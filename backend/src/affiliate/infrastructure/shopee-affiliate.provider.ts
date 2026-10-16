import type { FactoryProvider } from '@nestjs/common';
import { SHOPEE_AFFILIATE } from '../application/ports/shopee-affiliate.port.js';
import type { ShopeeAffiliatePort } from '../application/ports/shopee-affiliate.port.js';
import type {
  ShopeeAffiliateOffer,
  ShopeeAffiliateLink,
  ShopeeAffiliateProvenance,
} from '../domain/shopee-affiliate-contracts.js';

const provenance = (): ShopeeAffiliateProvenance => ({
  source: 'FAKE',
  fixtureVersion: 'shopee-affiliate-fake/1',
  observedAt: null,
});

export class FakeShopeeAffiliate implements ShopeeAffiliatePort {
  async queryOffers(): Promise<ShopeeAffiliateOffer[]> {
    return [
      {
        offerId: 'fake-offer-001',
        productId: '9007199254740993',
        shopId: 'fake-shop-001',
        name: 'Synthetic fixture with image',
        price: { amount: '9007199254740993.01', currency: 'BRL' },
        estimatedCommission: {
          amount: '0.000001',
          currency: 'BRL',
          rate: '0.012345',
        },
        imageUrl: 'https://shopee-affiliate.invalid/fixture/image-001.png',
        provenance: provenance(),
      },
      {
        offerId: 'fake-offer-002',
        productId: 'fake-product-002',
        shopId: null,
        name: null,
        price: { amount: null, currency: null },
        estimatedCommission: { amount: null, currency: null, rate: null },
        imageUrl: null,
        provenance: provenance(),
      },
    ];
  }

  async generateLink(input: { offerId: string }): Promise<ShopeeAffiliateLink> {
    const offer = (await this.queryOffers()).find(
      (value) => value.offerId === input?.offerId,
    );
    if (!offer) throw new Error('SHOPEE_AFFILIATE_OFFER_NOT_FOUND');
    return {
      offerId: offer.offerId,
      url: `https://shopee-affiliate.invalid/link/${offer.offerId}`,
      associationVerified: false,
      provenance: provenance(),
    };
  }
}

export const shopeeAffiliateProvider = {
  provide: SHOPEE_AFFILIATE,
  useFactory: () => {
    const mode = process.env.SHOPEE_AFFILIATE_MODE ?? 'fake';
    if (mode === 'live') throw new Error('SHOPEE_AFFILIATE_LIVE_UNAVAILABLE');
    if (mode !== 'fake') throw new Error('SHOPEE_AFFILIATE_MODE_INVALID');
    return new FakeShopeeAffiliate();
  },
} satisfies FactoryProvider<ShopeeAffiliatePort>;
