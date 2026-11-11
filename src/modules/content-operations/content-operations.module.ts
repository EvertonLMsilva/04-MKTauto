import {
  campaignPostgresModule,
  type CampaignPostgresOptions,
} from './campaign-postgres.module.js';
import type { PostgresConfig } from '../../infrastructure/database/postgres/index.js';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ProjectModule } from '../project/project.module.js';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import { PROJECT_SNAPSHOT_READER } from '../project/application/ports/project-snapshot-reader.port.js';
import type { ProjectSnapshotReader } from '../project/application/ports/project-snapshot-reader.port.js';
import { AFFILIATE_RUN_CONTEXT } from '../affiliate/application/ports/affiliate-run-context.port.js';
import type { AffiliateRunContext } from '../affiliate/application/ports/affiliate-run-context.port.js';
import {
  CONTENT_OPERATIONS_DATABASE,
  CONTENT_OPERATIONS_STORE,
  CONTENT_OPERATIONS,
} from './application/ports/operations.port.js';
import type { OperationsStore } from './application/ports/operations.port.js';
import { OperationsPersistence } from './infrastructure/operations.persistence.js';
import { ContentOperationsService } from './application/content-operations.service.js';
import { ContentOperationsController } from './content-operations.controller.js';

@Module({
  imports: [ProjectModule, AffiliateModule],
  controllers: [ContentOperationsController],
  exports: [CONTENT_OPERATIONS, CONTENT_OPERATIONS_STORE],
  providers: [
    OperationsPersistence,
    {
      provide: CONTENT_OPERATIONS_DATABASE,
      useFactory: () => process.env.PROJECT_API_DATABASE ?? null,
    },
    { provide: CONTENT_OPERATIONS_STORE, useExisting: OperationsPersistence },
    {
      provide: ContentOperationsService,
      useFactory: (
        store: OperationsStore,
        projects: ProjectSnapshotReader,
        affiliate: AffiliateRunContext,
      ) => new ContentOperationsService(store, projects, affiliate),
      inject: [
        CONTENT_OPERATIONS_STORE,
        PROJECT_SNAPSHOT_READER,
        AFFILIATE_RUN_CONTEXT,
      ],
    },
    { provide: CONTENT_OPERATIONS, useExisting: ContentOperationsService },
  ],
})
export class ContentOperationsModule {
  static postgres(
    config: PostgresConfig,
    options: CampaignPostgresOptions = {},
  ): DynamicModule {
    return campaignPostgresModule(config, options);
  }
}
