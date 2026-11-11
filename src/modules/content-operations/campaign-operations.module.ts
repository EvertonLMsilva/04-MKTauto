import { Module } from '@nestjs/common';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import {
  AFFILIATE_REPOSITORY,
  type AffiliateRepositoryFactory,
} from '../affiliate/application/ports/affiliate-repository.port.js';
import { CAMPAIGN_OPERATIONS } from './application/campaign-operations.port.js';
import { CampaignOperationsService } from './application/campaign-operations.service.js';
import { SqliteCampaignOperationsPersistence } from './infrastructure/campaign-operations.persistence.js';

@Module({
  imports: [AffiliateModule],
  providers: [
    {
      provide: CAMPAIGN_OPERATIONS,
      inject: [AFFILIATE_REPOSITORY],
      useFactory: (catalog: AffiliateRepositoryFactory) =>
        new CampaignOperationsService(
          new SqliteCampaignOperationsPersistence(
            process.env.PROJECT_API_DATABASE ?? null,
          ),
          catalog,
        ),
    },
  ],
  exports: [CAMPAIGN_OPERATIONS],
})
export class CampaignOperationsModule {}
