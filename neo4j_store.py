"""Neo4j persistence layer for THREXA.

Neo4j is enabled when NEO4J_URI is configured. The application deliberately
keeps a JSON/NetworkX fallback so the demo remains runnable without credentials.
"""
import os
from neo4j import GraphDatabase

class Neo4jStore:
    def __init__(self):
        self.uri = os.getenv("NEO4J_URI", "").strip()
        self.username = os.getenv("NEO4J_USERNAME", "neo4j")
        self.password = os.getenv("NEO4J_PASSWORD", "")
        self.database = os.getenv("NEO4J_DATABASE", "").strip() or None
        self.driver = None
        if self.uri and self.password:
            self.driver = GraphDatabase.driver(
                self.uri, auth=(self.username, self.password),
                connection_timeout=5, max_connection_pool_size=20
            )

    @property
    def configured(self):
        return self.driver is not None

    def _get_session(self):
        if self.database:
            return self.driver.session(database=self.database)
        return self.driver.session()

    def verify(self):
        if not self.driver:
            return {"configured": False, "connected": False,
                    "mode": "json_fallback",
                    "message": "Neo4j credentials are not configured; using local JSON data."}
        try:
            self.driver.verify_connectivity()
            with self._get_session() as session:
                record = session.run("RETURN 1 AS ok").single()
            return {"configured": True, "connected": bool(record and record["ok"] == 1),
                    "mode": "neo4j", "database": self.database or "default",
                    "message": "Connected to Neo4j."}
        except Exception as exc:
            # Always return quickly so the UI does not stay stuck on "checking"
            return {"configured": True, "connected": False,
                    "mode": "json_fallback",
                    "message": f"Neo4j connection failed; using JSON fallback ({type(exc).__name__}: {str(exc)[:120]})."}

    def import_dataset(self, graph_data, alerts):
        if not self.driver:
            raise RuntimeError("Neo4j is not configured. Set NEO4J_URI and NEO4J_PASSWORD.")
        with self._get_session() as session:
            # Run schema DDL as auto-commit statements before the data transaction.
            session.run("CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE").consume()
            session.run("CREATE CONSTRAINT alert_id IF NOT EXISTS FOR (a:Alert) REQUIRE a.id IS UNIQUE").consume()
            session.run("CREATE INDEX entity_criticality IF NOT EXISTS FOR (n:Entity) ON (n.criticality)").consume()
            def tx_import(tx):
                for node in graph_data["nodes"]:
                    tx.run("""
                        MERGE (n:Entity {id:$id})
                        SET n.label=$label, n.type=$type, n.criticality=$criticality,
                            n.description=$description, n.x=$x, n.y=$y
                    """, id=node["id"], label=node.get("label", node["id"]),
                         type=node.get("type", "asset"),
                         criticality=node.get("criticality", "medium"),
                         description=node.get("description", ""),
                         x=node.get("x"), y=node.get("y"))
                for index, edge in enumerate(graph_data["edges"]):
                    edge_id = edge.get("id") or f'{edge["source"]}|{edge["target"]}|{edge["relation"]}|{index}'
                    tx.run("""
                        MATCH (s:Entity {id:$source}), (t:Entity {id:$target})
                        MERGE (s)-[r:RELATION {id:$edge_id}]->(t)
                        SET r.relation=$relation, r.label=$relation
                    """, source=edge["source"], target=edge["target"],
                         edge_id=edge_id, relation=edge["relation"])
                for alert in alerts:
                    tx.run("""
                        MERGE (a:Alert {id:$id})
                        SET a.time=$time, a.severity=$severity, a.title=$title,
                            a.description=$description, a.status=$status
                    """, id=alert["id"], time=alert.get("time"),
                         severity=alert.get("severity"), title=alert.get("title"),
                         description=alert.get("description"), status=alert.get("status"))
                    for entity_id in alert.get("entities", []):
                        tx.run("""
                            MATCH (e:Entity {id:$entity_id}), (a:Alert {id:$alert_id})
                            MERGE (e)-[:MENTIONED_IN]->(a)
                        """, entity_id=entity_id, alert_id=alert["id"])
                counts = tx.run("""
                    MATCH (n:Entity) WITH count(n) AS nodes
                    MATCH ()-[r:RELATION]->() WITH nodes, count(r) AS edges
                    MATCH (a:Alert) RETURN nodes, edges, count(a) AS alerts
                """).single()
                return dict(counts)
            return session.execute_write(tx_import)

    def fetch_graph(self):
        with self._get_session() as session:
            nodes = [dict(record["node"]) for record in session.run("""
                MATCH (n:Entity) RETURN n {.*} AS node ORDER BY n.id
            """)]
            edges = [dict(r) for r in session.run("""
                MATCH (s:Entity)-[r:RELATION]->(t:Entity)
                RETURN s.id AS source, t.id AS target, r.relation AS relation, r.id AS id
                ORDER BY source, target, id
            """)]
            return {"nodes": nodes, "edges": edges}

    # ------------------------------------------------------------------
    # Targeted, index-backed reads used by the Shadow Graph simulation.
    # They touch only the ids they are given, so cost scales with the
    # attacker's frontier, not with the size of the whole graph.
    # ------------------------------------------------------------------
    _NODE_PROPS = "{.id, .label, .type, .criticality, .description}"

    def _read(self, query, **params):
        def work(tx):
            return [record.data() for record in tx.run(query, **params)]
        with self._get_session() as session:
            return session.execute_read(work)

    def graph_totals(self):
        """Whole-graph counts (label/type count-store lookups plus one grouped scan)."""
        nodes = self._read("MATCH (n:Entity) RETURN count(n) AS c")[0]["c"]
        edges = self._read("MATCH ()-[r:RELATION]->() RETURN count(r) AS c")[0]["c"]
        by_crit = {row["c"] or "medium": row["k"] for row in self._read(
            "MATCH (n:Entity) RETURN n.criticality AS c, count(*) AS k")}
        return {"nodes": nodes, "edges": edges, "by_criticality": by_crit}

    def fetch_entities(self, ids, chunk=1000):
        ids, found = list(ids), {}
        for i in range(0, len(ids), chunk):
            for row in self._read(
                    f"MATCH (n:Entity) WHERE n.id IN $ids RETURN n {self._NODE_PROPS} AS node",
                    ids=ids[i:i + chunk]):
                found[row["node"]["id"]] = row["node"]
        return found

    def fetch_out_edges(self, ids, chunk=1000):
        """Outgoing relationships for a batch of node ids, with target node properties."""
        ids, edges = list(ids), []
        for i in range(0, len(ids), chunk):
            edges.extend(self._read(f"""
                MATCH (s:Entity)-[r:RELATION]->(t:Entity)
                WHERE s.id IN $ids
                RETURN s.id AS source, t.id AS target, r.relation AS relation,
                       r.id AS id, t {self._NODE_PROPS} AS target_node
            """, ids=ids[i:i + chunk]))
        return edges

    def fetch_alerts(self):
        with self._get_session() as session:
            rows = session.run("""
                MATCH (a:Alert)
                OPTIONAL MATCH (e:Entity)-[:MENTIONED_IN]->(a)
                RETURN a {.*} AS alert, collect(e.id) AS entities
                ORDER BY a.id
            """)
            return [{**dict(row["alert"]), "entities": row["entities"]} for row in rows]

    def close(self):
        if self.driver:
            self.driver.close()
