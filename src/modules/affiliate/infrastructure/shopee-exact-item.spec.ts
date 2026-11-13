import { ShopeeAffiliateLive } from './shopee-affiliate-live.js';
import {
  buildShopeeOffersQuery,
  normalizeShopeeOfferPage,
} from './shopee-offers.js';
import {
  ConfiguredShopeeAffiliate,
  FakeShopeeAffiliate,
  withShopeeLiveAuthorization,
} from './shopee-affiliate.provider.js';
import { ShopeeCatalogService } from '../application/shopee-catalog.service.js';

// Controlled responses only; the target identity does not make this real evidence.
const itemId = '23792533191';
const at = '2026-11-13T12:00:00.000Z';
const node = (id = itemId) => ({
  itemId: id,
  shopId: '9007199254740995',
  productName: 'FICTITIOUS_TEST_ONLY',
  shopName: 'FICTITIOUS_TEST_ONLY',
  imageUrl: 'https://example.invalid/controlled.png',
  productLink: `https://shopee.com.br/product/9007199254740995/${id}`,
  offerLink: 'https://s.shopee.com.br/FICTITIOUS_TEST_ONLY',
  price: '64.9900',
  commission: '21.4467',
  commissionRate: '0.33',
});
const response = (nodes: unknown[] = [node()]) => ({
  data: {
    productOfferV2: {
      nodes,
      pageInfo: { page: 1, limit: 10, hasNextPage: false },
    },
  },
});
const setup = (body: unknown = response()) => {
  const fetch = vi.fn(async () => Response.json(body));
  return {
    fetch,
    live: new ShopeeAffiliateLive(
      { appId: 'synthetic-app', secret: 'synthetic-secret' },
      { fetch, now: () => Date.parse(at) },
    ),
  };
};
const permitted = <T>(run: () => Promise<T>, reserve = () => {}) =>
  withShopeeLiveAuthorization(
    {
      mode: 'SHOPEE_LIVE',
      expiresAt: '2100-01-01T00:00:00Z',
      maxOfferPages: 1,
      maxLinks: 0,
      reserve,
    },
    run,
  );

beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('REAL_NETWORK_FORBIDDEN');
    }),
  ),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('exact Shopee item lookup (offline)', () => {
  it.each([itemId, '9007199254740993', '9223372036854775807'])(
    'emits the validated integer literal without Number or an assumed variable scalar: %s',
    (id) => {
      const built = buildShopeeOffersQuery({
        itemId: id,
        keyword: 'organizador',
      });
      expect(built.query).toContain(
        `productOfferV2(itemId: ${id}, page: $page`,
      );
      expect(built.query).not.toContain('$itemId');
      expect(built.variables).toEqual({
        page: 1,
        limit: 10,
        keyword: 'organizador',
      });
    },
  );

  it.each([
    '',
    '0',
    '-1',
    '+1',
    '01',
    ' 1',
    '1 ',
    '1.0',
    '1e3',
    '9223372036854775808',
    '18446744073709551615',
    '1) { nodes { itemId } } mutation { x',
    '1\n',
    23792533191,
    9007199254740992,
    1n,
    null,
  ])(
    'rejects noncanonical or out-of-range item IDs before HTTP: %s',
    async (id) => {
      const s = setup();
      await expect(
        s.live.queryOfferPage({ itemId: id } as never),
      ).rejects.toThrow(/^SHOPEE_OFFERS_QUERY_INVALID$/);
      expect(s.fetch).not.toHaveBeenCalled();
      expect(s.live.metadata().requestCount).toBe(0);
    },
  );

  it('keeps the previous query unchanged when the filter is omitted', () => {
    expect(buildShopeeOffersQuery({}).query)
      .toBe(`query AffiliateOffers($page: Int!, $limit: Int!, $keyword: String, $sortType: Int, $productCatId: Int) {
  productOfferV2(page: $page, limit: $limit, keyword: $keyword, sortType: $sortType, productCatId: $productCatId) {
    nodes { itemId productName price priceMin priceMax priceDiscountRate imageUrl productLink offerLink commission commissionRate shopId shopName }
    pageInfo { page limit hasNextPage }
  }
}`);
  });

  it('preserves all previous filters alongside the exact identity', () => {
    const built = buildShopeeOffersQuery({
      itemId,
      page: 2,
      limit: 3,
      keyword: 'x',
      sortType: 2,
      productCatId: 100,
    });
    expect(built.variables).toEqual({
      page: 2,
      limit: 3,
      keyword: 'x',
      sortType: 2,
      productCatId: 100,
    });
    expect(built.query).toContain(`itemId: ${itemId}, page: $page`);
  });

  it('returns details for exactly the requested product without asserting rights, stock or link ownership', async () => {
    const s = setup();
    const page = await s.live.queryOfferPage({ itemId });
    expect(page.offers).toHaveLength(1);
    expect(page.offers[0]).toMatchObject({
      productId: itemId,
      shopId: '9007199254740995',
      imageUrl: node().imageUrl,
      productUrl: node().productLink,
      affiliateUrl: node().offerLink,
      price: { amount: '64.9900', currency: null },
      estimatedCommission: { amount: '21.4467', rate: '0.33', currency: null },
      availability: null,
      provenance: { source: 'SHOPEE_LIVE', observedAt: at },
    });
    expect(page.offers[0]).not.toHaveProperty('mediaRightsEvidence');
    expect(page.offers[0]).not.toHaveProperty('associationVerified');
    const sent = JSON.parse(
      (s.fetch.mock.calls[0] as unknown as [unknown, RequestInit])[1]
        .body as string,
    );
    expect(Object.keys(sent).sort()).toEqual(['query', 'variables']);
    expect(sent.query).toContain(`itemId: ${itemId},`);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([[node('23792533192')], [node(), node('23792533192')]])(
    'rejects a wrong item or mixed identities without returning partial offers',
    async (...nodes) => {
      const s = setup(response(nodes));
      await expect(s.live.queryOfferPage({ itemId })).rejects.toThrow(
        /^SHOPEE_OFFERS_RESPONSE_INVALID$/,
      );
      expect(s.live.metadata().offersReturned).toBeNull();
      await expect(s.live.queryOfferPage({ itemId })).rejects.toThrow(
        'SHOPEE_LIVE_ALREADY_ATTEMPTED',
      );
      expect(s.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts an empty result without treating it as an authentication failure', async () => {
    const s = setup(response([]));
    expect((await s.live.queryOfferPage({ itemId })).offers).toEqual([]);
    expect(s.live.metadata()).toMatchObject({
      authentication: 'SUCCESS',
      offersReturned: 0,
    });
  });

  it.each(['imageUrl', 'productLink', 'offerLink'])(
    'rejects an invalid returned %s',
    async (field) => {
      const s = setup(response([{ ...node(), [field]: 'javascript:invalid' }]));
      await expect(s.live.queryOfferPage({ itemId })).rejects.toThrow(
        /^SHOPEE_OFFERS_RESPONSE_INVALID$/,
      );
      expect(s.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects GraphQL errors even when the requested item is in partial data', async () => {
    const s = setup({
      ...response(),
      errors: [{ message: 'PRIVATE_FIXTURE', extensions: { code: 11001 } }],
    });
    await expect(s.live.queryOfferPage({ itemId })).rejects.toThrow(
      'SHOPEE_LIVE_GRAPHQL_ERROR',
    );
    expect(JSON.stringify(s.live.metadata())).not.toContain('PRIVATE_FIXTURE');
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves exact Int64 numeric response lexemes and the bound filter across caller mutation', async () => {
    const expected = '9223372036854775807';
    const input = { itemId: expected };
    const json = JSON.stringify(response([node(expected)])).replace(
      `"itemId":"${expected}"`,
      `"itemId":${expected}`,
    );
    const fetch = vi.fn(async () => {
      input.itemId = '1';
      return new Response(json);
    });
    const live = new ShopeeAffiliateLive(
      { appId: 'synthetic', secret: 'synthetic' },
      { fetch },
    );
    expect((await live.queryOfferPage(input)).offers[0].productId).toBe(
      expected,
    );
  });

  it('checks identity in the shared normalizer as well as the transport', () => {
    expect(() =>
      normalizeShopeeOfferPage(
        response([node('1')]),
        { page: 1, limit: 10, itemId },
        at,
      ),
    ).toThrow('SHOPEE_OFFERS_RESPONSE_INVALID');
  });

  it('filters the FAKE fixture before pagination and never invents an exact target result', async () => {
    const fake = new FakeShopeeAffiliate();
    expect((await fake.queryOfferPage({ itemId, limit: 1 })).offers).toEqual(
      [],
    );
    const page = await fake.queryOfferPage({
      itemId: '9007199254740993',
      limit: 1,
    });
    expect(page.offers.map((o) => o.productId)).toEqual(['9007199254740993']);
    expect(page.offers[0].provenance.source).toBe('FAKE');
    expect(page.pageInfo).toMatchObject({ hasNextPage: false, nextPage: null });
    expect(
      (
        await fake.queryOfferPage({
          itemId: '9007199254740993',
          page: 2,
          limit: 1,
        })
      ).offers,
    ).toEqual([]);
    expect((await fake.queryOfferPage({ limit: 10 })).offers).toHaveLength(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('uses the existing catalog/provider boundary and freezes the target before reserving a permitted call', async () => {
    const input = { itemId };
    const fetch = vi.fn(async () => Response.json(response()));
    const provider = new ConfiguredShopeeAffiliate(
      { appId: 'synthetic', secret: 'synthetic' },
      fetch,
    );
    const catalog = new ShopeeCatalogService(provider);
    const discovered = await permitted(() => catalog.discover([input], 1));
    expect(discovered.offers.map((o) => o.productId)).toEqual([itemId]);
    expect(discovered.observations[0].query.itemId).toBe(itemId);
    expect(fetch).toHaveBeenCalledTimes(1);
    const mutable = { itemId };
    const reserved = new ConfiguredShopeeAffiliate(
      { appId: 'synthetic', secret: 'synthetic' },
      fetch,
    );
    await permitted(
      () => reserved.queryOfferPage(mutable),
      () => {
        mutable.itemId = '1';
      },
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not bypass the configured LIVE gate for exact lookup', async () => {
    const fetch = vi.fn();
    const provider = new ConfiguredShopeeAffiliate(
      { appId: 'synthetic', secret: 'synthetic' },
      fetch,
    );
    expect(() => provider.queryOfferPage({ itemId })).toThrow(
      'SHOPEE_LIVE_AUTHORIZATION_REQUIRED',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
