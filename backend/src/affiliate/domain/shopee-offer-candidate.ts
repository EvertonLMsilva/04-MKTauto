import type { ShopeeAffiliateOfferDetails } from './shopee-affiliate-contracts.js';

// Transient discovery data, never a registered AffiliateProduct or evidence.
export interface ShopeeOfferCandidate {
  readonly source: 'SHOPEE_AFFILIATE_API';
  readonly eligibility: 'NOT_EVALUATED';
  // Keeps FAKE/LIVE provenance distinct from the integration's source label.
  readonly offer: ShopeeAffiliateOfferDetails;
}
