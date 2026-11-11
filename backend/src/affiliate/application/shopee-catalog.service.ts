import { Inject, Injectable } from '@nestjs/common';
import { SHOPEE_AFFILIATE } from './ports/shopee-affiliate.port.js';
import type { ShopeeAffiliatePort } from './ports/shopee-affiliate.port.js';
import type {
  ShopeeAffiliateOffer,
  ShopeeAffiliateOfferDetails,
} from '../domain/shopee-affiliate-contracts.js';
import type {
  ShopeeOfferCandidate,
  ShopeeOfferSelection,
} from '../domain/shopee-offer-candidate.js';
import { immutable } from '../domain/affiliate-contracts.js';
import { ContractValidationError } from '../domain/affiliate.errors.js';

@Injectable()
export class ShopeeCatalogService {
  constructor(
    @Inject(SHOPEE_AFFILIATE) private readonly shopee: ShopeeAffiliatePort,
  ) {}

  selectCandidate(
    candidate: ShopeeOfferCandidate,
    confirmed: true,
  ): ShopeeOfferSelection {
    if (
      confirmed !== true ||
      candidate?.source !== 'SHOPEE_AFFILIATE_API' ||
      candidate.eligibility !== 'NOT_EVALUATED'
    )
      throw new ContractValidationError(
        'SHOPEE_SELECTION_REQUIRED',
        'selection',
        'seleção explícita obrigatória',
      );
    return immutable({
      state: 'SELECTED',
      eligibility: 'NOT_EVALUATED',
      candidate,
    });
  }

  async listCandidates(): Promise<readonly ShopeeOfferCandidate[]> {
    return this.toCandidates(await this.shopee.queryOffers());
  }

  async discover(
    queries: readonly import('../domain/shopee-affiliate-contracts.js').ShopeeOfferQuery[],
    maxPages: number,
  ) {
    const { buildShopeeOffersQuery } =
      await import('../infrastructure/shopee-offers.js');
    if (
      !Number.isSafeInteger(maxPages) ||
      maxPages < queries.length ||
      maxPages > 10 ||
      queries.length < 1 ||
      queries.length > 5
    )
      throw new Error('SHOPEE_DISCOVERY_LIMIT_INVALID');
    const port = this
      .shopee as import('./ports/shopee-affiliate.port.js').ShopeeOfferPagePort;
    if (typeof port.queryOfferPage !== 'function')
      throw new Error('SHOPEE_PAGINATION_UNAVAILABLE');
    for (const query of queries) buildShopeeOffersQuery(query);
    const offers = new Map<string, ShopeeAffiliateOfferDetails>();
    let calls = 0;
    let truncated = false;
    const observations: {
      query: import('../domain/shopee-affiliate-contracts.js').ShopeeOfferQuery;
      productIds: string[];
    }[] = [];
    for (let index = 0; index < queries.length; index++) {
      const query = queries[index];
      let page: number | null = query.page ?? 1;
      // Reserve at least one call for every remaining niche query.
      while (page !== null && calls < maxPages - (queries.length - index - 1)) {
        const request = { ...query, page };
        const result = await port.queryOfferPage(request);
        calls++;
        observations.push({
          query: request,
          productIds: result.offers.map((o) => o.productId),
        });
        for (const offer of result.offers) {
          const previous = offers.get(offer.productId);
          if (previous) {
            // Observation timestamps may change across pages; business facts may not.
            const { provenance: _a, ...a } = previous;
            const { provenance: _b, ...b } = offer;
            if (JSON.stringify(a) !== JSON.stringify(b))
              throw new Error('SHOPEE_OFFERS_DUPLICATE_CONFLICT');
          } else offers.set(offer.productId, offer);
        }
        const next = result.pageInfo.nextPage;
        if (next !== null && next <= page)
          throw new Error('SHOPEE_CONTRACT_ERROR');
        page = next;
        if (
          result.pageInfo.hasNextPage &&
          (next === null || calls >= maxPages - (queries.length - index - 1))
        )
          truncated = true;
      }
    }
    return immutable({
      offers: [...offers.values()],
      calls,
      truncated,
      observations,
    });
  }

  generateTrackedLink(
    input: import('../domain/shopee-affiliate-contracts.js').ShopeeAffiliateLinkInput,
  ) {
    return this.shopee.generateLink(input);
  }

  // Input has already passed the Shopee adapter's normalization. No raw API data.
  toCandidates(
    offers: readonly (ShopeeAffiliateOffer &
      Partial<ShopeeAffiliateOfferDetails>)[],
  ): readonly ShopeeOfferCandidate[] {
    return immutable(
      offers.map((offer): ShopeeOfferCandidate => ({
        source: 'SHOPEE_AFFILIATE_API',
        eligibility: 'NOT_EVALUATED',
        offer: {
          ...offer,
          description: offer.description ?? null,
          availability: offer.availability ?? null,
          shopName: offer.shopName ?? null,
          productUrl: offer.productUrl ?? null,
          affiliateUrl: offer.affiliateUrl ?? null,
          priceRange: offer.priceRange ?? {
            min: { amount: null, currency: null },
            max: { amount: null, currency: null },
          },
          discountPercent: offer.discountPercent ?? null,
        },
      })),
    );
  }
}
