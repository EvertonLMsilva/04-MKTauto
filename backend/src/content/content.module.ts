import { Module } from '@nestjs/common';
import { ContentOperationsModule } from '../content-operations/content-operations.module.js';
import { CONTENT_OPERATIONS } from '../content-operations/application/ports/operations.port.js';
import type { ContentOperationsService } from '../content-operations/application/content-operations.service.js';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import { AFFILIATE_RUN_CONTEXT } from '../affiliate/application/ports/affiliate-run-context.port.js';
import type { AffiliateRunContext } from '../affiliate/application/ports/affiliate-run-context.port.js';
import {
  ContentPersistence,
  CONTENT_DATABASE,
} from './infrastructure/content.persistence.js';
import { ContentService } from './application/content.service.js';
import { ContentController } from './content.controller.js';

@Module({
  imports: [ContentOperationsModule, AffiliateModule],
  controllers: [ContentController],
  exports: [ContentService],
  providers: [
    {
      provide: CONTENT_DATABASE,
      useFactory: () => process.env.PROJECT_API_DATABASE ?? null,
    },
    {
      provide: ContentPersistence,
      useFactory: (
        path: string | null,
        operations: ContentOperationsService,
        affiliate: AffiliateRunContext,
      ) => new ContentPersistence(path, operations, affiliate),
      inject: [CONTENT_DATABASE, CONTENT_OPERATIONS, AFFILIATE_RUN_CONTEXT],
    },
    {
      provide: ContentService,
      useFactory: (store: ContentPersistence) => new ContentService(store),
      inject: [ContentPersistence],
    },
  ],
})
export class ContentModule {}
