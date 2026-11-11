import { PostgresDatabase } from '../../../infrastructure/database/postgres/index.js';
import type {
  OperationsStore,
  OperationsSession,
  StageRepository,
} from '../application/ports/operations.port.js';
import { OperationsRepositoryCore } from './sqlite-operations.repository.js';
import { StageRecoveryRepository } from './stage-recovery.repository.js';
import { CampaignRepository } from './campaign.repository.js';
import {
  PostgresCampaignSession,
  verifyCampaignSchema,
} from './postgres-campaign.session.js';
import { CampaignError } from '../domain/campaign.js';
export type CampaignRepositoryPort<A extends boolean = false> = {
  [
    K in keyof CampaignRepository as CampaignRepository[K] extends (
      ...args: any[]
    ) => any
      ? K
      : never
  ]: CampaignRepository[K] extends (...args: infer P) => infer R
    ? (...args: P) => A extends true ? Promise<Awaited<R>> : R
    : never;
};
export class PostgresOperationsPersistence implements OperationsStore<true> {
  constructor(private readonly database: PostgresDatabase) {}
  async open(readOnly = false): Promise<OperationsSession<true>> {
    await verifyCampaignSchema(this.database);
    const session = new PostgresCampaignSession(
      this.database,
      readOnly,
      'OPERATIONS',
    );
    const bridge = {
      sql: session.sql,
      transaction: <T>(work: () => T) => session.transaction(work) as any,
    };
    const core = new OperationsRepositoryCore(bridge.sql, bridge.transaction),
      stage = new StageRecoveryRepository(bridge);
    const stages: StageRepository<true> = {
      findSucceeded: async (...args) =>
        await session.transaction(() => stage.findSucceeded(...args)),
      getLatestAttempt: async (...args) =>
        await session.transaction(() => stage.getLatestAttempt(...args)),
      listAttempts: async (...args) =>
        await session.transaction(() => stage.listAttempts(...args)),
      startAttempt: async (...args) =>
        await session.transaction(() => stage.startAttempt(...args)),
      succeed: async (...args) =>
        await session.transaction(() => stage.succeed(...args)),
      fail: async (...args) =>
        await session.transaction(() => stage.fail(...args)),
    };
    return {
      close: async () => {
        session.close();
      },
      stages,
      startRun: async (...args) =>
        await session.transaction(() => core.startRun(...args)),
      getRun: async (...args) =>
        await session.transaction(() => core.getRun(...args)),
      listRunsByProjectVersion: async (...args) =>
        await session.transaction(() => core.listRunsByProjectVersion(...args)),
      transitionRun: async (...args) =>
        await session.transaction(() => core.transitionRun(...args)),
      resumeRun: async (...args) =>
        await session.transaction(() => core.resumeRun(...args)),
    };
  }
}
export class PostgresCampaignRepository implements CampaignRepositoryPort<true> {
  private readonly core: CampaignRepository;
  constructor(private readonly session: PostgresCampaignSession) {
    this.core = new CampaignRepository(session);
  }
  async readSnapshot<T>(
    read: (repository: PostgresCampaignRepository) => Promise<T>,
  ): Promise<T> {
    return this.session.transaction(() => read(this));
  }
  async close(): Promise<void> {
    this.session.close();
  }
  async operationalExecutions(
    ...args: Parameters<CampaignRepository['operationalExecutions']>
  ) {
    return await this.session.transaction(() =>
      this.core.operationalExecutions(...args),
    );
  }
  async operationalHistory(
    ...args: Parameters<CampaignRepository['operationalHistory']>
  ) {
    return await this.session.transaction(() =>
      this.core.operationalHistory(...args),
    );
  }
  async checkpoint(...args: Parameters<CampaignRepository['checkpoint']>) {
    return await this.session.transaction(() => this.core.checkpoint(...args));
  }
  async hasNotificationAttempt(
    ...args: Parameters<CampaignRepository['hasNotificationAttempt']>
  ) {
    return await this.session.transaction(() =>
      this.core.hasNotificationAttempt(...args),
    );
  }
  async notificationBaseline(
    ..._args: Parameters<CampaignRepository['notificationBaseline']>
  ): Promise<never> {
    throw new CampaignError('CAMPAIGN_CROSS_DOMAIN_REQUIRED');
  }
  async claimNotification(
    ..._args: Parameters<CampaignRepository['claimNotification']>
  ): Promise<never> {
    throw new CampaignError('CAMPAIGN_CROSS_DOMAIN_REQUIRED');
  }
  async finishNotification(
    ...args: Parameters<CampaignRepository['finishNotification']>
  ) {
    return await this.session.transaction(() =>
      this.core.finishNotification(...args),
    );
  }
  async recoverNotifications(
    ...args: Parameters<CampaignRepository['recoverNotifications']>
  ) {
    return await this.session.transaction(() =>
      this.core.recoverNotifications(...args),
    );
  }
  async get(...args: Parameters<CampaignRepository['get']>) {
    return await this.session.transaction(() => this.core.get(...args));
  }
  async history(...args: Parameters<CampaignRepository['history']>) {
    return await this.session.transaction(() => this.core.history(...args));
  }
  async listRecent(...args: Parameters<CampaignRepository['listRecent']>) {
    return await this.session.transaction(() => this.core.listRecent(...args));
  }
  async presentOperatorReview(
    ...args: Parameters<CampaignRepository['presentOperatorReview']>
  ) {
    return await this.session.transaction(() =>
      this.core.presentOperatorReview(...args),
    );
  }
  async schedule(...args: Parameters<CampaignRepository['schedule']>) {
    return await this.session.transaction(() => this.core.schedule(...args));
  }
  async scheduleCatalog(
    ..._args: Parameters<CampaignRepository['scheduleCatalog']>
  ): Promise<never> {
    throw new CampaignError('CAMPAIGN_CROSS_DOMAIN_REQUIRED');
  }
  async recurrences(...args: Parameters<CampaignRepository['recurrences']>) {
    return await this.session.transaction(() => this.core.recurrences(...args));
  }
  async configureRecurrence(
    ...args: Parameters<CampaignRepository['configureRecurrence']>
  ) {
    if (args[0].selectionMode === 'CATALOG')
      throw new CampaignError('CAMPAIGN_CROSS_DOMAIN_REQUIRED');
    return await this.session.transaction(() =>
      this.core.configureRecurrence(...args),
    );
  }
  async scheduleRecurring(
    ...args: Parameters<CampaignRepository['scheduleRecurring']>
  ) {
    if (args[1].selectionMode === 'CATALOG')
      throw new CampaignError('CAMPAIGN_CROSS_DOMAIN_REQUIRED');
    return await this.session.transaction(() =>
      this.core.scheduleRecurring(...args),
    );
  }
  async due(...args: Parameters<CampaignRepository['due']>) {
    return await this.session.transaction(() => this.core.due(...args));
  }
  async pendingFinalization(
    ...args: Parameters<CampaignRepository['pendingFinalization']>
  ) {
    return await this.session.transaction(() =>
      this.core.pendingFinalization(...args),
    );
  }
  async pendingPublicationPolls(
    ...args: Parameters<CampaignRepository['pendingPublicationPolls']>
  ) {
    return await this.session.transaction(() =>
      this.core.pendingPublicationPolls(...args),
    );
  }
  async claim(...args: Parameters<CampaignRepository['claim']>) {
    return await this.session.transaction(() => this.core.claim(...args));
  }
  async heartbeat(...args: Parameters<CampaignRepository['heartbeat']>) {
    return await this.session.transaction(() => this.core.heartbeat(...args));
  }
  async ownedEvent(...args: Parameters<CampaignRepository['ownedEvent']>) {
    return await this.session.transaction(() => this.core.ownedEvent(...args));
  }
  async recover(...args: Parameters<CampaignRepository['recover']>) {
    return await this.session.transaction(() => this.core.recover(...args));
  }
  async cancel(...args: Parameters<CampaignRepository['cancel']>) {
    return await this.session.transaction(() => this.core.cancel(...args));
  }
  async resume(...args: Parameters<CampaignRepository['resume']>) {
    return await this.session.transaction(() => this.core.resume(...args));
  }
  async reviseComposition(
    ..._args: Parameters<CampaignRepository['reviseComposition']>
  ): Promise<never> {
    throw new CampaignError('CAMPAIGN_CROSS_DOMAIN_REQUIRED');
  }
  async administrativeEvent(
    ...args: Parameters<CampaignRepository['administrativeEvent']>
  ) {
    return await this.session.transaction(() =>
      this.core.administrativeEvent(...args),
    );
  }
}
export class PostgresCampaignPersistence {
  constructor(private readonly database: PostgresDatabase) {}
  async open(readOnly = false): Promise<PostgresCampaignRepository> {
    await verifyCampaignSchema(this.database);
    return new PostgresCampaignRepository(
      new PostgresCampaignSession(this.database, readOnly),
    );
  }
}
