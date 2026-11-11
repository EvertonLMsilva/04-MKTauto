import { Inject, Injectable } from '@nestjs/common';
import {
  PostgresDatabase,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import type { ProjectRepositoryFactory } from '../application/ports/project-repository.port.js';
import type { ProjectSnapshotReader } from '../application/ports/project-snapshot-reader.port.js';
import { ProjectRepositoryError } from '../domain/project.errors.js';
import { PROJECT_POSTGRES_MIGRATIONS } from './postgres-project.migrations.js';
import { PostgresProjectRepository } from './postgres-project.repository.js';

@Injectable()
export class PostgresProjectPersistence
  implements ProjectRepositoryFactory<true>, ProjectSnapshotReader
{
  constructor(
    @Inject(PostgresDatabase) private readonly database: PostgresDatabase,
  ) {}

  async open(readOnly = false) {
    const migration = PROJECT_POSTGRES_MIGRATIONS[0]!;
    let valid = false;
    try {
      const result = await this.database.query<{
        name: string;
        checksum: string;
      }>(
        'SELECT name,checksum FROM platform.schema_migrations WHERE version=$1',
        [migration.version],
      );
      valid =
        result.rows[0]?.name === migration.name &&
        result.rows[0]?.checksum === postgresMigrationChecksum(migration.sql);
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('sqlState' in error) ||
        error.sqlState !== '42P01'
      )
        throw error;
    }
    if (!valid)
      throw new ProjectRepositoryError(
        'PROJECT_SCHEMA_VERSION_UNSUPPORTED',
        'schemaVersion',
        'pré-verificação exige migrations PostgreSQL existentes atualizadas',
      );
    return new PostgresProjectRepository(this.database, readOnly);
  }

  async get(projectId: string, version?: number) {
    const repository = await this.open(true);
    try {
      return await repository.get(projectId, version);
    } finally {
      await repository.close();
    }
  }
}
