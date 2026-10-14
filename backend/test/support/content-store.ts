import { ContentPersistence } from '../../src/content/infrastructure/content.persistence.js';
import { ContentOperationsService } from '../../src/content-operations/application/content-operations.service.js';
import { OperationsPersistence } from '../../src/content-operations/infrastructure/operations.persistence.js';
import { AffiliateRunContextService } from '../../src/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';

export function contentStore(database: string) {
  const affiliate = new AffiliateRunContextService(
    new SqliteAffiliateRunContextPersistence(database),
  );
  const operations = new ContentOperationsService(
    new OperationsPersistence(database),
    { get: async () => null },
    affiliate,
  );
  return new ContentPersistence(database, operations, affiliate);
}
