# THREXA | Graph-Based Cybersecurity Investigation Platform

 **From disconnected security alerts to connected investigation.**

THREXA is a graph-based cybersecurity investigation and decision-support platform designed to help analysts explore security entities, understand their relationships, investigate potential impact, and prioritize their next steps.

By representing users, devices, servers, applications, databases, and alerts as an interconnected graph, THREXA provides a unified view of security context and enables interactive graph-based investigation.

---

## Problem Statement

Cybersecurity analysts often struggle to investigate security alerts in complex, interconnected environments. Fragmented security information makes it difficult to understand relationships between entities, assess potential impact, trace connections, and prioritize investigations efficiently.

## Our Solution

THREXA transforms security entities, relationships, and alerts into an interactive graph-based investigation environment. It combines graph visualization, structural analysis, impact exploration, and explainable prioritization to support analysts in making more informed investigation decisions.

---

## Key Features

### 1. Interactive Graph Visualization
- Visual representation of entities and relationships.
- Interactive node selection and exploration.
- Zoom, pan, and graph navigation.
- Highlight relevant entities and connections.
- Explore complex relationships visually.

### 2. Alert Investigator
- Investigate security alerts with contextual information.
- Explore entities associated with an alert.
- Understand connected relationships surrounding suspicious activity.

### 3. Blast Radius
Explore the potential impact of a selected entity by identifying connected entities within a specified hop distance.

### 4. Attack Pathfinder
Find and visualize a structural path between selected source and target entities, including intermediate nodes.

### 5. Choke Point Analysis
Identify structurally important entities using graph centrality analysis, helping analysts discover important connectors within the network.

### 6. Shadow Graph
Explore connected graph entities progressively, allowing analysts to investigate relationships step by step without being overwhelmed by the entire graph.

## Technology Stack

| Technology | Role |
|---|---|
| Python | Core backend and analysis logic |
| Flask | Backend framework and REST API |
| NetworkX | Graph algorithms and structural analysis |
| Neo4j | Graph database and relationship storage |
| JavaScript | Frontend interaction and API communication |
| Cytoscape.js | Interactive graph visualization |
| HTML5 | Frontend structure |
| CSS3 | UI styling |
| JSON | Demo data and fallback data source |

---

## Architecture

                ┌─────────────────────────────┐
                │        Frontend            │
                │      HTML / CSS / JS       │
                │       Cytoscape.js         │
                └──────────────┬──────────────┘
                               │
                         API Requests
                               │
                ┌──────────────▼──────────────┐
                │       Flask Backend         │
                │       REST Endpoints       │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │       NetworkX Engine       │
                │  Graph & Analysis Logic     │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │       Graph Storage         │
                │       Neo4j / JSON          │
                └─────────────────────────────┘

### How it works

1. The analyst interacts with the THREXA interface.
2. The frontend sends requests to the Flask backend.
3. The backend retrieves graph data and executes analysis logic.
4. NetworkX performs graph computations.
5. Results are returned through APIs.
6. Cytoscape.js updates the graph and investigation interface.


## Graph Concepts

THREXA models a security environment using:

- **Nodes:** Entities such as users, laptops, servers, applications, databases, and alerts.
- **Edges:** Relationships between entities, such as connections, access, ownership, or associations.
- **Paths:** Sequences of connected entities.
- **Hops:** Number of connections traversed between entities.

These graph structures help analysts investigate relationships and explore potential impact.

---

## Installation & Setup

### Prerequisites

- Python 3.10+
- Git
- Neo4j database (for Neo4j integration)

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/THREXA.git
cd THREXA
```

### 2. Create a virtual environment

```bash
python -m venv venv
```

Activate it:

**Windows**
```bash
venv\Scripts\activate
```

**Linux / macOS**
```bash
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

Create a `.env` file using the project's `.env.example` template.

Add your Neo4j connection configuration and credentials as required by the project.

> Never commit credentials, API keys, database passwords, or your `.env` file.

### 5. Run the application

```bash
python app.py
```

Open the local URL displayed in your terminal to access THREXA.

---

## Demo Data

THREXA currently supports a demonstration environment using synthetic cybersecurity entities, relationships, and alerts.

The demo environment allows users to explore graph analysis features without requiring access to a real organization's security infrastructure.

---

## Project Limitations

THREXA is currently a  prototype and decision-support tool.

- Uses synthetic demonstration data.
- Does not currently ingest live enterprise SIEM/EDR telemetry.
- Graph paths represent structural connections, not confirmed attacker movement.
- Blast Radius represents modeled reachability, not confirmed compromise.
- Analyst Augmentation uses explainable heuristic scoring, not a trained machine-learning model or probability of compromise.
- Blast Shield performs hypothetical graph analysis, not real-world remediation.
- Enterprise-scale performance and production security have not yet been fully validated.

---

## Future Scope

- Integration with SIEM, EDR, IAM, and cloud security data sources.
- Real-time security event ingestion.
- Authentication, authorization, and role-based access control.
- Advanced graph filtering, clustering, and scalable graph exploration.
- Improved threat prioritization and contextual risk analysis.
- Audit logging and secure deployment.
- Benchmarking with larger, realistic security graphs.

---

## Team

**Team QUBRIX**

Built as a cybersecurity graph investigation project.

---

## Disclaimer

THREXA is an investigation-support prototype intended for educational, demonstration, and research purposes. Its outputs are based on the graph data provided and should not be interpreted as proof of compromise, exploitability, or actual attacker movement. Security decisions should be validated by qualified analysts.

---

**THREXA — Explore connections. Understand impact. Investigate smarter.**

