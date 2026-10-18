export const operationsPage = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MKTauto · Finalização</title><link rel="stylesheet" href="/operations/styles.css"><script src="/operations/app.js" defer></script></head>
<body><header><a href="/operations" class="brand">MKT<span>auto</span></a><span class="eyebrow">ESTÚDIO LOCAL / FINALIZAÇÃO</span><div id="session-label"></div><button id="logout" class="quiet" hidden>Sair</button></header>
<main><section id="login-panel" class="login card"><p class="eyebrow">ACESSO DO OPERADOR</p><h1>Da revisão ao vídeo final.</h1><p>Revise as mídias autorizadas. O sistema cuida da finalização disponível e mostra o que ainda falta.</p>
<form id="login-form"><label>Operador<input name="operatorId" autocomplete="username" required pattern="[a-z][a-z0-9_]{2,63}" placeholder="Seu identificador individual"></label><label>Credencial pessoal<input name="secret" type="password" autocomplete="current-password" required maxlength="128"></label><button type="submit">Entrar com segurança</button></form><p class="muted">Use sua identidade QC_REVIEWER já cadastrada. A credencial não é exibida nem salva na página. Se o cadastro não estiver configurado, solicite sua habilitação ao responsável pelo ambiente.</p></section>
<div id="notice" role="status" aria-live="polite" hidden></div>
<div id="workspace" class="workspace" hidden><aside><p class="eyebrow">FILA DE PRODUÇÃO</p><h1>Seus vídeos</h1><button id="refresh-list" class="quiet">Atualizar fila</button><div id="execution-list"></div><p class="muted">Somente recursos locais. Publicação permanece manual.</p></aside>
<section id="empty" class="card empty"><p class="eyebrow">COMECE PELA FILA</p><h2>Selecione uma campanha</h2><p>Acompanhe a revisão, as dependências e o resultado em um só lugar.</p></section>
<article id="detail" hidden><div class="title-row"><div><p class="eyebrow">FINALIZAÇÃO DO VÍDEO</p><h1 id="campaign-title"></h1></div><span id="execution-status" class="badge"></span></div><ol id="progress" class="progress" aria-label="Etapas de finalização"></ol>
<section id="dependency" class="dependency" hidden><p class="eyebrow">AÇÃO NECESSÁRIA</p><h2 id="dependency-title"></h2><p id="dependency-message"></p><button id="retry" class="quiet">Verificar novamente</button></section>
<section class="card"><div class="title-row"><h2>01 / Revisão da mídia</h2><label>Vídeo<select id="media-select" aria-label="Vídeo para revisar"></select></label></div><button id="load-review" class="quiet">Abrir revisão e verificação técnica</button>
<div id="reference-choice" hidden><label>Imagem original de referência<select id="reference-select"></select></label><button id="load-reference" class="quiet">Usar esta referência</button></div>
<div id="review-content" hidden><div class="media-grid"><div><video id="source-video" controls preload="metadata" aria-label="Vídeo para revisão"></video><p class="muted">Vídeo gerado / recuperado</p></div><div><img id="source-image" alt="Imagem original de referência autorizada"><p class="muted">Referência original</p></div></div><div id="technical" class="technical"></div><p id="decision-audit" class="audit"></p>
<form id="review-form"><p>Registre sua observação para cada critério ao longo do vídeo. Uma falha técnica não pode ser substituída por aprovação.</p><label>Movimento real<textarea name="motion" minlength="10" maxlength="1000" required placeholder="Descreva o movimento observado."></textarea></label><label>Continuidade<textarea name="continuity" minlength="10" maxlength="1000" required placeholder="Descreva a continuidade do vídeo completo."></textarea></label><label>Fidelidade à referência<textarea name="fidelity" minlength="10" maxlength="1000" required placeholder="Compare o produto e seus detalhes com a referência."></textarea></label><label class="check"><input type="checkbox" name="watched" required>Assisti ao vídeo completo e comparei com a imagem de referência.</label><div class="actions"><button name="decision" value="APPROVED" type="submit">Aprovar mídia</button><button name="decision" value="REJECTED" type="submit" class="danger">Rejeitar mídia</button></div></form></div></section>
<section id="audio-panel" class="card" hidden><h2>02 / Narração autorizada</h2><p>Envie uma gravação própria ou licenciada que corresponda ao roteiro. WAV PCM, 24 kHz, mono, 16 bits; até 20 MB. Nenhum TTS pago será acionado.</p><details><summary>Ver roteiro da narração</summary><pre id="narration"></pre></details><form id="audio-form"><label>Arquivo WAV<input type="file" name="audio" accept=".wav,audio/wav" required></label><label>Direito de uso<select name="usageBasis"><option value="OWNED">Gravação própria</option><option value="LICENSED">Gravação licenciada</option></select></label><label>Evidência de autorização<textarea name="statement" required minlength="15" maxlength="2000" placeholder="Informe a origem e a autorização de uso desta gravação."></textarea></label><label class="check"><input type="checkbox" name="commercialUseAllowed" required>Confirmo autorização para processamento local e uso comercial nesta campanha.</label><button type="submit">Enviar gravação e continuar</button></form></section>
<section id="final-panel" class="card" hidden><div class="title-row"><h2>03 / Seu vídeo final</h2><a id="download" class="button" download="video-final.mp4">Baixar MP4</a></div><video id="final-video" controls preload="metadata" aria-label="Vídeo final com narração e legendas"></video><p class="muted">MP4 com QC técnico validado. Custo computacional local não medido; nenhum custo pago é presumido como zero.</p><form id="final-form" hidden><h3>Aprovação da versão final</h3><p>Esta decisão é independente da revisão da mídia e libera somente a entrega manual.</p><label>Observação / motivo da rejeição<textarea name="justification" maxlength="2000"></textarea></label><label class="check"><input type="checkbox" required>Revisei esta versão final exata, incluindo narração e legendas.</label><div class="actions"><button name="decision" value="APPROVED" type="submit">Aprovar versão final</button><button name="decision" value="REJECTED" type="submit" class="danger">Rejeitar versão final</button></div></form></section></article></div></main><footer>Controle humano em cada aprovação. Direitos e proveniência preservados.</footer></body></html>`;

export const operationsStyles = `
:root {
  font-family:
    Segoe UI,
    Arial,
    sans-serif;
  color: #20343c;
  background: #f4f3ef;
  font-size: 15px;
  --ink: #173c42;
  --accent: #b54f33;
}
* {
  box-sizing: border-box;
}
[hidden] {
  display: none !important;
}
body {
  margin: 0;
}
header {
  min-height: 80px;
  padding: 20px 4vw;
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid #d9ded8;
  background: #fff;
}
.brand {
  text-decoration: none;
  font-weight: 800;
  font-size: 25px;
  color: var(--ink);
}
.brand span {
  font-weight: 400;
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 0.16em;
  font-weight: 700;
  color: #62736c;
}
#session-label {
  margin-left: auto;
  font-size: 13px;
}
main {
  max-width: 1440px;
  margin: 36px auto;
  padding: 0 4vw;
}
h1 {
  font-size: 30px;
  line-height: 1.2;
  letter-spacing: -0.035em;
  margin: 12px 0 22px;
}
h2 {
  font-size: 20px;
  letter-spacing: -0.025em;
}
h3 {
  font-size: 18px;
}
p {
  line-height: 1.65;
}
.muted {
  color: #66756f;
  font-size: 13px;
}
.card {
  background: #fff;
  border: 1px solid #dce0da;
  border-radius: 12px;
  padding: 28px;
  margin-bottom: 24px;
}
.login {
  max-width: 540px;
  margin: 60px auto;
}
.login h1 {
  font-size: 39px;
}
.login form {
  margin: 28px 0;
}
.workspace {
  display: grid;
  grid-template-columns: 255px minmax(0, 1fr);
  gap: 36px;
}
aside h1 {
  font-size: 26px;
}
.empty {
  align-self: start;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
}
.title-row h1 {
  margin: 8px 0 24px;
}
.badge {
  font-size: 12px;
  background: #e5eee8;
  color: #245945;
  border-radius: 99px;
  padding: 9px 14px;
  white-space: nowrap;
}
button,
.button {
  font: inherit;
  font-weight: 600;
  border: 1px solid transparent;
  background: var(--ink);
  color: white;
  border-radius: 7px;
  padding: 12px 18px;
  cursor: pointer;
  text-decoration: none;
  display: inline-block;
}
button:hover,
.button:hover {
  filter: brightness(1.13);
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.quiet {
  background: transparent;
  color: var(--ink);
  border-color: #bfcac3;
  padding: 9px 13px;
}
.danger {
  background: #fff3ee;
  color: #a43f29;
  border-color: #dca38f;
}
.actions {
  display: flex;
  gap: 12px;
  margin-top: 18px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 18px;
}
input,
textarea,
select {
  font: inherit;
  color: #20343c;
  border: 1px solid #bcc8c1;
  background: #fff;
  border-radius: 6px;
  padding: 11px;
  max-width: 100%;
}
textarea {
  resize: vertical;
  min-height: 75px;
}
input:focus,
textarea:focus,
select:focus,
button:focus-visible,
a:focus-visible {
  outline: 3px solid #d1a767;
  outline-offset: 3px;
}
.check {
  flex-direction: row;
  align-items: flex-start;
  font-weight: 400;
  line-height: 1.55;
}
.check input {
  margin-top: 4px;
}
.execution {
  display: block;
  width: 100%;
  text-align: left;
  background: white;
  color: var(--ink);
  border: 1px solid #d7dfd8;
  margin-top: 12px;
}
.execution.active {
  border-color: var(--ink);
  box-shadow: inset 4px 0 var(--ink);
}
.execution small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  margin-top: 8px;
}
.progress {
  display: flex;
  gap: 6px;
  padding: 0;
  list-style: none;
  flex-wrap: wrap;
  margin: 0 0 28px;
}
.progress li {
  font-size: 11px;
  padding: 7px 9px;
  background: #e8ebe5;
  border-radius: 4px;
  color: #697970;
}
.progress li.done {
  background: #d7e8db;
  color: #275539;
}
.progress li.active {
  background: var(--ink);
  color: white;
}
.dependency {
  padding: 22px 26px;
  border-left: 4px solid var(--accent);
  background: #f8e9de;
  margin-bottom: 24px;
  border-radius: 0 8px 8px 0;
}
.dependency h2 {
  margin: 10px 0;
  font-size: 19px;
}
.media-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 20px;
  margin-top: 24px;
}
.media-grid video,
.media-grid img {
  width: 100%;
  height: 340px;
  object-fit: contain;
  background: #102a2f;
  border-radius: 8px;
}
.media-grid img {
  background: #f0f1ec;
}
.technical {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 14px 0;
}
.technical span {
  padding: 10px 12px;
  background: #eef2eb;
  font-size: 12px;
  border-radius: 5px;
}
.audit {
  font-size: 13px;
  color: #335b48;
}
#final-video {
  display: block;
  max-height: 550px;
  width: 100%;
  background: #102a2f;
  border-radius: 8px;
  margin-top: 20px;
}
#notice {
  position: sticky;
  top: 10px;
  z-index: 2;
  padding: 16px 22px;
  background: #fff4dd;
  border: 1px solid #d4b374;
  border-radius: 8px;
  margin-bottom: 24px;
  line-height: 1.5;
}
pre {
  white-space: pre-wrap;
  font: inherit;
  font-size: 14px;
  line-height: 1.7;
  background: #f4f5ef;
  padding: 18px;
  border-radius: 6px;
}
summary {
  cursor: pointer;
  font-size: 14px;
  margin-bottom: 16px;
}
footer {
  max-width: 1440px;
  margin: 40px auto 24px;
  padding: 0 4vw;
  font-size: 12px;
  color: #758078;
}
@media (max-width: 850px) {
  header .eyebrow {
    display: none;
  }
  .workspace {
    grid-template-columns: 1fr;
    gap: 22px;
  }
  #execution-list {
    display: flex;
    gap: 12px;
    overflow: auto;
  }
  .execution {
    min-width: 210px;
  }
  .media-grid {
    grid-template-columns: 1fr;
  }
  .title-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .card {
    padding: 20px;
  }
  main {
    margin-top: 22px;
  }
  .login {
    margin: 20px auto;
  }
  .login h1 {
    font-size: 32px;
  }
}
`;

export const operationsScript = String.raw`
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let csrf = "",
    selected = "",
    context = null,
    timer = null,
    generation = 0;
  const advancing = new Set();
  const statusNames = {
    SCHEDULED: "Na fila",
    RUNNING: "Em processamento",
    WAITING_INPUT: "Aguardando ação",
    WAITING_RECONCILIATION: "Verificando retomada",
    FAILED: "Interrompido",
    SUCCEEDED: "Pronto para entrega",
    CANCELLED: "Rejeitado / cancelado",
  };
  const steps = [
    ["MEDIA_QC", "Revisão"],
    ["AUDIO", "Narração"],
    ["ALIGNMENT", "Alinhamento"],
    ["SUBTITLES", "Legendas"],
    ["COMPOSITION", "Composição"],
    ["BURN", "MP4"],
    ["QC", "QC final"],
    ["PREVIEW", "Preview"],
    ["HANDOFF", "Aprovação final"],
  ];
  const errors = {
    QC_AUTHENTICATION_REQUIRED:
      "Operador ou credencial inválidos. Use seu cadastro individual.",
    QC_REVIEWER_REQUIRED:
      "A identidade não está habilitada ou foi revogada. Solicite acesso QC_REVIEWER.",
    QC_IDENTITY_CONFIGURATION_REQUIRED:
      "O cadastro individual de revisores precisa ser configurado pelo responsável pelo ambiente.",
    QC_AUTH_RATE_LIMIT:
      "Muitas tentativas. Aguarde um minuto antes de entrar novamente.",
    QC_SESSION_EXPIRED: "Sua sessão expirou. Entre novamente.",
    QC_CSRF_REQUIRED: "A sessão precisa ser renovada. Entre novamente.",
    QC_ORIGIN_REQUIRED: "Acesse este painel pelo endereço local original.",
    HUMAN_APPROVAL_REFERENCE_REQUIRED:
      "Falta uma imagem original autorizada vinculada ao roteiro. Solicite o cadastro dessa referência.",
    REFERENCE_IMAGE_SELECTION_REQUIRED:
      "Selecione a imagem original correta para esta revisão.",
    MEDIA_PROCESSING_RIGHTS_UNCONFIRMED:
      "Os direitos atuais não autorizam este processamento.",
    HUMAN_APPROVAL_RIGHTS_SCOPE_MISMATCH:
      "A campanha ou operação não corresponde à autorização da mídia.",
    HUMAN_APPROVAL_REVIEW_STALE:
      "A mídia, a referência ou os direitos mudaram. Atualize a revisão.",
    HUMAN_APPROVAL_TECHNICAL_REQUIRED:
      "A verificação técnica local e seus recursos precisam estar disponíveis.",
    HUMAN_APPROVAL_QC_FAILED:
      "Há uma falha técnica que impede a aprovação. Substitua a mídia por uma versão válida.",
    HUMAN_APPROVAL_REVIEW_INVALID:
      "Confira as observações de todos os critérios e atualize a revisão.",
    HUMAN_APPROVAL_DECISION_CONFLICT:
      "Já existe uma decisão diferente para esta versão. Atualize a revisão.",
    LOCAL_RIGHTS_EVIDENCE_REQUIRED:
      "Informe a origem e confirme os direitos da gravação.",
    PROVIDER_UNSUPPORTED_AUDIO: "Use WAV PCM, 24 kHz, mono, 16 bits.",
    PROVIDER_INVALID_AUDIO: "O WAV não contém áudio válido no formato exigido.",
    LOCAL_MEDIA_CONFIGURATION_REQUIRED:
      "O armazenamento de mídia local precisa ser configurado no ambiente.",
    AUDIO_INPUT_CONFLICT:
      "A gravação não pode ser substituída nesta etapa. Atualize a execução.",
    HUMAN_APPROVAL_JUSTIFICATION_REQUIRED:
      "Informe o motivo da rejeição da versão final.",
    OFFLINE_VIDEO_PRODUCTION_REQUIRED:
      "Esta execução não pertence ao fluxo local de finalização. Nenhuma geração ou publicação foi acionada.",
  };
  function notice(message) {
    $("notice").textContent = message;
    $("notice").hidden = !message;
  }
  function fail(error) {
    notice(
      errors[error.code] ||
        "Não foi possível concluir a ação. Atualize a execução e confira suas pendências.",
    );
    if (error.status === 401) {
      generation++;
      clearTimeout(timer);
      $("workspace").hidden = true;
      $("login-panel").hidden = false;
      $("logout").hidden = true;
      csrf = "";
      selected = "";
      context = null;
      $("source-video").removeAttribute("src");
      $("final-video").removeAttribute("src");
      $("source-image").removeAttribute("src");
      $("detail").hidden = true;
      $("empty").hidden = false;
      $("session-label").textContent = "";
    }
  }
  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.method && options.method !== "GET") headers["x-qc-csrf"] = csrf;
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw {
        code: body.code || "OPERATIONS_UNAVAILABLE",
        status: response.status,
      };
    return body;
  }
  const post = (path, body) =>
    api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const base = () => "/operations/executions/" + encodeURIComponent(selected);
  function text(tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  }
  async function list() {
    const rows = await api("/operations/executions");
    $("execution-list").replaceChildren();
    if (!rows.length)
      $("execution-list").append(
        text(
          "p",
          "Nenhuma execução de campanha disponível. O painel exibirá os vídeos das execuções locais cadastradas.",
        ),
      );
    for (const row of rows) {
      const button = text("button", row.campaign_id);
      button.className =
        "execution" + (row.execution_id === selected ? " active" : "");
      button.append(text("small", statusNames[row.status] || row.status));
      button.addEventListener("click", () =>
        open(row.execution_id).catch(fail),
      );
      $("execution-list").append(button);
    }
  }
  function render(data) {
    const execution = data.execution,
      finalization = execution.finalization;
    $("campaign-title").textContent = execution.campaign_id;
    $("execution-status").textContent =
      (statusNames[execution.status] || execution.status) +
      (execution.provenance?.provenance === "LEGACY_RECOVERY"
        ? " · Run recuperado. Contexto, roteiro, cenas e geração não foram executados por este orquestrador."
        : "");
    $("progress").replaceChildren();
    for (const [key, label] of steps) {
      const li = text("li", label);
      li.className = finalization.completedSteps.includes(key)
        ? "done"
        : finalization.step === key
          ? "active"
          : "";
      $("progress").append(li);
    }
    const pending = finalization.pending;
    $("dependency").hidden = !pending;
    $("dependency-title").textContent = pending
      ? "O processamento precisa de você."
      : "";
    $("dependency-message").textContent = pending ? pending.message : "";
    $("retry").hidden =
      !pending ||
      !["WAITING_INPUT", "WAITING_RECONCILIATION", "FAILED"].includes(
        execution.status,
      );
    const current = $("media-select").value;
    $("media-select").replaceChildren();
    for (const item of data.media) {
      const option = text(
        "option",
        "Cena " + item.position + " · versão " + item.revision,
      );
      option.value = item.mediaAssetId;
      $("media-select").append(option);
    }
    if (data.media.some((m) => m.mediaAssetId === current))
      $("media-select").value = current;
    $("load-review").disabled = !data.media.length;
    $("audio-panel").hidden = !(
      pending &&
      ["AUDIO_REQUIRED", "LOCAL_AUDIO_SELECTION_REQUIRED"].includes(
        pending.code,
      )
    );
    $("narration").textContent =
      data.script?.fullNarration || "O roteiro ainda não está disponível.";
    const ready = finalization.completedSteps.includes("PREVIEW");
    $("final-panel").hidden = !ready;
    if (ready) {
      const url = base() + "/final.mp4";
      if ($("final-video").getAttribute("src") !== url)
        $("final-video").src = url;
      $("download").href = url + "?download=1";
    }
    $("final-form").hidden = !(
      ready && pending?.code === "EXACT_HUMAN_APPROVAL_REQUIRED"
    );
  }
  async function advance(id) {
    if (advancing.has(id)) return;
    advancing.add(id);
    try {
      await post(
        "/operations/executions/" + encodeURIComponent(id) + "/advance",
        {},
      );
    } catch (error) {
      if (id === selected) fail(error);
    } finally {
      advancing.delete(id);
    }
  }
  async function poll(version) {
    if (version !== generation || !selected) return;
    try {
      const data = await api(base());
      if (version !== generation) return;
      render(data);
      if (
        [
          "SCHEDULED",
          "RUNNING",
          "WAITING_INPUT",
          "WAITING_RECONCILIATION",
        ].includes(data.execution.status)
      )
        void advance(selected);
    } catch (error) {
      fail(error);
    }
    if (version === generation) timer = setTimeout(() => poll(version), 4000);
  }
  async function open(id) {
    generation++;
    clearTimeout(timer);
    selected = id;
    context = null;
    $("review-content").hidden = true;
    $("reference-choice").hidden = true;
    $("empty").hidden = true;
    $("detail").hidden = false;
    notice("");
    await poll(generation);
    await list();
  }
  async function loadReview(referenceId) {
    const version = generation,
      mediaId = $("media-select").value;
    context = null;
    $("review-content").hidden = true;
    const data = await post(
      base() + "/media/" + encodeURIComponent(mediaId) + "/context",
      referenceId ? { referenceId } : {},
    );
    if (version !== generation || mediaId !== $("media-select").value) return;
    $("reference-select").replaceChildren();
    for (const item of data.referenceChoices || []) {
      const option = text("option", "Referência da cena " + item.position);
      option.value = item.mediaAssetId;
      $("reference-select").append(option);
    }
    $("reference-choice").hidden = !(data.referenceChoices?.length > 1);
    if (data.pending) {
      notice(errors[data.pending] || data.pending);
      return;
    }
    context = data;
    context.mediaId = mediaId;
    $("reference-select").value = data.referenceImage.mediaAssetId;
    const file =
      base() +
      "/media/" +
      encodeURIComponent(mediaId) +
      "/" +
      encodeURIComponent(data.referenceImage.mediaAssetId) +
      "/file";
    $("source-video").src = file + "?kind=video";
    $("source-image").src = file + "?kind=reference";
    $("technical").replaceChildren();
    const labels = {
        motion: "Movimento",
        continuity: "Continuidade",
        fidelity: "Fidelidade",
      },
      results = {
        PASS: "Validado",
        FAIL: "Falha",
        NOT_VALIDATED: "Revisão humana necessária",
      };
    for (const key of Object.keys(labels))
      $("technical").append(
        text(
          "span",
          labels[key] + ": " + results[data.automatic.evidence[key]],
        ),
      );
    const audit = data.review?.evidence?.provenance?.parameters?.humanReview;
    $("decision-audit").textContent = audit
      ? (audit.decision === "APPROVED" ? "Aprovado" : "Rejeitado") +
        " por " +
        audit.actor +
        " · " +
        new Date(audit.decidedAt).toLocaleString("pt-BR")
      : "";
    $("review-form").hidden = !!audit;
    $("review-form").reset();
    $("review-content").hidden = false;
    notice("");
  }
  async function start(session) {
    csrf = session.csrfToken;
    $("session-label").textContent = session.operatorId;
    $("logout").hidden = false;
    $("login-panel").hidden = true;
    $("workspace").hidden = false;
    notice("");
    await list();
  }
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const button = event.target.querySelector("button");
    button.disabled = true;
    try {
      const result = await post("/operations/session", {
        operatorId: form.get("operatorId"),
        secret: form.get("secret"),
      });
      event.target.reset();
      await start(result);
    } catch (error) {
      fail(error);
    } finally {
      button.disabled = false;
    }
  });
  $("logout").addEventListener("click", async () => {
    try {
      await post("/operations/logout", {});
      location.reload();
    } catch (error) {
      fail(error);
    }
  });
  $("refresh-list").addEventListener("click", () => list().catch(fail));
  $("load-review").addEventListener("click", () => loadReview().catch(fail));
  $("load-reference").addEventListener("click", () =>
    loadReview($("reference-select").value).catch(fail),
  );
  $("media-select").addEventListener("change", () => {
    context = null;
    $("review-content").hidden = true;
    $("reference-choice").hidden = true;
  });
  $("review-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!context) return;
    const review = context,
      version = generation,
      id = selected;
    const buttons = [...event.target.querySelectorAll("button")];
    buttons.forEach((button) => (button.disabled = true));
    try {
      const form = new FormData(event.target),
        duration = review.asset.durationMilliseconds / 1000,
        criteria = {};
      for (const key of ["motion", "continuity", "fidelity"])
        criteria[key] = {
          startSeconds: 0,
          endSeconds: duration,
          observation: form.get(key),
        };
      await post(
        "/media/assets/" +
          encodeURIComponent(review.mediaId) +
          "/temporal-reviews",
        {
          schemaVersion: "human-temporal-review-request/1.0.0",
          mediaAssetId: review.asset.mediaAssetId,
          mediaContentHash: review.asset.contentHash,
          mediaRevision: review.asset.revision,
          automaticReportHash: review.automatic.contentHash,
          referenceImage: review.referenceImage,
          decision: event.submitter.value,
          criteria,
        },
      );
      if (version !== generation) return;
      notice(
        "Decisão humana registrada. A finalização disponível continua automaticamente.",
      );
      await loadReview(review.referenceImage.mediaAssetId);
      void advance(id);
    } catch (error) {
      fail(error);
    } finally {
      buttons.forEach((button) => (button.disabled = false));
    }
  });
  $("audio-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target),
      file = form.get("audio");
    if (!file || file.size > 20971520) {
      notice("Selecione um WAV de até 20 MB.");
      return;
    }
    form.set("commercialUseAllowed", "true");
    const button = event.target.querySelector("button");
    button.disabled = true;
    try {
      await api(base() + "/audio", { method: "POST", body: form });
      event.target.reset();
      notice(
        "Gravação autorizada registrada. Preparando alinhamento e legendas.",
      );
      void advance(selected);
    } catch (error) {
      fail(error);
    } finally {
      button.disabled = false;
    }
  });
  $("final-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const decision = event.submitter.value,
      justification = event.target.elements.justification.value.trim() || null;
    if (decision === "REJECTED" && !justification) {
      notice("Informe o motivo da rejeição.");
      return;
    }
    const buttons = [...event.target.querySelectorAll("button")];
    buttons.forEach((button) => (button.disabled = true));
    try {
      await post(base() + "/final-review", { decision, justification });
      event.target.reset();
      notice(
        "Decisão da versão final registrada. Nenhuma publicação foi acionada.",
      );
      void advance(selected);
    } catch (error) {
      fail(error);
    } finally {
      buttons.forEach((button) => (button.disabled = false));
    }
  });
  $("retry").addEventListener("click", async () => {
    try {
      await post(base() + "/retry", {});
      void advance(selected);
    } catch (error) {
      fail(error);
    }
  });
  api("/operations/session")
    .then(start)
    .catch((error) => {
      if (error.status !== 401) fail(error);
    });
})();
`;
