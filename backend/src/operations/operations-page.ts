export const operationsPage = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MKTauto · Finalização</title><link rel="stylesheet" href="/operations/styles.css"><script src="/operations/app.js" defer></script></head>
<body><header><a href="/operations" class="brand">MKT<span>auto</span></a><span class="eyebrow">ESTÚDIO LOCAL / FINALIZAÇÃO</span><div id="session-label"></div><button id="logout" class="quiet" hidden>Sair</button></header>
<main><section id="login-panel" class="login card"><p class="eyebrow">ACESSO DO OPERADOR</p><h1>Da revisão ao vídeo final.</h1><p>Revise as mídias autorizadas. O sistema cuida da finalização disponível e mostra o que ainda falta.</p>
<form id="login-form"><label>Operador<input name="operatorId" autocomplete="username" required pattern="[a-z][a-z0-9_]{2,63}" placeholder="Seu identificador individual"></label><label>Credencial pessoal<input name="secret" type="password" autocomplete="current-password" required maxlength="128"></label><button type="submit">Entrar com segurança</button></form><p class="muted">Use sua identidade QC_REVIEWER já cadastrada. A credencial não é exibida nem salva na página. Se o cadastro não estiver configurado, solicite sua habilitação ao responsável pelo ambiente.</p></section>
<div id="notice" role="status" aria-live="polite" hidden></div>
<div id="workspace" class="workspace" hidden><aside><p class="eyebrow">FILA DE PRODUÇÃO</p><h1>Seus vídeos</h1><button id="refresh-list" class="quiet">Atualizar fila</button><div id="execution-list"></div><p class="muted">Finalização local. Publicação simulada exige autorização própria.</p></aside>
<div><section id="instagram-connection" class="card"><h2>Conexão Instagram</h2><p>Facebook Login · conta profissional vinculada a uma Página. Credenciais são configuradas somente no servidor.</p><p id="instagram-connection-status" role="status">Conexão ainda não verificada. Publicação LIVE bloqueada.</p><button id="instagram-connection-check" class="quiet">Verificar conexão com a Meta</button><p class="muted">Consulta somente leitura, sob demanda. A verificação não publica nem autoriza postagem. Hospedagem LIVE confiável, acesso do app e aprovação da versão exata continuam necessários.</p></section>
<section id="empty" class="card empty"><p class="eyebrow">COMECE PELA FILA</p><h2>Selecione uma campanha</h2><p>Acompanhe a revisão, as dependências e o resultado em um só lugar.</p></section>
<article id="detail" hidden><div class="title-row"><div><p class="eyebrow">FINALIZAÇÃO DO VÍDEO</p><h1 id="campaign-title"></h1></div><span id="execution-status" class="badge"></span></div><ol id="progress" class="progress" aria-label="Etapas de finalização"></ol>
<section id="dependency" class="dependency" hidden><p class="eyebrow">AÇÃO NECESSÁRIA</p><h2 id="dependency-title"></h2><p id="dependency-message"></p><button id="retry" class="quiet">Verificar novamente</button></section>
<section class="card"><div class="title-row"><h2>01 / Revisão da mídia</h2><label>Vídeo<select id="media-select" aria-label="Vídeo para revisar"></select></label></div><button id="load-review" class="quiet">Abrir revisão e verificação técnica</button>
<div id="reference-choice" hidden><label>Imagem original de referência<select id="reference-select"></select></label><button id="load-reference" class="quiet">Usar esta referência</button></div>
<div id="review-content" hidden><div class="media-grid"><div><video id="source-video" controls preload="metadata" aria-label="Vídeo para revisão"></video><p class="muted">Vídeo gerado / recuperado</p></div><div><img id="source-image" alt="Imagem original de referência autorizada"><p class="muted">Referência original</p></div></div><div id="technical" class="technical"></div><p id="decision-audit" class="audit"></p>
<form id="review-form"><p>Registre sua observação para cada critério ao longo do vídeo. Uma falha técnica não pode ser substituída por aprovação.</p><label>Movimento real<textarea name="motion" minlength="10" maxlength="1000" required placeholder="Descreva o movimento observado."></textarea></label><label>Continuidade<textarea name="continuity" minlength="10" maxlength="1000" required placeholder="Descreva a continuidade do vídeo completo."></textarea></label><label>Fidelidade à referência<textarea name="fidelity" minlength="10" maxlength="1000" required placeholder="Compare o produto e seus detalhes com a referência."></textarea></label><label class="check"><input type="checkbox" name="watched" required>Assisti ao vídeo completo e comparei com a imagem de referência.</label><div class="actions"><button name="decision" value="APPROVED" type="submit">Aprovar mídia</button><button name="decision" value="REJECTED" type="submit" class="danger">Rejeitar mídia</button></div></form></div></section>
<section id="script-revision-panel" class="card" hidden><h2>Revisar roteiro</h2><p>Selecione uma revisão cadastrada para esta campanha e confira o texto antes de continuar. Somente uma revisão de narração com os mesmos visuais pode reutilizar o QC visual. Áudio, legendas, composição e aprovação final anteriores deixam de valer para esta versão.</p><form id="script-revision-form"><label>Roteiro / revisão disponível<select id="script-revision-select" name="scriptId" required aria-describedby="script-revision-help"></select></label><p id="script-revision-help"></p><pre id="script-revision-text"></pre><label>Justificativa<textarea name="reason" required minlength="15" maxlength="1000"></textarea></label><button>Vincular revisão e continuar</button></form></section><section id="tts-panel" class="card" hidden><h2>Narração comercial OpenAI</h2><p id="tts-status"></p><button id="tts-prepare">Preparar narração</button><div id="tts-preview" hidden><p id="tts-model"></p><pre id="tts-text"></pre><p id="tts-price"></p><label class="check"><input id="tts-accept-risk" type="checkbox">Autorizo uma única narração e aceito que a cobrança do provedor possa superar a reserva interna de US$ 0,01. A estimativa não é um teto garantido. Autorização válida por 15 minutos.</label><button id="tts-generate" disabled>Autorizar e gerar narração</button></div></section><section id="audio-panel" class="card" hidden><h2>02 / Narração autorizada</h2><label>Fonte da voz<select id="audio-mode"><option value="AUTOMATIC">Voz automática local</option><option value="RECORDING">Gravação própria ou licenciada</option></select></label><p id="audio-mode-description">A voz automática exige modelo local, licença comercial comprovada e alinhador configurados. Nenhum serviço pago será acionado. A fala não será acelerada ou cortada.</p><details><summary>Ver roteiro da narração</summary><pre id="narration"></pre></details><form id="audio-form" hidden><p>WAV PCM, 24 kHz, mono, 16 bits; até 20 MB.</p><label>Arquivo WAV<input type="file" name="audio" accept=".wav,audio/wav" required></label><label>Direito de uso<select name="usageBasis"><option value="OWNED">Gravação própria</option><option value="LICENSED">Gravação licenciada</option></select></label><label>Evidência de autorização<textarea name="statement" required minlength="15" maxlength="2000" placeholder="Informe a origem e a autorização de uso desta gravação."></textarea></label><label class="check"><input type="checkbox" name="commercialUseAllowed" required>Confirmo autorização para processamento local e uso comercial nesta campanha.</label><button type="submit">Enviar gravação e continuar</button></form></section>
<section id="final-panel" class="card" hidden><div class="title-row"><h2>03 / Seu vídeo final</h2><a id="download" class="button" download="video-final.mp4">Baixar MP4</a></div><video id="final-video" controls preload="metadata" aria-label="Vídeo final com narração e legendas"></video><p class="muted">MP4 com QC técnico validado. Custo computacional local não medido; nenhum custo pago é presumido como zero.</p><form id="final-form" hidden><h3>Aprovação da versão final</h3><p>Esta decisão é independente da revisão da mídia e libera somente a entrega manual.</p><label>Observação / motivo da rejeição<textarea name="justification" maxlength="2000"></textarea></label><label class="check"><input type="checkbox" required>Revisei esta versão final exata, incluindo narração e legendas.</label><div class="actions"><button name="decision" value="APPROVED" type="submit">Aprovar versão final</button><button name="decision" value="REJECTED" type="submit" class="danger">Rejeitar versão final</button></div></form></section><section id="instagram-panel" class="card" hidden><h2>05 / Instagram</h2><p id="instagram-mode"></p><p id="instagram-state" role="status"></p><a id="instagram-url" target="_blank" rel="noopener noreferrer" hidden>Ver publicação</a>
<form id="instagram-package-form"><label>Texto da postagem<textarea name="caption" required maxlength="5000"></textarea></label><button>Preparar pacote para revisão</button></form>
<pre id="instagram-package-preview"></pre>
<form id="instagram-schedule-form" hidden><label>Data e hora local<input name="scheduledAt" type="datetime-local" required></label><label class="check"><input name="confirm" type="checkbox" required>Revisei o MP4 final e o pacote acima e autorizo esta publicação simulada nesta conta e horário.</label><button>Autorizar e agendar simulação</button></form>
<button id="instagram-refresh" class="quiet">Verificar publicação</button><button id="instagram-cancel" class="quiet" hidden>Cancelar agendamento</button></section>
</article></div></div></main><footer>Controle humano em cada aprovação. Direitos e proveniência preservados.</footer></body></html>`;

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
#instagram-connection-status {
  white-space: pre-line;
  overflow-wrap: anywhere;
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
  let instagramPackageHash = "";
  let lastTts = null;
  function renderTts(data) {
    if (!lastTts || lastTts.requestHash !== data?.requestHash) $("tts-accept-risk").checked = false;
    lastTts = data;
    $("tts-panel").hidden = !data;
    const prepared = !!data?.requestHash;
    $("tts-preview").hidden = !prepared;
    $("tts-prepare").disabled = prepared && data.state !== "NOT_SUBMITTED";
    if (!prepared) { $("tts-status").textContent = data ? "Prepare a narração para conferir texto, modelo e custo antes de autorizar." : ""; return; }
    $("tts-model").textContent = data.model + " · voz " + data.voice + " · português";
    $("tts-text").textContent = data.text;
    $("tts-price").textContent = "Estimativa histórica: US$ " + data.estimatedUsd + ". Reserva interna: US$ " + data.reservationUsd + ". O custo efetivo depende da evidência de cobrança." + (data.policyVersion ? " Política: " + data.policyVersion + "." : "");
    const uncertain = ["SUBMITTING", "UNKNOWN"].includes(data.state) && !data.audioConfirmed;
    $("tts-status").textContent = data.audioConfirmed
      ? "Áudio confirmado. A finalização pode continuar sem novo envio pago. O custo efetivo pode continuar pendente de evidência."
      : uncertain ? "Envio em processamento ou incerto. Novo envio bloqueado; aguarde confirmação ou reconciliação."
      : data.liveEnabled ? "Confira o texto e autorize somente esta narração." : "Geração paga desativada neste ambiente. Nenhuma chamada será realizada.";
    $("tts-generate").textContent = data.audioConfirmed ? "Retomar finalização" : "Autorizar e gerar narração";
    $("tts-generate").disabled = !data.audioConfirmed && (uncertain || !data.liveEnabled || !$("tts-accept-risk").checked);
  }
  function renderNextAction(data) {
    const action = data.nextAction?.code;
    const ttsAction = ["TTS_AUTHORIZATION_REQUIRED", "TTS_CONTINUATION_REQUIRED", "TTS_RECONCILIATION_REQUIRED"].includes(action);
    $("script-revision-panel").hidden = action !== "SCRIPT_REVISION_REQUIRED";
    $("audio-panel").hidden = ttsAction || data.execution.finalization.completedSteps.includes("AUDIO") || data.execution.status !== "WAITING_INPUT";
    renderTts(ttsAction ? data.tts : null);
  }

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
    SOCIAL_INSTAGRAM_CONFIGURATION_REQUIRED: "Configure a conta e o provedor Instagram fake no ambiente. Nenhuma publicação real está habilitada.",
    SOCIAL_SCHEDULER_CONFIGURATION_REQUIRED: "O armazenamento do agendador precisa ser provisionado pelo responsável pelo ambiente. Nenhum envio foi iniciado.",
    SOCIAL_HANDOFF_REQUIRED: "Conclua a aprovação final independente do MP4 antes de preparar a publicação.",
    SOCIAL_LIVE_POST_BLOCKED: "Publicação LIVE bloqueada. Este painel autoriza somente simulações offline.",
    SOCIAL_SCHEDULE_CONFLICT: "Já existe outro agendamento para este vídeo. Consulte o registro existente.",
    SOCIAL_CANCELLATION_RECONCILIATION_REQUIRED: "O envio já foi iniciado. É necessário reconciliar o resultado antes de qualquer nova ação.",
    PUBLICATION_RIGHTS_REQUIRED: "As fontes possuem direitos insuficientes ou restritos à revisão. A publicação exige autorização comercial aplicável.",
    PUBLICATION_SOURCE_QC_REQUIRED: "O QC autenticado das fontes precisa continuar válido para publicar.",
    PUBLICATION_QC_REQUIRED: "O QC técnico do MP4 final está ausente, mudou ou não foi aprovado.",
    SOCIAL_ELIGIBILITY_REQUIRED: "Não foi possível comprovar a elegibilidade do MP4 final para publicação.",
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
    HUMAN_APPROVAL_REQUEST_INVALID:
      "Os dados da revisão são inválidos. Recarregue a revisão e confira os campos antes de decidir.",
    HUMAN_APPROVAL_VIDEO_BINDING_MISMATCH:
      "A revisão não corresponde à versão exata do vídeo, da referência ou do QC técnico. Recarregue a revisão antes de decidir.",
    HUMAN_APPROVAL_REVIEW_BUSY:
      "Outra revisão está sendo processada. Aguarde e consulte a decisão registrada antes de tentar novamente.",
    HUMAN_APPROVAL_REVIEW_UNAVAILABLE:
      "O serviço de revisão está indisponível. Solicite a verificação do backend.",
    HUMAN_APPROVAL_REVIEW_INVALID:
      "Confira as observações de todos os critérios e atualize a revisão.",
    HUMAN_APPROVAL_DECISION_CONFLICT:
      "Já existe uma decisão diferente para esta versão. Atualize a revisão.",
    LOCAL_RIGHTS_EVIDENCE_REQUIRED:
      "Informe a origem e confirme os direitos da gravação.",
    TTS_EXPLICIT_RISK_ACCEPTANCE_REQUIRED: "Confira o texto e aceite explicitamente o risco financeiro desta narração.",
    TTS_PREPARATION_STALE: "O roteiro ou a preparação mudou. Prepare novamente e confira o texto antes de autorizar.",
    TTS_LIVE_CONFIGURATION_REQUIRED: "A geração paga permanece desativada ou não foi configurada pelo responsável pelo ambiente.",
    TTS_RECONCILIATION_REQUIRED: "O envio anterior está incerto. Nenhum novo envio será realizado; é necessário reconciliar as evidências.",
    TTS_CONFIRMED_AUDIO_REQUIRED: "Ainda não há um resultado de áudio confirmado para finalizar este vídeo.",
    NARRATION_DURATION_REQUIRED: "A fala não cabe no vídeo. Revise o roteiro e preserve o CTA; o áudio não será cortado nem acelerado.",
    ALIGNMENT_TEXT_DIVERGENT: "O alinhador não confirmou a correspondência entre a fala e o roteiro. As legendas permanecem bloqueadas.",
    PROVIDER_UNSUPPORTED_AUDIO: "Use WAV PCM, 24 kHz, mono, 16 bits.",
    PROVIDER_INVALID_AUDIO: "O WAV não contém áudio válido no formato exigido.",
    LOCAL_MEDIA_CONFIGURATION_REQUIRED:
      "O armazenamento de mídia local precisa ser configurado no ambiente.",
    AUDIO_INPUT_CONFLICT:
      "A gravação não pode ser substituída nesta etapa. Atualize a execução.",
    INVALID_SCRIPT_REVISION_IDENTIFIER:
      "O campo ID da revisão cadastrada exige um identificador sem espaços. Cadastre a revisão pelo fluxo de roteiros e copie seu ID; informe o motivo em Justificativa.",
    INVALID_SCRIPT_REVISION:
      "Informe uma revisão cadastrada e uma justificativa de pelo menos 15 caracteres.",
    SCRIPT_REVISION_STALE:
      "O roteiro mudou desde a abertura desta tela. Atualize a execução antes de vincular a revisão.",
    SCRIPT_REVISION_SCOPE_MISMATCH:
      "A revisão deve suceder o roteiro atual na mesma operação e preservar visuais, CTA e exigências de revisão.",
    SCRIPT_REVISION_STATE_CONFLICT:
      "A revisão exige execução aguardando entrada e QC visual concluído, antes do handoff ou publicação.",
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
      (error.code === "HUMAN_APPROVAL_REQUEST_INVALID" && error.field === "observation"
        ? "Confira as observações: use texto de 10 a 1000 caracteres, sem credenciais, caminhos privados ou caracteres de controle."
        : errors[error.code]) ||
        ("Não foi possível concluir a ação." +
          (/^[A-Z][A-Z0-9_]{2,79}$/.test(error.code || "")
            ? " Código: " + error.code + "."
            : "") + " Atualize a execução e confira suas pendências."),
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
        field: body.field,
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
  function renderInstagramConnection(data) {
    const state = {READY:"Conexão pronta",NOT_CONFIGURED:"Configuração pendente",NOT_CHECKED:"Conexão ainda não verificada",BLOCKED:"Conexão bloqueada",UNAVAILABLE:"Conexão indisponível"};
    const reasons = {CONFIGURATION_REQUIRED:"Preencha a configuração privada no servidor.",CONNECTION_CHECK_REQUIRED:"Execute a verificação de conexão.",TOKEN_INVALID:"Token da Página inválido ou revogado.",TOKEN_EXPIRED:"Token ou acesso aos dados expirado.",TOKEN_APP_MISMATCH:"Token pertence a outro app Meta.",PAGE_TOKEN_REQUIRED:"É necessário um token de acesso da Página.",TOKEN_RESPONSE_INVALID:"A Meta não retornou evidência válida do token.",TOKEN_TARGET_MISMATCH:"Permissões não abrangem o destino configurado.",PAGE_TOKEN_MISMATCH:"Token pertence a outra Página.",PROFESSIONAL_ACCOUNT_LINK_REQUIRED:"Vincule a conta profissional à Página.",INSTAGRAM_ACCOUNT_MISMATCH:"A conta vinculada difere do destino configurado.",APP_AUTH_REQUIRED:"Credencial do app Meta inválida ou indisponível.",META_PERMISSION_REQUIRED:"A Meta não confirmou as permissões necessárias.",META_RATE_LIMIT:"Limite de consultas da Meta atingido. Tente mais tarde.",META_UNAVAILABLE:"A Meta não confirmou a conexão. Tente mais tarde."};
    const tokenStates = {VALID:"válido",INVALID:"inválido",EXPIRED:"expirado",NOT_CHECKED:"não verificado"};
    const lines = [state[data.connection] || "Conexão indisponível", "Publicação LIVE bloqueada."];
    if(data.missingConfiguration.length)lines.push("Configuração no servidor: " + data.missingConfiguration.join(", "));
    lines.push(data.missingPermissions===null ? "Permissões ainda não verificadas." : data.missingPermissions.length ? "Permissões faltantes: " + data.missingPermissions.join(", ") : "Permissões exigidas verificadas.");
    if(data.requiredPermissions?.length)lines.push("Permissões exigidas: " + data.requiredPermissions.join(", "));
    lines.push("Token: " + (tokenStates[data.token.status] || "não verificado") + (data.token.expiresAt ? " · acesso expira em " + data.token.expiresAt : ""));
    if(data.blockers.length)lines.push("Pendências: " + data.blockers.map(code=>reasons[code] || "Conexão não confirmada.").join(" "));
    if(data.checkedAt)lines.push("Verificado em: " + data.checkedAt);
    $("instagram-connection-status").textContent=lines.join("\n");
  }
  async function instagramStatus() {
    const data=await api(base()+"/instagram");
    $("instagram-mode").textContent=data.configuration.mode==="fake"
      ? "Simulação offline. Nenhuma publicação real será enviada. Conta: "+data.configuration.accountId
      : "Instagram indisponível. Configure o provedor fake e o agendador; LIVE exige autorização e integração próprias.";
    const schedule=data.schedule,operation=data.operation;
    const states={SCHEDULED:"Agendado",RUNNING:"Em processamento",WAITING_RECONCILIATION:"Resultado incerto: reconciliação necessária; nenhum novo envio será feito",COMPLETED:"Simulação concluída",FAILED:"Falha: verifique a pendência",CANCELLED:"Cancelado",PUBLISHED:"Publicado na simulação",UNCERTAIN:"Resultado remoto incerto",PROCESSING:"Processando no provedor",PREPARED:"Preparado",READY:"Pronto"};
    const problem=schedule?.result_json?JSON.parse(schedule.result_json).code:null;
    $("instagram-state").textContent=schedule
      ? (states[schedule.status]||schedule.status)+" · "+new Date(schedule.scheduled_at).toLocaleString("pt-BR")+
        (operation?" · "+(states[operation.state]||operation.state):"")+
        (operation?.mediaId?" · ID: "+operation.mediaId:"")+
        (problem?" · "+(errors[problem]||"Pendência de publicação: "+problem):"")
      : "Nenhuma publicação autorizada.";
    $("instagram-package-form").hidden=data.configuration.mode!=="fake" || !!schedule;
    $("instagram-cancel").hidden=!schedule || schedule.status!=="SCHEDULED" || !!operation;
    const url=operation?.remoteReceipt?.permalink;
    const safeUrl=typeof url==="string" && /^https:\/\/(www\.)?instagram\.com\//.test(url);
    $("instagram-url").hidden=!safeUrl;
    if(safeUrl)$("instagram-url").href=url;
    if(schedule)$("instagram-schedule-form").hidden=true;
  }
  function render(data) {
    const execution = data.execution,
      finalization = execution.finalization;
    $("instagram-panel").hidden=execution.status!=="SUCCEEDED";
    if(execution.status==="SUCCEEDED")void instagramStatus().catch(fail);
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
    const pending = data.nextAction ?? finalization.pending;
    $("dependency").hidden = !pending;
    $("dependency-title").textContent = pending
      ? "O processamento precisa de você."
      : "";
    $("dependency-message").textContent = pending ? pending.message : "";
    $("retry").hidden =
      !pending ||
      ["TTS_AUTHORIZATION_REQUIRED", "TTS_RECONCILIATION_REQUIRED", "SCRIPT_REVISION_REQUIRED"].includes(pending.code) ||
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
    renderNextAction(data);
    $("script-revision-form").dataset.previousHash = data.script?.contentHash || "";
    const revisionSelect = $("script-revision-select");
    const previousRevision = revisionSelect.value;
    revisionSelect.replaceChildren();
    const revisions = data.scriptRevisions || [];
    for (const revision of revisions) {
      const option = text("option", "Versão " + revision.revision + " · " + revision.fullNarration);
      option.value = revision.scriptId;
      revisionSelect.append(option);
    }
    if (revisions.some((revision) => revision.scriptId === previousRevision)) revisionSelect.value = previousRevision;
    const showRevision = () => {
      const revision = revisions.find((item) => item.scriptId === revisionSelect.value);
      $("script-revision-text").textContent = revision ? "Versão " + revision.revision + "\n" + revision.fullNarration : "";
    };
    revisionSelect.onchange = showRevision;
    showRevision();
    revisionSelect.disabled = !revisions.length;
    $("script-revision-form").querySelector("button").disabled = !revisions.length;
    $("script-revision-help").textContent = revisions.length
      ? "Selecione a revisão que deseja vincular. O identificador será enviado automaticamente."
      : "Uma revisão mais curta precisa estar cadastrada, preservando os visuais e o CTA do roteiro atual.";
    $("audio-mode").value = data.audioMode || "AUTOMATIC";
    $("audio-form").hidden = $("audio-mode").value!=="RECORDING";
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
    instagramPackageHash="";
    $("instagram-package-preview").textContent="";
    $("instagram-schedule-form").hidden=true;
    context = null;
    $("review-content").hidden = true;
    $("reference-choice").hidden = true;
    $("empty").hidden = true;
    $("detail").hidden = false;
    notice("");
    await poll(generation);
    await list();
  }
  function reviewPresentation(data) {
    const evidence = data.review?.evidence;
    const audit = evidence?.provenance?.validator === "authenticated-human-qc"
      ? evidence.provenance.parameters?.humanReview : null;
    return audit && ["APPROVED", "REJECTED"].includes(audit.decision)
      ? {evidence, audit}
      : {evidence:data.automatic.evidence, audit:null};
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
    const presentation = reviewPresentation(data);
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
          labels[key] + ": " + results[presentation.evidence[key]] +
            (presentation.audit ? " · revisão humana" : " · análise automática"),
        ),
      );
    const audit = presentation.audit;
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
    await Promise.all([api("/operations/instagram/connection").then(renderInstagramConnection).catch(fail), list()]);
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
  $("instagram-connection-check").addEventListener("click",async()=>{
    const button=$("instagram-connection-check");button.disabled=true;
    $("instagram-connection-status").textContent="Verificando conexão. Publicação LIVE bloqueada.";
    try{renderInstagramConnection(await post("/operations/instagram/connection/check",{}));}
    catch(error){$("instagram-connection-status").textContent="Conexão não verificada. Publicação LIVE bloqueada.";fail(error);}
    finally{button.disabled=false;}
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
  function buildReviewCriteria(review, form) {
    const duration = review.asset.durationMilliseconds / 1000;
    if (!Number.isFinite(duration) || duration <= 0)
      throw {code:"HUMAN_APPROVAL_REVIEW_INVALID",field:"criteria"};
    const criteria = {};
    for (const key of ["motion", "continuity", "fidelity"]) {
      const observation = String(form.get(key) || "").replace(/[ \t\r\n]+/g, " ").trim();
      if (observation.length < 10 || observation.length > 1000)
        throw {code:"HUMAN_APPROVAL_REQUEST_INVALID",field:"observation"};
      criteria[key] = {startSeconds:0,endSeconds:duration,observation};
    }
    return criteria;
  }
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
        criteria = buildReviewCriteria(review, form);
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
  $("script-revision-form").addEventListener("submit",async(event)=>{
    event.preventDefault();const button=event.target.querySelector("button");button.disabled=true;const form=new FormData(event.target);
    try{await post(base()+"/script-revision",{scriptId:form.get("scriptId"),previousScriptContentHash:event.target.dataset.previousHash,reason:form.get("reason")});event.target.reset();await post(base()+"/retry",{});await advance(selected);}
    catch(error){fail(error);}
    finally{button.disabled=false;}
  });
  $("tts-accept-risk").addEventListener("change", () => renderTts(lastTts));
  $("tts-prepare").addEventListener("click", async () => {
    const id = selected; $("tts-prepare").disabled = true;
    try { const data = await post(base() + "/tts/prepare", {}); if (selected === id) renderTts(data); }
    catch (error) { fail(error); }
    finally { if (selected === id) $("tts-prepare").disabled = false; }
  });
  $("tts-generate").addEventListener("click", async () => {
    const id = selected, prepared = lastTts;
    if (!prepared?.requestHash || $("tts-generate").disabled) return;
    $("tts-generate").disabled = true;
    try {
      const path = "/operations/executions/" + encodeURIComponent(id);
      if (!prepared.audioConfirmed) {
        if (!$("tts-accept-risk").checked) return;
        await post(path + "/tts/authorize", {requestHash:prepared.requestHash,acceptsUnboundedCost:true,expiresAt:new Date(Date.now()+900000).toISOString()});
      }
      const data = await post(path + "/tts/execute", {requestHash:prepared.requestHash});
      if (selected === id) render(data);
    } catch (error) { fail(error); }
    finally { if (selected === id) renderTts(lastTts); }
  });
  $("audio-mode").addEventListener("change",async(event)=>{
    event.target.disabled=true;
    try{await post(base()+"/audio-mode",{mode:event.target.value});await advance(selected);}
    catch(error){fail(error);}
    finally{event.target.disabled=false;}
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
  $("instagram-package-form").addEventListener("submit",async(event)=>{
    event.preventDefault();try{const form=new FormData(event.target),pkg=await post(base()+"/instagram/package",{caption:form.get("caption")});
      instagramPackageHash=pkg.contentHash;
      $("instagram-package-preview").textContent=["Conta: "+pkg.account,"MP4: "+pkg.identity.videoRenderContentHash,pkg.caption,pkg.cta,pkg.disclosure,pkg.link,"Pacote: "+pkg.contentHash].join("\n\n");
      $("instagram-schedule-form").hidden=false;
    }catch(error){fail(error);}
  });
  $("instagram-schedule-form").addEventListener("submit",async(event)=>{
    event.preventDefault();try{const form=new FormData(event.target);if(!instagramPackageHash||!form.get("confirm"))return;
      await post(base()+"/instagram/schedule",{packageHash:instagramPackageHash,scheduledAt:new Date(form.get("scheduledAt")).toISOString(),confirm:true});await instagramStatus();
    }catch(error){fail(error);}
  });
  $("instagram-refresh").addEventListener("click",async()=>{try{await post(base()+"/instagram/refresh",{});await instagramStatus();}catch(error){fail(error);}});
  $("instagram-cancel").addEventListener("click",async()=>{try{await post(base()+"/instagram/cancel",{});await instagramStatus();}catch(error){fail(error);}});
  api("/operations/session")
    .then(start)
    .catch((error) => {
      if (error.status !== 401) fail(error);
    });
})();
`;
