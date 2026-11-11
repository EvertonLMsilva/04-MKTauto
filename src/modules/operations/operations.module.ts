import {
  campaignPostgresModule,
  type CampaignPostgresOptions,
} from '../content-operations/campaign-postgres.module.js';
import type { PostgresConfig } from '../../infrastructure/database/postgres/index.js';
import type { DynamicModule } from '@nestjs/common';
import { PublishingModule } from '../publishing/publishing.module.js';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import { FakeCampaignCommandController } from './fake-campaign-command.controller.js';
import { FakeCampaignCommandService } from './fake-campaign-command.service.js';
import { FakeCampaignCommandGuard } from './fake-campaign-command.guard.js';
import { Module } from '@nestjs/common';
import { CampaignOrchestrationModule } from '../content-operations/campaign-orchestration.module.js';
import { MediaModule } from '../media/media.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { DashboardSummaryService } from './dashboard-summary.service.js';
import { SqliteDashboardSummaryRepository } from './infrastructure/dashboard-summary.repository.js';
@Module({
  imports: [
    CampaignOrchestrationModule,
    MediaModule,
    PublishingModule,
    AffiliateModule,
  ],
  controllers: [OperationsController, FakeCampaignCommandController],
  providers: [
    OperationsService,
    FakeCampaignCommandService,
    FakeCampaignCommandGuard,
    {
      provide: DashboardSummaryService,
      useFactory: () =>
        new DashboardSummaryService(
          new SqliteDashboardSummaryRepository(
            process.env.PROJECT_API_DATABASE ?? null,
          ),
        ),
    },
  ],
})
export class OperationsModule {
  static postgres(
    config: PostgresConfig,
    options: CampaignPostgresOptions = {},
  ): DynamicModule {
    return campaignPostgresModule(config, options);
  }
}
