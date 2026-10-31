# GraphOps — Threat Investigation Workbench

A runnable educational prototype for graph-based security investigation. It demonstrates three connected workflows using **synthetic data**:

1. Connected Alert Investigator — displays sample alerts and the entities each alert references.
2. Incident Impact Explorer — calculates the 1-, 2-, and 3-hop neighborhood around a selected node.
3. Attack Path & Containment Planner — finds a shortest relationship path to a selected target and ranks potential choke points using betweenness centrality.

## Requirements
- Python 3.10 or newer
- pip

## Run locally
```bash
# 1. Extract the ZIP and open the GraphOps_Submission folder
# 2. (Recommended) create a virtual environment
python -m venv .venv

# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Start the app
python app.py
```
Open http://127.0.0.1:5000 in a browser.

## Demo walkthrough
1. The graph loads with a simulated employee laptop `D01` selected.
2. Click **Calculate blast radius**. Review the reachable nodes by hop count.
3. Set the critical target to **Payroll DB (DB01)** and click **Find relationship path**.
4. Click **Show potential choke points** to see nodes with high betweenness centrality.
5. Review the sample alerts and their related graph entities.

## API endpoints
- `GET /api/graph` — graph nodes and edges
- `GET /api/alerts` — synthetic alert records
- `GET /api/incident` — alert/entity correlation view
- `GET /api/blast-radius/<node_id>` — reachable neighborhood up to three hops
- `GET /api/attack-path?source=D01&target=DB01` — shortest undirected relationship path
- `GET /api/choke-points` — top nodes by betweenness centrality

## Data model
Nodes represent users, devices, servers, applications, databases, and IP addresses. Edges represent relationships such as `uses`, `connects_to`, `admin_session`, `hosts`, and `reads_from`. The graph and alerts are stored in JSON under `data/`, making the demo easy to inspect and modify.

## Important limitations
- All telemetry and alerts are fabricated for demonstration. No real organization data is collected.
- Relationships are treated as traversable in either direction for blast-radius and shortest-path demonstrations. A production engine must preserve direction, permissions, time, and relationship semantics.
- A graph path is not proof that an attacker traversed or can exploit that path.
- Betweenness centrality is a structural graph metric, not a validated security-risk score.
- Alert correlation is based on shared entity IDs in a fixed sample, not a trained or production detection system.
- This prototype does not connect to a SIEM, EDR, CMDB, identity provider, or live network.
- Do not use it to make real containment decisions.

## Suggested next steps
Add time-stamped edges, direction-aware path rules, real (authorized) telemetry connectors, analyst feedback, authentication, automated tests, and a security review before any operational use.
