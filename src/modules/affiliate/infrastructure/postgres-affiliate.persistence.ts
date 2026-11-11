import type {
  AffiliateRepository,
  AffiliateRepositoryFactory,
} from '../application/ports/affiliate-repository.port.js';
import type {
  AffiliateRunContextFactory,
  AffiliateRunContextSession,
} from '../application/ports/affiliate-run-context.port.js';
import type {
  RunBriefingBinding,
  BindRunInput,
  ScriptGenerationContext,
} from '../domain/affiliate-run-context.js';
import {
  assertBindingBriefing,
  assertNewBindingAllowed,
  assertProjectScope,
  validateGenerationIdentity,
} from '../domain/affiliate-run-context.js';
import { AffiliateRepositoryError } from '../domain/affiliate.errors.js';
import { SqliteAffiliateRunContextRepository } from './sqlite-affiliate-run-context.repository.js';
import {
  PostgresAffiliateSessionFactory,
  type PostgresAffiliateSession,
} from './postgres-affiliate.session.js';

export class PostgresAffiliateRepository
  implements AffiliateRepository<true>, AffiliateRunContextSession<true>
{
  private readonly core: SqliteAffiliateRunContextRepository;
  readonly catalog = this;
  readonly executions;
  readonly activity;
  constructor(private readonly session: PostgresAffiliateSession) {
    this.core = new SqliteAffiliateRunContextRepository(session);
    this.executions = {
      getRun: async (id: string) => await session.executions.getRun(id),
    };
    this.activity = {
      hasStarted: async (id: string) => await session.activity.hasStarted(id),
    };
  }
  async close() {
    this.core.close();
  }
  async transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.session.transaction(work);
  }
  async bindingCommand(
    input: BindRunInput,
    key: string,
    work: () => Promise<RunBriefingBinding>,
  ): Promise<RunBriefingBinding> {
    if (!this.session.coordinated)
      throw new Error('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
    return await this.session.transaction(() => {
      this.session.requireCoordination();
      return this.core.bindingCommand(
        input,
        key,
        work as unknown as () => RunBriefingBinding,
      );
    });
  }
  async insertRunBinding(value: RunBriefingBinding): Promise<void> {
    if (!this.session.coordinated)
      throw new Error('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
    await this.session.transaction(async () => {
      this.session.requireCoordination();
      const run = await this.executions.getRun(value.pipelineRunId);
      if (!run)
        throw new AffiliateRepositoryError(
          'PIPELINE_RUN_NOT_FOUND',
          'pipelineRunId',
        );
      const briefing = await this.getBriefing(value.briefingId);
      if (!briefing)
        throw new AffiliateRepositoryError(
          'AFFILIATE_BRIEFING_NOT_FOUND',
          'briefingId',
        );
      assertBindingBriefing(value, briefing);
      const campaign = await this.getCampaign(
        briefing.campaignId,
        briefing.campaignRevision,
      );
      if (!campaign)
        throw new AffiliateRepositoryError(
          'AFFILIATE_REFERENCE_MISSING',
          'campaignId',
        );
      assertProjectScope(run, campaign.projectId);
      assertNewBindingAllowed(
        run,
        (await this.activity.hasStarted(value.pipelineRunId)) ||
          (await this.hasScriptContexts(value.pipelineRunId)),
      );
      await this.core.insertRunBinding(value);
    });
  }
  async insertScriptContext(value: ScriptGenerationContext): Promise<void> {
    if (!this.session.coordinated)
      throw new Error('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
    await this.session.transaction(async () => {
      this.session.requireCoordination();
      validateGenerationIdentity({
        generationRequestId: value.generationRequestId,
        contentHash: value.requestHash,
      });
      if (!(await this.executions.getRun(value.pipelineRunId)))
        throw new AffiliateRepositoryError(
          'PIPELINE_RUN_NOT_FOUND',
          'pipelineRunId',
        );
      const binding = await this.getRunBinding(value.pipelineRunId);
      if ((binding?.briefingHash ?? null) !== value.briefingHash)
        throw new AffiliateRepositoryError(
          'AFFILIATE_SCRIPT_CONTEXT_CONFLICT',
          'generationRequestId',
        );
      await this.core.insertScriptContext(value);
    });
  }
  async replay<T>(
    ...args: Parameters<AffiliateRepository['replay']>
  ): Promise<T | null> {
    return this.session.transaction(() => this.core.replay<T>(...args));
  }
  async catalogCandidates(
    ...args: Parameters<
      SqliteAffiliateRunContextRepository['catalogCandidates']
    >
  ) {
    return await this.session.transaction(() =>
      this.core.catalogCandidates(...args),
    );
  }
  async resolveBriefingSource(
    ...args: Parameters<
      SqliteAffiliateRunContextRepository['resolveBriefingSource']
    >
  ) {
    return await this.session.transaction(() =>
      this.core.resolveBriefingSource(...args),
    );
  }
  async getCampaignSource(
    ...args: Parameters<
      SqliteAffiliateRunContextRepository['getCampaignSource']
    >
  ) {
    return await this.session.transaction(() =>
      this.core.getCampaignSource(...args),
    );
  }
  async associateCampaignSource(
    ...args: Parameters<
      SqliteAffiliateRunContextRepository['associateCampaignSource']
    >
  ) {
    return await this.session.transaction(() =>
      this.core.associateCampaignSource(...args),
    );
  }
  async registerProduct(
    ...args: Parameters<SqliteAffiliateRunContextRepository['registerProduct']>
  ) {
    return await this.session.transaction(() =>
      this.core.registerProduct(...args),
    );
  }
  async getProduct(
    ...args: Parameters<SqliteAffiliateRunContextRepository['getProduct']>
  ) {
    return await this.session.transaction(() => this.core.getProduct(...args));
  }
  async registerCampaign(
    ...args: Parameters<SqliteAffiliateRunContextRepository['registerCampaign']>
  ) {
    return await this.session.transaction(() =>
      this.core.registerCampaign(...args),
    );
  }
  async getCampaign(
    ...args: Parameters<SqliteAffiliateRunContextRepository['getCampaign']>
  ) {
    return await this.session.transaction(() => this.core.getCampaign(...args));
  }
  async createBriefing(
    ...args: Parameters<SqliteAffiliateRunContextRepository['createBriefing']>
  ) {
    return await this.session.transaction(() =>
      this.core.createBriefing(...args),
    );
  }
  async createCatalogBriefing(
    ...args: Parameters<
      SqliteAffiliateRunContextRepository['createCatalogBriefing']
    >
  ) {
    return await this.session.transaction(() =>
      this.core.createCatalogBriefing(...args),
    );
  }
  async getBriefing(
    ...args: Parameters<SqliteAffiliateRunContextRepository['getBriefing']>
  ) {
    return await this.session.transaction(() => this.core.getBriefing(...args));
  }
  async getRunBinding(
    ...args: Parameters<SqliteAffiliateRunContextRepository['getRunBinding']>
  ) {
    return await this.session.transaction(() =>
      this.core.getRunBinding(...args),
    );
  }
  async hasScriptContexts(
    ...args: Parameters<
      SqliteAffiliateRunContextRepository['hasScriptContexts']
    >
  ) {
    return await this.session.transaction(() =>
      this.core.hasScriptContexts(...args),
    );
  }
  async getScriptContext(
    ...args: Parameters<SqliteAffiliateRunContextRepository['getScriptContext']>
  ) {
    return await this.session.transaction(() =>
      this.core.getScriptContext(...args),
    );
  }
}
export class PostgresAffiliatePersistence
  implements AffiliateRepositoryFactory<true>, AffiliateRunContextFactory<true>
{
  constructor(private readonly sessions: PostgresAffiliateSessionFactory) {}
  async open(readOnly = false) {
    return new PostgresAffiliateRepository(await this.sessions.open(readOnly));
  }
}
