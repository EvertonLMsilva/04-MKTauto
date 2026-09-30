import { ContractValidationError } from "./domain/contracts.js";
import {
  humanApprovalDecisionId,
  humanApprovalDecisionIdentityHash,
  validateHumanApprovalDecision,
  validateHumanApprovalIdentity,
} from "./domain/human-approval-contracts.js";
import { QualityControlRepository } from "./quality-control-repository.js";

export class HumanApprovalRepositoryError extends Error {
  constructor(code, field, message, options) { super(`${code}: ${message}`, options); this.name = "HumanApprovalRepositoryError"; this.code = code; this.field = field; }
}

export class HumanApprovalRepository extends QualityControlRepository {
  registerHumanApprovalDecision(value) {
    let decision; try { decision = validateHumanApprovalDecision(value); } catch (caught) { throw mapError(caught); }
    const identityHash = humanApprovalDecisionIdentityHash(decision);
    return this.#transaction(() => {
      const prior = this.db.prepare("SELECT identity_hash FROM human_approval_decisions WHERE human_approval_decision_id = ?").get(decision.humanApprovalDecisionId);
      if (prior) {
        if (prior.identity_hash !== identityHash) throw failure("HUMAN_APPROVAL_DECISION_CONFLICT", "humanApprovalDecisionId", "decisão lógica já registrada com conteúdo divergente");
        return this.getHumanApprovalDecision(decision.humanApprovalDecisionId);
      }
      this.db.prepare(`INSERT INTO human_approval_decisions
        (human_approval_decision_id, schema_version, identity_hash, project_id,
         project_version, pipeline_run_id, video_render_id, video_render_revision,
         video_render_content_hash, quality_control_report_id,
         quality_control_report_content_hash, decision, actor, justification,
         decided_at, content_hash, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        decision.humanApprovalDecisionId, decision.schemaVersion, identityHash,
        decision.projectId, decision.projectVersion, decision.pipelineRunId,
        decision.videoRenderId, decision.videoRenderRevision, decision.videoRenderContentHash,
        decision.qualityControlReportId, decision.qualityControlReportContentHash,
        decision.decision, decision.actor, decision.justification, decision.decidedAt,
        decision.contentHash, JSON.stringify(decision),
      );
      return this.getHumanApprovalDecision(decision.humanApprovalDecisionId);
    });
  }

  getHumanApprovalDecision(decisionId) {
    requireIdentifier(decisionId, "humanApprovalDecisionId");
    const row = this.db.prepare("SELECT * FROM human_approval_decisions WHERE human_approval_decision_id = ?").get(decisionId);
    return row ? hydrate(row) : null;
  }

  findHumanApprovalDecision(value) {
    let identity; try { identity = validateHumanApprovalIdentity(value); } catch (caught) { throw mapError(caught); }
    return this.getHumanApprovalDecision(humanApprovalDecisionId(identity));
  }

  findApprovedHumanApprovalDecision(value) {
    const found = this.findHumanApprovalDecision(value);
    return found?.decision === "APPROVED" ? found : null;
  }

  listHumanApprovalDecisionsByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    return this.db.prepare(`SELECT * FROM human_approval_decisions
      WHERE pipeline_run_id = ? ORDER BY decided_at, human_approval_decision_id`).all(pipelineRunId).map(hydrate);
  }

  #transaction(operation) {
    try { this.db.exec("BEGIN IMMEDIATE"); const value = operation(); this.db.exec("COMMIT"); return value; }
    catch (caught) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw mapSqliteError(caught); }
  }
}

function hydrate(row) {
  try {
    const value = validateHumanApprovalDecision(JSON.parse(row.payload_json));
    const exact = row.schema_version === value.schemaVersion
      && row.identity_hash === humanApprovalDecisionIdentityHash(value)
      && row.project_id === value.projectId && row.project_version === value.projectVersion
      && row.pipeline_run_id === value.pipelineRunId && row.video_render_id === value.videoRenderId
      && row.video_render_revision === value.videoRenderRevision
      && row.video_render_content_hash === value.videoRenderContentHash
      && row.quality_control_report_id === value.qualityControlReportId
      && row.quality_control_report_content_hash === value.qualityControlReportContentHash
      && row.decision === value.decision && row.actor === value.actor
      && row.justification === value.justification && row.decided_at === value.decidedAt
      && row.content_hash === value.contentHash;
    if (!exact) throw new Error("decisão persistida divergente");
    return value;
  } catch (caught) { throw failure("INVALID_PERSISTED_HUMAN_APPROVAL_DECISION", "humanApprovalDecisionId", "decisão persistida inválida", { cause: caught }); }
}
function requireIdentifier(value, field) { if (typeof value !== "string" || value.length > 200 || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); }
function mapError(caught) { if (caught instanceof HumanApprovalRepositoryError) return caught; if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "decisão humana inválida", { cause: caught }); return caught; }
function mapSqliteError(caught) { if (caught instanceof HumanApprovalRepositoryError) return caught; const message = String(caught?.message ?? ""); if (message.includes("HUMAN_APPROVAL_BINDING_MISMATCH")) return failure("HUMAN_APPROVAL_BINDING_MISMATCH", "decision", "decisão não corresponde ao render e QC exatos", { cause: caught }); if (message.includes("UNIQUE constraint failed")) return failure("HUMAN_APPROVAL_DECISION_CONFLICT", "humanApprovalDecisionId", "decisão concorrente divergente", { cause: caught }); return caught; }
function failure(code, field, message, options) { return new HumanApprovalRepositoryError(code, field, message, options); }
