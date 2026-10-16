import type {
  ShopeeAffiliateOffer,
  ShopeeAffiliateLink,
} from '../../domain/shopee-affiliate-contracts.js';

export const SHOPEE_AFFILIATE = Symbol('SHOPEE_AFFILIATE');

export interface ShopeeAffiliatePort {
  queryOffers(): Promise<ShopeeAffiliateOffer[]>;
  generateLink(input: { offerId: string }): Promise<ShopeeAffiliateLink>;
}
