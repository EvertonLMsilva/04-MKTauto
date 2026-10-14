import { Inject, Injectable } from '@nestjs/common';
import { isAbsolute } from 'node:path';
import { PROJECT_DATABASE } from './project-database.config.js';
import { SqliteProjectRepository } from './sqlite-project.repository.js';
import type { ProjectRepositoryFactory } from '../application/ports/project-repository.port.js';
import type { ProjectSnapshotReader } from '../application/ports/project-snapshot-reader.port.js';

@Injectable()
export class SqliteProjectPersistence
  implements ProjectRepositoryFactory, ProjectSnapshotReader
{
  constructor(
    @Inject(PROJECT_DATABASE) private readonly database: string | null,
  ) {}
  open(readOnly = false) {
    if (!this.database || !isAbsolute(this.database))
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    return new SqliteProjectRepository(this.database, { readOnly });
  }
  async get(projectId: string, version?: number) {
    const repository = this.open(true);
    try {
      return repository.get(projectId, version);
    } finally {
      repository.close();
    }
  }
}
