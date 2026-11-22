const ShadowGraph = (() => {
  const REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const PLAY_DELAY_MS = 1000;
  const LOG_LIMIT = 40;
  const S = {
    graph: null, defender: null, attacker: null, simId: null,
    started: false, exhausted: false, busy: false, playing: false,
    timer: null, syncing: false, gen: 0
  };
  const el = id => document.getElementById(id);

  const FADE = REDUCED ? "0s" : "0.35s";
  const STYLE = [
    { selector: "node", style: {
      "width": 28, "height": 28, "background-color": "#34464c",
      "border-width": 2, "border-color": "#243238",
      "label": "data(label)", "color": "#7f918d", "font-size": "8px",
      "text-valign": "bottom", "text-margin-y": 4, "text-wrap": "wrap", "text-max-width": 76,
      "text-background-color": "#0c1418", "text-background-opacity": 0.8, "text-background-padding": "2px",
      "min-zoomed-font-size": 7,
      "transition-property": "background-color, border-color, border-width, opacity",
      "transition-duration": FADE } },
    { selector: "node[criticality = 'critical']", style: { "shape": "diamond", "width": 34, "height": 34 } },
    { selector: "node.unseen", style: { "opacity": 0.55 } },
    { selector: "node.found", style: {
      "background-color": "#f2b56b", "border-color": "#7a5a2c", "color": "#e9f0ed", "opacity": 1 } },
    { selector: "node.fresh", style: {
      "background-color": "#ef817b", "border-color": "#ffd9d6", "border-width": 4,
      "color": "#ffffff", "opacity": 1 } },
    { selector: "node.entry", style: {
      "border-style": "double", "border-width": 6, "border-color": "#a7e3c2" } },
    { selector: "edge", style: {
      "width": 1, "line-color": "#2c3b41", "target-arrow-color": "#2c3b41",
      "target-arrow-shape": "triangle", "arrow-scale": 0.8, "curve-style": "bezier", "opacity": 0.7,
      "transition-property": "line-color, target-arrow-color, width, opacity",
      "transition-duration": FADE } },
    { selector: "edge.traversed", style: {
      "width": 2, "line-color": "#f2b56b", "target-arrow-color": "#f2b56b", "opacity": 1 } },
    { selector: "edge.fresh", style: {
      "width": 3, "line-color": "#ef817b", "target-arrow-color": "#ef817b", "opacity": 1 } }
  ];

  // ---------- helpers ----------
  function layoutFor(nodes) {
    // Hand-placed coordinates (shipped in graph.json / stored in Neo4j) are used as-is:
    // deterministic, instant and overlap-free. Otherwise fall back to a force layout
    // with the same spacing as the main graph, or a cheap layout for very large graphs.
    const seeded = nodes.length > 0 && nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y));
    if (seeded) return { name: "preset", padding: 30 };
    if (nodes.length > 600) return { name: "concentric", animate: false, padding: 30, minNodeSpacing: 14 };
    return { name: "cose", animate: false, randomize: true, padding: 40, nodeDimensionsIncludeLabels: true,
             nodeRepulsion: 18000, nodeOverlap: 24, idealEdgeLength: 155, gravity: 0.12,
             componentSpacing: 90, numIter: 1000 };
  }

  function buildDefender() {
    const g = S.graph;
    const els = [
      ...g.nodes.map(n => ({
        data: { id: n.id, label: n.label, type: n.type, criticality: n.criticality },
        position: Number.isFinite(n.x) && Number.isFinite(n.y) ? { x: n.x, y: n.y } : undefined,
        classes: "unseen" })),
      ...g.edges.map((e, i) => ({
        data: { id: e.id || `${e.source}|${e.target}|${e.relation}|${i}`,
                source: e.source, target: e.target, relation: e.relation } }))
    ];
    return cytoscape({
      container: el("shadowDefender"), elements: els, style: STYLE,
      minZoom: 0.2, maxZoom: 2.2, wheelSensitivity: 0.2,
      boxSelectionEnabled: false, autoungrabify: true
    });
  }

  function buildAttacker() {
    return cytoscape({
      container: el("shadowAttacker"), elements: [], style: STYLE,
      minZoom: 0.2, maxZoom: 2.2, wheelSensitivity: 0.2,
      boxSelectionEnabled: false, autoungrabify: true
    });
  }

  function mirrorViewports() {
    const link = (from, to) => from.on("pan zoom", () => {
      if (S.syncing) return;
      S.syncing = true;
      to.viewport({ zoom: from.zoom(), pan: from.pan() });
      S.syncing = false;
    });
    link(S.defender, S.attacker);
    link(S.attacker, S.defender);
  }

  function fitBoth() {
    if (!S.defender) return;
    S.defender.resize(); S.attacker.resize();
    S.defender.fit(undefined, 28);
    S.syncing = true;
    S.attacker.viewport({ zoom: S.defender.zoom(), pan: S.defender.pan() });
    S.syncing = false;
  }

  function setText(id, value) {
    const node = el(id);
    if (!node) return;
    const text = String(value);
    if (node.textContent !== text) {
      node.textContent = text;
      if (!REDUCED) { node.classList.remove("bump"); void node.offsetWidth; node.classList.add("bump"); }
    }
  }

  function setStatus(message, isError = false) {
    const node = el("shadowStatus");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("error", !!isError);
  }

  function setButtons() {
    const idle = !S.busy;
    el("shadowStartBtn").disabled = S.busy;
    el("shadowNextBtn").disabled = !(idle && S.started && !S.exhausted && !S.playing);
    el("shadowAllBtn").disabled = !(idle && S.started && !S.exhausted && !S.playing);
    el("shadowAutoBtn").disabled = !(S.started && !S.exhausted) && !S.playing;
    el("shadowAutoBtn").textContent = S.playing ? "⏸ Pause" : "▶ Auto-play";
    el("shadowAutoBtn").setAttribute("aria-pressed", S.playing ? "true" : "false");
    el("shadowResetBtn").disabled = S.busy || !S.started;
  }

  function renderCounts(c, view) {
    setText("asymTotal", c.total_nodes);
    setText("asymFound", c.discovered_nodes);
    setText("asymBlind", c.blind_spots);
    el("asymFoundNote").textContent = `${c.percentage}% of the environment`;
    el("asymBlindNote").textContent = c.blind_spots
      ? "entities the attacker has not found yet" : "nothing left to discover";
    if (view) {
      const crit = c.critical_total
        ? `${c.critical_found}/${c.critical_total} critical` : "no critical assets";
      const first = view.first_critical_step != null ? ` (first at step ${view.first_critical_step})` : "";
      el("shadowMeta").textContent =
        `Step ${view.step} · ${crit} assets exposed${first} · ` +
        `${c.discovered_edges}/${c.total_edges} relationships revealed · frontier ${view.frontier_size}`;
    }
  }

  function appendLog(entries) {
    const list = el("shadowLog");
    if (!list || !entries || !entries.length) return;
    const empty = list.querySelector(".empty");
    if (empty) empty.remove();
    entries.forEach(e => {
      const li = document.createElement("li");
      const tag = document.createElement("b");
      tag.textContent = e.step === 0 ? "Start" : `Step ${e.step}`;
      li.append(tag, " " + e.text);
      list.prepend(li);
    });
    while (list.children.length > LOG_LIMIT) list.lastChild.remove();
  }

  function renderCypher(view) {
    const box = el("shadowCypher");
    if (!box) return;
    const show = view.backend === "neo4j" && view.cypher;
    box.hidden = !show;
    if (show) el("shadowCypherText").textContent = view.cypher;
  }

  // ---------- graph updates ----------
  function demoteFresh() {
    [S.defender, S.attacker].forEach(cy => cy.elements(".fresh").removeClass("fresh").addClass(
      "found").filter("edge").addClass("traversed"));
  }

  function discoverIn(defenderNodeIds, edgeIds, { entry = false } = {}) {
    defenderNodeIds.forEach(id => {
      const n = S.defender.getElementById(id);
      if (n.nonempty()) n.removeClass("unseen").addClass(entry ? "found entry" : "fresh");
    });
    edgeIds.forEach(id => {
      const e = S.defender.getElementById(id);
      if (e.nonempty()) e.addClass("fresh");
    });
  }

  function growAttacker(nodes, edges, { entry = false } = {}) {
    const add = [], pending = new Set();
    nodes.forEach(n => {
      if (S.attacker.getElementById(n.id).nonempty()) return;
      pending.add(n.id);
      const pos = S.defender.getElementById(n.id).position();
      add.push({ group: "nodes", data: { id: n.id, label: n.label, type: n.type, criticality: n.criticality },
                 position: { x: pos.x, y: pos.y }, classes: entry ? "found entry" : "fresh" });
    });
    edges.forEach(e => {
      if (S.attacker.getElementById(e.id).nonempty()) return;
      const known = id => pending.has(id) || S.attacker.getElementById(id).nonempty();
      if (!known(e.source) || !known(e.target)) return;
      add.push({ group: "edges", data: { id: e.id, source: e.source, target: e.target, relation: e.relation },
                 classes: "fresh" });
    });
    if (!add.length) return;
    const added = S.attacker.add(add);
    if (!REDUCED) {
      added.nodes().forEach(n => { n.style("opacity", 0); n.animate({ style: { opacity: 1 } }, { duration: 350 }); });
    }
  }

  function applyDelta(nodes, edges) {
    demoteFresh();
    discoverIn(nodes.map(n => n.id), edges.map(e => e.id));
    growAttacker(nodes, edges);
  }

  function clearOverlay() {
    S.attacker.elements().remove();
    S.defender.nodes().removeClass("found fresh entry").addClass("unseen");
    S.defender.edges().removeClass("fresh traversed");
  }

  // ---------- actions ----------
  async function call(fn) {
    if (S.busy) return null;
    S.busy = true; setButtons();
    const gen = S.gen;
    try {
      const out = await fn();
      return gen === S.gen ? out : null;     // ignore responses that arrive after a reset/re-init
    } catch (err) {
      setStatus(err.message || "Request failed", true);
      stopPlay();
      return null;
    } finally {
      S.busy = false; setButtons();
    }
  }

  async function start() {
    stopPlay();
    const entry = el("shadowStart").value;
    const view = await call(() => postJSON("/api/shadow/start", { start_node: entry }));
    if (!view) return;
    clearOverlay();
    S.simId = view.simulation_id; S.started = true; S.exhausted = view.exhausted;
    el("shadowLog").innerHTML = "";
    discoverIn(view.nodes.map(n => n.id), [], { entry: true });
    growAttacker(view.nodes, [], { entry: true });
    el("shadowBackendTag").textContent = view.backend === "neo4j"
      ? "NEO4J • FRONTIER QUERIES" : "JSON • INDEXED IN-MEMORY";
    renderCounts(view.counts, view); renderCypher(view); appendLog(view.log);
    setStatus("Foothold established. Press “Next attack step” to let the attacker look around.");
    setButtons();
  }

  async function next(steps = 1) {
    if (!S.started) return;
    const view = await call(() => postJSON("/api/shadow/advance", { simulation_id: S.simId, steps }));
    if (!view) return;
    const d = view.delta;
    applyDelta(d.nodes, d.edges);
    S.exhausted = view.exhausted;
    renderCounts(view.counts, view); renderCypher(view); appendLog(d.log);
    let msg = view.message;
    if (view.truncated) msg += " Wave was capped for performance; press again to continue.";
    if (view.time_limited) msg += " Stopped at the time budget; press again to continue.";
    if (view.capped) msg += " Session discovery limit reached.";
    setStatus(msg);
    if (S.exhausted) stopPlay();
    setButtons();
  }

  function stopPlay() {
    S.playing = false;
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    setButtons();
  }

  async function playLoop() {
    if (!S.playing) return;
    await next(1);
    if (S.playing && !S.exhausted) S.timer = setTimeout(playLoop, PLAY_DELAY_MS);
    else stopPlay();
  }

  function togglePlay() {
    if (S.playing) return stopPlay();
    if (!S.started || S.exhausted) return;
    S.playing = true; setButtons(); playLoop();
  }

  async function reset() {
    stopPlay();
    const simId = S.simId;
    S.gen++; S.started = false; S.exhausted = false; S.simId = null;
    if (S.defender) clearOverlay();
    el("shadowLog").innerHTML = '<li class="empty">No simulation running.</li>';
    el("shadowCypher").hidden = true;
    initialCounts();
    setStatus("Simulation reset.");
    setButtons();
    if (simId) { try { await postJSON("/api/shadow/reset", { simulation_id: simId }); } catch (_) { /* TTL cleans up */ } }
  }

  function initialCounts() {
    const total = S.graph ? S.graph.nodes.length : 0;
    setText("asymTotal", total); setText("asymFound", 0); setText("asymBlind", total);
    el("asymFoundNote").textContent = "start a simulation";
    el("asymBlindNote").textContent = "entities the attacker has not found yet";
    el("shadowMeta").textContent = "No simulation running.";
  }

  // ---------- lifecycle ----------
  function init(graphData) {
    if (!el("shadowSection") || typeof cytoscape === "undefined") return;
    stopPlay(); S.gen++;
    S.graph = graphData; S.started = false; S.exhausted = false; S.simId = null;
    if (S.defender) S.defender.destroy();
    if (S.attacker) S.attacker.destroy();

    const select = el("shadowStart");
    select.innerHTML = "";
    graphData.nodes.forEach(n => {
      const o = document.createElement("option");
      o.value = n.id; o.textContent = `${n.label} (${n.id})`;
      select.append(o);
    });
    if (graphData.nodes.some(n => n.id === "D01")) select.value = "D01";

    S.defender = buildDefender();
    S.attacker = buildAttacker();
    mirrorViewports();
    const layout = S.defender.layout(layoutFor(graphData.nodes));
    layout.one("layoutstop", fitBoth);
    layout.run();
    fitBoth();
    el("shadowLog").innerHTML = '<li class="empty">No simulation running.</li>';
    el("shadowCypher").hidden = true;
    initialCounts(); setStatus(""); setButtons();
  }

  async function runDemo() {
    if (!S.defender) return;
    await start();
    for (let i = 0; i < 2; i++) { await new Promise(r => setTimeout(r, 1200)); await next(1); }
  }

  function bind() {
    const on = (id, fn) => { const b = el(id); if (b) b.addEventListener("click", fn); };
    on("shadowStartBtn", start);
    on("shadowNextBtn", () => next(1));
    on("shadowAllBtn", () => next("all"));
    on("shadowAutoBtn", togglePlay);
    on("shadowResetBtn", reset);
    on("shadowCopyCypher", () => {
      const t = el("shadowCypherText").textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => setStatus("Cypher copied."), () => {});
    });
    let t = null;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(fitBoth, 150); });
  }
  document.addEventListener("DOMContentLoaded", bind);

  return { init, runDemo };
})();
window.ShadowGraph = ShadowGraph;
