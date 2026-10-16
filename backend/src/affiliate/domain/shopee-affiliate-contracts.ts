// Internal contracts only; no dependency on an unconfirmed Shopee API schema.
// Decimal strings preserve source precision. Null means unknown, never zero.
export interface ShopeeMoney {
  amount: string | null;
  currency: string | null;
}

export type ShopeeAffiliateProvenance =
  | {
      source: 'FAKE';
      fixtureVersion: string;
      observedAt: null;
    }
  | {
      source: 'SHOPEE_LIVE';
      fixtureVersion: null;
      observedAt: string;
    };

export interface ShopeeAffiliateOffer {
  offerId: string;
  productId: string;
  shopId: string | null;
  name: string | null;
  price: ShopeeMoney;
  // Rate is a decimal fraction, not a percentage. Estimates are not revenue.
  estimatedCommission: ShopeeMoney & { rate: string | null };
  imageUrl: string | null;
  provenance: ShopeeAffiliateProvenance;
}

export interface ShopeeAffiliateLink {
  offerId: string;
  url: string;
  associationVerified: false;
  provenance: ShopeeAffiliateProvenance;
}

// Internal offer details; unknown business facts remain explicitly unknown.
export interface ShopeeAffiliateOfferDetails extends ShopeeAffiliateOffer {
  description: null;
  availability: null;
  shopName: string | null;
  productUrl: string | null;
  affiliateUrl: string | null;
  priceRange: { min: ShopeeMoney; max: ShopeeMoney };
  discountPercent: number | null;
}

export interface ShopeeOfferQuery {
  page?: number;
  limit?: number;
  keyword?: string;
  sortType?: 1 | 2 | 3 | 4 | 5;
  productCatId?: number;
}

export interface ShopeeAffiliateOfferPage {
  offers: ShopeeAffiliateOfferDetails[];
  pageInfo: {
    page: number | null;
    limit: number;
    hasNextPage: boolean;
    nextPage: number | null;
  };
}
