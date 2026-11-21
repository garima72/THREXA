from flask import Flask, jsonify, render_template, request
from pathlib import Path
from collections import defaultdict
import json, os
import networkx as nx
from dotenv import load_dotenv
from neo4j_store import Neo4jStore

load_dotenv()
app = Flask(__name__)
BASE = Path(__file__).resolve().parent
store = Neo4jStore()
_shadow_sessions = {}
_analyst_sessions = defaultdict(set)

CRITICALITY = {"low": 0.25, "medium": 0.5, "high": 0.75, "critical": 1.0}
RELATION_COST = {
    "uses": 0.8, "connects_to": 0.7, "admin_session": 1.5,
    "hosts": 1.0, "administers": 1.5, "reads_from": 1.2,
    "network_event": 0.5, "shares_network": 0.8
}

def load_json(filename):
    with open(BASE / "data" / filename, encoding="utf-8") as f:
        return json.load(f)

def neo4j_status():
    return store.verify()

def get_graph_data():
    status = neo4j_status()
    if status["connected"]:
        try:
            return store.fetch_graph(), "neo4j"
        except Exception:
            pass
    return load_json("graph.json"), "json_fallback"

def get_alerts_data():
    status = neo4j_status()
    if status["connected"]:
        try:
            return store.fetch_alerts(), "neo4j"
        except Exception:
            pass
    return load_json("alerts.json"), "json_fallback"

def build_graph():
    data, backend = get_graph_data()
    graph = nx.MultiDiGraph()
    for node in data["nodes"]:
        graph.add_node(node["id"], **node)
    for index, edge in enumerate(data["edges"]):
        edge_id = edge.get("id") or f'{edge["source"]}|{edge["target"]}|{edge["relation"]}|{index}'
        graph.add_edge(edge["source"], edge["target"], key=edge_id, id=edge_id,
                       relation=edge["relation"], label=edge["relation"])
    return graph, data, backend

def node_payload(node_id, attrs):
    return {"id": node_id, "label": attrs.get("label", node_id),
            "type": attrs.get("type", "asset"),
            "criticality": attrs.get("criticality", "medium"),
            "description": attrs.get("description", "")}

def json_error(message, status=400):
    return jsonify({"error": message}), status

@app.route("/")
def home():
    return render_template("index.html")

@app.get("/api/neo4j/status")
def neo4j_status_api():
    # Return quickly. Do not let a slow/failed Neo4j connection hang the UI.
    try:
        status = neo4j_status()
    except Exception as exc:
        status = {
            "configured": bool(store.configured),
            "connected": False,
            "mode": "json_fallback",
            "message": f"Status check error ({type(exc).__name__}). Using JSON fallback."
        }
    status["active_backend"] = "neo4j" if status.get("connected") else "json_fallback"
    return jsonify(status)

@app.post("/api/neo4j/import")
def neo4j_import():
    if not store.configured:
        return json_error("Neo4j is not configured. Add credentials to .env first.", 503)
    try:
        counts = store.import_dataset(load_json("graph.json"), load_json("alerts.json"))
        return jsonify({"ok": True, "counts": counts,
                        "message": "Synthetic graph and alerts imported into Neo4j."})
    except Exception as exc:
        return json_error(f"Neo4j import failed: {type(exc).__name__}: {exc}", 500)

@app.get("/api/graph")
def graph_data():
    data, backend = get_graph_data()
    return jsonify({"nodes": data["nodes"], "edges": data["edges"], "backend": backend})

@app.get("/api/alerts")
def alerts():
    data, _ = get_alerts_data()
    return jsonify(data)

@app.get("/api/blast-radius/<node_id>")
def blast_radius(node_id):
    graph, _, backend = build_graph()
    if node_id not in graph:
        return json_error(f"Unknown node: {node_id}", 404)
    undirected = graph.to_undirected()
    distances = nx.single_source_shortest_path_length(undirected, node_id, cutoff=3)
    impacted = [{**node_payload(n, graph.nodes[n]), "hops": hops}
                for n, hops in distances.items() if n != node_id]
    impacted.sort(key=lambda item: (item["hops"], item["criticality"], item["label"]))
    return jsonify({"source": node_payload(node_id, graph.nodes[node_id]),
        "impacted": impacted, "counts": {
            "one_hop": sum(x["hops"] == 1 for x in impacted),
            "two_hop": sum(x["hops"] == 2 for x in impacted),
            "three_hop": sum(x["hops"] == 3 for x in impacted)},
        "backend": backend,
        "note": "Potential graph reachability only; it does not prove compromise or exploitability."})

@app.get("/api/attack-path")
def attack_path():
    graph, _, backend = build_graph()
    source, target = request.args.get("source", ""), request.args.get("target", "")
    if source not in graph or target not in graph:
        return json_error("Choose valid source and target nodes.")
    try:
        path = nx.shortest_path(graph.to_undirected(), source, target)
    except nx.NetworkXNoPath:
        return jsonify({"path": [], "message": "No path found in the current sample graph."})
    return jsonify({"path": [node_payload(n, graph.nodes[n]) for n in path],
        "length": len(path)-1, "backend": backend,
        "note": "Shortest undirected relationship path in the model; not a confirmed attacker route."})

@app.get("/api/choke-points")
def choke_points():
    graph, _, backend = build_graph()
    centrality = nx.betweenness_centrality(graph.to_undirected(), normalized=True)
    ranked = sorted(centrality.items(), key=lambda pair: pair[1], reverse=True)
    return jsonify({"items": [{**node_payload(n, graph.nodes[n]), "score": round(score, 4)}
                              for n, score in ranked[:6] if score > 0],
        "backend": backend,
        "note": "Betweenness centrality is a structural indicator, not a security-risk score."})

@app.get("/api/incident")
def incident():
    graph, _, backend = build_graph()
    alerts_data, _ = get_alerts_data()
    items = []
    for alert in alerts_data:
        related = [entity for entity in alert.get("entities", []) if entity in graph]
        items.append({**alert, "related_nodes": related})
    return jsonify({"alerts": items,
        "summary": "Alerts are grouped by shared entity identifiers in the demonstration dataset.",
        "backend": backend,
        "note": "Synthetic-data correlation, not a production detection engine."})

@app.post("/api/blast-shield/simulate")
def blast_shield_simulate():
    body = request.get_json(silent=True) or {}
    source, target, edge_id = body.get("source", "D01"), body.get("target", "DB01"), body.get("edge_id")
    try:
        result = blast_shield_analysis(source, target)
    except ValueError as exc:
        return json_error(str(exc))
    candidate = next((x for x in result["candidates"] if x["id"] == edge_id), None)
    if not candidate:
        return json_error("Unknown candidate edge_id.")
    graph, _, _ = build_graph()
    model = graph.to_undirected()
    model.remove_edge(candidate["source"], candidate["target"], key=candidate["id"])
    still_connected = nx.has_path(model, source, target)
    try:
        remaining_paths = len(list(nx.all_simple_edge_paths(model, source, target,
                              cutoff=min(8, max(len(model)-1, 1)))))
    except nx.NetworkXNoPath:
        remaining_paths = 0
    return jsonify({"removed_edge_in_simulation": candidate,
        "source": source, "target": target, "still_connected": still_connected,
        "remaining_paths": remaining_paths,
        "disrupted_paths": max(result["total_paths"]-remaining_paths, 0),
        "note": "This is an in-memory what-if simulation only. The stored graph and real infrastructure are unchanged."})

if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
            host="127.0.0.1", port=int(os.getenv("PORT", "5000")))
