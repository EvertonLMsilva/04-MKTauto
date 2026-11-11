import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ResearchController } from './research.controller.js';
import { ResearchService } from './application/research.service.js';
import {
  RESEARCH_REPOSITORY,
  RESEARCH_READER,
} from './application/research-repository.port.js';
import { RESEARCH_DATABASE } from './infrastructure/research-database.config.js';
import { ResearchPersistence } from './infrastructure/research.persistence.js';
import { PostgresModule } from '../../infrastructure/database/postgres/index.js';
import type { PostgresConfig } from '../../infrastructure/database/postgres/index.js';
import { PostgresResearchPersistence } from './infrastructure/postgres-research.persistence.js';

@Module({
  controllers: [ResearchController],
  providers: [
    ResearchService,
    ResearchPersistence,
    { provide: RESEARCH_REPOSITORY, useExisting: ResearchPersistence },
    { provide: RESEARCH_READER, useExisting: ResearchService },
    {
      provide: RESEARCH_DATABASE,
      useFactory: () => process.env.PROJECT_API_DATABASE ?? null,
    },
  ],
  exports: [RESEARCH_READER],
})
export class ResearchModule {
  /** Explicit isolated opt-in. The default operational module stays SQLite. */
  static postgres(config: PostgresConfig): DynamicModule {
    return {
      module: PostgresResearchPilotModule,
      imports: [PostgresModule.register(config)],
      controllers: [ResearchController],
      providers: [
        PostgresResearchPersistence,
        {
          provide: RESEARCH_REPOSITORY,
          useExisting: PostgresResearchPersistence,
        },
        {
          provide: ResearchService,
          useFactory: (persistence: PostgresResearchPersistence) =>
            new ResearchService<true>(persistence),
          inject: [PostgresResearchPersistence],
        },
        { provide: RESEARCH_READER, useExisting: ResearchService },
      ],
      exports: [RESEARCH_READER],
    };
  }
}

@Module({})
class PostgresResearchPilotModule {}
