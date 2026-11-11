import { ContractValidationError } from '../../project/domain/project.errors.js';
import {
  humanApprovalDecisionId,
  humanApprovalDecisionIdentityHash,
  validateHumanApprovalDecision,
  validateHumanApprovalIdentity,
} from '../domain/human-approval-contracts.js';
import { immutable } from '../../affiliate/domain/affiliate-contracts.js';
export class HumanApprovalRepositoryError extends Error {
  [key: string]: any;
  constructor(code: any, field: any, message: any, options?: any) {
    super(`${code}: ${message}`, options);
    this.name = 'HumanApprovalRepositoryError';
    this.code = code;
    this.field = field;
  }
}
export class HumanApprovalRepository {
  [key: string]: any;
  constructor(base: any, evidence: any) {
    this.db = base.db;
    this.evidence = evidence;
  }
  getVideoRender(id: any): any {
    return this.evidence.getVideoRender(id);
  }
  getQualityControlReport(id: any): any {
    return this.evidence.getQualityControlReport(id);
  }
  registerHumanApprovalDecision(value: any): any {
    let decision: any;
    try {
      decision = validateHumanApprovalDecision(value);
    } catch (caught: any) {
      throw mapError(caught);
    }
    const identityHash: any = humanApprovalDecisionIdentityHash(decision);
    if (
      this.getVideoRender(decision.videoRenderId)?.schemaVersion ===
      'video-render/2.0.0'
    ) {
      const render: any = this.getVideoRender(decision.videoRenderId),
        qc: any = this.getQualityControlReport(decision.qualityControlReportId);
      if (
        !qc ||
        render.contentHash !== decision.videoRenderContentHash ||
        render.revision !== decision.videoRenderRevision ||
        render.pipelineRunId !== decision.pipelineRunId ||
        render.projectId !== decision.projectId ||
        render.projectVersion !== decision.projectVersion ||
        qc.contentHash !== decision.qualityControlReportContentHash ||
        qc.videoRenderId !== render.videoRenderId ||
        qc.videoRenderContentHash !== render.contentHash ||
        (decision.decision === 'APPROVED' && qc.approvalBlocked)
      )
        throw failure(
          'HUMAN_APPROVAL_QC_FAILED',
          'decision',
          'aprovação V2 inválida',
        );
      return putP4(
        this,
        'human_approval',
        decision.humanApprovalDecisionId,
        decision,
        decision.pipelineRunId,
      );
    }
    return this.#transaction((): any => {
      const prior: any = this.db
        .prepare(
          'SELECT identity_hash FROM human_approval_decisions WHERE human_approval_decision_id = ?',
        )
        .get(decision.humanApprovalDecisionId);
      if (prior) {
        if (prior.identity_hash !== identityHash)
          throw failure(
            'HUMAN_APPROVAL_DECISION_CONFLICT',
            'humanApprovalDecisionId',
            'decisão lógica já registrada com conteúdo divergente',
          );
        return this.getHumanApprovalDecision(decision.humanApprovalDecisionId);
      }
      this.db
        .prepare(
          `INSERT INTO human_approval_decisions
        (human_approval_decision_id, schema_version, identity_hash, project_id,
         project_version, pipeline_run_id, video_render_id, video_render_revision,
         video_render_content_hash, quality_control_report_id,
         quality_control_report_content_hash, decision, actor, justification,
         decided_at, content_hash, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          decision.humanApprovalDecisionId,
          decision.schemaVersion,
          identityHash,
          decision.projectId,
          decision.projectVersion,
          decision.pipelineRunId,
          decision.videoRenderId,
          decision.videoRenderRevision,
          decision.videoRenderContentHash,
          decision.qualityControlReportId,
          decision.qualityControlReportContentHash,
          decision.decision,
          decision.actor,
          decision.justification,
          decision.decidedAt,
          decision.contentHash,
          JSON.stringify(decision),
        );
      return this.getHumanApprovalDecision(decision.humanApprovalDecisionId);
    });
  }
  getHumanApprovalDecision(decisionId: any): any {
    requireIdentifier(decisionId, 'humanApprovalDecisionId');
    const p4: any = getP4(this, 'human_approval', decisionId);
    if (p4) return validateHumanApprovalDecision(p4);
    const row: any = this.db
      .prepare(
        'SELECT * FROM human_approval_decisions WHERE human_approval_decision_id = ?',
      )
      .get(decisionId);
    return row ? hydrate(row) : null;
  }
  findHumanApprovalDecision(value: any): any {
    let identity: any;
    try {
      identity = validateHumanApprovalIdentity(value);
    } catch (caught: any) {
      throw mapError(caught);
    }
    return this.getHumanApprovalDecision(humanApprovalDecisionId(identity));
  }
  findApprovedHumanApprovalDecision(value: any): any {
    const found: any = this.findHumanApprovalDecision(value);
    return found?.decision === 'APPROVED' ? found : null;
  }
  listHumanApprovalDecisionsByPipelineRun(pipelineRunId: any): any {
    requireIdentifier(pipelineRunId, 'pipelineRunId');
    const legacy: any = this.db
      .prepare(
        `SELECT * FROM human_approval_decisions
      WHERE pipeline_run_id = ? ORDER BY decided_at, human_approval_decision_id`,
      )
      .all(pipelineRunId)
      .map(hydrate);
    return [
      ...legacy,
      ...this.db
        .prepare(
          "SELECT artifact_id FROM p4_artifacts WHERE kind='human_approval' AND pipeline_run_id=? ORDER BY artifact_id",
        )
        .all(pipelineRunId)
        .map((row: any): any => this.getHumanApprovalDecision(row.artifact_id)),
    ];
  }
  #transaction(operation: any): any {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const value: any = operation();
      this.db.exec('COMMIT');
      return value;
    } catch (caught: any) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw mapSqliteError(caught);
    }
  }
}
function hydrate(row: any): any {
  try {
    const value: any = validateHumanApprovalDecision(
      JSON.parse(row.payload_json),
    );
    const exact: any =
      row.schema_version === value.schemaVersion &&
      row.identity_hash === humanApprovalDecisionIdentityHash(value) &&
      row.project_id === value.projectId &&
      row.project_version === value.projectVersion &&
      row.pipeline_run_id === value.pipelineRunId &&
      row.video_render_id === value.videoRenderId &&
      row.video_render_revision === value.videoRenderRevision &&
      row.video_render_content_hash === value.videoRenderContentHash &&
      row.quality_control_report_id === value.qualityControlReportId &&
      row.quality_control_report_content_hash ===
        value.qualityControlReportContentHash &&
      row.decision === value.decision &&
      row.actor === value.actor &&
      row.justification === value.justification &&
      row.decided_at === value.decidedAt &&
      row.content_hash === value.contentHash;
    if (!exact) throw new Error('decisão persistida divergente');
    return value;
  } catch (caught: any) {
    throw failure(
      'INVALID_PERSISTED_HUMAN_APPROVAL_DECISION',
      'humanApprovalDecisionId',
      'decisão persistida inválida',
      { cause: caught },
    );
  }
}
function requireIdentifier(value: any, field: any): any {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw failure('INVALID_IDENTIFIER', field, 'identificador inválido');
}
function mapError(caught: any): any {
  if (caught instanceof HumanApprovalRepositoryError) return caught;
  if (caught instanceof ContractValidationError)
    return failure(caught.code, caught.path, 'decisão humana inválida', {
      cause: caught,
    });
  return caught;
}
function mapSqliteError(caught: any): any {
  if (caught instanceof HumanApprovalRepositoryError) return caught;
  const message: any = String(caught?.message ?? '');
  if (message.includes('HUMAN_APPROVAL_BINDING_MISMATCH'))
    return failure(
      'HUMAN_APPROVAL_BINDING_MISMATCH',
      'decision',
      'decisão não corresponde ao render e QC exatos',
      { cause: caught },
    );
  if (message.includes('UNIQUE constraint failed'))
    return failure(
      'HUMAN_APPROVAL_DECISION_CONFLICT',
      'humanApprovalDecisionId',
      'decisão concorrente divergente',
      { cause: caught },
    );
  return caught;
}
function failure(code: any, field: any, message: any, options?: any): any {
  return new HumanApprovalRepositoryError(code, field, message, options);
}
function getP4(repository: any, kind: any, id: any): any {
  const row: any = repository.db
    .prepare(
      'SELECT identity_hash,payload_json FROM p4_artifacts WHERE kind=? AND artifact_id=?',
    )
    .get(kind, id);
  if (!row) return null;
  const value: any = JSON.parse(row.payload_json);
  if (humanApprovalDecisionIdentityHash(value) !== row.identity_hash)
    throw Object.assign(new Error('P4_PERSISTED_INTEGRITY_INVALID'), {
      code: 'P4_PERSISTED_INTEGRITY_INVALID',
    });
  return immutable(value);
}
function putP4(
  repository: any,
  kind: any,
  id: any,
  value: any,
  runId: any = null,
): any {
  const prior: any = getP4(repository, kind, id);
  if (prior) {
    if (
      humanApprovalDecisionIdentityHash(prior) !==
      humanApprovalDecisionIdentityHash(value)
    )
      throw Object.assign(new Error('P4_IDENTITY_CONFLICT'), {
        code: 'P4_IDENTITY_CONFLICT',
      });
    return prior;
  }
  repository.db
    .prepare('INSERT INTO p4_artifacts VALUES (?,?,?,?,?)')
    .run(
      kind,
      id,
      humanApprovalDecisionIdentityHash(value),
      runId,
      JSON.stringify(value),
    );
  return getP4(repository, kind, id);
}
