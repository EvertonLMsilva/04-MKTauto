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
} from '../domain/affiliate-run-context.js';
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
    _input: BindRunInput,
    _key: string,
    _work: () => Promise<RunBriefingBinding>,
  ): Promise<RunBriefingBinding> {
    throw new Error('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
  }
  async insertRunBinding(_value: RunBriefingBinding): Promise<void> {
    throw new Error('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
  }
  async insertScriptContext(): Promise<void> {
    throw new Error('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
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
