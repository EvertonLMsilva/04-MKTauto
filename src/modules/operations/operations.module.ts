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
import {
  Module,
  RequestMethod,
  type NestModule,
  type MiddlewareConsumer,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { CampaignOrchestrationModule } from '../content-operations/campaign-orchestration.module.js';
import { MediaModule } from '../media/media.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { ProjectShopeeHandoffService } from './project-shopee-handoff.service.js';
import { ProjectShopeeLivePreflightService } from './project-shopee-live-preflight.service.js';
import { ProjectShopeePreparationLock } from './project-shopee-preparation-lock.js';
import { ShopeeDynamicJournal } from '../affiliate/infrastructure/shopee-dynamic-journal.js';
import { ProjectShopeeDiscoveryService } from './project-shopee-discovery.service.js';
import { ProjectModule } from '../project/project.module.js';
import { OperationsPreflightService } from './operations-preflight.service.js';
import { FinanceModule } from '../finance/finance.module.js';
import { DashboardSummaryService } from './dashboard-summary.service.js';
import { SqliteDashboardSummaryRepository } from './infrastructure/dashboard-summary.repository.js';
import { FirstCommercialPilotService } from './first-commercial-pilot.service.js';
@Module({
  imports: [
    CampaignOrchestrationModule,
    MediaModule,
    PublishingModule,
    AffiliateModule,
    FinanceModule,
    ProjectModule,
  ],
  controllers: [OperationsController, FakeCampaignCommandController],
  exports: [FirstCommercialPilotService],
  providers: [
    FirstCommercialPilotService,
    OperationsService,
    ProjectShopeeHandoffService,
    ProjectShopeeLivePreflightService,
    ProjectShopeePreparationLock,
    {
      provide: ShopeeDynamicJournal,
      useFactory: () =>
        new ShopeeDynamicJournal(process.env.PROJECT_API_DATABASE ?? null),
    },
    ProjectShopeeDiscoveryService,
    OperationsPreflightService,
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
export class OperationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((_request: Request, response: Response, next: NextFunction) => {
        response.setHeader('Cache-Control', 'no-store');
        next();
      })
      .forRoutes({
        path: 'operations/projects/:projectId/shopee-live/preflight',
        method: RequestMethod.POST,
      });
  }
  static postgres(
    config: PostgresConfig,
    options: CampaignPostgresOptions = {},
  ): DynamicModule {
    return campaignPostgresModule(config, options);
  }
}
