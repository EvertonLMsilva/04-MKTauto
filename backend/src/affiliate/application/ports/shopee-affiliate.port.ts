import type {
  ShopeeAffiliateOffer,
  ShopeeAffiliateLink,
  ShopeeOfferQuery,
  ShopeeAffiliateOfferPage,
} from '../../domain/shopee-affiliate-contracts.js';

export const SHOPEE_AFFILIATE = Symbol('SHOPEE_AFFILIATE');

export interface ShopeeAffiliatePort {
  queryOffers(): Promise<ShopeeAffiliateOffer[]>;
  generateLink(input: { offerId: string }): Promise<ShopeeAffiliateLink>;
}

// Additive internal capability; the existing fake/probe contract is unchanged.
export interface ShopeeOfferPagePort extends ShopeeAffiliatePort {
  queryOfferPage(input?: ShopeeOfferQuery): Promise<ShopeeAffiliateOfferPage>;
}
