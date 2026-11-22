import json
import os
import re
import threading
import time
import uuid
from collections import OrderedDict, deque
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request
from werkzeug.exceptions import HTTPException


def _env_int(name, default):
    try:
        return max(1, int(os.getenv(name, default)))
    except ValueError:
        return default


MAX_EXPAND_PER_WAVE = _env_int("SHADOW_MAX_EXPAND", 500)       # frontier nodes expanded per wave
MAX_WAVES_PER_CALL = _env_int("SHADOW_MAX_WAVES", 100)         # waves per /advance call
MAX_DISCOVERED = _env_int("SHADOW_MAX_DISCOVERED", 50_000)     # memory bound per session
TIME_BUDGET_S = _env_int("SHADOW_TIME_BUDGET_MS", 2500) / 1000  # wall-clock bound per call
SESSION_TTL_S = _env_int("SHADOW_SESSION_TTL", 1800)
MAX_SESSIONS = _env_int("SHADOW_MAX_SESSIONS", 200)
NEO4J_PROBE_TTL_S = _env_int("SHADOW_NEO4J_PROBE_TTL", 10)

HIGH_VALUE = ("critical", "high")
SIM_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
CYPHER_LIST_CAP = 200


class ShadowError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ----------------------------------------------------------------------
# Graph sources: the only thing the simulation needs from a graph.
# ----------------------------------------------------------------------
def _node_payload(node):
    return {"id": node["id"], "label": node.get("label", node["id"]),
            "type": node.get("type", "asset"),
            "criticality": node.get("criticality", "medium"),
            "description": node.get("description", "")}


class MemoryGraphSource:
    """Adjacency-indexed in-memory graph (JSON fallback). Built once, reused."""
    name = "json_fallback"

    def __init__(self, data):
        self.nodes = {n["id"]: _node_payload(n) for n in data["nodes"]}
        self.out = {}
        for index, e in enumerate(data["edges"]):
            # Same id formula as app.build_graph / the frontend, so ids line up.
            edge_id = e.get("id") or f'{e["source"]}|{e["target"]}|{e["relation"]}|{index}'
            self.out.setdefault(e["source"], []).append(
                {"id": edge_id, "source": e["source"], "target": e["target"],
                 "relation": e["relation"]})
        by_crit = {}
        for n in self.nodes.values():
            by_crit[n["criticality"]] = by_crit.get(n["criticality"], 0) + 1
        self._totals = {"nodes": len(self.nodes), "edges": len(data["edges"]),
                        "by_criticality": by_crit}

    def totals(self):
        return self._totals

    def get_nodes(self, ids):
        return {i: self.nodes[i] for i in ids if i in self.nodes}

    def out_edges(self, ids):
        rows = []
        for i in ids:
            for e in self.out.get(i, ()):
                target = self.nodes.get(e["target"])
                if target:
                    rows.append({**e, "target_node": target})
        return rows


class Neo4jGraphSource:
    """Neo4j-backed source. Every call is a bounded, index-backed read."""
    name = "neo4j"

    def __init__(self, store):
        self.store = store
        self._totals, self._totals_at = None, 0.0

    def totals(self):
        if self._totals is None or time.monotonic() - self._totals_at > 30:
            self._totals, self._totals_at = self.store.graph_totals(), time.monotonic()
        return self._totals

    def get_nodes(self, ids):
        return {i: _node_payload(n) for i, n in self.store.fetch_entities(ids).items()}

    def out_edges(self, ids):
        rows = self.store.fetch_out_edges(ids)
        for r in rows:
            r["target_node"] = _node_payload(r["target_node"])
            r["id"] = r["id"] or f'{r["source"]}|{r["target"]}|{r["relation"]}'
        return rows


class SourceProvider:
    """Chooses Neo4j or the cached JSON source, without probing on every request."""

    def __init__(self, store, graph_json_path):
        self.store, self.path = store, Path(graph_json_path)
        self._mem, self._mem_key = None, None
        self._neo = Neo4jGraphSource(store) if store is not None else None
        self._probe_ok, self._probe_at = False, 0.0
        self._lock = threading.Lock()

    def _neo4j_up(self):
        if self.store is None or not self.store.configured:
            return False
        now = time.monotonic()
        if now - self._probe_at > NEO4J_PROBE_TTL_S:
            try:
                self._probe_ok = bool(self.store.verify().get("connected"))
            except Exception:
                self._probe_ok = False
            self._probe_at = now
        return self._probe_ok

    def _json(self):
        key = self.path.stat().st_mtime_ns
        with self._lock:
            if self._mem is None or key != self._mem_key:
                self._mem = MemoryGraphSource(json.loads(self.path.read_text(encoding="utf-8")))
                self._mem_key = key
            return self._mem

    def current(self):
        return self._neo if self._neo4j_up() else self._json()

    def for_backend(self, name):
        """Source a running session is pinned to (never silently switch datasets)."""
        if name != "neo4j":
            return self._json()
        if self._neo is None or not self._neo4j_up():
            raise ShadowError("Neo4j is no longer reachable. Restart the simulation.", 503)
        return self._neo


# ----------------------------------------------------------------------
# One attacker simulation = one overlay on the defender graph.
# ----------------------------------------------------------------------
class ShadowSession:
    def __init__(self, sim_id, backend, entry_nodes, totals):
        self.id, self.backend, self.totals = sim_id, backend, totals
        self.created = self.touched = time.time()
        self.step = 0
        self.discovered = {}      # node id -> {"step", "depth"}
        self.nodes = {}           # node id -> payload (only what the attacker found)
        self.edges = {}           # edge id -> (source, target, relation)
        self.frontier = deque()
        self.exposed = {}         # critical/high assets found: id -> info
        self.first_critical_step = None
        self.log = deque(maxlen=50)
        self.entry_points = [n["id"] for n in entry_nodes]
        self.capped = False
        self.lock = threading.Lock()
        for n in entry_nodes:
            self._discover(n, step=0, depth=0)
        self.log.append({"step": 0, "text": "Attacker foothold: " + ", ".join(
            n["label"] for n in entry_nodes)})

    def _discover(self, node, step, depth):
        nid = node["id"]
        self.discovered[nid] = {"step": step, "depth": depth}
        self.nodes[nid] = node
        self.frontier.append(nid)
        if node["criticality"] in HIGH_VALUE:
            self.exposed[nid] = {"id": nid, "label": node["label"],
                                 "criticality": node["criticality"], "step": step}
            if node["criticality"] == "critical" and self.first_critical_step is None:
                self.first_critical_step = step

    @property
    def exhausted(self):
        return not self.frontier or self.capped

    def advance(self, source, waves):
        """Run up to `waves` BFS waves; return what was newly discovered."""
        new_nodes, new_edges, new_log = [], [], []
        truncated = time_limited = False
        deadline = time.monotonic() + TIME_BUDGET_S
        done = 0
        while done < waves and self.frontier and not self.capped:
            if done and time.monotonic() > deadline:
                time_limited = True
                break
            take = min(len(self.frontier), MAX_EXPAND_PER_WAVE)
            truncated = truncated or take < len(self.frontier)
            batch = [self.frontier.popleft() for _ in range(take)]
            rows = source.out_edges(batch)          # one bounded read per wave
            self.step += 1
            found_labels = []
            for r in rows:
                tid = r["target"]
                is_new = tid not in self.discovered
                if is_new and len(self.discovered) >= MAX_DISCOVERED:
                    self.capped = True       # never record an edge to an undiscovered node
                    continue
                if r["id"] in self.edges:
                    continue
                self.edges[r["id"]] = (r["source"], tid, r["relation"])
                new_edges.append({"id": r["id"], "source": r["source"],
                                  "target": tid, "relation": r["relation"]})
                if is_new:
                    depth = self.discovered[r["source"]]["depth"] + 1
                    self._discover(r["target_node"], self.step, depth)
                    new_nodes.append({**r["target_node"], "step": self.step, "depth": depth})
                    found_labels.append(r["target_node"]["label"])
            entry = {"step": self.step, "text": (
                f"Expanded {len(batch)} node(s); found " + ", ".join(found_labels)
                if found_labels else f"Expanded {len(batch)} node(s); nothing new reachable")}
            self.log.append(entry)
            new_log.append(entry)
            done += 1
        self.touched = time.time()
        return {"nodes": new_nodes, "edges": new_edges,
                "log": new_log,
                "truncated": truncated, "time_limited": time_limited, "waves_run": done}

    # -- views ---------------------------------------------------------
    def counts(self):
        total = max(self.totals["nodes"], len(self.discovered))
        found = len(self.discovered)
        by_crit = self.totals.get("by_criticality", {})
        return {
            "total_nodes": total, "discovered_nodes": found,
            "blind_spots": max(total - found, 0),
            "total_edges": self.totals["edges"], "discovered_edges": len(self.edges),
            "percentage": round(100 * found / max(total, 1), 1),
            "critical_total": by_crit.get("critical", 0),
            "critical_found": sum(1 for v in self.exposed.values() if v["criticality"] == "critical"),
            "high_total": by_crit.get("high", 0),
            "high_found": sum(1 for v in self.exposed.values() if v["criticality"] == "high"),
        }

    def cypher(self):
        """Read-only query that reproduces the attacker view in Neo4j Browser / Bloom."""
        if len(self.discovered) > CYPHER_LIST_CAP:
            return None
        ids = json.dumps(sorted(self.discovered))
        return (f"MATCH (n:Entity) WHERE n.id IN {ids} "
                f"OPTIONAL MATCH (n)-[r:RELATION]->(m:Entity) WHERE m.id IN {ids} "
                "RETURN n, r, m")

    def view(self, delta=None, full=False):
        out = {
            "simulation_id": self.id, "backend": self.backend, "step": self.step,
            "entry_points": self.entry_points, "counts": self.counts(),
            "frontier_size": len(self.frontier), "frontier": list(self.frontier)[:20],
            "exhausted": self.exhausted, "capped": self.capped,
            "first_critical_step": self.first_critical_step,
            "exposed_assets": sorted(self.exposed.values(), key=lambda v: (v["step"], v["id"])),
            "cypher": self.cypher(),
            "note": ("Attacker discovery follows outgoing directed relationships only, one "
                     "breadth-first wave per step. The underlying graph is never modified.")}
        if delta is not None:
            out["delta"] = delta
            out["truncated"] = delta["truncated"]
            out["time_limited"] = delta["time_limited"]
        if full:
            out["nodes"] = [{**n, **self.discovered[i]} for i, n in self.nodes.items()]
            out["edges"] = [{"id": i, "source": s, "target": t, "relation": r}
                            for i, (s, t, r) in self.edges.items()]
            out["log"] = list(self.log)
        return out


class SessionStore:
    """Thread-safe, TTL + LRU bounded session registry."""

    def __init__(self):
        self._items, self._lock = OrderedDict(), threading.Lock()

    def _evict(self, now):
        for k in [k for k, s in self._items.items() if now - s.touched > SESSION_TTL_S]:
            del self._items[k]
        while len(self._items) > MAX_SESSIONS:
            self._items.popitem(last=False)

    def put(self, session):
        with self._lock:
            self._items[session.id] = session
            self._items.move_to_end(session.id)
            self._evict(time.time())

    def get(self, sim_id):
        with self._lock:
            self._evict(time.time())
            s = self._items.get(sim_id)
            if s:
                s.touched = time.time()
                self._items.move_to_end(sim_id)
            return s

    def pop(self, sim_id):
        with self._lock:
            return self._items.pop(sim_id, None)

    def __len__(self):
        with self._lock:
            return len(self._items)


# ----------------------------------------------------------------------
# HTTP API
# ----------------------------------------------------------------------
def _parse_waves(value):
    if value in (None, ""):
        return 1
    if value == "all":
        return MAX_WAVES_PER_CALL
    try:
        return max(1, min(int(value), MAX_WAVES_PER_CALL))
    except (TypeError, ValueError):
        raise ShadowError("steps must be a positive integer or 'all'.")


def create_shadow_blueprint(provider, sessions=None):
    bp = Blueprint("shadow", __name__, url_prefix="/api/shadow")
    sessions = sessions if sessions is not None else SessionStore()
    bp.sessions = sessions

    def body():
        return request.get_json(silent=True) or {}

    def require(sim_id):
        if not sim_id:
            raise ShadowError("simulation_id is required.")
        s = sessions.get(sim_id)
        if not s:
            raise ShadowError("Simulation not found or expired. Start a Shadow Graph simulation first.", 404)
        return s

    @bp.errorhandler(ShadowError)
    def handle_shadow_error(exc):
        return jsonify({"error": str(exc)}), exc.status

    @bp.errorhandler(Exception)
    def handle_backend_error(exc):
        # A failing Neo4j read must not surface as an opaque 500 or a corrupted session.
        if isinstance(exc, ShadowError):
            return handle_shadow_error(exc)
        if isinstance(exc, HTTPException):
            return exc
        current_app.logger.exception("Shadow Graph backend error")
        return jsonify({"error": f"Graph backend error ({type(exc).__name__}). Try again or restart the simulation."}), 503

    @bp.post("/start")
    def start():
        data = body()
        entry_ids = data["start_nodes"] if "start_nodes" in data else [data.get("start_node", "D01")]
        if not isinstance(entry_ids, list) or not entry_ids or len(entry_ids) > 20 \
                or not all(isinstance(i, str) for i in entry_ids):
            raise ShadowError("start_nodes must be a list of 1-20 node ids.")
        sim_id = data.get("simulation_id") or f"SIM-{uuid.uuid4().hex[:12]}"
        if not isinstance(sim_id, str) or not SIM_ID_RE.match(sim_id):
            raise ShadowError("simulation_id must be 1-64 characters: letters, digits, _ . -")
        source = provider.current()
        entry = source.get_nodes(list(dict.fromkeys(entry_ids)))
        missing = [i for i in entry_ids if i not in entry]
        if missing:
            raise ShadowError(f"Unknown start node: {', '.join(missing)}")
        session = ShadowSession(sim_id, source.name, [entry[i] for i in dict.fromkeys(entry_ids)],
                                source.totals())
        sessions.put(session)
        view = session.view(full=True)
        view["start_node"] = session.entry_points[0]
        return jsonify(view)

    @bp.post("/advance")
    def advance():
        data = body()
        session = require(data.get("simulation_id"))
        waves = _parse_waves(data.get("steps"))
        source = provider.for_backend(session.backend)
        with session.lock:
            if session.exhausted:
                delta = {"nodes": [], "edges": [], "log": [], "truncated": False,
                         "time_limited": False, "waves_run": 0}
                view = session.view(delta)
                view["message"] = ("Discovery limit reached for this simulation." if session.capped
                                   else "Discovery frontier is exhausted: no more reachable entities.")
                return jsonify(view)
            delta = session.advance(source, waves)
            view = session.view(delta)
        found = len(delta["nodes"])
        view["message"] = (f"{delta['waves_run']} wave(s): {found} new entit"
                           f"{'y' if found == 1 else 'ies'}, {len(delta['edges'])} relationship(s) revealed."
                           if found else "No new reachable entities; the attacker has hit the edge of what is reachable.")
        return jsonify(view)

    @bp.get("/state")
    @bp.get("/attacker-view")
    def state():
        session = require(request.args.get("simulation_id"))
        with session.lock:
            return jsonify(session.view(full=True))

    @bp.post("/reset")
    def reset():
        sim_id = body().get("simulation_id")
        if sim_id:
            sessions.pop(sim_id)
        return jsonify({"ok": True, "simulation_id": sim_id})

    return bp
