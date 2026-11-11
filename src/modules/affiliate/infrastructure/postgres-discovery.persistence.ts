import type {
  DiscoveryRepository,
  DiscoveryRepositoryFactory,
} from '../application/ports/discovery.port.js';
import { SqliteDiscoveryRepository } from './sqlite-discovery.repository.js';
import { PostgresAffiliateSessionFactory } from './postgres-affiliate.session.js';
export class PostgresDiscoveryPersistence implements DiscoveryRepositoryFactory<true> {
  constructor(private readonly sessions: PostgresAffiliateSessionFactory) {}
  async open(readOnly = false): Promise<DiscoveryRepository<true>> {
    const session = await this.sessions.open(readOnly),
      core = new SqliteDiscoveryRepository(session);
    return {
      close: async () => {
        core.close();
      },
      get: async (...args) =>
        await session.transaction(() => core.get(...args)),
      used: async (...args) =>
        await session.transaction(() => core.used(...args)),
      reserve: async (...args) =>
        await session.transaction(() => core.reserve(...args)),
    };
  }
}
