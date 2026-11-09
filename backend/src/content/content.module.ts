import { Module } from '@nestjs/common';
import { OllamaEditorialProvider } from './infrastructure/ollama-editorial.provider.js';
import { ContentOperationsModule } from '../content-operations/content-operations.module.js';
import { CONTENT_OPERATIONS } from '../content-operations/application/ports/operations.port.js';
import type { ContentOperationsService } from '../content-operations/application/content-operations.service.js';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { AFFILIATE_RUN_CONTEXT } from '../affiliate/application/ports/affiliate-run-context.port.js';
import type { AffiliateRunContext } from '../affiliate/application/ports/affiliate-run-context.port.js';
import {
  ContentPersistence,
  CONTENT_DATABASE,
} from './infrastructure/content.persistence.js';
import { ContentService } from './application/content.service.js';
import { ContentController } from './content.controller.js';
import { CONTENT_OPERATIONS_STORE } from '../content-operations/application/ports/operations.port.js';
import type { OperationsStore } from '../content-operations/application/ports/operations.port.js';
import { ResearchModule } from '../research/research.module.js';
import { RESEARCH_READER } from '../research/application/research-repository.port.js';
import type { ResearchReader } from '../research/application/research-reader.port.js';
import { FinanceModule } from '../finance/finance.module.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { EditorialFlowService } from './application/editorial-flow.service.js';
import { EDITORIAL_PROVIDER } from './application/editorial-provider.port.js';
import type { EditorialProvider } from './application/editorial-provider.port.js';
import {
  FakeEditorialProvider,
  UnavailableEditorialProvider,
} from './infrastructure/fake-editorial.provider.js';
import { EditorialFlowController } from './editorial-flow.controller.js';

@Module({
  imports: [
    ContentOperationsModule,
    AffiliateModule,
    ResearchModule,
    FinanceModule,
  ],
  controllers: [ContentController, EditorialFlowController],
  exports: [ContentService, EditorialFlowService, EDITORIAL_PROVIDER],
  providers: [
    {
      provide: EDITORIAL_PROVIDER,
      useFactory: () =>
        process.env.CONTENT_EDITORIAL_PROVIDER === 'fake'
          ? new FakeEditorialProvider()
          : process.env.CONTENT_EDITORIAL_PROVIDER === 'ollama'
            ? new OllamaEditorialProvider(
                process.env.OLLAMA_MODEL ?? '',
                globalThis.fetch,
                process.env.OLLAMA_BASE_URL,
              )
            : new UnavailableEditorialProvider(),
    },
    {
      provide: EditorialFlowService,
      inject: [
        ContentService,
        AFFILIATE_RUN_CONTEXT,
        RESEARCH_READER,
        CONTENT_OPERATIONS_STORE,
        FinanceService,
        EDITORIAL_PROVIDER,
        AffiliateService,
      ],
      useFactory: (
        content: ContentService,
        affiliate: AffiliateRunContext,
        research: ResearchReader,
        operations: OperationsStore,
        finance: FinanceService,
        provider: EditorialProvider,
        catalog: AffiliateService,
      ) =>
        new EditorialFlowService(
          content,
          affiliate,
          research,
          operations,
          finance,
          provider,
          catalog,
        ),
    },
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
