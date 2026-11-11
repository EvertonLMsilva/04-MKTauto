import { contentStore } from './content-store.js';
import { ContentService } from '../../src/modules/content/application/content.service.js';
import { ContentOperationsService } from '../../src/modules/content-operations/application/content-operations.service.js';
import { OperationsPersistence } from '../../src/modules/content-operations/infrastructure/operations.persistence.js';
import { AffiliateRunContextService } from '../../src/modules/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { MediaPersistence } from '../../src/modules/media/infrastructure/media.persistence.js';
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
