const elements = {
  fixture: document.querySelector("#fixture"),
  live: document.querySelector("#live"),
  status: document.querySelector("#status"),
  candidateCount: document.querySelector("#candidate-count"),
  eligibleCount: document.querySelector("#eligible-count"),
  mode: document.querySelector("#mode"),
  top: document.querySelector("#top"),
  candidates: document.querySelector("#candidates"),
};

elements.fixture.addEventListener("click", () => execute("/api/runs/fixture"));
elements.live.addEventListener("click", () => execute("/api/runs/live"));

const health = await request("/api/health");
elements.live.disabled = !health.liveReady;
elements.status.textContent = health.liveReady
  ? "Integrações configuradas. A busca atual está disponível."
  : "Modo demonstração disponível. Configure as duas chaves para busca atual.";

const latest = await request("/api/runs/latest");
if (latest) render(latest);

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
  elements.candidateCount.textContent = run.scored.length;
  elements.eligibleCount.textContent = run.scored.filter((item) => item.eligible).length;
  elements.mode.textContent = run.mode === "live" ? "Atual" : "Fixture";
  elements.top.innerHTML = run.top.length
    ? run.top.map((item, index) => `
      <article class="rank-card">
        <span class="rank">${index + 1}</span>
        <p class="macro">${escapeHtml(item.macroNiche)}</p>
        <h3>${escapeHtml(item.name)}</h3>
        <strong>${number(item.finalScore)}</strong>
        <p>${escapeHtml(item.explanation)}</p>
        <small>${item.evidenceIds.length} evidência(s)</small>
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
