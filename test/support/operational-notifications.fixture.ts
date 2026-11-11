import { SqliteAffiliatePersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { AffiliateRunContextService } from '../../src/modules/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { CampaignOperationsService } from '../../src/modules/content-operations/application/campaign-operations.service.js';
import { SqliteCampaignOperationsPersistence } from '../../src/modules/content-operations/infrastructure/campaign-operations.persistence.js';
import { PublishingOperationsService } from '../../src/modules/publishing/application/publishing-operations.service.js';
import { SqlitePublishingOperationsPersistence } from '../../src/modules/publishing/infrastructure/publishing-operations.persistence.js';
import type { PublishingOperationsPort } from '../../src/modules/publishing/application/publishing-operations.port.js';
import { OperationalNotificationRepository } from '../../src/modules/notifications/infrastructure/operational-notification.repository.js';

export function openNotificationStore(
  path: string,
  publishing?: PublishingOperationsPort,
) {
  const catalog = new SqliteAffiliatePersistence(path);
  const campaigns = new CampaignOperationsService(
    new SqliteCampaignOperationsPersistence(path),
    catalog,
  );
  const publications =
    publishing ??
    new PublishingOperationsService(
      new SqlitePublishingOperationsPersistence(
        path,
        catalog,
        new AffiliateRunContextService(
          new SqliteAffiliateRunContextPersistence(path),
        ),
      ),
    );
  return new OperationalNotificationRepository(campaigns.open(), publications);
}
