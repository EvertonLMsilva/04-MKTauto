import {
  type DynamicModule,
  type ExecutionContext,
  ConflictException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  PostgresModule,
  PostgresDatabase,
  type PostgresConfig,
} from '../../infrastructure/database/postgres/index.js';
import { PostgresProjectPersistence } from '../project/infrastructure/postgres-project.persistence.js';
import { PostgresAffiliatePersistence } from './infrastructure/postgres-affiliate.persistence.js';
import {
  PostgresAffiliateSessionFactory,
  type AffiliatePostgresReaders,
} from './infrastructure/postgres-affiliate.session.js';
import { PostgresDiscoveryPersistence } from './infrastructure/postgres-discovery.persistence.js';
import type { DiscoverySourceFactory } from './application/ports/discovery.port.js';
import type { ShopeeAffiliatePort } from './application/ports/shopee-affiliate.port.js';

export interface AffiliatePostgresOptions {
  readers?: AffiliatePostgresReaders;
  coordinateCampaign?: boolean;
  discovery?: DiscoverySourceFactory;
  shopee?: ShopeeAffiliatePort;
}
import { PROJECT_SNAPSHOT_READER } from '../project/application/ports/project-snapshot-reader.port.js';
import type { ProjectSnapshotReader } from '../project/application/ports/project-snapshot-reader.port.js';
import { Module } from '@nestjs/common';
import { QualificationPreviewController } from './qualification-preview.controller.js';
import { QualificationPreviewService } from './application/qualification-preview.service.js';
import type { AffiliateRepositoryFactory } from './application/ports/affiliate-repository.port.js';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { FeedQualificationController } from './feed-qualification.controller.js';
import { ShopeeCatalogService } from './application/shopee-catalog.service.js';
import { ShopeeDynamicService } from './application/shopee-dynamic.service.js';
import { ShopeeDynamicJournal } from './infrastructure/shopee-dynamic-journal.js';
import { ShopeeCatalogCommit } from './infrastructure/shopee-catalog-commit.js';
import { SHOPEE_AFFILIATE } from './application/ports/shopee-affiliate.port.js';
import { shopeeAffiliateProvider } from './infrastructure/shopee-affiliate.provider.js';
import { DiscoveryController } from './discovery.controller.js';
import { AffiliateDiscoveryService } from './application/discovery.service.js';
import {
  DISCOVERY_SOURCE,
  DISCOVERY_REPOSITORY,
} from './application/ports/discovery.port.js';
import { DiscoveryPersistence } from './infrastructure/discovery.persistence.js';
import { ConfiguredDiscoverySource } from './infrastructure/configured-discovery-source.js';
import { AffiliateService } from './application/affiliate.service.js';
import { AffiliateController } from './affiliate.controller.js';
import { ProjectModule } from '../project/project.module.js';
import { AFFILIATE_REPOSITORY } from './application/ports/affiliate-repository.port.js';
import { AFFILIATE_DATABASE } from './infrastructure/affiliate-database.config.js';
import { SqliteAffiliatePersistence } from './infrastructure/sqlite-affiliate.persistence.js';
import { AffiliateRunContextController } from './affiliate-run-context.controller.js';
import { AffiliateRunContextService } from './application/affiliate-run-context.service.js';
import {
  AFFILIATE_RUN_CONTEXT,
  AFFILIATE_RUN_CONTEXT_FACTORY,
} from './application/ports/affiliate-run-context.port.js';
import { SqliteAffiliateRunContextPersistence } from './infrastructure/sqlite-affiliate-run-context.persistence.js';

@Module({
  imports: [ProjectModule],
  controllers: [
    QualificationPreviewController,
    FeedQualificationController,
    AffiliateController,
    AffiliateRunContextController,
    DiscoveryController,
  ],
  exports: [
    ShopeeDynamicService,
    ShopeeCatalogService,
    SHOPEE_AFFILIATE,
    AffiliateService,
    AFFILIATE_RUN_CONTEXT,
    AFFILIATE_REPOSITORY,
    AffiliateDiscoveryService,
  ],
  providers: [
    ShopeeCatalogCommit,
    ShopeeDynamicJournal,
    {
      provide: ShopeeDynamicService,
      useFactory: (
        catalog: ShopeeCatalogService,
        affiliate: AffiliateService,
        journal: ShopeeDynamicJournal,
        projects: ProjectSnapshotReader,
      ) => new ShopeeDynamicService(catalog, affiliate, journal, projects),
      inject: [
        ShopeeCatalogService,
        AffiliateService,
        ShopeeDynamicJournal,
        PROJECT_SNAPSHOT_READER,
      ],
    },
    {
      provide: QualificationPreviewService,
      useFactory: (
        feeds: FeedQualificationService,
        p: AffiliateRepositoryFactory,
        projects: ProjectSnapshotReader,
      ) => new QualificationPreviewService(feeds, p, projects),
      inject: [
        FeedQualificationService,
        AFFILIATE_REPOSITORY,
        PROJECT_SNAPSHOT_READER,
      ],
    },
    FeedQualificationService,
    ShopeeCatalogService,
    shopeeAffiliateProvider,
    {
      provide: AffiliateDiscoveryService,
      useFactory: (
        p: DiscoveryPersistence,
        s: ConfiguredDiscoverySource,
        projects: ProjectSnapshotReader,
      ) => new AffiliateDiscoveryService(p, s, projects),
      inject: [DISCOVERY_REPOSITORY, DISCOVERY_SOURCE, PROJECT_SNAPSHOT_READER],
    },
    DiscoveryPersistence,
    ConfiguredDiscoverySource,
    { provide: DISCOVERY_REPOSITORY, useExisting: DiscoveryPersistence },
    { provide: DISCOVERY_SOURCE, useExisting: ConfiguredDiscoverySource },
    AffiliateService,
    AffiliateRunContextService,
    SqliteAffiliateRunContextPersistence,
    { provide: AFFILIATE_RUN_CONTEXT, useExisting: AffiliateRunContextService },
    {
      provide: AFFILIATE_RUN_CONTEXT_FACTORY,
      useExisting: SqliteAffiliateRunContextPersistence,
    },
    SqliteAffiliatePersistence,
    { provide: AFFILIATE_REPOSITORY, useExisting: SqliteAffiliatePersistence },
    {
      provide: AFFILIATE_DATABASE,
      useFactory: () => process.env.PROJECT_API_DATABASE ?? null,
    },
  ],
})
export class AffiliateModule {
  /** Explicit isolated composition; never loads SQLite providers or selects a LIVE provider. */
  static postgres(
    config: PostgresConfig,
    options: AffiliatePostgresOptions,
  ): DynamicModule {
    if (!options.coordinateCampaign && !options.readers)
      throw new Error('AFFILIATE_CONTEXT_READERS_REQUIRED');
    const unavailable = async (): Promise<never> => {
      throw new Error('SHOPEE_POSTGRES_OFFLINE_PROVIDER_REQUIRED');
    };
    const shopee: ShopeeAffiliatePort = options.shopee ?? {
      queryOffers: unavailable,
      generateLink: unavailable,
    };
    const discovery: DiscoverySourceFactory = options.discovery ?? {
      open: async () => {
        throw new Error('EXTERNAL_CATALOG_POSTGRES_SOURCE_UNAVAILABLE');
      },
    };
    return {
      module: PostgresAffiliatePilotModule,
      imports: [PostgresModule.register(config)],
      controllers: [
        AffiliateController,
        AffiliateRunContextController,
        DiscoveryController,
        FeedQualificationController,
        QualificationPreviewController,
      ],
      providers: [
        {
          provide: PROJECT_SNAPSHOT_READER,
          inject: [PostgresDatabase],
          useFactory: (database: PostgresDatabase) =>
            new PostgresProjectPersistence(database),
        },
        {
          provide: PostgresAffiliateSessionFactory,
          inject: [PostgresDatabase],
          useFactory: (database: PostgresDatabase) =>
            new PostgresAffiliateSessionFactory(
              database,
              options.readers,
              options.coordinateCampaign,
            ),
        },
        {
          provide: PostgresAffiliatePersistence,
          inject: [PostgresAffiliateSessionFactory],
          useFactory: (sessions: PostgresAffiliateSessionFactory) =>
            new PostgresAffiliatePersistence(sessions),
        },
        {
          provide: AFFILIATE_REPOSITORY,
          useExisting: PostgresAffiliatePersistence,
        },
        {
          provide: AFFILIATE_RUN_CONTEXT_FACTORY,
          useExisting: PostgresAffiliatePersistence,
        },
        {
          provide: ShopeeCatalogCommit,
          inject: [PostgresAffiliatePersistence],
          useFactory: (p: PostgresAffiliatePersistence) =>
            new ShopeeCatalogCommit<true>(p),
        },
        {
          provide: AffiliateService,
          inject: [
            PostgresAffiliatePersistence,
            PROJECT_SNAPSHOT_READER,
            ShopeeCatalogCommit,
          ],
          useFactory: (
            p: PostgresAffiliatePersistence,
            projects: ProjectSnapshotReader,
            commit: ShopeeCatalogCommit<true>,
          ) => new AffiliateService<true>(p, projects, commit),
        },
        {
          provide: AffiliateRunContextService,
          inject: [PostgresAffiliatePersistence],
          useFactory: (p: PostgresAffiliatePersistence) =>
            new AffiliateRunContextService<true>(p),
        },
        {
          provide: AFFILIATE_RUN_CONTEXT,
          useExisting: AffiliateRunContextService,
        },
        {
          provide: PostgresDiscoveryPersistence,
          inject: [PostgresAffiliateSessionFactory],
          useFactory: (sessions: PostgresAffiliateSessionFactory) =>
            new PostgresDiscoveryPersistence(sessions),
        },
        {
          provide: DISCOVERY_REPOSITORY,
          useExisting: PostgresDiscoveryPersistence,
        },
        { provide: DISCOVERY_SOURCE, useValue: discovery },
        {
          provide: AffiliateDiscoveryService,
          inject: [
            PostgresDiscoveryPersistence,
            DISCOVERY_SOURCE,
            PROJECT_SNAPSHOT_READER,
          ],
          useFactory: (
            p: PostgresDiscoveryPersistence,
            source: DiscoverySourceFactory,
            projects: ProjectSnapshotReader,
          ) => new AffiliateDiscoveryService<true>(p, source, projects),
        },
        { provide: SHOPEE_AFFILIATE, useValue: shopee },
        ShopeeCatalogService,
        {
          provide: ShopeeDynamicJournal,
          inject: [PostgresAffiliateSessionFactory],
          useFactory: (sessions: PostgresAffiliateSessionFactory) =>
            new ShopeeDynamicJournal<true>(sessions),
        },
        {
          provide: ShopeeDynamicService,
          inject: [
            ShopeeCatalogService,
            AffiliateService,
            ShopeeDynamicJournal,
            PROJECT_SNAPSHOT_READER,
          ],
          useFactory: (
            catalog: ShopeeCatalogService,
            affiliate: AffiliateService<true>,
            journal: ShopeeDynamicJournal<true>,
            projects: ProjectSnapshotReader,
          ) =>
            new ShopeeDynamicService<true>(
              catalog,
              affiliate,
              journal,
              projects,
            ),
        },
        FeedQualificationService,
        {
          provide: QualificationPreviewService,
          inject: [
            FeedQualificationService,
            PostgresAffiliatePersistence,
            PROJECT_SNAPSHOT_READER,
          ],
          useFactory: (
            feeds: FeedQualificationService,
            p: PostgresAffiliatePersistence,
            projects: ProjectSnapshotReader,
          ) => new QualificationPreviewService(feeds, p, projects),
        },
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (context: ExecutionContext) => {
              if (
                !options.coordinateCampaign &&
                context.getClass() === AffiliateRunContextController &&
                context.getHandler().name === 'bindRun'
              )
                throw new ConflictException({
                  code: 'AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED',
                  field: 'pipelineRunId',
                });
              return true;
            },
          },
        },
      ],
      exports: [
        AFFILIATE_RUN_CONTEXT_FACTORY,
        PostgresAffiliatePersistence,
        AffiliateService,
        AFFILIATE_REPOSITORY,
        AFFILIATE_RUN_CONTEXT,
        AffiliateDiscoveryService,
        ShopeeCatalogService,
        ShopeeDynamicService,
        SHOPEE_AFFILIATE,
      ],
    };
  }
}
@Module({})
class PostgresAffiliatePilotModule {}
