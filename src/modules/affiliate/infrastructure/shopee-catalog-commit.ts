import { runAffiliateIo } from '../application/affiliate-io.js';
import { PostgresAffiliatePersistence } from './postgres-affiliate.persistence.js';
import type { Io } from '../application/affiliate-io.js';
import { Inject, Injectable } from '@nestjs/common';
import { AFFILIATE_DATABASE } from './affiliate-database.config.js';
import { SqliteAffiliateRepository } from './sqlite-affiliate.repository.js';
import type {
  AffiliateProduct,
  AffiliateCampaign,
} from '../domain/affiliate-contracts.js';
import type { AffiliateCampaignSourceV1 } from '../domain/affiliate-campaign-source.js';
// Reuse every existing validation, revision rule, command receipt and trigger.
// Inner commands join the enclosing transaction so CATALOG never observes an
// offer without its product and persisted Shopee source, even after a crash.
class AtomicShopeeRepository extends SqliteAffiliateRepository {
  override transaction<T>(operation: () => T): T {
    return this.db.isTransaction ? operation() : super.transaction(operation);
  }
}
@Injectable()
export class ShopeeCatalogCommit<A extends boolean = false> {
  constructor(
    @Inject(AFFILIATE_DATABASE)
    private readonly path: string | null | PostgresAffiliatePersistence,
  ) {}
  commit(
    product: AffiliateProduct,
    campaign: AffiliateCampaign,
    source: AffiliateCampaignSourceV1,
    verifiedMediaRefs: readonly string[],
    receipt: string,
  ): Io<A, AffiliateCampaignSourceV1> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        if (!this.path) throw new Error('SHOPEE_DATABASE_REQUIRED');
        const repo =
          typeof this.path === 'string'
            ? new AtomicShopeeRepository(this.path)
            : yield this.path.open();
        try {
          return yield repo.transaction(() =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                yield repo.registerProduct(product, `sp_${receipt}`);
                yield repo.registerCampaign(campaign, `sc_${receipt}`, true);
                return yield repo.associateCampaignSource(
                  source,
                  `ss_${receipt}`,
                  verifiedMediaRefs,
                );
              }.call(this),
            ),
          );
        } finally {
          yield repo.close();
        }
      }.call(this),
    );
  }
}
