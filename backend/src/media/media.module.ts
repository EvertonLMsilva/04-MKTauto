import { Module } from '@nestjs/common';
import { createTemporalValidator } from './infrastructure/offline-temporal.validator.js';
import { createFalControl } from './infrastructure/controlled-fal.js';
import { FalVideoStorage } from './infrastructure/fal-video-storage.js';
import { FalFinanceService } from '../finance/application/fal-finance.service.js';
import { ContentModule } from '../content/content.module.js';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { AFFILIATE_RUN_CONTEXT } from '../affiliate/application/ports/affiliate-run-context.port.js';
import { VideoProductionPreparationService } from './application/video-production-preparation.service.js';
import { VideoGenerationService } from './application/video-generation.service.js';
import { FakeVideoGenerationProvider } from './infrastructure/fake-video-generation.provider.js';
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
import { FalAcquisitionService } from './application/fal-acquisition.service.js';
import { NarrationService } from './application/narration.service.js';
import { OpenAiNarrationTransport } from './infrastructure/openai-narration.transport.js';
import { NarrationController } from './narration.controller.js';
import { LocalFlowController } from './local-flow.controller.js';
import { LocalFlowService } from './application/local-flow.service.js';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import { LocalFlowRepository } from './infrastructure/local-flow.repository.js';
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
  imports: [
    ContentModule,
    ContentOperationsModule,
    FinanceModule,
    AffiliateModule,
  ],
  controllers: [MediaController, NarrationController, LocalFlowController],
  exports: [
    MediaService,
    NarrationService,
    LocalFlowService,
    FalAcquisitionService,
    VideoProductionPreparationService,
    VideoGenerationService,
  ],
  providers: [
    {
      provide: VideoGenerationService,
      inject: [FalAcquisitionService],
      useFactory: (acquisition: FalAcquisitionService) => {
        const mode = process.env.FAL_GENERATION_MODE ?? 'fake';
        if (mode === 'live') throw new Error('FAL_LIVE_DISABLED');
        if (!['fake', 'controlled'].includes(mode))
          throw new Error('FAL_MODE_INVALID');
        return new VideoGenerationService(
          new FakeVideoGenerationProvider(),
          acquisition,
        );
      },
    },
    {
      provide: VideoProductionPreparationService,
      inject: [ContentService, CONTENT_OPERATIONS, AffiliateService],
      useFactory: (
        content: ContentService,
        operations: ContentOperationsService,
        affiliate: AffiliateService,
      ) =>
        new VideoProductionPreparationService(content, operations, affiliate),
    },
    {
      provide: FalAcquisitionService,
      inject: [
        MediaPersistence,
        FalFinanceService,
        FinanceService,
        VideoProductionPreparationService,
        AFFILIATE_RUN_CONTEXT,
      ],
      useFactory: (
        store: MediaPersistence,
        jobs: FalFinanceService,
        finance: FinanceService,
        preparations: VideoProductionPreparationService,
        briefings: any,
      ) => {
        const mode = process.env.FAL_GENERATION_MODE ?? 'fake';
        if (mode === 'live') throw new Error('FAL_LIVE_DISABLED');
        if (!['fake', 'controlled'].includes(mode))
          throw new Error('FAL_MODE_INVALID');
        if (mode === 'controlled') {
          const control = createFalControl(process.env, finance);
          const unavailable = async (): Promise<never> => {
            throw new Error('CONTROLLED_FAL_AUTHORIZATION_REQUIRED');
          };
          return new FalAcquisitionService({
            store,
            finance: jobs,
            preparations,
            briefings,
            control,
            queue: {
              submit: unavailable,
              status: unavailable,
              result: unavailable,
              download: unavailable,
            },
            resolveImage: unavailable,
            storage: new FalVideoStorage({
              root: process.env.FFMPEG_MEDIA_ROOT ?? '',
              maxBytes: 104857600,
              ffmpegPath: process.env.FFMPEG_PATH,
              ffprobePath: process.env.FFPROBE_PATH,
              allowAudio: true,
            }),
          });
        }
        // No normal path constructs a paid transport or opens a repository.
        return new FalAcquisitionService(null);
      },
    },
    {
      provide: LocalFlowService,
      useFactory: (
        media: MediaService,
        operations: ContentOperationsService,
        content: ContentService,
        runner: ProcessRunner,
        path: string | null,
      ) =>
        new LocalFlowService(
          new LocalFlowRuntime(
            () => {
              if (!path)
                throw new Error(
                  'PROJECT_API_DATABASE must be an explicit absolute path',
                );
              return new LocalFlowRepository(path, operations, content);
            },
            media,
            process.env,
            undefined,
            runner,
          ),
        ),
      inject: [
        MediaService,
        CONTENT_OPERATIONS,
        ContentService,
        FFMPEG_PROCESS_RUNNER,
        MEDIA_DATABASE,
      ],
    },
    {
      provide: NarrationService,
      useFactory: (finance: FinanceService) =>
        new NarrationService(
          finance,
          new OpenAiNarrationTransport(process.env),
        ),
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
        runner: ProcessRunner,
      ) =>
        new MediaPersistence(
          path,
          operations,
          content,
          undefined,
          createTemporalValidator(process.env, runner),
        ),
      inject: [
        MEDIA_DATABASE,
        CONTENT_OPERATIONS,
        ContentService,
        FFMPEG_PROCESS_RUNNER,
      ],
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
