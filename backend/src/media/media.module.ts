import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { ContentService } from '../content/application/content.service.js';
import { ContentOperationsModule } from '../content-operations/content-operations.module.js';
import { CONTENT_OPERATIONS } from '../content-operations/application/ports/operations.port.js';
import type { ContentOperationsService } from '../content-operations/application/content-operations.service.js';
import {
  MediaPersistence,
  MEDIA_DATABASE,
} from './infrastructure/media.persistence.js';
import { MediaService } from './application/media.service.js';
import { MediaController } from './media.controller.js';
import { FinanceModule } from '../finance/finance.module.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { NarrationService } from './application/narration.service.js';
import { NarrationController } from './narration.controller.js';
import { createVideoComposer } from './infrastructure/ffmpeg-composer.provider.js';
import {
  FFMPEG_PROCESS_RUNNER,
  runProcess,
  type ProcessRunner,
} from './infrastructure/ffmpeg-process.js';
import {
  VIDEO_COMPOSER,
  type VideoComposer,
} from './application/video-composition.port.js';

@Module({
  imports: [ContentModule, ContentOperationsModule, FinanceModule],
  controllers: [MediaController, NarrationController],
  exports: [MediaService, NarrationService],
  providers: [
    {
      provide: NarrationService,
      useFactory: (finance: FinanceService) => new NarrationService(finance),
      inject: [FinanceService],
    },
    { provide: FFMPEG_PROCESS_RUNNER, useValue: runProcess },
    {
      provide: VIDEO_COMPOSER,
      useFactory: (store: MediaPersistence, runner: ProcessRunner) =>
        createVideoComposer(store, process.env, runner),
      inject: [MediaPersistence, FFMPEG_PROCESS_RUNNER],
    },
    {
      provide: MEDIA_DATABASE,
      useFactory: () => process.env.PROJECT_API_DATABASE ?? null,
    },
    {
      provide: MediaPersistence,
      useFactory: (
        path: string | null,
        operations: ContentOperationsService,
        content: ContentService,
      ) => new MediaPersistence(path, operations, content),
      inject: [MEDIA_DATABASE, CONTENT_OPERATIONS, ContentService],
    },
    {
      provide: MediaService,
      useFactory: (store: MediaPersistence, composer: VideoComposer) =>
        new MediaService(store, composer),
      inject: [MediaPersistence, VIDEO_COMPOSER],
    },
  ],
})
export class MediaModule {}
