import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { Test } from '@nestjs/testing';
import { AffiliateModule } from '../affiliate.module.js';
import { SHOPEE_AFFILIATE } from '../application/ports/shopee-affiliate.port.js';
import type { ShopeeAffiliatePort } from '../application/ports/shopee-affiliate.port.js';
import {
  FakeShopeeAffiliate,
  shopeeAffiliateProvider,
  withShopeeLiveAuthorization,
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

  it('requires private credentials for explicitly selected live mode', () => {
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
    vi.stubEnv('SHOPEE_AFFILIATE_APP_ID', '');
    vi.stubEnv('SHOPEE_AFFILIATE_SECRET', '');
    expect(() => shopeeAffiliateProvider.useFactory()).toThrow(
      'SHOPEE_LIVE_CREDENTIALS_MISSING',
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

  it.each([1, 2])(
    'paginates all fake fixtures without loss or duplication with limit=%i',
    async (limit) => {
      const fake = new FakeShopeeAffiliate();
      const all = await fake.queryOffers();
      const ids: string[] = [];
      let next: number | null = 1;
      let calls = 0;
      while (next !== null && calls < 3) {
        const page = await fake.queryOfferPage({ page: next, limit });
        ids.push(...page.offers.map((offer) => offer.productId));
        expect(page.pageInfo.hasNextPage).toBe(ids.length < all.length);
        next = page.pageInfo.nextPage;
        calls++;
      }
      expect(ids).toEqual(all.map((offer) => offer.productId));
      expect(new Set(ids).size).toBe(ids.length);
      expect(next).toBeNull();
      expect(calls).toBe(Math.ceil(all.length / limit));
      expect((await fake.queryOfferPage({ page: 100, limit })).offers).toEqual(
        [],
      );
    },
  );

  it('preserves a complete synthetic offer through paginated discovery without granting evidence', async () => {
    const fake = new FakeShopeeAffiliate();
    const [offer] = await fake.queryOffers();
    const first = await fake.queryOfferPage({ page: 1, limit: 1 });
    const complete = first.offers[0];
    expect(complete).toMatchObject(offer);
    expect(complete.productId).toMatch(/^\d+$/);
    expect(complete.shopId).toMatch(/^\d+$/);
    expect(complete.productUrl).toBe(
      `https://shopee.com.br/product/${complete.shopId}/${complete.productId}`,
    );
    expect(complete.affiliateUrl).toBe(
      `https://shopee-affiliate.invalid/link/${complete.offerId}`,
    );
    expect(complete.price.amount).toBe('9007199254740993.01');
    expect(complete.estimatedCommission.rate).toBe('0.012345');
    expect(first.pageInfo).toEqual({
      page: 1,
      limit: 1,
      hasNextPage: true,
      nextPage: 2,
    });
    const second = await fake.queryOfferPage({ page: 2, limit: 1 });
    expect(second.offers[0]).toMatchObject({
      shopId: null,
      productUrl: null,
      affiliateUrl: null,
    });
    expect(second.pageInfo).toEqual({
      page: 2,
      limit: 1,
      hasNextPage: false,
      nextPage: null,
    });
    const input = {
      offerId: complete.offerId,
      originUrl: complete.productUrl!,
      subIds: ['FICTITIOUS_TEST_ONLY', 'project001'],
    };
    const link = await fake.generateLink(input);
    expect(link).toEqual(await fake.generateLink(input));
    expect(link).toMatchObject({
      ...input,
      url: complete.affiliateUrl,
      associationVerified: false,
      provenance: complete.provenance,
    });
    expect(new URL(link.url).protocol).toBe('https:');
    expect(new URL(link.url).hostname).toBe('shopee-affiliate.invalid');
    input.subIds.push('later');
    expect(link.subIds).toEqual(['FICTITIOUS_TEST_ONLY', 'project001']);
    for (const key of [
      'authorizations',
      'mediaRightsEvidence',
      'commercialApproval',
      'affiliateAssociationEvidence',
    ]) {
      expect(complete).not.toHaveProperty(key);
    }
  });

  it.each(['HTTP_429', 'GRAPHQL_10030'])(
    'does not retry rate limit %s through the authorized LIVE facade',
    async (kind) => {
      vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
      vi.stubEnv('SHOPEE_AFFILIATE_APP_ID', 'synthetic-app');
      vi.stubEnv('SHOPEE_AFFILIATE_SECRET', 'synthetic-secret');
      const fetch = vi.fn(async () =>
        kind === 'HTTP_429'
          ? new Response('PRIVATE_RATE_LIMIT_BODY', {
              status: 429,
              headers: { 'Retry-After': '60' },
            })
          : Response.json({
              errors: [
                {
                  message: 'PRIVATE_RATE_LIMIT_BODY',
                  extensions: { code: 10030 },
                },
              ],
            }),
      );
      vi.stubGlobal('fetch', fetch);
      const provider = shopeeAffiliateProvider.useFactory();
      expect(fetch).not.toHaveBeenCalled();
      const reserve = vi.fn();
      // Spare permission is not permission to retry a failed operation automatically.
      await withShopeeLiveAuthorization(
        {
          mode: 'SHOPEE_LIVE',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          maxOfferPages: 2,
          maxLinks: 0,
          reserve,
        },
        async () => {
          await expect(provider.queryOffers()).rejects.toThrow(
            /^SHOPEE_UNAVAILABLE$/,
          );
          await Promise.resolve();
          expect(fetch).toHaveBeenCalledTimes(1);
          expect(reserve).toHaveBeenCalledExactlyOnceWith('OFFERS', 1);
        },
      );
    },
  );

  it('requires a LIVE capability before HTTP and never leaks permission outside its async context', async () => {
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
    vi.stubEnv('SHOPEE_AFFILIATE_APP_ID', 'synthetic-app');
    vi.stubEnv('SHOPEE_AFFILIATE_SECRET', 'synthetic-secret');
    const fetch = vi.fn(async () =>
      Response.json({
        data: {
          productOfferV2: {
            nodes: [],
            pageInfo: { page: 1, limit: 10, hasNextPage: false },
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const provider = shopeeAffiliateProvider.useFactory();
    await expect(provider.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_AUTHORIZATION_REQUIRED',
    );
    expect(fetch).not.toHaveBeenCalled();
    await withShopeeLiveAuthorization(
      {
        mode: 'SHOPEE_LIVE',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        maxOfferPages: 1,
        maxLinks: 0,
        reserve: () => {},
      },
      async () => {
        expect(await provider.queryOffers()).toEqual([]);
      },
    );
    await expect(provider.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_AUTHORIZATION_REQUIRED',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
