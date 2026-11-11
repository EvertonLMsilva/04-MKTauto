import type { SQLOutputValue } from 'node:sqlite';
import {
  runCampaignIo,
  type SqliteOperationsRepository,
} from './sqlite-operations.repository.js';
import { immutable, OperationsError } from '../domain/operations-contracts.js';
import {
  sanitizeStageFailure,
  stageExecutionIdentityHash,
  validateStageExecutionRequest,
} from '../domain/stage-contracts.js';
import type { StageAttempt } from '../domain/stage-contracts.js';
import type { StageRepository } from '../application/ports/operations.port.js';
export class StageRecoveryRepository implements StageRepository {
  constructor(
    private readonly session: Pick<
      SqliteOperationsRepository,
      'sql' | 'transaction'
    >,
  ) {}
  private get db() {
    return this.session.sql;
  }
  findSucceeded(value: unknown): StageAttempt | null {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const request = validateStageExecutionRequest(value);
        const row = yield this.db
          .prepare(
            "SELECT * FROM pipeline_stage_attempts WHERE pipeline_run_id=? AND stage=? AND identity_hash=? AND state='SUCCEEDED' ORDER BY attempt DESC LIMIT 1",
          )
          .get(
            request.pipelineRunId,
            request.stage,
            stageExecutionIdentityHash(request),
          );
        return row ? fromRow(row) : null;
      }.call(this),
    );
  }
  getLatestAttempt(id: string, stage: string): StageAttempt | null {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const row = yield this.db
          .prepare(
            'SELECT * FROM pipeline_stage_attempts WHERE pipeline_run_id=? AND stage=? ORDER BY attempt DESC LIMIT 1',
          )
          .get(id, stage);
        return row ? fromRow(row) : null;
      }.call(this),
    );
  }
  listAttempts(id: string): StageAttempt[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return (yield this.db
          .prepare(
            'SELECT * FROM pipeline_stage_attempts WHERE pipeline_run_id=? ORDER BY stage,attempt',
          )
          .all(id)).map(fromRow);
      }.call(this),
    );
  }
  startAttempt(
    value: unknown,
    {
      trigger,
      startedAt,
    }: {
      trigger: string;
      startedAt: string;
    },
  ): StageAttempt {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const r = validateStageExecutionRequest(value);
        const identity = stageExecutionIdentityHash(r);
        return yield this.session.transaction(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              if (
                !(yield this.db
                  .prepare(
                    'SELECT 1 FROM pipeline_runs WHERE pipeline_run_id=?',
                  )
                  .get(r.pipelineRunId))
              )
                throw new OperationsError(
                  'PIPELINE_RUN_NOT_FOUND',
                  'pipelineRunId',
                );
              if (
                yield this.db
                  .prepare(
                    "SELECT 1 FROM pipeline_stage_attempts WHERE pipeline_run_id=? AND stage=? AND state='RUNNING'",
                  )
                  .get(r.pipelineRunId, r.stage)
              )
                throw new OperationsError('STAGE_ALREADY_RUNNING', 'stage');
              const attempt = Number(
                (yield this.db
                  .prepare(
                    'SELECT COALESCE(MAX(attempt),0)+1 AS value FROM pipeline_stage_attempts WHERE pipeline_run_id=? AND stage=?',
                  )
                  .get(r.pipelineRunId, r.stage))!.value,
              );
              const info = yield this.db
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
              return yield this.attempt(info.lastInsertRowid);
            }.call(this),
          ),
        );
      }.call(this),
    );
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
  ): StageAttempt {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.session.transaction(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              yield this.terminal(id);
              yield this.db
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
              return yield this.attempt(id);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  fail(
    id: number,
    {
      completedAt,
      error,
    }: {
      completedAt: string;
      error: unknown;
    },
  ): StageAttempt {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const e = sanitizeStageFailure(error);
        return yield this.session.transaction(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              yield this.terminal(id);
              yield this.db
                .prepare(
                  "UPDATE pipeline_stage_attempts SET state='FAILED',completed_at=?,failure_code=?,failure_field=?,retry_allowed=? WHERE id=? AND state='RUNNING'",
                )
                .run(completedAt, e.code, e.field, e.retryAllowed ? 1 : 0, id);
              return yield this.attempt(id);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  private terminal(id: number) {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const row = yield this.db
          .prepare('SELECT state FROM pipeline_stage_attempts WHERE id=?')
          .get(id);
        if (!row)
          throw new OperationsError('STAGE_ATTEMPT_NOT_FOUND', 'attempt');
        if (row.state !== 'RUNNING')
          throw new OperationsError('STAGE_ATTEMPT_TERMINAL', 'attempt');
      }.call(this),
    );
  }
  private attempt(id: number | bigint): StageAttempt {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return fromRow(
          (yield this.db
            .prepare('SELECT * FROM pipeline_stage_attempts WHERE id=?')
            .get(id))!,
        );
      }.call(this),
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
