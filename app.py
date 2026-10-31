from flask import Flask, jsonify, render_template, request
import json
from pathlib import Path
import networkx as nx

app = Flask(__name__)
BASE = Path(__file__).resolve().parent

def load_json(filename):
    with open(BASE / "data" / filename, encoding="utf-8") as f:
        return json.load(f)

def build_graph():
    data = load_json("graph.json")
    graph = nx.DiGraph()
    for node in data["nodes"]:
        graph.add_node(node["id"], **node)
    for edge in data["edges"]:
        graph.add_edge(edge["source"], edge["target"],
                       relation=edge["relation"], label=edge["relation"])
    return graph, data

def node_payload(node_id, attrs):
    return {
        "id": node_id,
        "label": attrs.get("label", node_id),
        "type": attrs.get("type", "asset"),
        "criticality": attrs.get("criticality", "medium"),
        "description": attrs.get("description", "")
    }

@app.route("/")
def home():
    return render_template("index.html")

@app.get("/api/graph")
def graph_data():
    graph, raw = build_graph()
    return jsonify({
        "nodes": raw["nodes"],
        "edges": raw["edges"]
    })

@app.get("/api/alerts")
def alerts():
    return jsonify(load_json("alerts.json"))

@app.get("/api/blast-radius/<node_id>")
def blast_radius(node_id):
    graph, _ = build_graph()
    if node_id not in graph:
        return jsonify({"error": f"Unknown node: {node_id}"}), 404

    # Treat relationships as traversable in either direction for impact exploration.
    undirected = graph.to_undirected()
    distances = nx.single_source_shortest_path_length(undirected, node_id, cutoff=3)
    impacted = []
    for target, hops in distances.items():
        if target == node_id:
            continue
        impacted.append({
            **node_payload(target, graph.nodes[target]),
            "hops": hops
        })
    impacted.sort(key=lambda item: (item["hops"], item["criticality"], item["label"]))
    return jsonify({
        "source": node_payload(node_id, graph.nodes[node_id]),
        "impacted": impacted,
        "counts": {
            "one_hop": sum(x["hops"] == 1 for x in impacted),
            "two_hop": sum(x["hops"] == 2 for x in impacted),
            "three_hop": sum(x["hops"] == 3 for x in impacted)
        },
        "note": "Potential graph reachability only; it does not prove compromise or exploitability."
    })

@app.get("/api/attack-path")
def attack_path():
    graph, _ = build_graph()
    source = request.args.get("source", "")
    target = request.args.get("target", "")
    if source not in graph or target not in graph:
        return jsonify({"error": "Choose valid source and target nodes."}), 400
    undirected = graph.to_undirected()
    try:
        path = nx.shortest_path(undirected, source, target)
    except nx.NetworkXNoPath:
        return jsonify({"path": [], "message": "No path found in the current sample graph."})
    return jsonify({
        "path": [node_payload(n, graph.nodes[n]) for n in path],
        "length": len(path) - 1,
        "note": "This is a shortest relationship path in the sample graph, not a confirmed attacker route."
    })

@app.get("/api/choke-points")
def choke_points():
    graph, _ = build_graph()
    centrality = nx.betweenness_centrality(graph.to_undirected(), normalized=True)
    ranked = sorted(centrality.items(), key=lambda pair: pair[1], reverse=True)
    return jsonify({
        "items": [
            {**node_payload(node_id, graph.nodes[node_id]),
             "score": round(score, 4)}
            for node_id, score in ranked[:6] if score > 0
        ],
        "note": "Betweenness centrality is a structural indicator, not a security-risk score."
    })

@app.get("/api/incident")
def incident():
    # Demonstration: connect alerts that mention assets/users present in the graph.
    graph, _ = build_graph()
    alerts_data = load_json("alerts.json")
    items = []
    for alert in alerts_data:
        related = [entity for entity in alert["entities"] if entity in graph]
        items.append({**alert, "related_nodes": related})
    return jsonify({
        "alerts": items,
        "summary": "Alerts are grouped by shared entities in the demonstration dataset.",
        "note": "This is deterministic sample-data correlation, not a production detection engine."
    })

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
