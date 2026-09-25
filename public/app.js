const elements = {
  fixture: document.querySelector("#fixture"),
  live: document.querySelector("#live"),
  status: document.querySelector("#status"),
  candidateCount: document.querySelector("#candidate-count"),
  eligibleCount: document.querySelector("#eligible-count"),
  mode: document.querySelector("#mode"),
  top: document.querySelector("#top"),
  selectionNote: document.querySelector("#selection-note"),
  candidates: document.querySelector("#candidates"),
  discoverSources: document.querySelector("#discover-sources"),
  sourceStatus: document.querySelector("#source-status"),
  sourceResults: document.querySelector("#source-results"),
};

let currentRun = null;

elements.fixture.addEventListener("click", () => execute("/api/runs/fixture"));
elements.live.addEventListener("click", () => execute("/api/runs/live"));
elements.discoverSources.addEventListener("click", () => discoverSources(currentRun.id));

const health = await request("/api/health");
elements.live.disabled = !health.liveReady;
elements.status.textContent = health.liveReady
  ? "Integrações configuradas. A busca atual está disponível."
  : "Modo demonstração disponível. Configure a chave do YouTube e mantenha o Ollama ativo.";

const requestedRunId = new URLSearchParams(window.location.search).get("run");
const latest = await request(requestedRunId
  ? `/api/runs/${encodeURIComponent(requestedRunId)}`
  : "/api/runs/latest");
if (latest) {
  render(latest);
  await loadSources(latest.id);
}

async function execute(endpoint) {
  setBusy(true);
  elements.status.textContent = "Processando sinais e aplicando regras…";
  try {
    const run = await request(endpoint, { method: "POST" });
    render(run);
    elements.status.textContent = `Rodada concluída em ${formatDate(run.createdAt)}.`;
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function render(run) {
  currentRun = run;
  const provisional = run.top.length === 0;
  const selection = provisional ? (run.provisionalTop ?? []) : run.top;
  elements.candidateCount.textContent = run.scored.length;
  elements.eligibleCount.textContent = run.scored.filter((item) => item.eligible).length;
  elements.mode.textContent = run.mode === "live" ? "Atual" : "Fixture";
  const approvedMacros = new Set(selection
    .filter((item) => item.reviewDecision === "approved")
    .map((item) => item.macroNiche));
  elements.discoverSources.disabled = run.mode !== "live" || approvedMacros.size < 3;
  elements.sourceStatus.textContent = elements.discoverSources.disabled
    ? "Aprove três nichos diversos de uma rodada atual para habilitar a busca."
    : "Pronto para buscar arquivos reutilizáveis com download oficial.";
  elements.selectionNote.textContent = provisional
    ? "Ranking provisório: todos os critérios passaram, exceto a confirmação humana da fonte verde."
    : "Somente candidatos que passaram em todos os gates.";
  elements.top.innerHTML = selection.length
    ? selection.map((item, index) => `
      <article class="rank-card">
        <span class="rank">${index + 1}</span>
        <p class="macro">${escapeHtml(item.macroNiche)}</p>
        <h3>${escapeHtml(item.name)}</h3>
        <strong>${number(item.finalScore)}</strong>
        <p>${escapeHtml(item.explanation)}</p>
        <small>${item.evidenceIds.length} evidência(s)${provisional ? " · direitos pendentes" : ""}</small>
        <div class="review-actions" data-candidate="${item.id}">
          <button class="approve" ${item.reviewDecision === "approved" ? "disabled" : ""}>Aprovar</button>
          <button class="reject" ${item.reviewDecision === "rejected" ? "disabled" : ""}>Rejeitar</button>
        </div>
        <small class="decision">Revisão: ${reviewLabel(item.reviewDecision)}</small>
      </article>`).join("")
    : '<p class="empty">Nenhum candidato passou por todos os gates.</p>';

  elements.candidates.innerHTML = run.scored.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.summary)}</small></td>
      <td>${escapeHtml(item.macroNiche)}</td>
      <td>${number(item.trendScore)}</td>
      <td>${number(item.viabilityScore)}</td>
      <td><strong>${number(item.finalScore)}</strong></td>
      <td>${item.eligible
        ? '<span class="badge ok">Elegível</span>'
        : `<span class="badge blocked">Bloqueado</span><small>${item.failedGates.join(", ")}</small>`}</td>
    </tr>`).join("");

  for (const group of elements.top.querySelectorAll(".review-actions")) {
    group.querySelector(".approve").addEventListener("click", () => review(run.id, group.dataset.candidate, "approved"));
    group.querySelector(".reject").addEventListener("click", () => review(run.id, group.dataset.candidate, "rejected"));
  }
}

async function discoverSources(runId) {
  elements.discoverSources.disabled = true;
  elements.sourceStatus.textContent = "Buscando mídia reutilizável em repositório oficial…";
  try {
    const sourceRun = await request(`/api/runs/${runId}/sources/discover`, { method: "POST" });
    renderSources(sourceRun);
    elements.sourceStatus.textContent = `Busca concluída em ${formatDate(sourceRun.createdAt)}.`;
  } catch (error) {
    elements.sourceStatus.textContent = error.message;
  } finally {
    elements.discoverSources.disabled = false;
  }
}

async function loadSources(runId) {
  try {
    const sourceRun = await request(`/api/runs/${runId}/sources/latest`);
    if (sourceRun) renderSources(sourceRun);
  } catch (error) {
    elements.sourceStatus.textContent = error.message;
  }
}

function renderSources(sourceRun) {
  elements.sourceResults.innerHTML = sourceRun.niches.map((group) => `
    <article class="source-group">
      <p class="macro">${escapeHtml(group.macroNiche)}</p>
      <h3>${escapeHtml(group.niche)}</h3>
      <div class="source-grid">${group.sources.length ? group.sources.map((source) => `
        <article class="source-card">
          <h3>${escapeHtml(source.title)}</h3>
          <p>${escapeHtml(source.creator || "Autoria não informada")}</p>
          <small>Licença declarada: ${escapeHtml(source.declaredLicense)} · ${source.attributionRequired ? "atribuição obrigatória" : "sem atribuição obrigatória"}</small>
          <a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noreferrer">Ver origem e licença</a>
          <a href="${escapeHtml(source.downloadUrl)}" target="_blank" rel="noreferrer">Abrir arquivo oficial</a>
          <div class="review-actions" data-source="${escapeHtml(source.id)}">
            <button class="approve" ${source.reviewDecision === "green" ? "disabled" : ""}>Confirmar verde</button>
            <button class="reject" ${source.reviewDecision === "rejected" ? "disabled" : ""}>Rejeitar</button>
          </div>
          <small class="decision">Revisão: ${sourceReviewLabel(source.reviewDecision)}</small>
        </article>`).join("") : '<p class="empty">Nenhuma fonte CC encontrada.</p>'}</div>
    </article>`).join("");

  for (const group of elements.sourceResults.querySelectorAll(".review-actions")) {
    group.querySelector(".approve").addEventListener("click", () =>
      reviewSource(sourceRun.id, group.dataset.source, "green"));
    group.querySelector(".reject").addEventListener("click", () =>
      reviewSource(sourceRun.id, group.dataset.source, "rejected"));
  }
}

async function reviewSource(sourceRunId, sourceId, decision) {
  try {
    const sourceRun = await request(`/api/source-runs/${sourceRunId}/sources/${encodeURIComponent(sourceId)}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    renderSources(sourceRun);
    elements.sourceStatus.textContent = "Decisão de fonte registrada localmente.";
  } catch (error) {
    elements.sourceStatus.textContent = error.message;
  }
}

async function review(runId, candidateId, decision) {
  try {
    const run = await request(`/api/runs/${runId}/candidates/${candidateId}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    render(run);
    elements.status.textContent = "Decisão humana registrada localmente.";
  } catch (error) {
    elements.status.textContent = error.message;
  }
}

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Erro ${response.status}`);
  return body;
}

function setBusy(value) {
  elements.fixture.disabled = value;
  elements.live.disabled = value || !health.liveReady;
}

function number(value) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 }).format(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function reviewLabel(value) {
  return ({ approved: "aprovado", rejected: "rejeitado", pending: "pendente" })[value] || "pendente";
}

function sourceReviewLabel(value) {
  return ({ green: "verde confirmado", rejected: "rejeitada", pending: "pendente" })[value] || "pendente";
}
