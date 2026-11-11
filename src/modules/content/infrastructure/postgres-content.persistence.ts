import { contentStorageFailure } from './content-storage.errors.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';
import { types } from 'pg';
import type { PostgresDatabase } from '../../../infrastructure/database/postgres/index.js';
import type {
  ContentStore,
  ContentRepository,
} from '../application/content.port.js';
import type { ContentSession, ContentSqlSession } from './content-database.js';
import type { ContentOperationsService } from '../../content-operations/application/content-operations.service.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import type { ResearchReader } from '../../research/application/research-reader.port.js';
import { PostgresOperationsPersistence } from '../../content-operations/infrastructure/postgres-campaign.persistence.js';
import { AffiliateRunContextService } from '../../affiliate/application/affiliate-run-context.service.js';
import { PostgresAffiliatePersistence } from '../../affiliate/infrastructure/postgres-affiliate.persistence.js';
import { PostgresAffiliateSessionFactory } from '../../affiliate/infrastructure/postgres-affiliate.session.js';
import { OperationsError } from '../../content-operations/domain/operations-contracts.js';
import { ScriptRepository } from './script.repository.js';
import { CONTENT_POSTGRES_MIGRATIONS } from './postgres-content.migrations.js';
import { postgresMigrationChecksum } from '../../../infrastructure/database/postgres/index.js';

export interface ContentPostgresDependencies {
  operations: Pick<ContentOperationsService<boolean>, 'get'>;
  affiliate: Pick<AffiliateRunContext<boolean>, 'resolveRunBriefing'>;
  research:
    | Pick<ResearchReader, 'getShortlist' | 'getInsight'>
    | Pick<ResearchReader<true>, 'getShortlist' | 'getInsight'>;
}
const tables = [
  'artifact_lineage_inputs',
  'artifact_lineage',
  'idea_candidate_evidence',
  'idea_candidates',
  'idea_batches',
  'idea_scores',
  'idea_selections',
  'affiliate_editorial_selections',
  'scripts',
];
const coordinatedContent = Symbol('COORDINATED_CONTENT');
/** SQL originates exclusively in the shared Content repositories, never from HTTP input. */
function postgresSql(sql: string): string {
  let position = 0;
  return sql
    .replace(new RegExp(`\\b(${tables.join('|')})\\b`, 'g'), 'content.$1')
    .replace(/\?/g, () => `$${++position}`)
    .replace(
      'ORDER BY created_at, idea_selection_id,',
      'ORDER BY created_at, idea_selection_id NULLS FIRST,',
    );
}
class PostgresContentSession implements ContentSession {
  private readonly context = new AsyncLocalStorage<{
    client: PoolClient;
    active: boolean;
  }>();
  private closed = false;
  readonly db: ContentSqlSession;
  readonly research: ContentPostgresDependencies['research'];
  constructor(
    private readonly database: PostgresDatabase,
    dependencies: ContentPostgresDependencies,
    private readonly readOnly: boolean,
    private readonly coordinated = false,
  ) {
    this.research = dependencies.research;
    this.db = {
      prepare: (sql) => ({
        get: async (...values: unknown[]) => (await this.query(sql, values))[0],
        all: (...values: unknown[]) => this.query(sql, values),
        run: async (...values: unknown[]) => {
          await this.query(sql, values);
        },
      }),
      exec: () => {
        throw new Error('CONTENT_RAW_SQL_UNSUPPORTED');
      },
      isTransaction: false,
      close: () => {
        this.closed = true;
      },
    };
  }
  async transaction<T>(operation: () => T): Promise<T> {
    if (this.closed) throw new Error('CONTENT_HANDLE_CLOSED');
    if (this.database.inUnitOfWork('content') && !this.coordinated)
      throw new Error('CONTENT_CROSS_DOMAIN_TRANSACTION_REQUIRED');
    const active = this.context.getStore();
    if (active) {
      if (!active.active) throw new Error('CONTENT_TRANSACTION_ENDED');
      if (this.database.inUnitOfWork('content'))
        return this.database.transaction(
          async () => await operation(),
          'content',
        );
      return await operation();
    }
    const transaction = () =>
      this.database.transaction(async (client) => {
        if (this.database.inUnitOfWork('content')) {
          // Isolation and participant locks belong to the coordinator.
        } else if (this.readOnly)
          await client.query(
            'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
          );
        else
          await client.query(
            'SELECT pg_catalog.pg_advisory_xact_lock($1,$2)',
            [1296782401, 3],
          );
        const scope = { client, active: true };
        try {
          return await this.context.run(scope, operation);
        } finally {
          scope.active = false;
        }
      }, 'content');
    return this.coordinated
      ? this.database.unitOfWork(
          ['content', 'affiliate', 'campaign'],
          transaction,
        )
      : transaction();
  }
  private async query(sql: string, values: unknown[]) {
    const context = this.context.getStore();
    if (this.closed || !context?.active)
      throw new Error('CONTENT_SESSION_INACTIVE');
    let result;
    try {
      if (this.readOnly && !/^\s*SELECT\b/i.test(sql))
        throw new Error('CONTENT_READ_ONLY');
      result = await context.client.query({
        text: postgresSql(sql),
        values,
        types: {
          getTypeParser: (oid: number, format?: string) =>
            oid === 114
              ? (text: string) => text
              : types.getTypeParser(oid, format as 'text'),
        },
      });
    } catch (error) {
      throw contentStorageFailure(error);
    }
    for (const row of result.rows)
      for (const column of result.fields) {
        if (
          row[column.name] !== null &&
          [20, 1700].includes(column.dataTypeID)
        ) {
          const value = Number(row[column.name]);
          if (
            !Number.isFinite(value) ||
            (column.dataTypeID === 20 && !Number.isSafeInteger(value))
          )
            throw new Error('CONTENT_NUMBER_OUT_OF_RANGE');
          row[column.name] = value;
        }
      }
    return result.rows;
  }
}
export class PostgresContentPersistence implements ContentStore<true> {
  constructor(
    private readonly database: PostgresDatabase,
    private readonly dependencies: ContentPostgresDependencies,
    private readonly coordination?: typeof coordinatedContent,
  ) {}
  /** Canonical PostgreSQL projections only; external callbacks cannot pose as participants. */
  static coordinated(database: PostgresDatabase): PostgresContentPersistence {
    const operations = new PostgresOperationsPersistence(database);
    const affiliate = new AffiliateRunContextService<true>(
      new PostgresAffiliatePersistence(
        new PostgresAffiliateSessionFactory(database, undefined, true),
      ),
    );
    const unsupported = async (): Promise<never> => {
      throw new Error('CONTENT_CROSS_DOMAIN_TRANSACTION_REQUIRED');
    };
    return new PostgresContentPersistence(
      database,
      {
        operations: {
          get: async (id: string) => {
            const session = await operations.open(true);
            try {
              const run = await session.getRun(id);
              if (!run)
                throw new OperationsError(
                  'PIPELINE_RUN_NOT_FOUND',
                  'pipelineRunId',
                );
              return run;
            } finally {
              await session.close();
            }
          },
        },
        affiliate,
        // Research/editorial generation/Finance are not enlisted by this composition.
        research: { getShortlist: unsupported, getInsight: unsupported },
      },
      coordinatedContent,
    );
  }
  async open(readOnly = false): Promise<ContentRepository<true>> {
    const migration = CONTENT_POSTGRES_MIGRATIONS[0]!;
    const history = await this.database.query(
      'SELECT name,checksum FROM platform.schema_migrations WHERE version=$1',
      [3],
      'content',
    );
    if (
      history.rows[0]?.name !== migration.name ||
      history.rows[0]?.checksum !== postgresMigrationChecksum(migration.sql)
    )
      throw new Error('CONTENT_SCHEMA_VERSION_UNSUPPORTED');
    const session = new PostgresContentSession(
      this.database,
      this.dependencies,
      readOnly,
      this.coordination === coordinatedContent,
    );
    const repository = new ScriptRepository(
      session,
      this.dependencies.operations,
      this.dependencies.affiliate,
    );
    return {
      close: async () => repository.close(),
      registerBatch: async (value) =>
        session.transaction(() => repository.registerBatch(value)),
      getIdeaWithScore: async (value) =>
        session.transaction(() => repository.getIdeaWithScore(value)),
      listIdeasByPipelineRun: async (value) =>
        session.transaction(() => repository.listIdeasByPipelineRun(value)),
      registerSelection: async (value) =>
        session.transaction(() => repository.registerSelection(value)),
      getSelection: async (value) =>
        session.transaction(() => repository.getSelection(value)),
      listSelectionsByPipelineRun: async (value) =>
        session.transaction(() =>
          repository.listSelectionsByPipelineRun(value),
        ),
      listSelectionsByBatch: async (value) =>
        session.transaction(() => repository.listSelectionsByBatch(value)),
      registerAffiliateEditorialSelection: async (value) =>
        session.transaction(() =>
          repository.registerAffiliateEditorialSelection(value),
        ),
      getAffiliateEditorialSelection: async (value) =>
        session.transaction(() =>
          repository.getAffiliateEditorialSelection(value),
        ),
      registerScript: async (value) =>
        session.transaction(() => repository.registerScript(value)),
      getScript: async (value) =>
        session.transaction(() => repository.getScript(value)),
      listScriptsByPipelineRun: async (value) =>
        session.transaction(() => repository.listScriptsByPipelineRun(value)),
      listScriptsBySelection: async (value) =>
        session.transaction(() => repository.listScriptsBySelection(value)),
    };
  }
}
