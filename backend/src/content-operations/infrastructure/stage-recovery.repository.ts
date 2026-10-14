import type { SQLOutputValue } from 'node:sqlite';
import type { SqliteOperationsRepository } from './sqlite-operations.repository.js';
import { immutable, OperationsError } from '../domain/operations-contracts.js';
import {
  sanitizeStageFailure,
  stageExecutionIdentityHash,
  validateStageExecutionRequest,
} from '../domain/stage-contracts.js';
import type { StageAttempt } from '../domain/stage-contracts.js';
import type { StageRepository } from '../application/ports/operations.port.js';

export class StageRecoveryRepository implements StageRepository {
  constructor(private readonly session: SqliteOperationsRepository) {}
  private get db() {
    return this.session.db;
  }
  findSucceeded(value: unknown) {
    const request = validateStageExecutionRequest(value);
    const row = this.db
      .prepare(
        "SELECT * FROM pipeline_stage_attempts WHERE pipeline_run_id=? AND stage=? AND identity_hash=? AND state='SUCCEEDED' ORDER BY attempt DESC LIMIT 1",
      )
      .get(
        request.pipelineRunId,
        request.stage,
        stageExecutionIdentityHash(request),
      );
    return row ? fromRow(row) : null;
  }
  getLatestAttempt(id: string, stage: string) {
    const row = this.db
      .prepare(
        'SELECT * FROM pipeline_stage_attempts WHERE pipeline_run_id=? AND stage=? ORDER BY attempt DESC LIMIT 1',
      )
      .get(id, stage);
    return row ? fromRow(row) : null;
  }
  listAttempts(id: string) {
    return this.db
      .prepare(
        'SELECT * FROM pipeline_stage_attempts WHERE pipeline_run_id=? ORDER BY stage,attempt',
      )
      .all(id)
      .map(fromRow);
  }
  startAttempt(
    value: unknown,
    { trigger, startedAt }: { trigger: string; startedAt: string },
  ) {
    const r = validateStageExecutionRequest(value);
    const identity = stageExecutionIdentityHash(r);
    return this.session.transaction(() => {
      if (
        !this.db
          .prepare('SELECT 1 FROM pipeline_runs WHERE pipeline_run_id=?')
          .get(r.pipelineRunId)
      )
        throw new OperationsError('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
      if (
        this.db
          .prepare(
            "SELECT 1 FROM pipeline_stage_attempts WHERE pipeline_run_id=? AND stage=? AND state='RUNNING'",
          )
          .get(r.pipelineRunId, r.stage)
      )
        throw new OperationsError('STAGE_ALREADY_RUNNING', 'stage');
      const attempt = Number(
        this.db
          .prepare(
            'SELECT COALESCE(MAX(attempt),0)+1 AS value FROM pipeline_stage_attempts WHERE pipeline_run_id=? AND stage=?',
          )
          .get(r.pipelineRunId, r.stage)!.value,
      );
      const info = this.db
        .prepare(
          "INSERT INTO pipeline_stage_attempts(pipeline_run_id,stage,attempt,trigger_kind,state,identity_hash,request_hash,inputs_json,policy_versions_json,provider_config_hash,started_at) VALUES(?,?,?,?,'RUNNING',?,?,?,?,?,?)",
        )
        .run(
          r.pipelineRunId,
          r.stage,
          attempt,
          trigger,
          identity,
          r.requestHash,
          JSON.stringify(r.inputs),
          JSON.stringify(r.policyVersions),
          r.providerConfigHash,
          startedAt,
        );
      return this.attempt(info.lastInsertRowid);
    });
  }
  succeed(
    id: number,
    {
      completedAt,
      artifactId,
      artifactContentHash,
      result,
    }: {
      completedAt: string;
      artifactId: string;
      artifactContentHash: string;
      result: unknown;
    },
  ) {
    return this.session.transaction(() => {
      this.terminal(id);
      this.db
        .prepare(
          "UPDATE pipeline_stage_attempts SET state='SUCCEEDED',completed_at=?,artifact_id=?,artifact_content_hash=?,result_json=? WHERE id=? AND state='RUNNING'",
        )
        .run(
          completedAt,
          artifactId,
          artifactContentHash,
          JSON.stringify(result),
          id,
        );
      return this.attempt(id);
    });
  }
  fail(
    id: number,
    { completedAt, error }: { completedAt: string; error: unknown },
  ) {
    const e = sanitizeStageFailure(error);
    return this.session.transaction(() => {
      this.terminal(id);
      this.db
        .prepare(
          "UPDATE pipeline_stage_attempts SET state='FAILED',completed_at=?,failure_code=?,failure_field=?,retry_allowed=? WHERE id=? AND state='RUNNING'",
        )
        .run(completedAt, e.code, e.field, e.retryAllowed ? 1 : 0, id);
      return this.attempt(id);
    });
  }
  private terminal(id: number) {
    const row = this.db
      .prepare('SELECT state FROM pipeline_stage_attempts WHERE id=?')
      .get(id);
    if (!row) throw new OperationsError('STAGE_ATTEMPT_NOT_FOUND', 'attempt');
    if (row.state !== 'RUNNING')
      throw new OperationsError('STAGE_ATTEMPT_TERMINAL', 'attempt');
  }
  private attempt(id: number | bigint) {
    return fromRow(
      this.db
        .prepare('SELECT * FROM pipeline_stage_attempts WHERE id=?')
        .get(id)!,
    );
  }
}
function fromRow(r: Record<string, SQLOutputValue>): StageAttempt {
  return immutable({
    id: Number(r.id),
    pipelineRunId: String(r.pipeline_run_id),
    stage: String(r.stage),
    attempt: Number(r.attempt),
    trigger: String(r.trigger_kind),
    state: r.state as StageAttempt['state'],
    identityHash: String(r.identity_hash),
    requestHash: String(r.request_hash),
    inputs: JSON.parse(String(r.inputs_json)),
    policyVersions: JSON.parse(String(r.policy_versions_json)),
    providerConfigHash: r.provider_config_hash as string | null,
    startedAt: String(r.started_at),
    completedAt: r.completed_at as string | null,
    failure: r.failure_code
      ? {
          code: String(r.failure_code),
          field: String(r.failure_field),
          retryAllowed: r.retry_allowed === 1,
        }
      : null,
    artifactId: r.artifact_id as string | null,
    artifactContentHash: r.artifact_content_hash as string | null,
    result: r.result_json ? JSON.parse(String(r.result_json)) : null,
  });
}
