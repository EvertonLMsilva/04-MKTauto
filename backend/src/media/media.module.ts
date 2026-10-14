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

@Module({
  imports: [ContentModule, ContentOperationsModule],
  controllers: [MediaController],
  exports: [MediaService],
  providers: [
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
      useFactory: (store: MediaPersistence) => new MediaService(store),
      inject: [MediaPersistence],
    },
  ],
})
export class MediaModule {}
