import { PROJECT_SNAPSHOT_READER } from '../project/application/ports/project-snapshot-reader.port.js';
import type { ProjectSnapshotReader } from '../project/application/ports/project-snapshot-reader.port.js';
import { Module } from '@nestjs/common';
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
    AffiliateController,
    AffiliateRunContextController,
    DiscoveryController,
  ],
  exports: [
    AffiliateService,
    AFFILIATE_RUN_CONTEXT,
    AFFILIATE_REPOSITORY,
    AffiliateDiscoveryService,
  ],
  providers: [
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
export class AffiliateModule {}
