import { AsyncLocalStorage } from 'node:async_hooks';
import { types, type PoolClient } from 'pg';
import { AffiliateRepositoryError } from '../domain/affiliate.errors.js';
import { immutable } from '../domain/affiliate-contracts.js';
import {
  validateExecutionProjection,
  type ExecutionContext,
} from '../domain/affiliate-run-context.js';
import { verifyCampaignSchema } from '../../content-operations/infrastructure/postgres-campaign.session.js';
import { CONTENT_POSTGRES_MIGRATIONS } from '../../content/infrastructure/postgres-content.migrations.js';
import {
  PostgresDatabase,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import type { AffiliateSql, AffiliateSession } from './affiliate-sql.js';
import type {
  PipelineContextReader,
  ScriptGenerationActivityReader,
} from '../application/ports/pipeline-context.port.js';
import { AFFILIATE_POSTGRES_MIGRATIONS } from './postgres-affiliate.migrations.js';
export interface AffiliatePostgresReaders {
  executions: PipelineContextReader | PipelineContextReader<true>;
  activity:
    ScriptGenerationActivityReader | ScriptGenerationActivityReader<true>;
}
const tables = [
  'affiliate_product_revisions',
  'affiliate_campaign_revisions',
  'affiliate_briefings',
  'affiliate_commands',
  'affiliate_campaign_sources_v1',
  'affiliate_run_bindings',
  'affiliate_script_contexts',
  'affiliate_discovery_decisions',
  'affiliate_discovery_execution',
  'affiliate_discovery_events',
  'affiliate_shopee_dynamic_events_v1',
];
export class PostgresAffiliateSession implements AffiliateSession {
  private readonly context = new AsyncLocalStorage<{
    client: PoolClient;
    active: boolean;
  }>();
  private closed = false;
  readonly sql: AffiliateSql;
  readonly executions: AffiliatePostgresReaders['executions'];
  readonly activity: AffiliatePostgresReaders['activity'];
  constructor(
    private readonly database: PostgresDatabase,
    readers: AffiliatePostgresReaders | undefined,
    private readonly readOnly: boolean,
    readonly coordinated = false,
  ) {
    if (!coordinated && !readers)
      throw new Error('AFFILIATE_CONTEXT_READERS_REQUIRED');
    this.executions = coordinated
      ? {
          getRun: (id: string) =>
            this.transaction(async () => {
              const row = (
                await this.query(
                  'SELECT pipeline_run_id,schema_version,project_id,project_version,state,project_snapshot_json::text AS project_snapshot_json FROM campaign.pipeline_runs WHERE pipeline_run_id=?',
                  [id],
                )
              ).rows[0];
              if (!row) return null;
              try {
                if (row.schema_version !== 'pipeline-run/1.0.0')
                  throw new Error('INVALID_SCHEMA');
                return immutable(
                  validateExecutionProjection(
                    {
                      pipelineRunId: row.pipeline_run_id,
                      projectId: row.project_id,
                      projectVersion: row.project_version,
                      state: row.state as ExecutionContext['state'],
                    },
                    JSON.parse(row.project_snapshot_json),
                  ),
                );
              } catch {
                throw new AffiliateRepositoryError(
                  'INVALID_PERSISTED_PIPELINE_RUN',
                  'pipelineRunId',
                );
              }
            }),
        }
      : readers!.executions;
    this.activity = coordinated
      ? {
          hasStarted: (id: string) =>
            this.transaction(async () =>
              Boolean(
                (
                  await this.query(
                    `SELECT 1 FROM content.scripts WHERE pipeline_run_id=?
        UNION ALL SELECT 1 FROM campaign.pipeline_stage_attempts WHERE pipeline_run_id=? AND stage='SCRIPT' LIMIT 1`,
                    [id, id],
                  )
                ).rows[0],
              ),
            ),
        }
      : readers!.activity;
    this.sql = {
      prepare: (sql) => ({
        get: async (...values) => (await this.query(sql, values)).rows[0],
        all: async (...values) => (await this.query(sql, values)).rows,
        run: async (...values) => ({
          changes: (await this.query(sql, values)).rowCount ?? 0,
        }),
      }),
    };
  }
  async transaction<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.closed) throw new Error('AFFILIATE_HANDLE_CLOSED');
    if (this.database.inUnitOfWork('affiliate') && !this.coordinated)
      throw new Error('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
    const active = this.context.getStore();
    if (active) {
      if (!active.active) throw new Error('AFFILIATE_TRANSACTION_ENDED');
      if (this.database.inUnitOfWork('affiliate'))
        return this.database.transaction(async () => await work(), 'affiliate');
      return await work();
    }
    const transaction = () =>
      this.database.transaction(async (client) => {
        if (this.database.inUnitOfWork('affiliate')) {
          // Locks and the common connection belong to the explicit coordinator.
        } else if (this.readOnly)
          await client.query(
            'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
          );
        else
          await client.query(
            'SELECT pg_catalog.pg_advisory_xact_lock($1,$2)',
            [1296782401, 4],
          );
        const scope = { client, active: true };
        try {
          return await this.context.run(scope, work);
        } finally {
          scope.active = false;
        }
      }, 'affiliate');
    return this.coordinated
      ? this.database.unitOfWork(
          ['content', 'affiliate', 'campaign'],
          transaction,
        )
      : transaction();
  }
  requireCoordination(): void {
    if (
      !this.coordinated ||
      !this.database.inUnitOfWork('affiliate') ||
      !this.database.inUnitOfWork('campaign') ||
      !this.database.inUnitOfWork('content')
    )
      throw new Error('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
  }
  close() {
    this.closed = true;
  }
  private async query(sql: string, values: unknown[]) {
    const scope = this.context.getStore();
    if (this.closed || !scope?.active)
      throw new Error('AFFILIATE_SESSION_INACTIVE');
    let position = 0;
    const text = sql
      .replace(new RegExp(`\\b(${tables.join('|')})\\b`, 'g'), 'affiliate.$1')
      .replace(/\?/g, () => `$${++position}`);
    try {
      if (this.readOnly && !/^\s*SELECT\b/i.test(sql))
        throw new Error('AFFILIATE_READ_ONLY');
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
      for (const row of result.rows)
        for (const column of result.fields)
          if (column.dataTypeID === 20 && row[column.name] !== null) {
            const value = Number(row[column.name]);
            if (!Number.isSafeInteger(value))
              throw new Error('AFFILIATE_NUMBER_OUT_OF_RANGE');
            row[column.name] = value;
          }
      return result;
    } catch (error) {
      if (error instanceof AffiliateRepositoryError) throw error;
      const state =
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
      throw new AffiliateRepositoryError(
        state === 'P4002'
          ? 'AFFILIATE_REVISION_CONFLICT'
          : 'AFFILIATE_PERSISTENCE_FAILED',
        state === 'P4002' ? 'revision' : 'storage',
      );
    }
  }
}
export class PostgresAffiliateSessionFactory {
  constructor(
    private readonly database: PostgresDatabase,
    private readonly readers: AffiliatePostgresReaders | undefined,
    private readonly coordinated = false,
  ) {}
  async verify() {
    const migration = AFFILIATE_POSTGRES_MIGRATIONS[0]!;
    let valid = false;
    try {
      const result = await this.database.query(
        'SELECT name,checksum FROM platform.schema_migrations WHERE version=$1',
        [4],
        'affiliate',
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
    if (!valid)
      throw new AffiliateRepositoryError(
        'AFFILIATE_SCHEMA_VERSION_UNSUPPORTED',
        'schemaVersion',
      );
    if (this.coordinated) {
      await verifyCampaignSchema(this.database);
      const migration = CONTENT_POSTGRES_MIGRATIONS[0]!;
      const content = await this.database.query(
        'SELECT name,checksum FROM platform.schema_migrations WHERE version=$1',
        [3],
        'content',
      );
      if (
        content.rows[0]?.name !== migration.name ||
        content.rows[0]?.checksum !== postgresMigrationChecksum(migration.sql)
      )
        throw new AffiliateRepositoryError(
          'AFFILIATE_SCHEMA_VERSION_UNSUPPORTED',
          'schemaVersion',
        );
    }
  }
  async open(readOnly = false) {
    await this.verify();
    return new PostgresAffiliateSession(
      this.database,
      this.readers,
      readOnly,
      this.coordinated,
    );
  }
  async withSession<T>(
    readOnly: boolean,
    work: (sql: AffiliateSql) => T,
  ): Promise<T> {
    const session = await this.open(readOnly);
    try {
      return await session.transaction(() => work(session.sql));
    } finally {
      session.close();
    }
  }
}
