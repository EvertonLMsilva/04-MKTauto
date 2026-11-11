import { Module, type DynamicModule } from '@nestjs/common';
import {
  POSTGRES_CONFIG,
  validatePostgresConfig,
  type PostgresConfig,
} from './postgres.config.js';
import {
  createPostgresPool,
  POSTGRES_POOL_FACTORY,
  PostgresDatabase,
} from './postgres.database.js';

@Module({})
export class PostgresModule {
  static register(config: PostgresConfig): DynamicModule {
    return {
      module: PostgresModule,
      providers: [
        { provide: POSTGRES_CONFIG, useValue: validatePostgresConfig(config) },
        { provide: POSTGRES_POOL_FACTORY, useValue: createPostgresPool },
        PostgresDatabase,
      ],
      exports: [PostgresDatabase],
    };
  }
}
