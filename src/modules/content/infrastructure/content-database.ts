import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import type { ContentOperationsService } from '../../content-operations/application/content-operations.service.js';
import { OperationsError } from '../../content-operations/domain/operations-contracts.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import type { ResearchReader } from '../../research/application/research-reader.port.js';
import { SqliteResearchReader } from '../../research/infrastructure/sqlite-research.reader.js';

export interface ContentSqlSession {
  prepare(sql: string): {
    get(...values: any[]): any;
    all(...values: any[]): any;
    run(...values: any[]): any;
  };
  exec(sql: string): any;
  readonly isTransaction: boolean;
  close(): void;
}
export interface ContentSession {
  db: ContentSqlSession;
  research:
    | Pick<ResearchReader, 'getShortlist' | 'getInsight'>
    | Pick<ResearchReader<true>, 'getShortlist' | 'getInsight'>;
  transaction<T>(operation: () => T): any;
}
export class ContentDatabase {
  protected readonly sql: ContentSqlSession;
  private readonly sqlite?: DatabaseSync;
  get db(): DatabaseSync {
    if (!this.sqlite) throw new Error('CONTENT_NATIVE_SQLITE_UNAVAILABLE');
    return this.sqlite;
  }
  private readonly session?: ContentSession;
  readonly research:
    | Pick<ResearchReader, 'getShortlist' | 'getInsight'>
    | Pick<ResearchReader<true>, 'getShortlist' | 'getInsight'>;
  constructor(
    path: string | ContentSession,
    private readonly operations: Pick<ContentOperationsService, 'get'>,
    protected readonly affiliate: Pick<
      AffiliateRunContext,
      'resolveRunBriefing'
    >,
    { readOnly = false }: { readOnly?: boolean } = {},
  ) {
    if (typeof path !== 'string') {
      this.session = path;
      this.sql = path.db;
      this.research = path.research;
      return;
    }
    if (!isAbsolute(path))
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    const preflight = new DatabaseSync(path, { readOnly: true });
    try {
      preflight.exec('PRAGMA busy_timeout=5000;');
      if (
        ![39, 40, 41, 42, 43, 44].includes(
          Number(preflight.prepare('PRAGMA user_version').get()?.user_version),
        ) ||
        (Number(preflight.prepare('PRAGMA user_version').get()?.user_version) >=
          41 &&
          preflight
            .prepare('SELECT name FROM schema_migrations WHERE version=41')
            .get()?.name !== '041_campaign_orchestration')
      )
        throw new Error('CONTENT_SCHEMA_VERSION_UNSUPPORTED');
    } finally {
      preflight.close();
    }
    this.sqlite = new DatabaseSync(path, { readOnly });
    this.sql = this.sqlite;
    try {
      this.sql.exec('PRAGMA busy_timeout=5000;');
      this.sql.exec(
        readOnly ? 'PRAGMA query_only=ON;' : 'PRAGMA foreign_keys=ON;',
      );
      this.research = new SqliteResearchReader(this.db);
    } catch (error) {
      this.sql.close();
      throw error;
    }
  }
  getRun(id: string) {
    try {
      return this.operations.get(id);
    } catch (error) {
      if (
        error instanceof OperationsError &&
        error.code === 'PIPELINE_RUN_NOT_FOUND'
      )
        return null;
      throw error;
    }
  }
  protected transaction<T>(operation: () => T): T {
    if (this.session) return this.session.transaction(operation);
    try {
      this.sql.exec('BEGIN IMMEDIATE');
      const result = operation();
      this.sql.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.sql.isTransaction) this.sql.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.sql.close();
  }
}
