import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ProjectModule } from './modules/project/project.module.js';
import { AffiliateModule } from './modules/affiliate/affiliate.module.js';
import { ContentOperationsModule } from './modules/content-operations/content-operations.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { FinanceModule } from './modules/finance/finance.module.js';
import { PublishingModule } from './modules/publishing/publishing.module.js';
import { ResearchModule } from './modules/research/research.module.js';
import { CampaignOrchestrationModule } from './modules/content-operations/campaign-orchestration.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';

@Module({
  imports: [
    ProjectModule,
    AffiliateModule,
    ContentOperationsModule,
    ContentModule,
    MediaModule,
    FinanceModule,
    PublishingModule,
    ResearchModule,
    CampaignOrchestrationModule,
    OperationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
