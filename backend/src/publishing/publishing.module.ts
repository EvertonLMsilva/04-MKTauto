import { FinanceModule } from '../finance/finance.module.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { publishingEvidence } from './application/publication-eligibility.js';
const PUBLISHING_EVIDENCE = Symbol('PUBLISHING_EVIDENCE');
import { deterministicInstagramPorts } from './infrastructure/instagram-fake.js';
import { InstagramGraphAdapter } from './infrastructure/instagram-graph.adapter.js';
import { socialFail } from './domain/social-publication-contracts.js';
import { createHash } from 'node:crypto';
import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { InstagramConnectionService } from './application/instagram-connection.service.js';
import { instagramAccountId } from './infrastructure/instagram-environment.js';
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
import { InstagramEditorialService } from './application/instagram-editorial.service.js';
import { PublishingController } from './publishing.controller.js';

@Module({
  imports: [MediaModule, AffiliateModule, FinanceModule],
  controllers: [PublishingController],
  exports: [
    InstagramEditorialService,
    PublishingService,
    InstagramPublicationService,
    InstagramConnectionService,
  ],
  providers: [
    {
      provide: InstagramEditorialService,
      inject: [PUBLISHING_DATABASE],
      useFactory: (path: string | null) => new InstagramEditorialService(path),
    },
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
      inject: [
        PublishingService,
        MediaService,
        LocalFlowService,
        InstagramConnectionService,
      ],
      useFactory: (
        publishing: PublishingService,
        media: MediaService,
        local: LocalFlowService,
        connection: InstagramConnectionService,
      ) => {
        const mode = process.env.INSTAGRAM_PUBLICATION_MODE;
        const bytes = async (
          packageHash: string,
          renderId: string,
          expectedHash: string,
        ) => {
          const pkg = publishing.package(packageHash);
          if (
            !pkg ||
            pkg.identity.videoRenderId !== renderId ||
            pkg.identity.videoRenderContentHash !== expectedHash ||
            media.verifyMedia(pkg.mediaReference) !== expectedHash
          )
            socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
          const value = await local.previewBytes(renderId);
          if (createHash('sha256').update(value).digest('hex') !== expectedHash)
            socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
          return value;
        };
        if (mode === 'fake') {
          const ports = deterministicInstagramPorts(
            publishing,
            media,
            instagramAccountId(process.env),
            process.env.INSTAGRAM_API_VERSION ?? '',
          );
          return process.env.INSTAGRAM_PUBLICATION_SOURCE === 'local'
            ? { ...ports, localBytes: bytes }
            : ports;
        }
        if (!mode) return null;
        if (mode !== 'live') socialFail('SOCIAL_CONFIG_INVALID');
        if (connection.status().missingConfiguration.length)
          socialFail('SOCIAL_INSTAGRAM_CONFIGURATION_REQUIRED');
        const publisher = new InstagramGraphAdapter({
          mode: 'live',
          accountId: instagramAccountId(process.env),
          apiVersion: process.env.INSTAGRAM_API_VERSION ?? '',
          getAccessToken: () => process.env.INSTAGRAM_ACCESS_TOKEN ?? '',
          fetch: globalThis.fetch,
          allowLivePosts: process.env.INSTAGRAM_LIVE_POSTS_ENABLED === 'true',
        });
        return {
          publisher,
          media: {
            inspect: async (reference: string) => ({
              contentHash: media.verifyMedia(reference),
              result: 'PASS',
              policyVersion: 'instagram-reels-profile/1.0.0',
            }),
          },
          transfer: async () => socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED'),
          localBytes: bytes,
          verifier: {
            mode: 'live',
            verifyTransfer: async () =>
              socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED'),
            verifyPublication: async () =>
              socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED'),
          },
          allowLivePosts: process.env.INSTAGRAM_LIVE_POSTS_ENABLED === 'true',
          verifyConnection: async () => {
            const result = await connection.check();
            if (result.connection !== 'READY')
              socialFail('SOCIAL_AUTH_REQUIRED');
          },
        } satisfies InstagramPublicationPorts;
      },
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
