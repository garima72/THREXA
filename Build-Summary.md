# GraphOps — Build Summary

**Theme:** Cybersecurity and Technology  
**Challenge:** Graph analytics for proactive threat hunting and blast-radius containment.

## Final problem statement
Security alerts and asset relationships can be difficult to interpret as one connected incident. GraphOps demonstrates how a connected graph of identities, devices, servers, applications, and databases can help an analyst inspect related alerts, estimate potential graph reachability, and examine structural paths toward critical assets.

## What changed
The prototype scope combines three related steps into one workflow: connect alerts, explore potential impact, and inspect paths/choke points. The user segment and real-world need remain hypotheses until validated with target users.

## What is built
- Interactive graph of 10 synthetic entities and 10 relationships.
- Five synthetic security alerts linked to graph entities.
- 1-hop, 2-hop, and 3-hop neighborhood analysis.
- Shortest undirected relationship path to a selected target.
- Betweenness-centrality ranking for potential choke points.
- Flask JSON API and browser dashboard.

## Deliberate omissions
No live SIEM/EDR/CMDB integration, no real-time streaming, no automated blocking, no production anomaly detection, no machine-learning model, and no claim of predicting exploitability.

## Technology stack
Python + Flask + NetworkX + HTML/CSS/JavaScript + SVG + JSON. This keeps the prototype easy to run and inspect without a separate frontend build system.

## Verified vs assumed
**Verified in prototype:** included sample data loads; API calculates neighborhoods, paths, and centrality metrics. Confirm by running the app and following README steps.

**Assumptions requiring evidence:** the target user needs this workflow; the interface improves investigation speed or clarity; choke-point ranking supports better prioritization.

**Data status:** all included data is synthetic.

## Next build
Conduct 3–5 short usability sessions with the chosen target user, record task completion and feedback, then improve direction/time-aware graph relationships and add automated tests.
