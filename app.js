const $ = (id) => document.getElementById(id);
let graphData = null;
let selectedNode = null;
let highlighted = new Set();

const colors = {user:"#80b9df",device:"#a7e3c2",server:"#f2b56b",application:"#d7a5e8",database:"#d7a5e8",ip:"#ef817b"};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function getJSON(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function renderGraph() {
  const svg = $("graph");
  const edges = graphData.edges.map(e => {
    const a = graphData.nodes.find(n=>n.id===e.source), b = graphData.nodes.find(n=>n.id===e.target);
    return `<line class="edge ${highlighted.has(e.source)&&highlighted.has(e.target)?"active":""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"><title>${escapeHtml(e.relation)}</title></line>`;
  }).join("");
  const nodes = graphData.nodes.map(n => {
    const cls = `${selectedNode===n.id?"selected":""} ${highlighted.has(n.id)?"highlight":""} ${highlighted.size&&!highlighted.has(n.id)?"dim":""}`;
    return `<g class="node ${cls}" data-id="${n.id}" transform="translate(${n.x},${n.y})">
      <circle r="17" fill="${colors[n.type]||"#a7e3c2"}"></circle>
      <text y="36">${escapeHtml(n.label)}</text><title>${escapeHtml(n.description)}</title></g>`;
  }).join("");
  svg.innerHTML = edges + nodes;
  svg.querySelectorAll(".node").forEach(el=>el.addEventListener("click",()=>selectNode(el.dataset.id)));
}
function selectNode(id) {
  selectedNode=id; $("sourceSelect").value=id;
  const n=graphData.nodes.find(x=>x.id===id);
  $("selectedLabel").textContent=`Selected: ${n.label} · ${n.type} · ${n.criticality} criticality`;
  renderGraph();
}
function fillSelects() {
  const opts = graphData.nodes.map(n=>`<option value="${n.id}">${escapeHtml(n.label)} (${n.id})</option>`).join("");
  $("sourceSelect").innerHTML=opts;
  const critical = graphData.nodes.filter(n=>["critical","high"].includes(n.criticality));
  $("targetSelect").innerHTML=critical.map(n=>`<option value="${n.id}">${escapeHtml(n.label)} (${n.id})</option>`).join("");
  $("sourceSelect").value="D01"; $("targetSelect").value="DB01";
}
async function blastRadius() {
  try {
    const id=$("sourceSelect").value, data=await getJSON(`/api/blast-radius/${id}`);
    highlighted=new Set([id,...data.impacted.map(x=>x.id)]); selectNode(id);
    const groups=[1,2,3].map(h=>`<li><b>${h}-hop:</b> ${data.impacted.filter(x=>x.hops===h).map(x=>escapeHtml(x.label)).join(", ")||"None"}</li>`).join("");
    $("blastResult").className="result";
    $("blastResult").innerHTML=`<b>${escapeHtml(data.source.label)}</b><ul>${groups}</ul><span class="muted">${escapeHtml(data.note)}</span>`;
    renderGraph();
  } catch(e) {$("blastResult").textContent=e.message;}
}
async function attackPath() {
  try {
    const source=$("sourceSelect").value,target=$("targetSelect").value;
    const data=await getJSON(`/api/attack-path?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`);
    highlighted=new Set(data.path.map(x=>x.id)); selectNode(source);
    $("pathResult").className="result";
    $("pathResult").innerHTML=data.path.length?`<b>${data.length} relationship hops</b><ul>${data.path.map(x=>`<li>${escapeHtml(x.label)} <span class="tag">${escapeHtml(x.type)}</span></li>`).join("")}</ul><span class="muted">${escapeHtml(data.note)}</span>`:escapeHtml(data.message);
    renderGraph();
  } catch(e) {$("pathResult").textContent=e.message;}
}
async function chokePoints() {
  try {
    const data=await getJSON("/api/choke-points");
    highlighted=new Set(data.items.map(x=>x.id)); renderGraph();
    $("chokeResult").className="result";
    $("chokeResult").innerHTML=`<ol>${data.items.map(x=>`<li>${escapeHtml(x.label)} — score ${x.score}</li>`).join("")||"<li>No high-centrality nodes found.</li>"}</ol><span class="muted">${escapeHtml(data.note)}</span>`;
  } catch(e) {$("chokeResult").textContent=e.message;}
}
async function loadAlerts() {
  const [alerts,incident]=await Promise.all([getJSON("/api/alerts"),getJSON("/api/incident")]);
  $("alertCount").textContent=alerts.length;
  $("incidentSummary").textContent=incident.summary+" "+incident.note;
  $("alerts").innerHTML=incident.alerts.map(a=>`<article class="alert ${a.severity}"><div class="alert-top"><b>${escapeHtml(a.title)}</b><span class="tag ${a.severity}">${escapeHtml(a.severity.toUpperCase())}</span></div><p>${escapeHtml(a.description)}</p><small>${escapeHtml(a.id)} · ${escapeHtml(a.time)} · RELATED: ${a.related_nodes.map(escapeHtml).join(", ")}</small></article>`).join("");
}
async function init() {
  try {
    graphData=await getJSON("/api/graph");
    $("nodeCount").textContent=graphData.nodes.length;
    $("edgeCount").textContent=graphData.edges.length;
    $("criticalCount").textContent=graphData.nodes.filter(n=>n.criticality==="critical").length;
    fillSelects(); renderGraph(); await loadAlerts();
    $("sourceSelect").addEventListener("change",e=>selectNode(e.target.value));
    $("blastBtn").addEventListener("click",blastRadius);
    $("pathBtn").addEventListener("click",attackPath);
    $("chokeBtn").addEventListener("click",chokePoints);
    $("resetBtn").addEventListener("click",()=>{highlighted.clear();selectedNode=null;$("selectedLabel").textContent="Select a node to inspect it.";renderGraph();});
    await blastRadius();
  } catch(e) { $("selectedLabel").textContent="Could not load prototype: "+e.message; }
}
init();
