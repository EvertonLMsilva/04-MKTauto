import { createHash } from 'node:crypto';
import { ShopeeAffiliateLive } from './shopee-affiliate-live.js';
import { shopeeOfferFixture } from '../../../../test/support/shopee-offer-fixture.js';
import {
  buildShopeeOffersQuery,
  normalizeShopeeOfferPage,
} from './shopee-offers.js';

const at = '2026-10-15T12:00:00.000Z';
const request = { page: 1, limit: 2 };

describe('documented Shopee offers (offline only)', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw Error('REAL_NETWORK_FORBIDDEN');
      }),
    ),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normalizes exact decimals and identity without deriving currency, rights, stock or revenue', () => {
    const page = normalizeShopeeOfferPage(shopeeOfferFixture(), request, at);
    expect(page.offers[0]).toMatchObject({
      productId: '9007199254740993',
      shopId: '9007199254740995',
      name: 'Organizador sintético',
      shopName: 'Loja sintética',
      price: { amount: '12345678901234567890.00100', currency: null },
      priceRange: {
        min: { amount: '0.00001', currency: null },
        max: { amount: '12345678901234567890.00100', currency: null },
      },
      estimatedCommission: {
        amount: '0.00000001',
        currency: null,
        rate: '0.01234500',
      },
      discountPercent: 15,
      productUrl: 'https://example.invalid/product',
      affiliateUrl: 'https://example.invalid/offer',
      description: null,
      availability: null,
      provenance: {
        source: 'SHOPEE_LIVE',
        fixtureVersion: null,
        observedAt: at,
      },
    });
    for (const name of [
      'eligibilityStatus',
      'mediaRightsEvidence',
      'revenue',
      'affiliateAssociationEvidence',
    ])
      expect(page.offers[0]).not.toHaveProperty(name);
    expect(page.pageInfo).toEqual({
      page: 1,
      limit: 2,
      hasNextPage: true,
      nextPage: 2,
    });
  });

  it.each(['omitted', 'null'])(
    'preserves %s optional data as null instead of zero, empty strings or assertions',
    (state) => {
      const node: Record<string, unknown> = { itemId: '1' };
      if (state === 'null')
        for (const key of [
          'shopId',
          'productName',
          'shopName',
          'price',
          'priceMin',
          'priceMax',
          'commission',
          'commissionRate',
          'priceDiscountRate',
          'imageUrl',
          'productLink',
          'offerLink',
        ])
          node[key] = null;
      const body = {
        data: {
          productOfferV2: {
            nodes: [node],
            pageInfo: { page: null, limit: 2, hasNextPage: false },
          },
        },
      };
      const page = normalizeShopeeOfferPage(body, request, at);
      expect(page.offers[0]).toMatchObject({
        name: null,
        shopId: null,
        shopName: null,
        price: { amount: null, currency: null },
        priceRange: {
          min: { amount: null, currency: null },
          max: { amount: null, currency: null },
        },
        estimatedCommission: { amount: null, currency: null, rate: null },
        imageUrl: null,
        productUrl: null,
        affiliateUrl: null,
        discountPercent: null,
      });
      expect(page.pageInfo).toEqual({
        page: null,
        limit: 2,
        hasNextPage: false,
        nextPage: null,
      });
    },
  );

  it('keeps zero distinct from missing data and accepts nullable list entries by skipping them', () => {
    const body = shopeeOfferFixture();
    Object.assign(body.data.productOfferV2.nodes[0], {
      price: '0.00',
      commission: '0',
      commissionRate: '0',
      priceDiscountRate: 0,
    });
    (body.data.productOfferV2.nodes as unknown[]).push(null);
    expect(normalizeShopeeOfferPage(body, request, at).offers[0]).toMatchObject(
      {
        price: { amount: '0.00' },
        estimatedCommission: { amount: '0', rate: '0' },
        discountPercent: 0,
      },
    );
  });

  it('deduplicates identical identities and rejects conflicting duplicates', () => {
    const body = shopeeOfferFixture();
    body.data.productOfferV2.nodes.push(
      structuredClone(body.data.productOfferV2.nodes[0]),
    );
    expect(normalizeShopeeOfferPage(body, request, at).offers).toHaveLength(1);
    body.data.productOfferV2.nodes[1].price = '2.00';
    expect(() => normalizeShopeeOfferPage(body, request, at)).toThrow(
      'SHOPEE_OFFERS_DUPLICATE_CONFLICT',
    );
  });

  it('uses a static query and variables even for GraphQL-looking keyword text', () => {
    const keyword = 'organizador " } mutation { private }';
    const built = buildShopeeOffersQuery({
      page: 2,
      limit: 3,
      keyword,
      sortType: 2,
      productCatId: 100,
    });
    expect(built.query).not.toContain(keyword);
    expect(built.query).toContain(
      'productOfferV2(page: $page, limit: $limit, keyword: $keyword, sortType: $sortType, productCatId: $productCatId)',
    );
    expect(built.variables).toEqual({
      page: 2,
      limit: 3,
      keyword,
      sortType: 2,
      productCatId: 100,
    });
    expect(buildShopeeOffersQuery({}).variables).toEqual({
      page: 1,
      limit: 10,
    });
  });

  it.each([
    { page: 0 },
    { page: 101 },
    { limit: 0 },
    { limit: 11 },
    { limit: 1.1 },
    { keyword: 'a'.repeat(101) },
    { sortType: 6 },
    { productCatId: -1 },
    { query: 'mutation{}' },
    { variables: {} },
    { page: '1' },
    null,
  ])('rejects invalid local query inputs without exposing values', (input) => {
    expect(() => buildShopeeOffersQuery(input as never)).toThrow(
      /^SHOPEE_OFFERS_QUERY_INVALID$/,
    );
  });

  it.each([
    { page: 1, limit: 2, hasNextPage: true },
    { page: 100, limit: 2, hasNextPage: true },
    { page: 2, limit: 2, hasNextPage: true },
  ])('never loops or walks beyond the local page cap', (info) => {
    const body = shopeeOfferFixture();
    body.data.productOfferV2.pageInfo = info;
    const page = normalizeShopeeOfferPage(
      body,
      { page: info.page, limit: 2 },
      at,
    );
    expect(page.pageInfo.nextPage).toBe(
      info.page === 100 ? null : info.page + 1,
    );
  });

  it.each([
    { page: 2, limit: 2, hasNextPage: true },
    { page: 1, limit: 3, hasNextPage: true },
    { page: 1, limit: 2, hasNextPage: 'yes' },
    null,
  ])('rejects mismatched or malformed pagination', (info) => {
    const body = shopeeOfferFixture();
    Object.assign(body.data.productOfferV2, { pageInfo: info });
    expect(() => normalizeShopeeOfferPage(body, request, at)).toThrow(
      'SHOPEE_OFFERS_RESPONSE_INVALID',
    );
  });

  it.each([
    { price: 1.23 },
    { commission: 'NaN' },
    { commissionRate: '-0.01' },
    { priceDiscountRate: 101 },
    { shopId: 9007199254740992 },
    { imageUrl: 'javascript:alert(1)' },
    { productLink: 'https://user:pass@example.invalid' },
    { offerLink: 'https://example.invalid/?token=synthetic-secret' },
  ])('rejects invalid present fields safely', (patch) => {
    const body = shopeeOfferFixture();
    Object.assign(body.data.productOfferV2.nodes[0], patch);
    expect(() => normalizeShopeeOfferPage(body, request, at)).toThrow(
      /^SHOPEE_OFFERS_RESPONSE_INVALID$/,
    );
  });

  it('reuses transport signing/limits with one request and preserves numeric Int64 lexemes', async () => {
    const body = shopeeOfferFixture();
    const json = JSON.stringify(body)
      .replace('"9007199254740993"', '9007199254740993')
      .replace('"9007199254740995"', '9007199254740995');
    const fetch = vi.fn(async () => new Response(json));
    const live = new ShopeeAffiliateLive(
      { appId: '123456', secret: 'synthetic-only' },
      { fetch, now: () => Date.parse(at) },
    );
    const result = await live.queryOfferPage({ limit: 2, keyword: 'teste' });
    expect(result.offers[0].productId).toBe('9007199254740993');
    expect(result.offers[0].shopId).toBe('9007199254740995');
    const options = (
      fetch.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    const payload = options.body as string;
    expect(JSON.parse(payload).variables).toEqual({
      page: 1,
      limit: 2,
      keyword: 'teste',
    });
    const signature = createHash('sha256')
      .update(
        '123456' +
          String(Math.ceil(Date.parse(at) / 1000)) +
          payload +
          'synthetic-only',
        'utf8',
      )
      .digest('hex');
    expect(options.headers).toMatchObject({
      Authorization: `SHA256 Credential=123456, Timestamp=${Math.ceil(Date.parse(at) / 1000)}, Signature=${signature}`,
    });
    expect(options.redirect).toBe('manual');
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(live.queryOfferPage({ page: 2 })).rejects.toThrow(
      'SHOPEE_LIVE_ALREADY_ATTEMPTED',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(live.metadata())).not.toContain('synthetic-only');
  });

  it('discards partial data accompanied by GraphQL errors without exposing messages', async () => {
    const body = {
      ...shopeeOfferFixture(),
      errors: [
        { message: 'synthetic-sensitive-payload', extensions: { code: 11001 } },
      ],
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(body)));
    const live = new ShopeeAffiliateLive(
      { appId: '123456', secret: 'synthetic-only' },
      { fetch },
    );
    await expect(live.queryOfferPage({ limit: 2 })).rejects.toThrow(
      /^SHOPEE_LIVE_GRAPHQL_ERROR$/,
    );
    expect(live.metadata().offersReturned).toBeNull();
    expect(JSON.stringify(live.metadata())).not.toContain(
      'synthetic-sensitive-payload',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid input before dispatch and does not expose its payload', async () => {
    const fetch = vi.fn(async () => new Response('never used'));
    const live = new ShopeeAffiliateLive(
      { appId: '123456', secret: 'synthetic-only' },
      { fetch },
    );
    await expect(
      live.queryOfferPage({ query: 'synthetic-sensitive-payload' } as never),
    ).rejects.toThrow(/^SHOPEE_OFFERS_QUERY_INVALID$/);
    expect(fetch).not.toHaveBeenCalled();
    expect(live.metadata().requestCount).toBe(0);
  });

  it('decodes against the variables transmitted, even if the caller mutates its input while awaiting', async () => {
    const input = { page: 1, limit: 2 };
    const fetch = vi.fn(async () => {
      input.page = 99;
      input.limit = 10;
      return new Response(JSON.stringify(shopeeOfferFixture()));
    });
    const live = new ShopeeAffiliateLive(
      { appId: '123456', secret: 'synthetic-only' },
      { fetch },
    );
    const page = await live.queryOfferPage(input);
    expect(page.pageInfo).toMatchObject({ page: 1, limit: 2, nextPage: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
