
import json
from pathlib import Path
from dotenv import load_dotenv
from neo4j_store import Neo4jStore

load_dotenv()

BASE = Path(__file__).resolve().parent

def main():
    graph = json.loads((BASE / "data" / "graph.json").read_text(encoding="utf-8"))
    alerts = json.loads((BASE / "data" / "alerts.json").read_text(encoding="utf-8"))
    store = Neo4jStore()
    if not store.configured:
        raise SystemExit("Configure NEO4J_URI and NEO4J_PASSWORD in .env first.")
    try:
        print("Imported:", store.import_dataset(graph, alerts))
        print("Neo4j status:", store.verify())
    finally:
        store.close()

if __name__ == "__main__":
    main()
