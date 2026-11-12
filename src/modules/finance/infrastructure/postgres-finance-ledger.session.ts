import { AsyncLocalStorage } from 'node:async_hooks';
import { types, type PoolClient } from 'pg';
import {
  PostgresDatabase,
  PostgresError,
} from '../../../infrastructure/database/postgres/index.js';
import { OperationsRepositoryCore } from '../../content-operations/infrastructure/sqlite-operations.repository.js';
import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import { createHash } from 'node:crypto';
import { CostLedgerRepositoryError } from './cost-ledger.repository.js';

export const financeLedgerHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function financeLedgerFailure(
  code: string,
  field: string,
  message: string,
): CostLedgerRepositoryError {
  return new CostLedgerRepositoryError(code, field, message);
}
export function financeLedgerStorageFailure(error: unknown): unknown {
  if (error instanceof CostLedgerRepositoryError) return error;
  if (
    error instanceof PostgresError &&
    error.code === 'POSTGRES_PARTICIPATION_REQUIRED'
  )
    return financeLedgerFailure(
      'FINANCE_CROSS_DOMAIN_TRANSACTION_REQUIRED',
      'database',
      'Finance não participa da unidade de trabalho multidomínio',
    );
  const state =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  const mapped: Record<string, [string, string, string]> = {
    P6001: [
      'PIPELINE_RUN_NOT_FOUND',
      'pipelineRunId',
      'execução não encontrada',
    ],
    P6002: [
      'COST_EVENT_RUN_SCOPE_MISMATCH',
      'projectId',
      'custo diverge do escopo da execução',
    ],
    P6003: [
      'COST_EVENT_RUN_SCOPE_MISMATCH',
      'projectVersion',
      'custo diverge do escopo da execução',
    ],
    P6004: [
      'COST_EVENT_ARTIFACT_NOT_FOUND',
      'artifactId',
      'artefato não encontrado',
    ],
    P6005: [
      'COST_EVENT_ARTIFACT_SCOPE_MISMATCH',
      'artifactId',
      'artefato pertence a outro escopo',
    ],
    P6006: [
      'COST_EVENT_CONTENT_MISMATCH',
      'contentIdentity',
      'conteúdo diverge do artefato',
    ],
    P6008: [
      'IMMUTABLE_COST_EVENT',
      'costEventId',
      'evento de custo é imutável',
    ],
  };
  return typeof state === 'string' && mapped[state]
    ? financeLedgerFailure(...mapped[state])
    : financeLedgerFailure(
        'COST_EVENT_PERSISTENCE_FAILED',
        'costEvent',
        'não foi possível persistir o custo',
      );
}

/** A Finance-only transaction. No pool, provisioning, policy or paid-effect capability. */
export class PostgresFinanceLedgerSession {
  private readonly scope = new AsyncLocalStorage<{
    client: PoolClient;
    active: boolean;
  }>();
  private closed = false;
  constructor(
    private readonly database: PostgresDatabase,
    private readonly readOnly: boolean,
  ) {}
  close(): void {
    this.closed = true;
  }
  async transaction<T>(work: () => Promise<T>, write = false): Promise<T> {
    if (this.closed)
      throw financeLedgerFailure(
        'FINANCE_LEDGER_HANDLE_CLOSED',
        'storage',
        'sessão encerrada',
      );
    if (write && this.readOnly)
      throw financeLedgerFailure(
        'FINANCE_LEDGER_READ_ONLY',
        'storage',
        'sessão somente leitura',
      );
    const current = this.scope.getStore();
    if (current) {
      if (!current.active)
        throw financeLedgerFailure(
          'FINANCE_LEDGER_TRANSACTION_ENDED',
          'storage',
          'transação encerrada',
        );
      return await work();
    }
    try {
      return await this.database.transaction(async (client) => {
        if (write) {
          // Keep the canonical run stable across reconstruction queries, in domain lock order.
          for (const domain of [5, 6])
            await client.query(
              'SELECT pg_catalog.pg_advisory_xact_lock($1,$2)',
              [1296782401, domain],
            );
        } else
          await client.query(
            'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
          );
        const scope = { client, active: true };
        try {
          return await this.scope.run(scope, work);
        } finally {
          scope.active = false;
        }
      });
    } catch (error) {
      // Domain/contract failures keep their identity; only storage errors are sanitized.
      if (error instanceof PostgresError)
        throw financeLedgerStorageFailure(error);
      throw error;
    }
  }
  async query(text: string, values: unknown[] = []) {
    const scope = this.scope.getStore();
    if (this.closed || !scope?.active)
      throw financeLedgerFailure(
        'FINANCE_LEDGER_SESSION_INACTIVE',
        'storage',
        'sessão inativa',
      );
    try {
      const result = await scope.client.query({
        text,
        values,
        types: {
          getTypeParser: (oid: number, format?: string) =>
            oid === 114
              ? (text: string) => text
              : types.getTypeParser(oid, format as 'text'),
        },
      });
      // BIGINT metadata is bounded by the historical safe-integer contracts. Monetary NUMERIC is never converted.
      for (const row of result.rows)
        for (const field of result.fields)
          if (field.dataTypeID === 20 && row[field.name] !== null) {
            const integer = Number(row[field.name]);
            if (!Number.isSafeInteger(integer))
              throw financeLedgerFailure(
                'COST_EVENT_PERSISTENCE_FAILED',
                'storage',
                'inteiro fora do contrato',
              );
            row[field.name] = integer;
          }
      return result;
    } catch (error) {
      throw financeLedgerStorageFailure(error);
    }
  }
  async getRun(id: string) {
    // Reuse the complete canonical run reconstruction, validation and identity checks.
    const rows = async (sql: string, values: unknown[]) => {
      let position = 0;
      const text = sql
        .replace(
          /\b(pipeline_runs|pipeline_run_transitions|pipeline_run_recoveries)\b/g,
          'campaign.$1',
        )
        .replace(/\?/g, () => `$${++position}`);
      return (await this.query(text, values)).rows;
    };
    const core = new OperationsRepositoryCore(
      {
        prepare: (sql) => ({
          get: async (...values: unknown[]) => (await rows(sql, values))[0],
          all: (...values: unknown[]) => rows(sql, values),
          run: () => {
            throw new Error('FINANCE_REFERENCE_READ_ONLY');
          },
        }),
      },
      (work) => work(),
    );
    return core.getRun(id);
  }
  async verifyArtifact(id: string): Promise<void> {
    const row = (
      await this.query(
        'SELECT * FROM content.artifact_lineage WHERE artifact_id=$1',
        [id],
      )
    ).rows[0];
    if (!row)
      throw financeLedgerFailure(
        'COST_EVENT_ARTIFACT_NOT_FOUND',
        'artifactId',
        'artefato não encontrado',
      );
    const inputs = (
      await this.query(
        'SELECT position,kind,input_id,content_hash FROM content.artifact_lineage_inputs WHERE artifact_id=$1 ORDER BY position',
        [id],
      )
    ).rows;
    try {
      const value = validateArtifactLineage({
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
        inputs: inputs.map((input) => ({
          position: input.position,
          kind: input.kind,
          inputId: input.input_id,
          contentHash: input.content_hash,
        })),
        generationMetadata:
          row.generation_metadata_json === null
            ? null
            : JSON.parse(row.generation_metadata_json),
        createdAt: row.created_at,
      });
      if (financeLedgerHash(value) !== row.identity_hash)
        throw new Error('INVALID_HASH');
    } catch {
      throw financeLedgerFailure(
        'INVALID_PERSISTED_ARTIFACT',
        'artifactId',
        'artefato persistido inválido',
      );
    }
  }
}
