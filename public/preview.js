const elements = Object.fromEntries(["project", "version", "run", "selection", "new-run", "execute", "status", "ideas-state", "idea-actor", "idea-rationale", "idea-candidates", "select-idea", "run-state", "stages", "public-error", "video", "video-empty", "video-metadata", "qc-result", "qc-metadata", "approval-note", "findings", "approval-result", "approval-actor", "approval-justification", "approve", "reject", "approval-history"].map((id) => [id, document.getElementById(id)]));
let refreshTimer = null;
let currentView = null;
let currentCandidates = [];
let currentRuns = [];

elements.project.addEventListener("change", async () => { resetAfter("project"); await loadCatalog(); });
elements.version.addEventListener("change", async () => { resetAfter("version"); await loadCatalog(); });
elements.run.addEventListener("change", async () => { resetAfter("run"); await loadCatalog(); });
elements.selection.addEventListener("change", async () => { elements.execute.disabled = !completeScope(); await refresh(); });
elements.execute.addEventListener("click", execute);
elements["new-run"].addEventListener("click", createRun);
elements["select-idea"].addEventListener("click", selectIdea);
elements.approve.addEventListener("click", () => submitDecision("APPROVED"));
elements.reject.addEventListener("click", () => submitDecision("REJECTED"));

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
    currentRuns = catalog.runs ?? [];
    if (elements.version.value) fill(elements.run, currentRuns, ({ pipelineRunId, state }) => [pipelineRunId, `${pipelineRunId} · ${state}`]);
    if (elements.run.value) fill(elements.selection, catalog.selections, ({ selectionId, revision }) => [selectionId, `${selectionId} · r${revision}`]);
    currentCandidates = catalog.candidates ?? []; renderIdeas(currentCandidates);
    elements["new-run"].disabled = !(elements.project.value && elements.version.value);
    elements.status.textContent = catalog.projects.length ? "Selecione o escopo operacional." : "Nenhum projeto persistido encontrado.";
  } catch (error) { elements.status.textContent = error.message; }
}

async function createRun() {
  elements["new-run"].disabled = true; elements.status.textContent = "Executando Research e preparando ideias válidas…";
  const resumable = currentCandidates.length === 0 ? currentRuns.find(({ pipelineRunId }) => pipelineRunId === elements.run.value) : null;
  const pipelineRunId = resumable?.pipelineRunId ?? `run_operator_${crypto.randomUUID().replaceAll("-", "")}`;
  const body = { schemaVersion: "pipeline-handoff/1.0.0", pipelineRunId, projectId: elements.project.value, projectVersion: Number(elements.version.value), startedAt: resumable?.startedAt ?? new Date().toISOString() };
  try { await request("/api/operator-preview/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); await loadCatalog(); elements.run.value = pipelineRunId; await loadCatalog(); }
  catch (error) { elements.status.textContent = error.message; }
  finally { elements["new-run"].disabled = !(elements.project.value && elements.version.value); }
}

function renderIdeas(candidates) {
  elements["ideas-state"].textContent = candidates.length ? `${candidates.length} CANDIDATO(S)` : elements.run.value ? "SEM CANDIDATOS" : "AGUARDANDO RUN";
  elements["idea-candidates"].replaceChildren(...(candidates.length ? candidates.map((item) => node("tr", "", [
    node("td", "", node("input", "idea-choice", "", { type: "radio", name: "idea-candidate", value: item.ideaCandidateId })),
    node("td", "", String(item.rank)), node("td", "", String(item.score)), node("td", "", item.title), node("td", "", item.editorialAngle),
  ])) : [node("tr", "", node("td", "empty", elements.run.value ? "Nenhum candidato persistido para esta execução." : "Crie ou selecione uma execução.", { colSpan: 5 }))]));
  elements["idea-candidates"].querySelectorAll("input").forEach((input) => input.addEventListener("change", () => { elements["select-idea"].disabled = false; }));
  elements["select-idea"].disabled = true;
  elements["new-run"].textContent = elements.run.value && candidates.length === 0 ? "Retomar execução" : "Nova execução";
}

async function selectIdea() {
  const selectedId = elements["idea-candidates"].querySelector("input:checked")?.value;
  const candidate = currentCandidates.find(({ ideaCandidateId }) => ideaCandidateId === selectedId);
  const actorId = elements["idea-actor"].value.trim(); const rationale = elements["idea-rationale"].value.trim() || null;
  if (!candidate || !actorId) { elements.status.textContent = "Selecione uma ideia e informe o ator humano."; return; }
  const value = { schemaVersion: "idea-selection/1.0.0", ideaSelectionId: `idea-selection:${crypto.randomUUID().replaceAll("-", "")}`, pipelineRunId: elements.run.value, projectId: elements.project.value, projectVersion: Number(elements.version.value), ideaBatchId: candidate.ideaBatchId, ideaCandidateId: candidate.ideaCandidateId, ideaScoreId: candidate.ideaScoreId, ideaContentHash: candidate.ideaContentHash, ideaScoreContentHash: candidate.ideaScoreContentHash, decision: "SELECTED", actor: { type: "HUMAN", id: actorId }, decidedAt: new Date().toISOString(), editorialRationale: rationale, revision: 1, supersedesIdeaSelectionId: null, contentHash: "" };
  value.contentHash = await sha256(stableJson(value, new Set(["contentHash"])));
  elements["select-idea"].disabled = true;
  try { const selected = await request("/api/operator-preview/idea-selections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); await loadCatalog(); elements.selection.value = selected.ideaSelectionId; elements.execute.disabled = !completeScope(); await refresh(); }
  catch (error) { elements.status.textContent = error.message; }
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
  currentView = view;
  elements.status.textContent = view.active ? "Pipeline em execução." : "Estado reconstruído dos artefatos persistidos.";
  elements["run-state"].textContent = view.pipelineRun.state;
  elements.stages.replaceChildren(...view.stages.map((stage) => node("li", `stage ${stage.state.toLowerCase()}`, [node("span", "", stage.name), node("strong", "", stage.state)])));
  elements["public-error"].hidden = !view.error;
  elements["public-error"].textContent = view.error ? `${view.error.code} · ${view.error.message}` : "";
  renderVideo(view.videoRender); renderQc(view.qualityControl, view.approval); renderApproval(view.approval);
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
  const metadata = qc ? [qc.reportId, qc.contentHash, qc.checkedAt] : ["—", "—", "—"];
  elements["qc-metadata"].querySelectorAll("dd").forEach((item, index) => { item.textContent = metadata[index]; });
  elements.findings.replaceChildren(...(qc?.findings.length ? qc.findings.map((finding) => node("tr", "", [node("td", `finding ${finding.status.toLowerCase()}`, finding.status), node("td", "", finding.code), node("td", "", `${finding.subjectType} · ${finding.subjectId}`), node("td", "", `${finding.message}${finding.observed === null ? "" : ` Observado: ${finding.observed}.`}`)])) : [node("tr", "", node("td", "empty", "QC ainda não disponível.", { colSpan: 4 }))]));
}

function renderApproval(approval) {
  elements["approval-result"].textContent = approval.decision?.decision ?? "PENDENTE";
  elements["approval-result"].className = `badge ${approval.decision?.decision === "APPROVED" ? "pass" : approval.decision?.decision === "REJECTED" ? "fail" : "pending"}`;
  elements.approve.disabled = !approval.approveAllowed;
  elements.reject.disabled = !approval.rejectAllowed;
  elements["approval-actor"].disabled = !approval.available || Boolean(approval.decision);
  elements["approval-justification"].disabled = !approval.available || Boolean(approval.decision);
  elements["approval-history"].replaceChildren(...(approval.history.length ? approval.history.map((item) => node("tr", "", [
    node("td", "", item.decidedAt), node("td", `finding ${item.decision === "APPROVED" ? "pass" : "fail"}`, item.decision),
    node("td", "", item.actor), node("td", "", `${item.videoRenderId} r${item.videoRenderRevision} ${item.videoRenderContentHash}\n${item.qualityControlReportId} ${item.qualityControlReportContentHash}`),
    node("td", "", item.justification ?? "—"),
  ])) : [node("tr", "", node("td", "empty", "Nenhuma decisão registrada nesta execução.", { colSpan: 5 }))]));
}

async function submitDecision(decision) {
  if (!currentView?.videoRender || !currentView?.qualityControl) return;
  const actor = elements["approval-actor"].value.trim();
  const justificationText = elements["approval-justification"].value.trim();
  if (!actor) { elements.status.textContent = "Informe o ator humano."; return; }
  if (decision === "REJECTED" && !justificationText) { elements.status.textContent = "Informe a justificativa da rejeição."; return; }
  elements.approve.disabled = true; elements.reject.disabled = true;
  const body = {
    projectId: elements.project.value, projectVersion: Number(elements.version.value), pipelineRunId: elements.run.value,
    videoRenderId: currentView.videoRender.id, videoRenderRevision: currentView.videoRender.revision,
    videoRenderContentHash: currentView.videoRender.sha256,
    qualityControlReportId: currentView.qualityControl.reportId,
    qualityControlReportContentHash: currentView.qualityControl.contentHash,
    decision, actor, justification: justificationText || null,
  };
  try {
    await request("/api/operator-preview/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await refresh();
  } catch (error) { elements.status.textContent = error.message; renderApproval(currentView.approval); }
}

function startPolling(view) { clearTimeout(refreshTimer); if (completeScope() && (view.active || view.stages.some(({ state }) => state === "RUNNING"))) refreshTimer = setTimeout(refresh, 2000); }
function scope() { return { projectId: elements.project.value, projectVersion: Number(elements.version.value), pipelineRunId: elements.run.value, selectionId: elements.selection.value }; }
function completeScope() { return Boolean(elements.project.value && elements.version.value && elements.run.value && elements.selection.value); }
function resetAfter(name) { const order = ["project", "version", "run", "selection"]; for (const id of order.slice(order.indexOf(name) + 1)) fill(elements[id], []); if (name !== "selection") { currentCandidates = []; if (name !== "run") currentRuns = []; renderIdeas([]); } elements.execute.disabled = true; elements["new-run"].disabled = !(elements.project.value && elements.version.value); }
function fill(select, items, describe) { const current = select.value; select.replaceChildren(new Option("Selecione", ""), ...items.map((item) => { const [value, label] = describe(item); return new Option(label, value); })); select.disabled = items.length === 0; if ([...select.options].some(({ value }) => value === current)) select.value = current; }
function node(tag, className, content, properties = {}) { const item = document.createElement(tag); if (className) item.className = className; if (Array.isArray(content)) item.append(...content); else if (content instanceof Node) item.append(content); else item.textContent = content; Object.assign(item, properties); return item; }
async function request(url, options) { const response = await fetch(url, options); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? `Erro ${response.status}`); return body; }
function stableJson(value, omitted = new Set()) { if (Array.isArray(value)) return `[${value.map((item) => stableJson(item, omitted)).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => !omitted.has(key)).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key], omitted)}`).join(",")}}`; return JSON.stringify(value); }
async function sha256(value) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join(""); }
