# THREXA — Think in Graphs. Hunt Smarter.

**A Graph-Powered Cyber Threat Analysis Platform**

THREXA is an educational cybersecurity investigation prototype developed by **Team QUBRIX** for the HackFront India AI Builder Challenge.

It demonstrates how graph analytics can help security analysts move beyond isolated security alerts and understand relationships between users, devices, servers, applications, and other infrastructure assets.

By representing security entities as interconnected graph nodes, THREXA provides three investigation capabilities using synthetic security data.

---

## Core Features

### 1. Connected Alert Investigator
- Displays sample security alerts.
- Identifies entities referenced by individual alerts.
- Demonstrates how alerts can be connected through shared graph entities.
- Provides a connected view of security-related information.

### 2. Incident Impact Explorer
- Select a potentially compromised device, account, or other graph node.
- Explore its connected neighborhood across 1-hop, 2-hop, and 3-hop relationships.
- Understand which assets may be structurally connected to the selected entity.
- Visualize the potential scope of an incident.

### 3. Attack Path & Containment Planner
- Explore the shortest relationship path between a selected source and target.
- Identify intermediate systems connecting potentially compromised assets to critical infrastructure.
- Rank potential choke points using betweenness centrality.
- Help analysts understand important connections within the infrastructure graph.

---

## Technology Stack

| Component | Technology |
|---|---|
| Backend | Python, Flask |
| Graph Analytics | NetworkX |
| Frontend | HTML, CSS, JavaScript |
| Data Storage | JSON |
| Visualization | SVG / JavaScript |

---

## Project Structure
THREXA/
│
├── app.py
├── requirements.txt
│
├── data/
│   ├── graph.json
│   └── alerts.json
│
├── templates/
│   └── index.html
│
├── static/
│   ├── style.css
│   └── app.js
│
└── README.md


---

## Getting Started

### Requirements
- Python 3.10 or newer
- pip

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd YOUR_REPOSITORY_FOLDER
```

Replace the placeholders with your actual GitHub repository URL and folder name.

### 2. Create a virtual environment

```bash
python -m venv .venv
```

Activate it:

**Windows PowerShell**
```powershell
.venv\Scripts\Activate.ps1
```

**macOS / Linux**
```bash
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the application

```bash
python app.py
```

### 5. Open in your browser

Visit:

http://127.0.0.1:5000

---

## Demo Walkthrough

Follow these steps to explore THREXA:

1. Launch the application and explore the sample security graph.
2. Open the **Connected Alert Investigator** and review the sample alerts and their associated entities.
3. Select `D01` (Laptop-07) in the Incident Impact Explorer.
4. Click **Calculate Blast Radius** to explore the connected neighborhood by hop count.
5. Select `DB01` (Payroll DB) as the target in the Attack Path Finder.
6. Click **Find Relationship Path** to explore the shortest relationship path.
7. Open **Potential Choke Points** to view nodes ranked by betweenness centrality.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/graph` | Returns graph nodes and edges |
| GET | `/api/alerts` | Returns synthetic security alerts |
| GET | `/api/incident` | Provides alert/entity correlation information |
| GET | `/api/blast-radius/<node_id>` | Calculates the neighborhood up to three hops |
| GET | `/api/attack-path?source=D01&target=DB01` | Finds the shortest undirected relationship path |
| GET | `/api/choke-points` | Returns nodes ranked by betweenness centrality |

---

## Graph Data Model

THREXA represents an organization's digital infrastructure as a graph.

**Node types include:**
- Users
- Devices
- Servers
- Applications
- Databases
- IP addresses

**Relationship types include:**
- `uses`
- `connects_to`
- `admin_session`
- `hosts`
- `reads_from`

The graph structure and sample alerts are stored in JSON files under the `data/` directory.

This makes the prototype easy to inspect, modify, and extend.

---

## Important Limitations

THREXA is currently an educational prototype, not a production cybersecurity platform.

- All telemetry, alerts, and graph relationships are synthetic and created for demonstration.
- Relationships are treated as traversable in either direction for blast-radius and shortest-path demonstrations.
- A discovered graph path does not prove that an attacker has traversed or can exploit that path.
- Betweenness centrality measures structural importance in a graph; it is not a validated security-risk score.
- Alert correlation uses shared entity IDs in a fixed sample dataset, not a trained detection model.
- The prototype does not connect to live SIEM, EDR, CMDB, identity-provider, or network systems.
- It does not execute automated containment actions.
- Its outputs should not be used to make real-world security or containment decisions.

---

## Future Scope

Potential improvements include:

- Direction-aware and time-stamped graph relationships.
- Integration with authorized SIEM, EDR, CMDB, and identity telemetry.
- More advanced attack-path analysis.
- Improved anomaly detection and alert correlation.
- Analyst feedback and investigation history.
- Authentication and role-based access control.
- Automated testing and performance optimization.

---

## Team

**Developed by Team QUBRIX**

Project: **THREXA**

Hackathon: **HackFront India — AI Builder Challenge**

**Think in Graphs. Hunt Smarter.**

---

<p align="center">
  Built with curiosity, collaboration, and a passion for cybersecurity.
</p>
