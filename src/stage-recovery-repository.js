import { PipelineRunRepository } from "./pipeline-run-repository.js";
import { sanitizeStageFailure, stageExecutionIdentityHash, validateStageExecutionRequest } from "./domain/stage-recovery-contracts.js";

export class StageRecoveryRepositoryError extends Error {
  constructor(code, field, message, options) { super(`${code}: ${message}`, options); this.name = "StageRecoveryRepositoryError"; this.code = code; this.field = field; }
}

export class StageRecoveryRepository extends PipelineRunRepository {
  findSucceeded(value) {
    const request = validateStageExecutionRequest(value); const identity = stageExecutionIdentityHash(request);
    const row = this.db.prepare(`SELECT * FROM pipeline_stage_attempts WHERE pipeline_run_id = ? AND stage = ? AND identity_hash = ? AND state = 'SUCCEEDED' ORDER BY attempt DESC LIMIT 1`).get(request.pipelineRunId, request.stage, identity);
    return row ? fromRow(row) : null;
  }

  getLatestAttempt(pipelineRunId, stage) {
    const row = this.db.prepare("SELECT * FROM pipeline_stage_attempts WHERE pipeline_run_id = ? AND stage = ? ORDER BY attempt DESC LIMIT 1").get(pipelineRunId, stage);
    return row ? fromRow(row) : null;
  }

  listAttempts(pipelineRunId) {
    return this.db.prepare("SELECT * FROM pipeline_stage_attempts WHERE pipeline_run_id = ? ORDER BY stage, attempt").all(pipelineRunId).map(fromRow);
  }

  startAttempt(value, { trigger, startedAt }) {
    const request = validateStageExecutionRequest(value); const identity = stageExecutionIdentityHash(request);
    return transaction(this.db, () => {
      if (!this.db.prepare("SELECT 1 FROM pipeline_runs WHERE pipeline_run_id = ?").get(request.pipelineRunId)) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
      const running = this.db.prepare("SELECT 1 FROM pipeline_stage_attempts WHERE pipeline_run_id = ? AND stage = ? AND state = 'RUNNING'").get(request.pipelineRunId, request.stage);
      if (running) throw failure("STAGE_ALREADY_RUNNING", "stage", "etapa já está em execução");
      const attempt = this.db.prepare("SELECT COALESCE(MAX(attempt), 0) + 1 AS value FROM pipeline_stage_attempts WHERE pipeline_run_id = ? AND stage = ?").get(request.pipelineRunId, request.stage).value;
      const info = this.db.prepare(`INSERT INTO pipeline_stage_attempts
        (pipeline_run_id, stage, attempt, trigger_kind, state, identity_hash, request_hash, inputs_json, policy_versions_json, provider_config_hash, started_at)
        VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?, ?, ?)`)
        .run(request.pipelineRunId, request.stage, attempt, trigger, identity, request.requestHash, JSON.stringify(request.inputs), JSON.stringify(request.policyVersions), request.providerConfigHash, startedAt);
      return fromRow(this.db.prepare("SELECT * FROM pipeline_stage_attempts WHERE id = ?").get(info.lastInsertRowid));
    });
  }

  succeed(id, { completedAt, artifactId, artifactContentHash, result }) {
    return transaction(this.db, () => {
      terminal(this.db, id, "SUCCEEDED");
      this.db.prepare(`UPDATE pipeline_stage_attempts SET state = 'SUCCEEDED', completed_at = ?, artifact_id = ?, artifact_content_hash = ?, result_json = ? WHERE id = ? AND state = 'RUNNING'`)
        .run(completedAt, artifactId, artifactContentHash, JSON.stringify(result), id);
      return fromRow(this.db.prepare("SELECT * FROM pipeline_stage_attempts WHERE id = ?").get(id));
    });
  }

  fail(id, { completedAt, error }) {
    const publicError = sanitizeStageFailure(error);
    return transaction(this.db, () => {
      terminal(this.db, id, "FAILED");
      this.db.prepare(`UPDATE pipeline_stage_attempts SET state = 'FAILED', completed_at = ?, failure_code = ?, failure_field = ?, retry_allowed = ? WHERE id = ? AND state = 'RUNNING'`)
        .run(completedAt, publicError.code, publicError.field, publicError.retryAllowed ? 1 : 0, id);
      return fromRow(this.db.prepare("SELECT * FROM pipeline_stage_attempts WHERE id = ?").get(id));
    });
  }
}

function terminal(db, id, state) { const row = db.prepare("SELECT state FROM pipeline_stage_attempts WHERE id = ?").get(id); if (!row) throw failure("STAGE_ATTEMPT_NOT_FOUND", "attempt", "tentativa não encontrada"); if (row.state !== "RUNNING") throw failure("STAGE_ATTEMPT_TERMINAL", "attempt", `tentativa já está ${row.state}, não ${state}`); }
function fromRow(row) { return Object.freeze({ id: Number(row.id), pipelineRunId: row.pipeline_run_id, stage: row.stage, attempt: row.attempt, trigger: row.trigger_kind, state: row.state, identityHash: row.identity_hash, requestHash: row.request_hash, inputs: JSON.parse(row.inputs_json), policyVersions: JSON.parse(row.policy_versions_json), providerConfigHash: row.provider_config_hash, startedAt: row.started_at, completedAt: row.completed_at, failure: row.failure_code ? Object.freeze({ code: row.failure_code, field: row.failure_field, retryAllowed: row.retry_allowed === 1 }) : null, artifactId: row.artifact_id, artifactContentHash: row.artifact_content_hash, result: row.result_json ? JSON.parse(row.result_json) : null }); }
function transaction(db, operation) { try { db.exec("BEGIN IMMEDIATE"); const result = operation(); db.exec("COMMIT"); return result; } catch (caught) { if (db.isTransaction) db.exec("ROLLBACK"); throw caught; } }
function failure(code, field, message, options) { return new StageRecoveryRepositoryError(code, field, message, options); }
