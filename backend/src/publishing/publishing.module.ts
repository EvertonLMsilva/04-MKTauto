import { FinanceModule } from '../finance/finance.module.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { publishingEvidence } from './application/publication-eligibility.js';
const PUBLISHING_EVIDENCE = Symbol('PUBLISHING_EVIDENCE');
import { deterministicInstagramPorts } from './infrastructure/instagram-fake.js';
import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { InstagramConnectionService } from './application/instagram-connection.service.js';
import {
  INSTAGRAM_PUBLICATION_PORTS,
  type InstagramPublicationPorts,
} from './application/ports/instagram-publication.port.js';
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
  imports: [MediaModule, AffiliateModule, FinanceModule],
  controllers: [PublishingController],
  exports: [
    PublishingService,
    InstagramPublicationService,
    InstagramConnectionService,
  ],
  providers: [
    {
      provide: InstagramConnectionService,
      useFactory: () =>
        new InstagramConnectionService(process.env, globalThis.fetch),
    },
    {
      provide: PUBLISHING_EVIDENCE,
      inject: [MediaService, LocalFlowService],
      useFactory: publishingEvidence,
    },
    {
      provide: INSTAGRAM_PUBLICATION_PORTS,
      inject: [PublishingService, MediaService],
      useFactory: (publishing: PublishingService, media: MediaService) =>
        process.env.INSTAGRAM_PUBLICATION_MODE === 'fake'
          ? deterministicInstagramPorts(
              publishing,
              media,
              process.env.INSTAGRAM_ACCOUNT_ID ?? '',
              process.env.INSTAGRAM_API_VERSION ?? '',
            )
          : null,
    },
    {
      provide: InstagramPublicationService,
      inject: [
        PublishingPersistence,
        INSTAGRAM_PUBLICATION_PORTS,
        FinanceService,
      ],
      useFactory: (
        store: PublishingPersistence,
        ports: InstagramPublicationPorts | null,
        finance: FinanceService,
      ) =>
        new InstagramPublicationService(
          store,
          ports,
          undefined,
          process.env.INSTAGRAM_PUBLICATION_MODE === 'fake' &&
            process.env.INSTAGRAM_SCHEDULER_ENABLED !== 'false',
          finance,
        ),
    },
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
        PUBLISHING_EVIDENCE,
        SOCIAL_HISTORY_DATABASE,
      ],
    },
    {
      provide: PublishingService,
      useFactory: (store: PublishingPersistence, media: MediaService) =>
        new PublishingService(store, media),
      inject: [PublishingPersistence, PUBLISHING_EVIDENCE],
    },
  ],
})
export class PublishingModule {}
