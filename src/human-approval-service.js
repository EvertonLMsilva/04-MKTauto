import {
  HUMAN_APPROVAL_DECISION_VERSION,
  HUMAN_APPROVAL_DECISIONS,
  humanApprovalDecisionContentHash,
  humanApprovalDecisionId,
  validateHumanApprovalDecision,
  validateHumanApprovalIdentity,
} from "./domain/human-approval-contracts.js";

const REQUEST_FIELDS = Object.freeze([
  "projectId", "projectVersion", "pipelineRunId", "videoRenderId",
  "videoRenderRevision", "videoRenderContentHash", "qualityControlReportId",
  "qualityControlReportContentHash", "decision", "actor", "justification",
]);

export class HumanApprovalError extends Error {
  constructor(code, field, message, options) { super(`${code}: ${message}`, options); this.name = "HumanApprovalError"; this.code = code; this.field = field; this.publicMessage = message; }
}

export class HumanApprovalService {
  constructor({ repository, now = () => new Date().toISOString() }) {
    requireMethods(repository, ["getVideoRender", "getQualityControlReport", "getHumanApprovalDecision", "registerHumanApprovalDecision", "findApprovedHumanApprovalDecision"], "repository");
    this.repository = repository; this.now = now;
  }

  decide(value) {
    const request = validateRequest(value); const id = humanApprovalDecisionId(request);
    const prior = this.repository.getHumanApprovalDecision(id);
    if (prior) {
      if (sameRequest(prior, request)) return prior;
      throw failure("HUMAN_APPROVAL_DECISION_CONFLICT", "decision", "já existe decisão divergente para este render e QC");
    }
    const render = this.repository.getVideoRender(request.videoRenderId);
    if (!render || render.videoRenderId !== request.videoRenderId
      || render.revision !== request.videoRenderRevision
      || render.contentHash !== request.videoRenderContentHash
      || render.pipelineRunId !== request.pipelineRunId
      || render.projectId !== request.projectId || render.projectVersion !== request.projectVersion) {
      throw failure("HUMAN_APPROVAL_VIDEO_BINDING_MISMATCH", "videoRenderId", "decisão não corresponde ao render final exato");
    }
    const qc = this.repository.getQualityControlReport(request.qualityControlReportId);
    if (!qc || qc.qualityControlReportId !== request.qualityControlReportId
      || qc.contentHash !== request.qualityControlReportContentHash
      || qc.videoRenderId !== request.videoRenderId
      || qc.videoRenderContentHash !== request.videoRenderContentHash
      || qc.pipelineRunId !== request.pipelineRunId
      || qc.projectId !== request.projectId || qc.projectVersion !== request.projectVersion) {
      throw failure("HUMAN_APPROVAL_QC_BINDING_MISMATCH", "qualityControlReportId", "decisão não corresponde ao QC exato");
    }
    if (request.decision === "APPROVED" && (qc.result === "FAIL" || qc.approvalBlocked === true)) {
      throw failure("HUMAN_APPROVAL_QC_FAILED", "decision", "QC com FAIL bloqueia aprovação");
    }
    const decision = {
      schemaVersion: HUMAN_APPROVAL_DECISION_VERSION, humanApprovalDecisionId: id,
      ...request, decidedAt: this.now(), contentHash: "",
    };
    decision.contentHash = humanApprovalDecisionContentHash(decision);
    return this.repository.registerHumanApprovalDecision(validateHumanApprovalDecision(decision));
  }

  findApproved(value) {
    const identity = validateHumanApprovalIdentity(value);
    return this.repository.findApprovedHumanApprovalDecision(identity);
  }
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("HUMAN_APPROVAL_REQUEST_INVALID", "request", "requisição de decisão inválida");
  for (const key of Object.keys(value)) if (!REQUEST_FIELDS.includes(key)) throw failure("HUMAN_APPROVAL_REQUEST_INVALID", key, "campo não permitido");
  for (const key of REQUEST_FIELDS) if (!(key in value)) throw failure("HUMAN_APPROVAL_REQUEST_INVALID", key, "campo obrigatório");
  let identity; try { identity = validateHumanApprovalIdentity(value); } catch (caught) { throw failure("HUMAN_APPROVAL_REQUEST_INVALID", caught.path ?? "request", "identidade inválida", { cause: caught }); }
  if (!HUMAN_APPROVAL_DECISIONS.includes(value.decision)) throw failure("HUMAN_APPROVAL_REQUEST_INVALID", "decision", "decisão inválida");
  publicText(value.actor, "actor", 100);
  if (value.justification !== null) publicText(value.justification, "justification", 1000);
  if (value.decision === "REJECTED" && value.justification === null) throw failure("HUMAN_APPROVAL_JUSTIFICATION_REQUIRED", "justification", "informe a justificativa da rejeição");
  return Object.freeze({ ...identity, decision: value.decision, actor: value.actor, justification: value.justification });
}
function sameRequest(prior, request) { return REQUEST_FIELDS.every((field) => prior[field] === request[field]); }
function publicText(value, field, max) { if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || /(?:bearer\s+\S+|sk-[a-z0-9_-]{3,}|[?&](?:token|signature|credential|key)=|(?:^|[\\/])users[\\/]|[a-z]:[\\/])/i.test(value)) throw failure("HUMAN_APPROVAL_REQUEST_INVALID", field, "texto público inválido"); }
function requireMethods(value, methods, name) { if (!value || methods.some((method) => typeof value[method] !== "function")) throw new TypeError(`${name} obrigatório`); }
function failure(code, field, message, options) { return new HumanApprovalError(code, field, message, options); }
