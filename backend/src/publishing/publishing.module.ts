import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { MediaService } from '../media/application/media.service.js';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import { AFFILIATE_REPOSITORY } from '../affiliate/application/ports/affiliate-repository.port.js';
import type { AffiliateRepositoryFactory } from '../affiliate/application/ports/affiliate-repository.port.js';
import { AFFILIATE_RUN_CONTEXT } from '../affiliate/application/ports/affiliate-run-context.port.js';
import type { AffiliateRunContext } from '../affiliate/application/ports/affiliate-run-context.port.js';
import {
  PublishingPersistence,
  PUBLISHING_DATABASE,
  SOCIAL_HISTORY_DATABASE,
} from './infrastructure/publishing.persistence.js';
import { PublishingService } from './application/publishing.service.js';
import { PublishingController } from './publishing.controller.js';

@Module({
  imports: [MediaModule, AffiliateModule],
  controllers: [PublishingController],
  exports: [PublishingService],
  providers: [
    {
      provide: PUBLISHING_DATABASE,
      useFactory: () => process.env.PROJECT_API_DATABASE ?? null,
    },
    {
      provide: SOCIAL_HISTORY_DATABASE,
      useFactory: () => process.env.SOCIAL_HISTORY_DATABASE ?? null,
    },
    {
      provide: PublishingPersistence,
      useFactory: (
        path: string | null,
        catalog: AffiliateRepositoryFactory,
        context: AffiliateRunContext,
        media: MediaService,
        socialPath: string | null,
      ) => new PublishingPersistence(path, catalog, context, media, socialPath),
      inject: [
        PUBLISHING_DATABASE,
        AFFILIATE_REPOSITORY,
        AFFILIATE_RUN_CONTEXT,
        MediaService,
        SOCIAL_HISTORY_DATABASE,
      ],
    },
    {
      provide: PublishingService,
      useFactory: (store: PublishingPersistence, media: MediaService) =>
        new PublishingService(store, media),
      inject: [PublishingPersistence, MediaService],
    },
  ],
})
export class PublishingModule {}
