import { Module } from '@nestjs/common';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import {
  AFFILIATE_REPOSITORY,
  type AffiliateRepositoryFactory,
} from '../affiliate/application/ports/affiliate-repository.port.js';
import {
  AFFILIATE_RUN_CONTEXT,
  type AffiliateRunContext,
} from '../affiliate/application/ports/affiliate-run-context.port.js';
import { PUBLISHING_OPERATIONS } from './application/publishing-operations.port.js';
import { PublishingOperationsService } from './application/publishing-operations.service.js';
import { SqlitePublishingOperationsPersistence } from './infrastructure/publishing-operations.persistence.js';

@Module({
  imports: [AffiliateModule],
  providers: [
    {
      provide: PUBLISHING_OPERATIONS,
      inject: [AFFILIATE_REPOSITORY, AFFILIATE_RUN_CONTEXT],
      useFactory: (
        catalog: AffiliateRepositoryFactory,
        context: AffiliateRunContext,
      ) =>
        new PublishingOperationsService(
          new SqlitePublishingOperationsPersistence(
            process.env.PROJECT_API_DATABASE ?? null,
            catalog,
            context,
          ),
        ),
    },
  ],
  exports: [PUBLISHING_OPERATIONS],
})
export class PublishingOperationsModule {}
