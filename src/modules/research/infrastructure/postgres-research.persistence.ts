import { Inject, Injectable } from '@nestjs/common';
import {
  PostgresDatabase,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import type { ResearchRepositoryFactory } from '../application/research-repository.port.js';
import { TrendStoreError } from '../domain/research.errors.js';
import { RESEARCH_POSTGRES_MIGRATIONS } from './postgres-research.migrations.js';
import { PostgresResearchRepository } from './postgres-research.repository.js';

@Injectable()
export class PostgresResearchPersistence implements ResearchRepositoryFactory<true> {
  constructor(
    @Inject(PostgresDatabase) private readonly database: PostgresDatabase,
  ) {}

  async open(readOnly = false): Promise<PostgresResearchRepository> {
    const migration = RESEARCH_POSTGRES_MIGRATIONS.find(
      (item) => item.version === 2,
    )!;
    let valid = false;
    try {
      const history = await this.database.query<{
        name: string;
        checksum: string;
      }>(
        'SELECT name,checksum FROM platform.schema_migrations WHERE version=$1',
        [migration.version],
      );
      valid =
        history.rows[0]?.name === migration.name &&
        history.rows[0]?.checksum === postgresMigrationChecksum(migration.sql);
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
      throw new TrendStoreError(
        'RESEARCH_SCHEMA_VERSION_UNSUPPORTED',
        'RESEARCH_SCHEMA_VERSION_UNSUPPORTED',
      );
    return new PostgresResearchRepository(this.database, { readOnly });
  }
}
