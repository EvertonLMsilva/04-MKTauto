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
export class SqliteOperationsRepository extends SqliteProjectRepository {
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
  startRun({
    execution,
    projectSnapshot,
  }: {
    execution: Execution;
    projectSnapshot: ProjectSnapshot;
  }) {
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
    const identity = createHash('sha256')
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
    return this.transaction(() => {
      const prior = this.db
        .prepare(
          'SELECT identity_hash FROM pipeline_runs WHERE pipeline_run_id=?',
        )
        .get(run.pipelineRunId);
      if (prior) {
        if (prior.identity_hash !== identity)
          throw new OperationsError('PIPELINE_RUN_ID_REUSED', 'pipelineRunId');
        return this.getRun(run.pipelineRunId)!;
      }
      this.db
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
      this.db
        .prepare(
          "INSERT INTO pipeline_run_transitions(pipeline_run_id,previous_state,next_state,changed_at,error_json) VALUES(?,NULL,'RUNNING',?,NULL)",
        )
        .run(run.pipelineRunId, run.startedAt);
      return this.getRun(run.pipelineRunId)!;
    });
  }
  getRun(id: string): PipelineRun | null {
    requireId(id);
    const row = this.db
      .prepare('SELECT * FROM pipeline_runs WHERE pipeline_run_id=?')
      .get(id);
    if (!row) return null;
    const transitions = this.db
      .prepare(
        'SELECT previous_state,next_state,changed_at,error_json FROM pipeline_run_transitions WHERE pipeline_run_id=? ORDER BY id',
      )
      .all(id);
    const recoveries = this.db
      .prepare(
        'SELECT previous_state,next_state,changed_at,NULL AS error_json FROM pipeline_run_recoveries WHERE pipeline_run_id=? ORDER BY id',
      )
      .all(id);
    try {
      return validatePipelineRun({
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
      });
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
  }
  listRunsByProjectVersion(projectId: string, projectVersion: number) {
    if (
      typeof projectId !== 'string' ||
      projectId.length > 80 ||
      !/^[a-z0-9][a-z0-9_-]{2,}$/.test(projectId)
    )
      throw new OperationsError('INVALID_PROJECT_ID', 'projectId');
    if (!Number.isSafeInteger(projectVersion) || projectVersion < 1)
      throw new OperationsError('INVALID_PROJECT_VERSION', 'projectVersion');
    return this.db
      .prepare(
        'SELECT pipeline_run_id FROM pipeline_runs WHERE project_id=? AND project_version=? ORDER BY started_at DESC,pipeline_run_id',
      )
      .all(projectId, projectVersion)
      .map((r) => this.getRun(String(r.pipeline_run_id))!);
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
    requireId(pipelineRunId);
    if (!['SUCCEEDED', 'FAILED'].includes(nextState))
      throw new OperationsError('INVALID_PIPELINE_RUN_TRANSITION', 'state');
    const at = requireTime(completedAt, 'completedAt');
    const json =
      nextState === 'FAILED'
        ? JSON.stringify(sanitizePipelineRunError(error))
        : null;
    return this.transaction(() => {
      const prior = this.db
        .prepare(
          'SELECT state,started_at,completed_at,error_json FROM pipeline_runs WHERE pipeline_run_id=?',
        )
        .get(pipelineRunId);
      if (!prior)
        throw new OperationsError('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
      if (Date.parse(at) < Date.parse(String(prior.started_at)))
        throw new OperationsError('INVALID_COMPLETED_AT', 'completedAt');
      if (
        prior.state === nextState &&
        prior.completed_at === at &&
        prior.error_json === json
      )
        return this.getRun(pipelineRunId)!;
      if (prior.state !== 'RUNNING')
        throw new OperationsError('INVALID_PIPELINE_RUN_TRANSITION', 'state');
      this.db
        .prepare(
          "UPDATE pipeline_runs SET state=?,completed_at=?,error_json=? WHERE pipeline_run_id=? AND state='RUNNING'",
        )
        .run(nextState, at, json, pipelineRunId);
      this.db
        .prepare(
          "INSERT INTO pipeline_run_transitions(pipeline_run_id,previous_state,next_state,changed_at,error_json) VALUES(?,'RUNNING',?,?,?)",
        )
        .run(pipelineRunId, nextState, at, json);
      return this.getRun(pipelineRunId)!;
    });
  }
  resumeRun({
    pipelineRunId,
    resumedAt,
  }: {
    pipelineRunId: string;
    resumedAt: string;
  }) {
    requireId(pipelineRunId);
    const at = requireTime(resumedAt, 'resumedAt');
    return this.transaction(() => {
      const prior = this.db
        .prepare(
          'SELECT state,completed_at FROM pipeline_runs WHERE pipeline_run_id=?',
        )
        .get(pipelineRunId);
      if (!prior)
        throw new OperationsError('PIPELINE_RUN_NOT_FOUND', 'pipelineRunId');
      if (prior.state === 'RUNNING' || prior.state === 'SUCCEEDED')
        return this.getRun(pipelineRunId)!;
      if (Date.parse(at) < Date.parse(String(prior.completed_at)))
        throw new OperationsError('INVALID_RESUMED_AT', 'resumedAt');
      this.db
        .prepare(
          "UPDATE pipeline_runs SET state='RUNNING',completed_at=NULL,error_json=NULL WHERE pipeline_run_id=? AND state='FAILED'",
        )
        .run(pipelineRunId);
      this.db
        .prepare(
          "INSERT INTO pipeline_run_recoveries(pipeline_run_id,previous_state,next_state,changed_at) VALUES(?,'FAILED','RUNNING',?)",
        )
        .run(pipelineRunId, at);
      return this.getRun(pipelineRunId)!;
    });
  }
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
