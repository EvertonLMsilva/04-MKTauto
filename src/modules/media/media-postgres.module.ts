import { Module, type DynamicModule } from '@nestjs/common';
import {
  PostgresModule,
  PostgresDatabase,
  type PostgresConfig,
} from '../../infrastructure/database/postgres/index.js';
import { PostgresMediaCatalogPersistence } from './infrastructure/postgres-media-catalog.persistence.js';
import { PostgresMediaVoicePersistence } from './infrastructure/postgres-media-voice.persistence.js';
import { PostgresMediaCompositionPersistence } from './infrastructure/postgres-media-composition.persistence.js';
import { PostgresMediaRenderPersistence } from './infrastructure/postgres-media-render.persistence.js';
export const POSTGRES_MEDIA_CATALOG = Symbol('POSTGRES_MEDIA_CATALOG');
export const POSTGRES_MEDIA_VOICE = Symbol('POSTGRES_MEDIA_VOICE');
export const POSTGRES_MEDIA_COMPOSITION = Symbol('POSTGRES_MEDIA_COMPOSITION');
export const POSTGRES_MEDIA_RENDER = Symbol('POSTGRES_MEDIA_RENDER');
@Module({})
export class MediaPostgresModule {
  static register(config: PostgresConfig): DynamicModule {
    return {
      module: MediaPostgresModule,
      imports: [PostgresModule.register(config)],
      providers: [
        {
          provide: PostgresMediaRenderPersistence,
          inject: [PostgresDatabase],
          useFactory: (db: PostgresDatabase) =>
            new PostgresMediaRenderPersistence(db),
        },
        {
          provide: POSTGRES_MEDIA_RENDER,
          useExisting: PostgresMediaRenderPersistence,
        },
        {
          provide: PostgresMediaCompositionPersistence,
          inject: [PostgresDatabase],
          useFactory: (db: PostgresDatabase) =>
            new PostgresMediaCompositionPersistence(db),
        },
        {
          provide: POSTGRES_MEDIA_COMPOSITION,
          useExisting: PostgresMediaCompositionPersistence,
        },
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
        POSTGRES_MEDIA_RENDER,
        PostgresMediaRenderPersistence,
        POSTGRES_MEDIA_COMPOSITION,
        PostgresMediaCompositionPersistence,
        POSTGRES_MEDIA_CATALOG,
        PostgresMediaCatalogPersistence,
        POSTGRES_MEDIA_VOICE,
        PostgresMediaVoicePersistence,
      ],
    };
  }
}
