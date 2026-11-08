import { VideoProductionPreparationService } from '../media/application/video-production-preparation.service.js';
import { VideoGenerationService } from '../media/application/video-generation.service.js';
import { InstagramPublicationService } from '../publishing/application/instagram-publication.service.js';
import { Module } from '@nestjs/common';
import { OperationalNotificationsModule } from '../notifications/operational-notifications.module.js';
import { OperationalAlertsService } from '../notifications/application/operational-alerts.service.js';
import { ContentOperationsModule } from './content-operations.module.js';
import { ContentModule } from '../content/content.module.js';
import { MediaModule } from '../media/media.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import { ResearchModule } from '../research/research.module.js';
import { PublishingModule } from '../publishing/publishing.module.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import {
  AFFILIATE_RUN_CONTEXT,
  type AffiliateRunContext,
} from '../affiliate/application/ports/affiliate-run-context.port.js';
import { RESEARCH_READER } from '../research/application/research-repository.port.js';
import type { ResearchReader } from '../research/application/research-reader.port.js';
import { EditorialFlowService } from '../content/application/editorial-flow.service.js';
import {
  EDITORIAL_PROVIDER,
  type EditorialProvider,
} from '../content/application/editorial-provider.port.js';
import { ContentService } from '../content/application/content.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { MediaService } from '../media/application/media.service.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { CONTENT_OPERATIONS } from './application/ports/operations.port.js';
import type { ContentOperationsService } from './application/content-operations.service.js';
import { PublishingService } from '../publishing/application/publishing.service.js';
import { InstagramEditorialService } from '../publishing/application/instagram-editorial.service.js';
import { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';
import {
  CampaignAdministration,
  CAMPAIGN_DATABASE,
} from './application/campaign-administration.js';
import { CampaignController } from './campaign.controller.js';
@Module({
  imports: [
    OperationalNotificationsModule,
    ContentOperationsModule,
    ContentModule,
    MediaModule,
    FinanceModule,
    AffiliateModule,
    ResearchModule,
    PublishingModule,
  ],
  controllers: [CampaignController],
  exports: [CampaignAdministration],
  providers: [
    {
      provide: CAMPAIGN_DATABASE,
      useFactory: () => process.env.PROJECT_API_DATABASE ?? null,
    },
    {
      provide: NativeCampaignWorkflow,
      inject: [
        AffiliateService,
        AFFILIATE_RUN_CONTEXT,
        RESEARCH_READER,
        EditorialFlowService,
        EDITORIAL_PROVIDER,
        ContentService,
        LocalFlowService,
        MediaService,
        FinanceService,
        CONTENT_OPERATIONS,
        PublishingService,
        InstagramPublicationService,
        VideoProductionPreparationService,
        VideoGenerationService,
        InstagramEditorialService,
      ],
      useFactory: (
        a: AffiliateService,
        b: AffiliateRunContext,
        r: ResearchReader,
        e: EditorialFlowService,
        p: EditorialProvider,
        c: ContentService,
        l: LocalFlowService,
        m: MediaService,
        f: FinanceService,
        o: ContentOperationsService,
        h: PublishingService,
        instagram: InstagramPublicationService,
        preparations: VideoProductionPreparationService,
        generation: VideoGenerationService,
        captions: InstagramEditorialService,
      ) =>
        new NativeCampaignWorkflow(
          a,
          b,
          r,
          e,
          p,
          c,
          l,
          m,
          f,
          o,
          h,
          instagram,
          {
            preparations,
            generation,
            media: m,
          },
          captions,
        ),
    },
    {
      provide: CampaignAdministration,
      inject: [
        CAMPAIGN_DATABASE,
        NativeCampaignWorkflow,
        OperationalAlertsService,
      ],
      useFactory: (
        path: string | null,
        w: NativeCampaignWorkflow,
        notifications: OperationalAlertsService,
      ) =>
        new CampaignAdministration(
          path,
          w,
          process.env.CAMPAIGN_SCHEDULER_ENABLED === 'true',
          undefined,
          notifications,
        ),
    },
  ],
})
export class CampaignOrchestrationModule {}
