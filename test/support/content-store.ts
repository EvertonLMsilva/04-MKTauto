import { ContentPersistence } from '../../src/modules/content/infrastructure/content.persistence.js';
import { ContentOperationsService } from '../../src/modules/content-operations/application/content-operations.service.js';
import { OperationsPersistence } from '../../src/modules/content-operations/infrastructure/operations.persistence.js';
import { AffiliateRunContextService } from '../../src/modules/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';

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
