import { Test } from '@nestjs/testing';
import { ShopeeCatalogService } from './shopee-catalog.service.js';
import { SHOPEE_AFFILIATE } from './ports/shopee-affiliate.port.js';
import {
  FakeShopeeAffiliate,
  shopeeAffiliateProvider,
} from '../infrastructure/shopee-affiliate.provider.js';
import { normalizeShopeeOfferPage } from '../infrastructure/shopee-offers.js';
import { shopeeOfferFixture } from '../../../test/support/shopee-offer-fixture.js';

describe('Shopee transient catalog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses only the existing fake port without network, SQLite or commercial effects', async () => {
    const fetch = vi.fn(() => {
      throw new Error('network forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    const fake = new FakeShopeeAffiliate();
    const query = vi.spyOn(fake, 'queryOffers');
    const generate = vi.spyOn(fake, 'generateLink');
    // No repository, AffiliateService or transport is provided to this container.
    const module = await Test.createTestingModule({
      providers: [
        ShopeeCatalogService,
        { provide: SHOPEE_AFFILIATE, useValue: fake },
      ],
    }).compile();
    try {
      const service = module.get(ShopeeCatalogService);
      const candidates = await service.listCandidates();
      expect(query).toHaveBeenCalledTimes(1);
      expect(generate).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(candidates).toHaveLength(2);
      expect(candidates[0].offer.productId).toBe('9007199254740993');
      expect(candidates[0].offer.price.amount).toBe('9007199254740993.01');
      expect(candidates[0].offer.provenance.source).toBe('FAKE');
      expect(candidates[1].offer).toMatchObject({
        name: null,
        shopId: null,
        productUrl: null,
        affiliateUrl: null,
        imageUrl: null,
        description: null,
        availability: null,
        price: { amount: null, currency: null },
        estimatedCommission: { amount: null, currency: null, rate: null },
      });
      for (const candidate of candidates) {
        expect(Object.keys(candidate).sort()).toEqual([
          'eligibility',
          'offer',
          'source',
        ]);
        expect(candidate.source).toBe('SHOPEE_AFFILIATE_API');
        expect(candidate.eligibility).toBe('NOT_EVALUATED');
        expect(Object.isFrozen(candidate.offer.price)).toBe(true);
      }
      expect(await service.listCandidates()).toEqual(candidates);
    } finally {
      await module.close();
    }
  });

  it('preserves normalized details, URLs, provenance and exact estimated decimals', () => {
    const page = normalizeShopeeOfferPage(
      shopeeOfferFixture(),
      { page: 1, limit: 2 },
      '2026-10-16T12:00:00Z',
    );
    const service = new ShopeeCatalogService(new FakeShopeeAffiliate());
    const candidates = service.toCandidates(page.offers);
    expect(candidates[0].offer).toEqual(page.offers[0]);
    expect(candidates[0].offer.price.amount).toBe('12345678901234567890.00100');
    expect(candidates[0].offer.estimatedCommission.rate).toBe('0.01234500');
    expect(candidates[0].offer.estimatedCommission.amount).toBe('0.00000001');
    page.offers[0].price.amount = '1';
    expect(candidates[0].offer.price.amount).toBe('12345678901234567890.00100');
    expect(service.toCandidates([])).toEqual([]);
  });

  it('propagates port failures without manufacturing candidates', async () => {
    const fake = new FakeShopeeAffiliate();
    vi.spyOn(fake, 'queryOffers').mockRejectedValue(
      new Error('invalid normalized source'),
    );
    await expect(
      new ShopeeCatalogService(fake).listCandidates(),
    ).rejects.toThrow('invalid normalized source');
  });

  it('keeps fake default and LIVE blocked', () => {
    const previous = process.env.SHOPEE_AFFILIATE_MODE;
    try {
      delete process.env.SHOPEE_AFFILIATE_MODE;
      expect(shopeeAffiliateProvider.useFactory()).toBeInstanceOf(
        FakeShopeeAffiliate,
      );
      process.env.SHOPEE_AFFILIATE_MODE = 'live';
      expect(() => shopeeAffiliateProvider.useFactory()).toThrow(
        'SHOPEE_AFFILIATE_LIVE_UNAVAILABLE',
      );
    } finally {
      if (previous === undefined) delete process.env.SHOPEE_AFFILIATE_MODE;
      else process.env.SHOPEE_AFFILIATE_MODE = previous;
    }
  });
});
