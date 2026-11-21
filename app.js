let graphData = null;
let cy = null;
let selectedNode = null;
let highlighted = new Set();

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

// ==================== NODE COLORS ====================

function nodeColor(type, criticality) {
  if (criticality === "critical") {
    return "#ef817b";
  }

  const map = {
    user: "#80b9df",
    device: "#a7e3c2",
    server: "#f2b56b",
    application: "#d7a5e8",
    database: "#c084fc",
    ip: "#ef817b"
  };

  return map[type] || "#91a39f";
}

// ==================== GRAPH ELEMENTS ====================

function buildCyElements() {
  const nodes = graphData.nodes.map(n => ({
    data: {
      id: n.id,
      label: n.label,
      type: n.type,
      criticality: n.criticality,
      description: n.description
    }
  }));

  const edges = graphData.edges.map((e, i) => ({
    data: {
      id: e.id || `${e.source}|${e.target}|${e.relation}|${i}`,
      source: e.source,
      target: e.target,
      label: e.relation,
      relation: e.relation
    }
  }));

  return [...nodes, ...edges];
}

// ==================== CYTOSCAPE INITIALIZATION ====================

function initCytoscape() {
  if (cy) {
    cy.destroy();
  }

  cy = cytoscape({
    container: $("cy"),
    elements: buildCyElements(),

    style: [
      {
        selector: "node",
        style: {
          "background-color": ele =>
            nodeColor(
              ele.data("type"),
              ele.data("criticality")
            ),

          "label": "data(label)",
          "color": "#e9f0ed",
          "font-size": "9px",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 5,
          "text-wrap": "wrap",
          "text-max-width": 84,
          "text-background-color": "#0c1418",
          "text-background-opacity": 0.82,
          "text-background-padding": "2px",
          "min-zoomed-font-size": 8,
          "width": 34,
          "height": 34,
          "border-width": 2,
          "border-color": "#29383d"
        }
      },

      {
        selector: "edge",
        style: {
          "width": 1.5,
          "line-color": "#3a4f55",
          "target-arrow-color": "#3a4f55",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "label": "",
          "font-size": "7px",
          "color": "#91a39f",
          "text-rotation": "autorotate",
          "text-background-color": "#0c1418",
          "text-background-opacity": 0.88,
          "text-background-padding": "2px"
        }
      },

      {
        selector: "node.highlighted",
        style: {
          "border-width": 4,
          "border-color": "#a7e3c2",
          "background-color": "#4fbd91"
        }
      },

      {
        selector: "edge.highlighted",
        style: {
          "line-color": "#a7e3c2",
          "target-arrow-color": "#a7e3c2",
          "width": 3,
          "label": "data(label)",
          "font-size": "9px"
        }
      },

      {
        selector: "node.selected",
        style: {
          "border-width": 5,
          "border-color": "#f2b56b"
        }
      }
    ],

    layout: {
      name: "cose",
      animate: true,
      animationDuration: 900,
      nodeRepulsion: 18000,
      nodeOverlap: 24,
      idealEdgeLength: 155,
      gravity: 0.12,
      componentSpacing: 90,
      padding: 55
    },

    minZoom: 0.25,
    maxZoom: 1.8,
    wheelSensitivity: 0.18
  });

  // Node selection
  cy.on("tap", "node", evt => {
    selectNode(evt.target.id());
  });

  // Fit graph after layout finishes
  cy.on("layoutstop", () => {
    fitGraphSafely();
  });

  // Deselect when clicking empty graph space
  cy.on("tap", evt => {
    if (evt.target === cy) {
      selectedNode = null;

      if ($("selectedLabel")) {
        $("selectedLabel").textContent =
          "Select a node to inspect it.";
      }

      cy.nodes().removeClass("selected");
    }
  });
}

// ==================== NODE SELECTION ====================

function selectNode(id) {
  selectedNode = id;

  const node = graphData.nodes.find(n => n.id === id);

  if (!node) return;

  if ($("selectedLabel")) {
    $("selectedLabel").textContent =
      `${node.label} (${node.type}) — ${node.criticality} criticality`;
  }

  cy.nodes().removeClass("selected");

  cy.getElementById(id).addClass("selected");

  if ($("sourceSelect")) {
    $("sourceSelect").value = id;
  }

  if ($("pathSource")) {
    $("pathSource").value = id;
  }
}

// ==================== GRAPH HIGHLIGHTING ====================

function highlightNodes(ids, edges = []) {
  if (!cy) return;

  cy.elements().removeClass("highlighted");

  ids.forEach(id => {
    cy.getElementById(id).addClass("highlighted");
  });

  edges.forEach(e => {
    const edge = cy.edges().filter(ed =>
      ed.data("source") === e.source &&
      ed.data("target") === e.target
    );

    edge.addClass("highlighted");
  });
}

// ==================== FIT GRAPH ====================

function fitGraphSafely() {
  if (!cy || cy.nodes().length === 0) {
    return;
  }

  cy.fit(cy.elements(), 45);

  // Limit maximum fit zoom
  if (cy.zoom() > 1.15) {
    cy.zoom(1.15);
  }

  cy.center();
}

// ==================== ZOOM IN / OUT ====================

function zoomGraph(factor) {
  if (!cy || !Number.isFinite(factor) || factor <= 0) {
    return;
  }

  const container = cy.container();

  if (!container) {
    return;
  }

  const width = cy.width();
  const height = cy.height();

  if (!width || !height) {
    return;
  }

  const currentZoom = cy.zoom();

  const nextZoom = Math.max(
    cy.minZoom(),
    Math.min(
      cy.maxZoom(),
      currentZoom * factor
    )
  );

  // Zoom around graph center
  cy.zoom({
    level: nextZoom,
    renderedPosition: {
      x: width / 2,
      y: height / 2
    }
  });
}

// ==================== DROPDOWN MENUS ====================

function fillSelects() {
  const options = graphData.nodes.map(n =>
    `<option value="${n.id}">
      ${escapeHtml(n.label)} (${n.id})
    </option>`
  ).join("");

  const selectIds = [
    "sourceSelect",
    "pathSource",
    "pathTarget",
    "shadowStart",
    "shieldSource",
    "shieldTarget"
  ];

  selectIds.forEach(id => {
    const el = $(id);

    if (el) {
      el.innerHTML = options;
    }
  });

  if ($("pathTarget")) {
    $("pathTarget").value = "DB01";
  }

  if ($("shieldTarget")) {
    $("shieldTarget").value = "DB01";
  }

  if ($("shieldSource")) {
    $("shieldSource").value = "D01";
  }

  if ($("shadowStart")) {
    $("shadowStart").value = "D01";
  }
}

// ==================== BLAST RADIUS ====================

async function blastRadius() {
  const node = $("sourceSelect").value;

  try {
    const data = await getJSON(
      `/api/blast-radius/${encodeURIComponent(node)}`
    );

    $("blastResult").className = "result";

    const hops = data.hops || {};

    const all = [].concat(
      ...Object.values(hops)
    );

    highlightNodes(
      all.map(n => n.id || n)
    );

    $("blastResult").innerHTML = `
      <b>${escapeHtml(data.label || node)}</b>
      — ${data.reachable_count || all.length}
      reachable within 3 hops<br>

      <small>
        1-hop: ${(hops["1"] || []).length}
        · 2-hop: ${(hops["2"] || []).length}
        · 3-hop: ${(hops["3"] || []).length}
      </small>

      <div class="muted">
        ${escapeHtml(data.note || "")}
      </div>
    `;
  } catch (e) {
    $("blastResult").textContent = e.message;
  }
}

// ==================== ATTACK PATH ====================

async function attackPath() {
  const source = $("pathSource").value;
  const target = $("pathTarget").value;

  try {
    const data = await getJSON(
      `/api/attack-path?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`
    );

    $("pathResult").className = "result";

    if (data.path && data.path.length) {
      const ids = data.path.map(p => p.id || p);

      highlightNodes(ids);

      $("pathResult").innerHTML = `
        <ol>
          ${data.path.map(p => `
            <li>
              ${escapeHtml(p.label || p.id || p)}
              <span class="tag">
                ${escapeHtml(p.type || "")}
              </span>
            </li>
          `).join("")}
        </ol>

        <span class="muted">
          ${escapeHtml(data.note || "")}
        </span>
      `;
    } else {
      $("pathResult").textContent =
        data.message || "No path found.";
    }
  } catch (e) {
    $("pathResult").textContent = e.message;
  }
}

// ==================== CHOKE POINTS ====================

async function chokePoints() {
  try {
    const data = await getJSON("/api/choke-points");

    const ids = (data.items || []).map(x => x.id);

    highlightNodes(ids);

    $("chokeResult").className = "result";

    $("chokeResult").innerHTML = `
      <ol>
        ${(data.items || []).map(x => `
          <li>
            ${escapeHtml(x.label)}
            — score ${x.score}
          </li>
        `).join("") || "<li>None found.</li>"}
      </ol>

      <span class="muted">
        ${escapeHtml(data.note || "")}
      </span>
    `;
  } catch (e) {
    $("chokeResult").textContent = e.message;
  }
}

// ==================== ALERTS ====================

async function loadAlerts() {
  const [alerts, incident] = await Promise.all([
    getJSON("/api/alerts"),
    getJSON("/api/incident")
  ]);

  $("alertCount").textContent = alerts.length;

  $("incidentSummary").textContent =
    (incident.summary || "") + " " +
    (incident.note || "");

  $("alerts").innerHTML = (incident.alerts || alerts)
    .map(a => `
      <article class="alert ${a.severity}">
        <div class="alert-top">
          <b>${escapeHtml(a.title)}</b>

          <span class="tag ${a.severity}">
            ${escapeHtml(a.severity.toUpperCase())}
          </span>
        </div>

        <p>${escapeHtml(a.description)}</p>

        <small>
          ${escapeHtml(a.id)}
          · ${escapeHtml(a.time)}
          · ${a.mitre ? escapeHtml(a.mitre) : ""}
          · RELATED:
          ${(a.related_nodes || a.entities || [])
            .map(escapeHtml)
            .join(", ")}
        </small>
      </article>
    `).join("");
}

// ==================== NEO4J STATUS ====================

async function loadBackendStatus() {
  $("backendStatus").innerHTML =
    `<i></i> JSON FALLBACK`;

  $("neo4jDetails").className = "result";

  $("neo4jDetails").textContent =
    "Checking Neo4j…";

  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, 5000);

  try {
    const res = await fetch("/api/neo4j/status", {
      signal: controller.signal
    });

    clearTimeout(timer);

    const s = await res.json();

    if (!res.ok) {
      throw new Error(s.error || "Status check failed");
    }

    $("backendStatus").innerHTML =
      `<i></i> ${s.connected
        ? "NEO4J CONNECTED"
        : "JSON FALLBACK"}`;

    $("neo4jDetails").innerHTML = `
      <b>${escapeHtml((s.mode || "").toUpperCase())}</b>

      <p>${escapeHtml(s.message || "")}</p>

      ${s.database
        ? `<small>Database: ${escapeHtml(s.database)}</small>`
        : ""}
    `;
  } catch (e) {
    clearTimeout(timer);

    $("backendStatus").innerHTML =
      `<i></i> JSON FALLBACK`;

    $("neo4jDetails").textContent =
      e.name === "AbortError"
        ? "Neo4j status check timed out. Using JSON fallback (app continues normally)."
        : "Neo4j unavailable. Using JSON fallback. " +
          (e.message || "");
  }
}

// ==================== ANALYST AUGMENTATION ====================

async function recommendNextStep() {
  try {
    const session =
      $("analystSession").value.trim() || "default";

    const d = await getJSON(
      `/api/analyst/next-step?session_id=${encodeURIComponent(session)}`
    );

    $("analystResult").className = "result";

    if (!d.recommendation) {
      $("analystResult").textContent =
        "All entities marked inspected for this session.";

      return;
    }

    const r = d.recommendation;

    $("analystResult").innerHTML = `
      <b>${escapeHtml(r.node.label)}</b>
      (${escapeHtml(r.node.id)})
      — score ${r.score}<br>

      <small>
        ${(r.reasons || []).join(" · ")}
      </small>

      <div class="muted tiny">
        Factors:
        centrality ${r.factors.centrality},
        alerts ${r.factors.alert_activity},
        criticality ${r.factors.criticality}
      </div>
    `;

    selectNode(r.node.id);
  } catch (e) {
    $("analystResult").textContent = e.message;
  }
}

async function markSelectedInspected() {
  if (!selectedNode) {
    return alert("Select a node first.");
  }

  const session =
    $("analystSession").value.trim() || "default";

  await postJSON("/api/analyst/inspected", {
    session_id: session,
    node_id: selectedNode
  });

  await recommendNextStep();
}

// ==================== SHADOW GRAPH ====================

async function startShadow() {
  const start = $("shadowStart").value;

  const d = await postJSON("/api/shadow/start", {
    start_node: start,
    simulation_id: "DEMO-SHADOW"
  });

  $("shadowResult").className = "result";

  $("shadowResult").innerHTML = `
    <b>Started at ${escapeHtml(start)}</b><br>
    Discovered: ${d.discovered_nodes.join(", ")}
  `;

  highlightNodes(d.discovered_nodes);
}

async function advanceShadow() {
  const d = await postJSON("/api/shadow/advance", {
    simulation_id: "DEMO-SHADOW"
  });

  $("shadowResult").className = "result";

  $("shadowResult").innerHTML = `
    <b>Step ${d.step}</b>
    — ${escapeHtml(d.message || "")}<br>

    Discovered (${d.discovered_nodes.length}):
    ${d.discovered_nodes.join(", ")}
  `;

  highlightNodes(
    d.discovered_nodes,
    d.discovered_edges || []
  );
}

async function resetShadow() {
  await postJSON("/api/shadow/reset", {
    simulation_id: "DEMO-SHADOW"
  });

  $("shadowResult").textContent =
    "Simulation reset.";

  if (cy) {
    cy.elements().removeClass("highlighted");
  }
}

// ==================== BLAST SHIELD ====================

async function analyzeShield() {
  const source = $("shieldSource").value;
  const target = $("shieldTarget").value;

  const d = await postJSON("/api/blast-shield/analyze", {
    source,
    target
  });

  $("shieldResult").className = "result";

  if (!d.candidates || !d.candidates.length) {
    $("shieldResult").textContent =
      "No candidate cuts found.";

    return;
  }

  $("shieldResult").innerHTML = `
    <b>${d.total_paths} modeled paths</b>

    <ol>
      ${d.candidates.slice(0, 5).map(c => `
        <li>
          ${escapeHtml(c.relation)}
          (${escapeHtml(c.source)} → ${escapeHtml(c.target)})

          — score ${c.shield_score}
          (disrupts ${c.paths_disrupted},
          cost ${c.operational_disruption_cost})

          <button
            class="tiny"
            onclick="simulateShieldCut('${c.id}')">
            Simulate cut
          </button>
        </li>
      `).join("")}
    </ol>

    <span class="muted">
      ${escapeHtml(d.note || "")}
    </span>
  `;
}

async function simulateShieldCut(edge_id) {
  const source = $("shieldSource").value;
  const target = $("shieldTarget").value;

  const d = await postJSON("/api/blast-shield/simulate", {
    source,
    target,
    edge_id
  });

  const summary = document.createElement("p");

  summary.innerHTML = `
    <b>What-if:</b>
    ${d.disrupted_paths} path(s) disrupted;
    ${d.remaining_paths} remain.
    Still connected:
    ${d.still_connected ? "Yes" : "No"}.
  `;

  $("shieldResult").appendChild(summary);

  const note = document.createElement("small");

  note.textContent = d.note;

  $("shieldResult").appendChild(note);
}

// ==================== NEO4J IMPORT ====================

async function importNeo4j() {
  try {
    const d = await postJSON("/api/neo4j/import", {});

    $("neo4jDetails").textContent =
      `${d.message} Entities: ${d.counts.nodes}, ` +
      `relationships: ${d.counts.edges}, ` +
      `alerts: ${d.counts.alerts}.`;

    await loadBackendStatus();

    graphData = await getJSON("/api/graph");

    initCytoscape();

    fillSelects();
  } catch (e) {
    $("neo4jDetails").textContent = e.message;
  }
}

// ==================== GUIDED DEMO STORY ====================

async function runDemoStory() {
  $("demoBtn").disabled = true;
  $("demoBtn").textContent = "Running…";

  try {
    // 1. Starting point
    selectNode("D01");

    highlightNodes(["D01", "IP01"]);

    $("selectedLabel").textContent =
      "Demo: Starting from compromised Laptop-07 (phishing entry)";

    await new Promise(r => setTimeout(r, 1800));

    // 2. Blast Radius
    $("sourceSelect").value = "D01";

    await blastRadius();

    await new Promise(r => setTimeout(r, 2200));

    // 3. Attack Path to Payroll DB
    $("pathSource").value = "D01";
    $("pathTarget").value = "DB01";

    await attackPath();

    await new Promise(r => setTimeout(r, 2200));

    // 4. Analyst Recommendation
    await recommendNextStep();

    await new Promise(r => setTimeout(r, 1800));

    // 5. Shadow Graph
    await startShadow();

    await new Promise(r => setTimeout(r, 1200));

    await advanceShadow();

    await new Promise(r => setTimeout(r, 1200));

    await advanceShadow();

    await new Promise(r => setTimeout(r, 1800));

    // 6. Blast Shield
    $("shieldSource").value = "D01";
    $("shieldTarget").value = "DB01";

    await analyzeShield();

  } finally {
    $("demoBtn").disabled = false;
    $("demoBtn").textContent = "▶ Run Demo Story";

    $("selectedLabel").textContent =
      "Demo complete — explore freely or re-run.";
  }
}

// ==================== EVENT LISTENERS ====================

function bindButton(id, callback) {
  const button = $(id);

  if (button) {
    button.addEventListener("click", callback);
  }
}

function bindControls() {
  bindButton("blastBtn", blastRadius);
  bindButton("pathBtn", attackPath);
  bindButton("chokeBtn", chokePoints);
  bindButton("recommendBtn", recommendNextStep);
  bindButton("markInspectedBtn", markSelectedInspected);
  bindButton("shadowStartBtn", startShadow);
  bindButton("shadowAdvanceBtn", advanceShadow);
  bindButton("shadowResetBtn", resetShadow);
  bindButton("shieldAnalyzeBtn", analyzeShield);
  bindButton("importNeo4jBtn", importNeo4j);
  bindButton("demoBtn", runDemoStory);

  bindButton("resetBtn", () => {
    if (cy) {
      cy.elements().removeClass("highlighted selected");
    }

    selectedNode = null;

    if ($("selectedLabel")) {
      $("selectedLabel").textContent =
        "Select a node to inspect it.";
    }

    fitGraphSafely();
  });

  // Graph zoom controls
  bindButton("fitGraphBtn", fitGraphSafely);

  bindButton("zoomInBtn", () => {
    zoomGraph(1.25);
  });

  bindButton("zoomOutBtn", () => {
    zoomGraph(0.8);
  });
}

// ==================== INITIALIZATION ====================

async function init() {
  $("backendStatus").innerHTML =
    `<i></i> JSON FALLBACK`;

  try {
    graphData = await getJSON("/api/graph");

    $("nodeCount").textContent =
      graphData.nodes.length;

    $("edgeCount").textContent =
      graphData.edges.length;

    $("criticalCount").textContent =
      graphData.nodes.filter(
        n => n.criticality === "critical"
      ).length;

    fillSelects();

    try {
      initCytoscape();
    } catch (e) {
      console.error("Cytoscape initialization failed:", e);
    }

    try {
      await loadAlerts();
    } catch (e) {
      console.error("Alerts loading failed:", e);
    }

    loadBackendStatus();

    bindControls();

    // Default selection
    setTimeout(() => {
      if ($("sourceSelect")) {
        $("sourceSelect").value = "D01";
      }
    }, 300);

  } catch (e) {
    $("selectedLabel").textContent =
      "Could not load prototype: " + e.message;

    console.error("THREXA initialization error:", e);
  }
}

// Expose this function for the inline simulation button.
window.simulateShieldCut = simulateShieldCut;

// Start the application
init();
