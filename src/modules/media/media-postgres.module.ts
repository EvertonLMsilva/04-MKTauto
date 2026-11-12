import { Module, type DynamicModule } from '@nestjs/common';
import {
  PostgresModule,
  PostgresDatabase,
  type PostgresConfig,
} from '../../infrastructure/database/postgres/index.js';
import { PostgresMediaCatalogPersistence } from './infrastructure/postgres-media-catalog.persistence.js';
import { PostgresMediaVoicePersistence } from './infrastructure/postgres-media-voice.persistence.js';
export const POSTGRES_MEDIA_CATALOG = Symbol('POSTGRES_MEDIA_CATALOG');
export const POSTGRES_MEDIA_VOICE = Symbol('POSTGRES_MEDIA_VOICE');
@Module({})
export class MediaPostgresModule {
  static register(config: PostgresConfig): DynamicModule {
    return {
      module: MediaPostgresModule,
      imports: [PostgresModule.register(config)],
      providers: [
        {
          provide: PostgresMediaVoicePersistence,
          inject: [PostgresDatabase],
          useFactory: (db: PostgresDatabase) =>
            new PostgresMediaVoicePersistence(db),
        },
        {
          provide: POSTGRES_MEDIA_VOICE,
          useExisting: PostgresMediaVoicePersistence,
        },
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
      exports: [
        POSTGRES_MEDIA_CATALOG,
        PostgresMediaCatalogPersistence,
        POSTGRES_MEDIA_VOICE,
        PostgresMediaVoicePersistence,
      ],
    };
  }
}
