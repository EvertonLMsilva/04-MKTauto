const elements = Object.fromEntries(["project", "version", "run", "selection", "execute", "status", "run-state", "stages", "public-error", "video", "video-empty", "video-metadata", "qc-result", "approval-note", "findings"].map((id) => [id, document.getElementById(id)]));
let refreshTimer = null;

elements.project.addEventListener("change", async () => { resetAfter("project"); await loadCatalog(); });
elements.version.addEventListener("change", async () => { resetAfter("version"); await loadCatalog(); });
elements.run.addEventListener("change", async () => { resetAfter("run"); await loadCatalog(); });
elements.selection.addEventListener("change", async () => { elements.execute.disabled = !completeScope(); await refresh(); });
elements.execute.addEventListener("click", execute);

await loadCatalog();

async function loadCatalog() {
  try {
    const query = new URLSearchParams();
    if (elements.project.value) query.set("projectId", elements.project.value);
    if (elements.version.value) query.set("projectVersion", elements.version.value);
    if (elements.run.value) query.set("pipelineRunId", elements.run.value);
    const catalog = await request(`/api/operator-preview/catalog?${query}`);
    if (!elements.project.value) fill(elements.project, catalog.projects, ({ id, name }) => [id, `${name} · ${id}`]);
    if (elements.project.value) fill(elements.version, catalog.versions, ({ version }) => [String(version), `Versão ${version}`]);
    if (elements.version.value) fill(elements.run, catalog.runs, ({ pipelineRunId, state }) => [pipelineRunId, `${pipelineRunId} · ${state}`]);
    if (elements.run.value) fill(elements.selection, catalog.selections, ({ selectionId, revision }) => [selectionId, `${selectionId} · r${revision}`]);
    elements.status.textContent = catalog.projects.length ? "Selecione o escopo operacional." : "Nenhum projeto persistido encontrado.";
  } catch (error) { elements.status.textContent = error.message; }
}

async function execute() {
  elements.execute.disabled = true; elements.status.textContent = "Iniciando ou retomando sem duplicar efeitos…";
  try { const view = await request("/api/operator-preview/executions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scope()) }); render(view); startPolling(view); }
  catch (error) { elements.status.textContent = error.message; }
  finally { elements.execute.disabled = !completeScope(); }
}

async function refresh() {
  if (!completeScope()) return;
  try { const view = await request(`/api/operator-preview/status?${new URLSearchParams(scope())}`); render(view); startPolling(view); }
  catch (error) { elements.status.textContent = error.message; }
}

function render(view) {
  elements.status.textContent = view.active ? "Pipeline em execução." : "Estado reconstruído dos artefatos persistidos.";
  elements["run-state"].textContent = view.pipelineRun.state;
  elements.stages.replaceChildren(...view.stages.map((stage) => node("li", `stage ${stage.state.toLowerCase()}`, [node("span", "", stage.name), node("strong", "", stage.state)])));
  elements["public-error"].hidden = !view.error;
  elements["public-error"].textContent = view.error ? `${view.error.code} · ${view.error.message}` : "";
  renderVideo(view.videoRender); renderQc(view.qualityControl, view.approval);
}

function renderVideo(video) {
  elements.video.hidden = !video; elements["video-empty"].hidden = Boolean(video);
  if (video && elements.video.dataset.render !== `${video.id}:${video.sha256}`) { elements.video.src = video.streamUrl; elements.video.dataset.render = `${video.id}:${video.sha256}`; }
  const values = video ? [video.id, video.revision, video.sha256, video.logicalReference] : ["—", "—", "—", "—"];
  elements["video-metadata"].querySelectorAll("dd").forEach((item, index) => { item.textContent = values[index]; });
}

function renderQc(qc, approval) {
  elements["qc-result"].textContent = qc?.result ?? "PENDENTE";
  elements["qc-result"].className = `badge ${(qc?.result ?? "pending").toLowerCase()}`;
  elements["approval-note"].textContent = approval.message;
  elements["approval-note"].className = approval.blocked ? "approval-blocked" : "";
  elements.findings.replaceChildren(...(qc?.findings.length ? qc.findings.map((finding) => node("tr", "", [node("td", `finding ${finding.status.toLowerCase()}`, finding.status), node("td", "", finding.code), node("td", "", `${finding.subjectType} · ${finding.subjectId}`), node("td", "", `${finding.message}${finding.observed === null ? "" : ` Observado: ${finding.observed}.`}`)])) : [node("tr", "", node("td", "empty", "QC ainda não disponível.", { colSpan: 4 }))]));
}

function startPolling(view) { clearTimeout(refreshTimer); if (completeScope() && (view.active || view.stages.some(({ state }) => state === "RUNNING"))) refreshTimer = setTimeout(refresh, 2000); }
function scope() { return { projectId: elements.project.value, projectVersion: Number(elements.version.value), pipelineRunId: elements.run.value, selectionId: elements.selection.value }; }
function completeScope() { return Boolean(elements.project.value && elements.version.value && elements.run.value && elements.selection.value); }
function resetAfter(name) { const order = ["project", "version", "run", "selection"]; for (const id of order.slice(order.indexOf(name) + 1)) fill(elements[id], []); elements.execute.disabled = true; }
function fill(select, items, describe) { const current = select.value; select.replaceChildren(new Option("Selecione", ""), ...items.map((item) => { const [value, label] = describe(item); return new Option(label, value); })); select.disabled = items.length === 0; if ([...select.options].some(({ value }) => value === current)) select.value = current; }
function node(tag, className, content, properties = {}) { const item = document.createElement(tag); if (className) item.className = className; if (Array.isArray(content)) item.append(...content); else if (content instanceof Node) item.append(content); else item.textContent = content; Object.assign(item, properties); return item; }
async function request(url, options) { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? `Erro ${response.status}`); return body; }
