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
export class ShopeeCatalogCommit {
  constructor(
    @Inject(AFFILIATE_DATABASE) private readonly path: string | null,
  ) {}
  commit(
    product: AffiliateProduct,
    campaign: AffiliateCampaign,
    source: AffiliateCampaignSourceV1,
    verifiedMediaRefs: readonly string[],
    receipt: string,
  ) {
    if (!this.path) throw new Error('SHOPEE_DATABASE_REQUIRED');
    const repo = new AtomicShopeeRepository(this.path);
    try {
      return repo.transaction(() => {
        repo.registerProduct(product, `sp_${receipt}`);
        repo.registerCampaign(campaign, `sc_${receipt}`, true);
        return repo.associateCampaignSource(
          source,
          `ss_${receipt}`,
          verifiedMediaRefs,
        );
      });
    } finally {
      repo.close();
    }
  }
}
