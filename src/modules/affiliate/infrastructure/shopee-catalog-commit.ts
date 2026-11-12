import { runAffiliateIo } from '../application/affiliate-io.js';
import { PostgresAffiliatePersistence } from './postgres-affiliate.persistence.js';
import type { Io } from '../application/affiliate-io.js';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { PostgresAffiliateSessionFactory } from './postgres-affiliate.session.js';
import { affiliateHash, immutable } from '../domain/affiliate-contracts.js';
import type {
  ReviewedRegistrationPayload,
  ReviewedRegistrationReceipt,
} from '../domain/reviewed-registration.js';
import { catalogError } from './discovery-error.js';
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
    return !this.session && this.db.isTransaction
      ? operation()
      : super.transaction(operation);
  }
  replayReviewed(payload: ReviewedRegistrationPayload, key: string) {
    const work = () =>
      this.replay<ReviewedRegistrationReceipt>('CAMPAIGN', payload, key);
    return this.session ? this.transaction(work) : work();
  }
  commitReviewed(payload: ReviewedRegistrationPayload, key: string) {
    return this.command('CAMPAIGN', payload, key, () =>
      runAffiliateIo(
        function* (
          this: AtomicShopeeRepository,
        ): Generator<unknown, ReviewedRegistrationReceipt, any> {
          if (
            (yield this.getProduct(
              payload.product.productId,
              payload.product.revision + 1,
            )) ||
            (yield this.getCampaign(
              payload.campaign.campaignId,
              payload.campaign.revision + 1,
            ))
          )
            throw catalogError('AFFILIATE_REVIEW_STALE');
          yield this.registerProduct(
            payload.product,
            'rp_' + affiliateHash({ key }),
          );
          yield this.registerCampaign(
            payload.campaign,
            'rc_' + affiliateHash({ key }),
            true,
          );
          return immutable({
            ...payload,
            status: 'REGISTERED',
            registeredAt: new Date().toISOString(),
            productHash: affiliateHash(payload.product),
            campaignHash: affiliateHash(payload.campaign),
            associationVerified: false,
            liveAuthorized: false,
            publicationAuthorized: false,
            operationalApprovalGranted: false,
          });
        }.call(this),
      ),
    );
  }
}
@Injectable()
export class ShopeeCatalogCommit<A extends boolean = false> {
  constructor(
    @Inject(AFFILIATE_DATABASE)
    private readonly path: string | null | PostgresAffiliatePersistence,
    @Optional()
    @Inject(PostgresAffiliateSessionFactory)
    private readonly reviewSessions?: PostgresAffiliateSessionFactory,
  ) {}
  private reviewed(
    payload: ReviewedRegistrationPayload,
    key: string,
    write: boolean,
  ): Io<A, ReviewedRegistrationReceipt | null> {
    return runAffiliateIo(
      function* (
        this: ShopeeCatalogCommit<A>,
      ): Generator<unknown, ReviewedRegistrationReceipt | null, any> {
        if (!this.path)
          throw catalogError('AFFILIATE_REVIEW_COMMIT_UNAVAILABLE');
        if (typeof this.path !== 'string' && !this.reviewSessions)
          throw catalogError('AFFILIATE_REVIEW_COMMIT_UNAVAILABLE');
        const repo = new AtomicShopeeRepository(
          typeof this.path === 'string'
            ? this.path
            : yield this.reviewSessions!.open(!write),
          { readOnly: !write },
        );
        try {
          return yield write
            ? repo.commitReviewed(payload, key)
            : repo.replayReviewed(payload, key);
        } finally {
          yield repo.close();
        }
      }.call(this),
    );
  }
  replayReviewed(
    payload: ReviewedRegistrationPayload,
    key: string,
  ): Io<A, ReviewedRegistrationReceipt | null> {
    return this.reviewed(payload, key, false);
  }
  commitReviewed(
    payload: ReviewedRegistrationPayload,
    key: string,
  ): Io<A, ReviewedRegistrationReceipt> {
    return this.reviewed(payload, key, true) as Io<
      A,
      ReviewedRegistrationReceipt
    >;
  }
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
