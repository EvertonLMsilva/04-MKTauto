import { PublishingModule } from '../publishing/publishing.module.js';
import { Module } from '@nestjs/common';
import { CampaignOrchestrationModule } from '../content-operations/campaign-orchestration.module.js';
import { MediaModule } from '../media/media.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
@Module({
  imports: [CampaignOrchestrationModule, MediaModule, PublishingModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
