import { createHash } from 'node:crypto';
import type { SQLOutputValue } from 'node:sqlite';
import { SqliteProjectRepository } from '../../project/infrastructure/sqlite-project.repository.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import {
  OperationsError,
  validatePipelineRun,
  sanitizePipelineRunError,
  timestamp,
  PIPELINE_RUN_CONTRACT_VERSION,
} from '../domain/operations-contracts.js';
import type { Execution, PipelineRun } from '../domain/operations-contracts.js';
import type { ProjectSnapshot } from '../../project/application/ports/project-snapshot-reader.port.js';
// Uses schema 39 as-is; opening a session never provisions or migrates storage.
export interface OperationsSql {
  prepare(sql: string): {
    get(...values: any[]): any;
    all(...values: any[]): any;
    run(...values: any[]): any;
  };
}
export class OperationsRepositoryCore {
  constructor(
    readonly sql: OperationsSql,
    readonly transaction: <T>(work: () => T) => T,
  ) {}
  startRun({
    execution,
    projectSnapshot,
  }: {
    execution: Execution;
    projectSnapshot: ProjectSnapshot;
  }) {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const run = validatePipelineRun({
          schemaVersion: PIPELINE_RUN_CONTRACT_VERSION,
          ...execution,
          projectSnapshot,
          state: 'RUNNING',
          completedAt: null,
          error: null,
          transitions: [
            {
              previousState: null,
              nextState: 'RUNNING',
              changedAt: execution.startedAt,
              error: null,
            },
          ],
        });
        const identity = pipelineIdentity(run);
        return yield this.transaction(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const prior = yield this.sql
                .prepare(
                  'SELECT identity_hash FROM pipeline_runs WHERE pipeline_run_id=?',
                )
                .get(run.pipelineRunId);
              if (prior) {
                const stored = (yield this.getRun(run.pipelineRunId))!;
                const canonical = validatePipelineRun(stored);
                if (pipelineIdentity(canonical) !== identity)
                  throw new OperationsError(
                    'PIPELINE_RUN_ID_REUSED',
                    'pipelineRunId',
                  );
                return stored;
              }
              yield this.sql
                .prepare(
                  "INSERT INTO pipeline_runs (pipeline_run_id,schema_version,identity_hash,project_id,project_version,project_snapshot_json,state,started_at,completed_at,error_json) VALUES(?,?,?,?,?,?,'RUNNING',?,NULL,NULL)",
                )
                .run(
                  run.pipelineRunId,
                  run.schemaVersion,
                  identity,
                  run.projectId,
                  run.projectVersion,
                  JSON.stringify(run.projectSnapshot),
                  run.startedAt,
                );
              yield this.sql
                .prepare(
                  "INSERT INTO pipeline_run_transitions(pipeline_run_id,previous_state,next_state,changed_at,error_json) VALUES(?,NULL,'RUNNING',?,NULL)",
                )
                .run(run.pipelineRunId, run.startedAt);
              return (yield this.getRun(run.pipelineRunId))!;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  getRun(id: string): PipelineRun | null {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        requireId(id);
        const row = yield this.sql
          .prepare('SELECT * FROM pipeline_runs WHERE pipeline_run_id=?')
          .get(id);
        if (!row) return null;
        const transitions = yield this.sql
          .prepare(
            'SELECT previous_state,next_state,changed_at,error_json FROM pipeline_run_transitions WHERE pipeline_run_id=? ORDER BY id',
          )
          .all(id);
        const recoveries = yield this.sql
          .prepare(
            'SELECT previous_state,next_state,changed_at,NULL AS error_json FROM pipeline_run_recoveries WHERE pipeline_run_id=? ORDER BY id',
          )
          .all(id);
        try {
          const run = validatePipelineRun(
            {
              schemaVersion: row.schema_version,
              pipelineRunId: row.pipeline_run_id,
              projectId: row.project_id,
              projectVersion: row.project_version,
              projectSnapshot: JSON.parse(String(row.project_snapshot_json)),
              state: row.state,
              startedAt: row.started_at,
              completedAt: row.completed_at,
              error: parse(row.error_json),
              transitions: [...transitions, ...recoveries]
                .sort((a, b) =>
                  String(a.changed_at).localeCompare(String(b.changed_at)),
                )
                .map((t) => ({
                  previousState: t.previous_state,
                  nextState: t.next_state,
                  changedAt: t.changed_at,
                  error: parse(t.error_json),
                })),
            },
            true,
          );
          if (pipelineIdentity(run) !== row.identity_hash)
            throw new OperationsError(
              'INVALID_PERSISTED_PIPELINE_RUN',
              'identityHash',
            );
          return run;
        } catch (cause) {
          if (
            cause instanceof ContractValidationError ||
            cause instanceof SyntaxError
          )
            throw new OperationsError(
              'INVALID_PERSISTED_PIPELINE_RUN',
              'pipelineRunId',
              { cause },
            );
          throw cause;
        }
      }.call(this),
    );
  }
  listRunsByProjectVersion(projectId: string, projectVersion: number) {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        if (
          typeof projectId !== 'string' ||
          projectId.length > 80 ||
          !/^[a-z0-9][a-z0-9_-]{2,}$/.test(projectId)
        )
          throw new OperationsError('INVALID_PROJECT_ID', 'projectId');
        if (!Number.isSafeInteger(projectVersion) || projectVersion < 1)
          throw new OperationsError(
            'INVALID_PROJECT_VERSION',
            'projectVersion',
          );
        return yield iterateCampaignIo(
          yield this.sql
            .prepare(
              'SELECT pipeline_run_id FROM pipeline_runs WHERE project_id=? AND project_version=? ORDER BY started_at DESC,pipeline_run_id',
            )
            .all(projectId, projectVersion),
          function* (this: any, r: any): Generator<unknown, any, any> {
            return (yield this.getRun(String(r.pipeline_run_id)))!;
          }.bind(this),
          'map',
        );
      }.call(this),
    );
  }
  transitionRun({
    pipelineRunId,
    nextState,
    completedAt,
    error = null,
  }: {
    pipelineRunId: string;
    nextState: string;
    completedAt?: string;
    error?: unknown;
  }) {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        requireId(pipelineRunId);
        if (!['SUCCEEDED', 'FAILED'].includes(nextState))
          throw new OperationsError('INVALID_PIPELINE_RUN_TRANSITION', 'state');
        const at = requireTime(completedAt, 'completedAt');
        const json =
          nextState === 'FAILED'
            ? JSON.stringify(sanitizePipelineRunError(error))
            : null;
        return yield this.transaction(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const prior = yield this.sql
                .prepare(
                  'SELECT state,started_at,completed_at,error_json FROM pipeline_runs WHERE pipeline_run_id=?',
                )
                .get(pipelineRunId);
              if (!prior)
                throw new OperationsError(
                  'PIPELINE_RUN_NOT_FOUND',
                  'pipelineRunId',
                );
              if (Date.parse(at) < Date.parse(String(prior.started_at)))
                throw new OperationsError(
                  'INVALID_COMPLETED_AT',
                  'completedAt',
                );
              if (
                prior.state === nextState &&
                prior.completed_at === at &&
                prior.error_json === json
              )
                return (yield this.getRun(pipelineRunId))!;
              if (prior.state !== 'RUNNING')
                throw new OperationsError(
                  'INVALID_PIPELINE_RUN_TRANSITION',
                  'state',
                );
              yield this.sql
                .prepare(
                  "UPDATE pipeline_runs SET state=?,completed_at=?,error_json=? WHERE pipeline_run_id=? AND state='RUNNING'",
                )
                .run(nextState, at, json, pipelineRunId);
              yield this.sql
                .prepare(
                  "INSERT INTO pipeline_run_transitions(pipeline_run_id,previous_state,next_state,changed_at,error_json) VALUES(?,'RUNNING',?,?,?)",
                )
                .run(pipelineRunId, nextState, at, json);
              return (yield this.getRun(pipelineRunId))!;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  resumeRun({
    pipelineRunId,
    resumedAt,
  }: {
    pipelineRunId: string;
    resumedAt: string;
  }) {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        requireId(pipelineRunId);
        const at = requireTime(resumedAt, 'resumedAt');
        return yield this.transaction(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const prior = yield this.sql
                .prepare(
                  'SELECT state,completed_at FROM pipeline_runs WHERE pipeline_run_id=?',
                )
                .get(pipelineRunId);
              if (!prior)
                throw new OperationsError(
                  'PIPELINE_RUN_NOT_FOUND',
                  'pipelineRunId',
                );
              if (prior.state === 'RUNNING' || prior.state === 'SUCCEEDED')
                return (yield this.getRun(pipelineRunId))!;
              if (Date.parse(at) < Date.parse(String(prior.completed_at)))
                throw new OperationsError('INVALID_RESUMED_AT', 'resumedAt');
              yield this.sql
                .prepare(
                  "UPDATE pipeline_runs SET state='RUNNING',completed_at=NULL,error_json=NULL WHERE pipeline_run_id=? AND state='FAILED'",
                )
                .run(pipelineRunId);
              yield this.sql
                .prepare(
                  "INSERT INTO pipeline_run_recoveries(pipeline_run_id,previous_state,next_state,changed_at) VALUES(?,'FAILED','RUNNING',?)",
                )
                .run(pipelineRunId, at);
              return (yield this.getRun(pipelineRunId))!;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
}
export class SqliteOperationsRepository extends SqliteProjectRepository {
  private readonly core = new OperationsRepositoryCore(this.db, (work) =>
    this.transaction(work),
  );
  get sql(): OperationsSql {
    return this.db;
  }
  transaction<T>(operation: () => T): T {
    let began = false;
    try {
      this.db.exec('BEGIN IMMEDIATE');
      began = true;
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (began && this.db.isTransaction) this.db.exec('ROLLBACK');
      if (error instanceof Error) {
        for (const code of [
          'IMMUTABLE_PIPELINE_RUN_IDENTITY',
          'INVALID_PIPELINE_RUN_TRANSITION',
        ])
          if (error.message.includes(code))
            throw new OperationsError(
              code,
              code === 'INVALID_PIPELINE_RUN_TRANSITION'
                ? 'state'
                : 'pipelineRunId',
              { cause: error },
            );
        if (error.message.includes('FOREIGN KEY constraint failed'))
          throw new OperationsError(
            'PROJECT_SNAPSHOT_NOT_FOUND',
            'projectVersion',
            { cause: error },
          );
      }
      throw error;
    }
  }
  startRun(
    ...args: Parameters<OperationsRepositoryCore['startRun']>
  ): PipelineRun {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.core.startRun(...args);
      }.call(this),
    );
  }
  getRun(
    ...args: Parameters<OperationsRepositoryCore['getRun']>
  ): PipelineRun | null {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.core.getRun(...args);
      }.call(this),
    );
  }
  listRunsByProjectVersion(
    ...args: Parameters<OperationsRepositoryCore['listRunsByProjectVersion']>
  ): PipelineRun[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.core.listRunsByProjectVersion(...args);
      }.call(this),
    );
  }
  transitionRun(
    ...args: Parameters<OperationsRepositoryCore['transitionRun']>
  ): PipelineRun {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.core.transitionRun(...args);
      }.call(this),
    );
  }
  resumeRun(
    ...args: Parameters<OperationsRepositoryCore['resumeRun']>
  ): PipelineRun {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.core.resumeRun(...args);
      }.call(this),
    );
  }
}
function pipelineIdentity(run: PipelineRun): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        pipelineRunId: run.pipelineRunId,
        projectId: run.projectId,
        projectVersion: run.projectVersion,
        startedAt: run.startedAt,
        projectSnapshot: run.projectSnapshot,
      }),
    )
    .digest('hex');
}
function requireId(id: unknown) {
  if (
    typeof id !== 'string' ||
    id.length > 80 ||
    !/^[a-z0-9][a-z0-9_-]{2,}$/.test(id)
  )
    throw new OperationsError('INVALID_PIPELINE_RUN_ID', 'pipelineRunId');
}
function requireTime(value: unknown, field: string) {
  try {
    return timestamp(value, field);
  } catch (cause) {
    throw new OperationsError('INVALID_TIMESTAMP', field, { cause });
  }
}
function parse(value: SQLOutputValue | undefined): unknown {
  return value === null ? null : JSON.parse(value as string);
}
export type Io<A extends boolean, T> = A extends true ? Promise<T> : T;
/** Execute the shared Campaign algorithm synchronously for SQLite or await each PG I/O. */
export function runCampaignIo(steps: Generator<unknown, any, any>): any {
  function resume(method: 'next' | 'throw', input?: unknown): any {
    for (;;) {
      const step = method === 'next' ? steps.next(input) : steps.throw(input);
      if (step.done) return step.value;
      if (step.value instanceof Promise)
        return step.value.then(
          (value) => resume('next', value),
          (error) => resume('throw', error),
        );
      method = 'next';
      input = step.value;
    }
  }
  return resume('next');
}
export function iterateCampaignIo(
  items: any[],
  operation: (...args: any[]) => Generator<unknown, any, any>,
  mode: 'map' | 'forEach' | 'some',
): any {
  return runCampaignIo(
    (function* (): Generator<unknown, any, any> {
      const result = [];
      for (let index = 0; index < items.length; index++) {
        const value = yield runCampaignIo(operation(items[index], index));
        if (mode === 'some' && value) return true;
        result.push(value);
      }
      return mode === 'some' ? false : mode === 'forEach' ? undefined : result;
    })(),
  );
}
