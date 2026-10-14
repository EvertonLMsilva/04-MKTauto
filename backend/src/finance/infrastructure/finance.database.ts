import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { FinancialDatabase } from '../application/financial-readers.port.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import {
  validateProjectSnapshot,
  createProjectSnapshot,
} from '../../project/domain/project-contracts.js';
import { validatePipelineRun } from '../../content-operations/domain/operations-contracts.js';

import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
class HistoricalReadError extends Error {
  constructor(
    public readonly code: string,
    public readonly field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
class PipelineRunRepositoryError extends HistoricalReadError {
  constructor(
    code: string,
    field: string,
    message = 'identificador inválido',
    options?: ErrorOptions,
  ) {
    super(code, field, code + ': ' + message, options);
    this.name = 'PipelineRunRepositoryError';
  }
}
class ArtifactLineageRepositoryError extends HistoricalReadError {
  constructor(
    code: string,
    field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, field, code + ': ' + message, options);
    this.name = 'ArtifactLineageRepositoryError';
  }
}
export class FinanceDatabase {
  readonly db: FinancialDatabase;
  constructor(path: string, { readOnly = false }: { readOnly?: boolean } = {}) {
    if (!isAbsolute(path))
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    const preflight = new DatabaseSync(path, { readOnly: true });
    try {
      if (preflight.prepare('PRAGMA user_version').get()?.user_version !== 39)
        throw new Error('FINANCE_SCHEMA_VERSION_UNSUPPORTED');
    } finally {
      preflight.close();
    }
    this.db = new DatabaseSync(path, { readOnly });
    try {
      this.db.exec('PRAGMA busy_timeout=5000;');
      this.db.exec(
        readOnly ? 'PRAGMA query_only=ON;' : 'PRAGMA foreign_keys=ON;',
      );
    } catch (e: any) {
      this.db.close();
      throw e;
    }
  }
  close(): any {
    this.db.close();
  }
  get(projectId: string): any {
    const row = this.db
      .prepare(
        'SELECT snapshot_json FROM project_snapshots WHERE project_id=? ORDER BY version DESC LIMIT 1',
      )
      .get(projectId);
    if (!row) return null;
    const value = JSON.parse(row.snapshot_json);
    return value?.project
      ? validateProjectSnapshot(value)
      : createProjectSnapshot(value);
  }
  getRun(pipelineRunId: any): any {
    requireIdentifier(pipelineRunId);
    const row = this.db
      .prepare('SELECT * FROM pipeline_runs WHERE pipeline_run_id = ?')
      .get(pipelineRunId);
    if (!row) return null;
    const transitions = this.db
      .prepare(
        `SELECT previous_state, next_state, changed_at, error_json
      FROM pipeline_run_transitions WHERE pipeline_run_id = ? ORDER BY id`,
      )
      .all(pipelineRunId);
    const recoveries = this.db
      .prepare(
        `SELECT previous_state, next_state, changed_at, NULL AS error_json
      FROM pipeline_run_recoveries WHERE pipeline_run_id = ? ORDER BY id`,
      )
      .all(pipelineRunId);
    try {
      return validatePipelineRun({
        schemaVersion: row.schema_version,
        pipelineRunId: row.pipeline_run_id,
        projectId: row.project_id,
        projectVersion: row.project_version,
        projectSnapshot: JSON.parse(row.project_snapshot_json),
        state: row.state,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: parseNullableJson(row.error_json),
        transitions: [...transitions, ...recoveries]
          .sort((left: any, right: any) =>
            left.changed_at.localeCompare(right.changed_at),
          )
          .map((transition: any) => ({
            previousState: transition.previous_state,
            nextState: transition.next_state,
            changedAt: transition.changed_at,
            error: parseNullableJson(transition.error_json),
          })),
      });
    } catch (caught: any) {
      if (caught instanceof PipelineRunRepositoryError) throw caught;
      if (
        caught instanceof ContractValidationError ||
        caught instanceof SyntaxError
      ) {
        throw runFailure(
          'INVALID_PERSISTED_PIPELINE_RUN',
          'pipelineRunId',
          'execução persistida inválida',
          { cause: caught },
        );
      }
      throw caught;
    }
  }
  getArtifact(artifactId: any): any {
    requireIdentifier(artifactId, 'artifactId');
    const row = this.db
      .prepare('SELECT * FROM artifact_lineage WHERE artifact_id = ?')
      .get(artifactId);
    if (!row) return null;
    const inputs = this.db
      .prepare(
        `SELECT position, kind, input_id, content_hash
      FROM artifact_lineage_inputs WHERE artifact_id = ? ORDER BY position`,
      )
      .all(artifactId);
    try {
      const artifact = validateArtifactLineage({
        schemaVersion: row.schema_version,
        artifactId: row.artifact_id,
        artifactType: row.artifact_type,
        artifactVersion: row.artifact_version,
        pipelineRunId: row.pipeline_run_id,
        projectId: row.project_id,
        projectVersion: row.project_version,
        contentIdentity: row.content_identity,
        hashAlgorithm: row.hash_algorithm,
        contentHash: row.content_hash,
        inputs: inputs.map((input: any) => ({
          position: input.position,
          kind: input.kind,
          inputId: input.input_id,
          contentHash: input.content_hash,
        })),
        generationMetadata: parseNullableJson(row.generation_metadata_json),
        createdAt: row.created_at,
      });
      if (stableHash(artifact) !== row.identity_hash) {
        throw artifactFailure(
          'INVALID_PERSISTED_ARTIFACT',
          'artifactId',
          'integridade do artefato persistido inválida',
        );
      }
      return artifact;
    } catch (caught: any) {
      if (caught instanceof ArtifactLineageRepositoryError) throw caught;
      if (
        caught instanceof ContractValidationError ||
        caught instanceof SyntaxError
      ) {
        throw artifactFailure(
          'INVALID_PERSISTED_ARTIFACT',
          'artifactId',
          'artefato persistido inválido',
          { cause: caught },
        );
      }
      throw caught;
    }
  }
}
function requireIdentifier(value: unknown, field?: string): void {
  if (field === undefined) {
    if (
      typeof value !== 'string' ||
      value.length > 80 ||
      !/^[a-z0-9][a-z0-9_-]{2,}$/.test(value)
    )
      throw new PipelineRunRepositoryError(
        'INVALID_PIPELINE_RUN_ID',
        'pipelineRunId',
      );
  } else if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw new ArtifactLineageRepositoryError(
      'INVALID_IDENTIFIER',
      field,
      'identificador inválido',
    );
}
function parseNullableJson(value: any): any {
  return value === null ? null : JSON.parse(value);
}
function stableHash(value: any): any {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function runFailure(
  code: string,
  field: string,
  _message: string,
  options?: ErrorOptions,
): any {
  return new PipelineRunRepositoryError(code, field, _message, options);
}
function artifactFailure(
  code: string,
  field: string,
  message: string,
  options?: ErrorOptions,
): any {
  return new ArtifactLineageRepositoryError(code, field, message, options);
}
