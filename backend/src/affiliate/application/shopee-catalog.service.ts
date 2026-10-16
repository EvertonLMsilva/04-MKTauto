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
