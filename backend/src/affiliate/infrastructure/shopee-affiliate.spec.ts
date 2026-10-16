import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { Test } from '@nestjs/testing';
import { AffiliateModule } from '../affiliate.module.js';
import { SHOPEE_AFFILIATE } from '../application/ports/shopee-affiliate.port.js';
import type { ShopeeAffiliatePort } from '../application/ports/shopee-affiliate.port.js';
import {
  FakeShopeeAffiliate,
  shopeeAffiliateProvider,
} from './shopee-affiliate.provider.js';

vi.mock('node:sqlite', () => ({
  DatabaseSync: class {
    constructor() {
      throw new Error('SQLite must not be opened by the Shopee fake');
    }
  },
}));

describe('internal Shopee affiliate fake', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('operates without network, even with a database path configured', async () => {
    const fetch = vi.fn(() => {
      throw new Error('network forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('PROJECT_API_DATABASE', 'must-not-open.sqlite');
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
    const fake = shopeeAffiliateProvider.useFactory();
    const [offer] = await fake.queryOffers();
    await fake.generateLink({ offerId: offer.offerId });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('defaults to fake and resolves the module provider without SQLite or other providers', async () => {
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', undefined);
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AffiliateModule,
    ) as unknown[];
    expect(providers).toContain(shopeeAffiliateProvider);
    const module = await Test.createTestingModule({
      providers: [shopeeAffiliateProvider],
    }).compile();
    expect(module.get<ShopeeAffiliatePort>(SHOPEE_AFFILIATE)).toBeInstanceOf(
      FakeShopeeAffiliate,
    );
    await module.close();
  });

  it.each(['', 'FAKE', 'invalid', 'sensitive-value'])(
    'rejects invalid mode without echoing it: %s',
    (mode) => {
      vi.stubEnv('SHOPEE_AFFILIATE_MODE', mode);
      expect(() => shopeeAffiliateProvider.useFactory()).toThrow(
        /^SHOPEE_AFFILIATE_MODE_INVALID$/,
      );
    },
  );

  it('fails explicitly for unavailable live mode', () => {
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
    expect(() => shopeeAffiliateProvider.useFactory()).toThrow(
      'SHOPEE_AFFILIATE_LIVE_UNAVAILABLE',
    );
  });

  it('returns deterministic isolated fixtures with exact decimals, missing data and provenance', async () => {
    const fake = new FakeShopeeAffiliate();
    const offers = await fake.queryOffers();
    expect(offers).toEqual(await new FakeShopeeAffiliate().queryOffers());
    expect(offers[0].price).toEqual({
      amount: '9007199254740993.01',
      currency: 'BRL',
    });
    expect(offers[0].estimatedCommission).toEqual({
      amount: '0.000001',
      currency: 'BRL',
      rate: '0.012345',
    });
    expect(offers[1]).toMatchObject({
      shopId: null,
      price: { amount: null, currency: null },
      estimatedCommission: { amount: null, currency: null, rate: null },
      imageUrl: null,
    });
    for (const offer of offers) {
      expect(offer.provenance).toEqual({
        source: 'FAKE',
        fixtureVersion: 'shopee-affiliate-fake/1',
        observedAt: null,
      });
      expect(offer).not.toHaveProperty('eligibilityStatus');
      expect(offer).not.toHaveProperty('mediaRightsEvidence');
      expect(offer).not.toHaveProperty('affiliateAssociationEvidence');
    }
    offers[0].price.amount = '1.00';
    expect((await fake.queryOffers())[0].price.amount).toBe(
      '9007199254740993.01',
    );
  });

  it('generates only deterministic non-routable fixture links for known offers', async () => {
    const fake = new FakeShopeeAffiliate();
    const [offer] = await fake.queryOffers();
    const link = await fake.generateLink({ offerId: offer.offerId });
    expect(link).toEqual(await fake.generateLink({ offerId: offer.offerId }));
    expect(new URL(link.url).hostname).toBe('shopee-affiliate.invalid');
    expect(link.provenance).toEqual(offer.provenance);
    expect(link).toMatchObject({
      offerId: offer.offerId,
      associationVerified: false,
    });
    await expect(fake.generateLink({ offerId: 'unknown' })).rejects.toThrow(
      'SHOPEE_AFFILIATE_OFFER_NOT_FOUND',
    );
  });
});
