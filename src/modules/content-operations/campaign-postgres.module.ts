import {
  Module,
  HttpException,
  type DynamicModule,
  type ExecutionContext,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  PostgresModule,
  PostgresDatabase,
  type PostgresConfig,
} from '../../infrastructure/database/postgres/index.js';
import { PostgresProjectPersistence } from '../project/infrastructure/postgres-project.persistence.js';
import { ContentOperationsController } from './content-operations.controller.js';
import { CampaignController } from './campaign.controller.js';
import { ContentOperationsService } from './application/content-operations.service.js';
import {
  CampaignAdministration,
  CampaignAdministrationRuntime,
} from './application/campaign-administration.js';
import type { CampaignWorkflow } from './application/campaign-orchestrator.js';
import type { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';
import { CampaignError } from './domain/campaign.js';
import { OperationsError } from './domain/operations-contracts.js';
import type { AffiliateRunContext } from '../affiliate/application/ports/affiliate-run-context.port.js';
import { AFFILIATE_RUN_CONTEXT } from '../affiliate/application/ports/affiliate-run-context.port.js';
import { AffiliateModule } from '../affiliate/affiliate.module.js';
import {
  CONTENT_OPERATIONS,
  CONTENT_OPERATIONS_STORE,
} from './application/ports/operations.port.js';
import {
  PostgresOperationsPersistence,
  PostgresCampaignPersistence,
} from './infrastructure/postgres-campaign.persistence.js';
export interface CampaignPostgresOptions {
  workflow?: CampaignWorkflow & {
    validate(request: Record<string, unknown>): Promise<void>;
  };
  affiliate?: Pick<AffiliateRunContext<boolean>, 'resolveRunBriefing'>;
  coordinateAffiliate?: boolean;
}
@Module({})
class CampaignPostgresPilotModule {}
/** A separate app composition: no operational scheduler or default native workflow is loaded. */
export function campaignPostgresModule(
  config: PostgresConfig,
  options: CampaignPostgresOptions = {},
): DynamicModule {
  const unavailable = async (): Promise<never> => {
    throw new CampaignError('CAMPAIGN_WORKFLOW_REQUIRED');
  };
  const workflow = options.workflow ?? {
    steps: ['POSTGRES_WORKFLOW_REQUIRED'],
    validate: unavailable,
    execute: unavailable,
    reconcile: unavailable,
  };
  const affiliate = options.affiliate ?? {
    resolveRunBriefing: () => {
      throw new OperationsError(
        'AFFILIATE_CONTEXT_READ_REQUIRED',
        'briefingId',
      );
    },
  };
  return {
    module: CampaignPostgresPilotModule,
    imports: [
      PostgresModule.register(config),
      ...(options.coordinateAffiliate
        ? [AffiliateModule.postgres(config, { coordinateCampaign: true })]
        : []),
    ],
    controllers: [ContentOperationsController, CampaignController],
    providers: [
      {
        provide: PostgresProjectPersistence,
        inject: [PostgresDatabase],
        useFactory: (db: PostgresDatabase) =>
          new PostgresProjectPersistence(db),
      },
      {
        provide: PostgresOperationsPersistence,
        inject: [PostgresDatabase],
        useFactory: (db: PostgresDatabase) =>
          new PostgresOperationsPersistence(db),
      },
      {
        provide: PostgresCampaignPersistence,
        inject: [PostgresDatabase],
        useFactory: (db: PostgresDatabase) =>
          new PostgresCampaignPersistence(db),
      },
      {
        provide: ContentOperationsService,
        inject: [
          PostgresOperationsPersistence,
          PostgresProjectPersistence,
          ...(options.coordinateAffiliate ? [AFFILIATE_RUN_CONTEXT] : []),
        ],
        useFactory: (
          ops: PostgresOperationsPersistence,
          projects: PostgresProjectPersistence,
          context?: AffiliateRunContext<true>,
        ) =>
          new ContentOperationsService<true>(
            ops,
            projects,
            context ?? affiliate,
          ),
      },
      { provide: CONTENT_OPERATIONS, useExisting: ContentOperationsService },
      {
        provide: CONTENT_OPERATIONS_STORE,
        useExisting: PostgresOperationsPersistence,
      },
      {
        provide: CampaignAdministration,
        inject: [PostgresCampaignPersistence],
        useFactory: async (p: PostgresCampaignPersistence) =>
          new CampaignAdministrationRuntime<true>(
            { repository: await p.open(), canExecute: !!options.workflow },
            workflow as unknown as NativeCampaignWorkflow,
            false,
          ),
      },
      {
        provide: APP_GUARD,
        useValue: {
          canActivate: (context: ExecutionContext) => {
            if (
              context.getClass() === CampaignController &&
              !['schedule', 'get', 'history', 'cancel', 'resume'].includes(
                context.getHandler().name,
              )
            )
              throw new HttpException(
                { code: 'CAMPAIGN_CROSS_DOMAIN_REQUIRED' },
                409,
              );
            return true;
          },
        },
      },
    ],
    exports: [
      CONTENT_OPERATIONS,
      CONTENT_OPERATIONS_STORE,
      ContentOperationsService,
      PostgresCampaignPersistence,
      CampaignAdministration,
    ],
  };
}
