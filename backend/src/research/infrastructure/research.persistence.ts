import { Inject, Injectable } from '@nestjs/common';
import { RESEARCH_DATABASE } from './research-database.config.js';
import { SqliteResearchRepository } from './sqlite-research.repository.js';
import type { ResearchRepositoryFactory } from '../application/research-repository.port.js';

@Injectable()
export class ResearchPersistence implements ResearchRepositoryFactory {
  constructor(
    @Inject(RESEARCH_DATABASE) private readonly database: string | null,
  ) {}
  open(readOnly = false) {
    if (!this.database)
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    return new SqliteResearchRepository(this.database, { readOnly });
  }
}
