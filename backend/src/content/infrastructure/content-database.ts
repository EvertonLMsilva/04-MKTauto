import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import type { ContentOperationsService } from '../../content-operations/application/content-operations.service.js';
import { OperationsError } from '../../content-operations/domain/operations-contracts.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import type { ResearchReader } from '../../research/application/research-reader.port.js';
import { SqliteResearchReader } from '../../research/infrastructure/sqlite-research.reader.js';

export class ContentDatabase {
  readonly db: DatabaseSync;
  readonly research: ResearchReader;
  constructor(
    path: string,
    private readonly operations: Pick<ContentOperationsService, 'get'>,
    protected readonly affiliate: AffiliateRunContext,
    { readOnly = false }: { readOnly?: boolean } = {},
  ) {
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
    this.db = new DatabaseSync(path, { readOnly });
    try {
      this.db.exec('PRAGMA busy_timeout=5000;');
      this.db.exec(
        readOnly ? 'PRAGMA query_only=ON;' : 'PRAGMA foreign_keys=ON;',
      );
      this.research = new SqliteResearchReader(this.db);
    } catch (error) {
      this.db.close();
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
  close() {
    this.db.close();
  }
}
