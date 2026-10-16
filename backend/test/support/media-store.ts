import { contentStore } from './content-store.js';
import { ContentService } from '../../src/content/application/content.service.js';
import { ContentOperationsService } from '../../src/content-operations/application/content-operations.service.js';
import { OperationsPersistence } from '../../src/content-operations/infrastructure/operations.persistence.js';
import { AffiliateRunContextService } from '../../src/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { MediaPersistence } from '../../src/media/infrastructure/media.persistence.js';
export function mediaStore(database: string) {
  const affiliate = new AffiliateRunContextService(
    new SqliteAffiliateRunContextPersistence(database),
  );
  const operations = new ContentOperationsService(
    new OperationsPersistence(database),
    { get: async () => null },
    affiliate,
  );
  return new MediaPersistence(
    database,
    operations,
    new ContentService(contentStore(database)),
  );
}
