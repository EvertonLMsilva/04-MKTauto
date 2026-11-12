import { Module, type DynamicModule } from '@nestjs/common';
import {
  PostgresModule,
  PostgresDatabase,
  type PostgresConfig,
} from '../../infrastructure/database/postgres/index.js';
import { PostgresMediaCatalogPersistence } from './infrastructure/postgres-media-catalog.persistence.js';
export const POSTGRES_MEDIA_CATALOG = Symbol('POSTGRES_MEDIA_CATALOG');
@Module({})
export class MediaPostgresModule {
  static register(config: PostgresConfig): DynamicModule {
    return {
      module: MediaPostgresModule,
      imports: [PostgresModule.register(config)],
      providers: [
        {
          provide: PostgresMediaCatalogPersistence,
          inject: [PostgresDatabase],
          useFactory: (db: PostgresDatabase) =>
            new PostgresMediaCatalogPersistence(db),
        },
        {
          provide: POSTGRES_MEDIA_CATALOG,
          useExisting: PostgresMediaCatalogPersistence,
        },
      ],
      exports: [POSTGRES_MEDIA_CATALOG, PostgresMediaCatalogPersistence],
    };
  }
}
