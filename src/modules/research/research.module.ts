import { Module } from '@nestjs/common';
import { ResearchController } from './research.controller.js';
import { ResearchService } from './application/research.service.js';
import {
  RESEARCH_REPOSITORY,
  RESEARCH_READER,
} from './application/research-repository.port.js';
import { RESEARCH_DATABASE } from './infrastructure/research-database.config.js';
import { ResearchPersistence } from './infrastructure/research.persistence.js';

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
export class ResearchModule {}
