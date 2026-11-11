import { AsyncLocalStorage } from 'node:async_hooks';
import { types, type PoolClient } from 'pg';
import {
  PostgresDatabase,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import { CAMPAIGN_POSTGRES_MIGRATIONS } from './postgres-campaign.migrations.js';
import type { OperationsSql } from './sqlite-operations.repository.js';
import { OperationsError } from '../domain/operations-contracts.js';
import { CampaignError } from '../domain/campaign.js';
const ownTables = [
  'pipeline_runs',
  'pipeline_run_transitions',
  'pipeline_run_recoveries',
  'pipeline_stage_attempts',
  'campaign_executions',
  'campaign_execution_events',
];
/** Only repository-owned statement templates reach this boundary. Values stay parameters. */
function statement(sql: string, returning: boolean): string {
  let position = 0;
  let text = sql
    .replace(
      /INSERT INTO campaign_execution_events VALUES/i,
      'INSERT INTO campaign_execution_events(execution_id,sequence,event_type,previous_status,next_status,occurred_at,evidence_json) VALUES',
    )
    .replace(/\browid\b/g, 'event_cursor')
    .replace(/json_extract\(([a-z_.]+),'\$\.([A-Za-z_]+)'\)/g, "($1 ->> '$2')")
    .replace(new RegExp(`\\b(${ownTables.join('|')})\\b`, 'g'), 'campaign.$1')
    .replace(/\baffiliate_briefings\b/g, 'affiliate.affiliate_briefings')
    .replace(/\?/g, () => `$${++position}`)
    .replace(/(\$\d+) IS NULL/g, '$1::TEXT IS NULL');
  if (
    returning &&
    /^\s*INSERT INTO campaign\.pipeline_(stage_attempts|run_transitions|run_recoveries)\b/.test(
      text,
    )
  )
    text += ' RETURNING id';
  return text;
}
export async function verifyCampaignSchema(
  database: PostgresDatabase,
): Promise<void> {
  const migration = CAMPAIGN_POSTGRES_MIGRATIONS[0]!;
  let valid = false;
  try {
    const result = await database.query(
      'SELECT name,checksum FROM platform.schema_migrations WHERE version=$1',
      [5],
    );
    valid =
      result.rows[0]?.name === migration.name &&
      result.rows[0]?.checksum === postgresMigrationChecksum(migration.sql);
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('sqlState' in error) ||
      error.sqlState !== '42P01'
    )
      throw error;
  }
  if (!valid) throw new CampaignError('CAMPAIGN_SCHEMA_VERSION_UNSUPPORTED');
}
export class PostgresCampaignSession {
  private readonly context = new AsyncLocalStorage<{
    client: PoolClient;
    active: boolean;
  }>();
  private closed = false;
  readonly sql: OperationsSql;
  constructor(
    private readonly database: PostgresDatabase,
    private readonly readOnly = false,
    private readonly kind: 'OPERATIONS' | 'CAMPAIGN' = 'CAMPAIGN',
  ) {
    this.sql = {
      prepare: (sql) => ({
        get: async (...values) =>
          (await this.query(sql, values, false)).rows[0],
        all: async (...values) => (await this.query(sql, values, false)).rows,
        run: async (...values) => {
          const result = await this.query(sql, values, true);
          return {
            changes: result.rowCount ?? 0,
            lastInsertRowid: result.rows[0]?.id ?? 0,
          };
        },
      }),
    };
  }
  async transaction<T>(work: () => T): Promise<T> {
    if (this.closed) throw new CampaignError('CAMPAIGN_HANDLE_CLOSED');
    const current = this.context.getStore();
    if (current) {
      if (!current.active)
        throw new CampaignError('CAMPAIGN_TRANSACTION_ENDED');
      return await work();
    }
    return this.database.transaction(async (client) => {
      if (this.readOnly)
        await client.query(
          'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
        );
      else
        await client.query(
          'SELECT pg_catalog.pg_advisory_xact_lock($1,$2)',
          [1296782401, 5],
        );
      const scope = { client, active: true };
      try {
        return await this.context.run(scope, work);
      } finally {
        scope.active = false;
      }
    });
  }
  close(): void {
    this.closed = true;
  }
  private async query(sql: string, values: unknown[], returning: boolean) {
    const scope = this.context.getStore();
    if (this.closed || !scope?.active)
      throw new CampaignError('CAMPAIGN_SESSION_INACTIVE');
    try {
      const result = await scope.client.query({
        text: statement(sql, returning),
        values,
        types: {
          getTypeParser: (oid: number, format?: string) =>
            oid === 114
              ? (value: string) => value
              : types.getTypeParser(oid, format as 'text'),
        },
      });
      for (const row of result.rows) {
        for (const field of result.fields)
          if (field.dataTypeID === 20 && row[field.name] !== null) {
            const number = Number(row[field.name]);
            if (!Number.isSafeInteger(number))
              throw new Error('UNSAFE_INTEGER');
            row[field.name] = number;
          }
        delete row.event_cursor;
      }
      return result;
    } catch (error) {
      const state =
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
      if (this.kind === 'OPERATIONS')
        throw new OperationsError(
          state === '23503'
            ? 'PROJECT_SNAPSHOT_NOT_FOUND'
            : state === 'P5002'
              ? 'INVALID_PIPELINE_RUN_TRANSITION'
              : 'OPERATIONS_PERSISTENCE_FAILED',
          state === '23503'
            ? 'projectVersion'
            : state === 'P5002'
              ? 'state'
              : 'storage',
        );
      throw new CampaignError(
        state === 'P5002'
          ? 'INVALID_CAMPAIGN_TRANSITION'
          : 'CAMPAIGN_PERSISTENCE_FAILED',
      );
    }
  }
}
