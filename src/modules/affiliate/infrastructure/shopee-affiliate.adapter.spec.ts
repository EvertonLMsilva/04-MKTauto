import { Test } from '@nestjs/testing';
import { AffiliateProviderService } from '../application/affiliate-provider.service.js';
import { AFFILIATE_PROVIDER_ADAPTERS } from '../application/ports/affiliate-provider.port.js';
import { SHOPEE_AFFILIATE } from '../application/ports/shopee-affiliate.port.js';
import type { AffiliateLinkInput } from '../domain/affiliate-provider.js';
import {
  ConfiguredShopeeAffiliate,
  FakeShopeeAffiliate,
  withShopeeLiveAuthorization,
} from './shopee-affiliate.provider.js';
import {
  ShopeeAffiliateAdapter,
  shopeeAffiliateAdapterProvider,
} from './shopee-affiliate.adapter.js';

// All responses and credentials below are synthetic. No remote data is evidence.
const fakeItemId = '9007199254740993';
const itemId = '23792533191';
const originUrl = `https://shopee.com.br/product/7/${itemId}`;
const liveNode = (id = itemId) => ({
  itemId: id,
  shopId: '7',
  productName: 'FICTITIOUS_TEST_ONLY',
  shopName: 'FICTITIOUS_TEST_ONLY',
  price: '12345678901234567890.00100',
  priceMin: '0.00000001',
  priceMax: '12345678901234567890.00100',
  commission: '0.00000001',
  commissionRate: '0.01234500',
  imageUrl: 'https://example.invalid/controlled.png',
  productLink: `https://shopee.com.br/product/7/${id}`,
  offerLink: 'https://s.shopee.com.br/FICTITIOUS_TEST_ONLY',
});
const page = (nodes: unknown[] = [liveNode()]) => ({
  data: {
    productOfferV2: {
      nodes,
      pageInfo: { page: 1, limit: 1, hasNextPage: false },
    },
  },
});
const configured = (body: unknown) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(body));
  const source = new ConfiguredShopeeAffiliate(
    { appId: 'synthetic-app', secret: 'synthetic-secret' },
    fetch,
  );
  return { fetch, source, adapter: new ShopeeAffiliateAdapter(source) };
};
const permitted = <T>(run: () => Promise<T>, reserve = vi.fn()) =>
  withShopeeLiveAuthorization(
    {
      mode: 'SHOPEE_LIVE',
      expiresAt: '2100-01-01T00:00:00Z',
      maxOfferPages: 1,
      maxLinks: 1,
      reserve,
    },
    run,
  );
const linkInput = (): AffiliateLinkInput => ({
  externalProductId: itemId,
  offerReference: `shopee-item-${itemId}`,
  originUrl,
  subIds: ['FICTITIOUS_TEST_ONLY'],
});

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

describe('Shopee provider adapter (offline)', () => {
  it('wires the existing Shopee token to the generic Nest consumer without effects', async () => {
    const source = new FakeShopeeAffiliate();
    const module = await Test.createTestingModule({
      providers: [
        { provide: SHOPEE_AFFILIATE, useValue: source },
        shopeeAffiliateAdapterProvider,
        AffiliateProviderService,
      ],
    }).compile();
    try {
      const adapters = module.get(AFFILIATE_PROVIDER_ADAPTERS);
      expect(adapters).toHaveLength(1);
      expect(adapters[0]).toBeInstanceOf(ShopeeAffiliateAdapter);
      const service = module.get(AffiliateProviderService);
      expect(service.capabilities('shopee')).toEqual({
        offerLookup: true,
        linkGeneration: true,
        mediaReferences: true,
        conversions: false,
        realizedCommissions: false,
      });
      expect(() => service.requireCapability('shopee', 'conversions')).toThrow(
        'AFFILIATE_CAPABILITY_UNSUPPORTED',
      );
      expect(() =>
        service.requireCapability('shopee', 'realizedCommissions'),
      ).toThrow('AFFILIATE_CAPABILITY_UNSUPPORTED');
      expect(
        (await service.lookupProduct('shopee', fakeItemId))[0].providerId,
      ).toBe('shopee');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('maps FAKE values and media references without granting rights or querying twice', async () => {
    const source = new FakeShopeeAffiliate();
    const query = vi.spyOn(source, 'queryOfferPage');
    const adapter = new ShopeeAffiliateAdapter(source);
    const [offer] = await adapter.lookupProduct(fakeItemId);
    expect(query).toHaveBeenCalledExactlyOnceWith({
      itemId: fakeItemId,
      page: 1,
      limit: 1,
    });
    expect(offer).toMatchObject({
      schemaVersion: 'affiliate-external-offer/1.0.0',
      providerId: 'shopee',
      offerReference: 'fake-offer-001',
      product: { externalProductId: fakeItemId, description: null },
      store: {
        externalStoreId: '9007199254740991',
        name: 'Synthetic fixture shop',
      },
      price: { amount: '9007199254740993.01', currency: 'BRL' },
      estimatedCommission: {
        amount: '0.000001',
        rate: '0.012345',
        classification: 'ESTIMATE',
      },
      availability: 'UNKNOWN',
      reportedAffiliateUrl:
        'https://shopee-affiliate.invalid/link/fake-offer-001',
      linkAssociationStatus: 'NOT_VERIFIED',
      provenance: {
        providerId: 'shopee',
        mode: 'FAKE',
        observedAt: null,
        sourceReference: null,
        fixtureVersion: 'shopee-affiliate-fake/1',
      },
    });
    expect(adapter.getMediaReferences(offer)).toEqual([
      {
        providerId: 'shopee',
        externalProductId: fakeItemId,
        kind: 'IMAGE',
        url: 'https://shopee-affiliate.invalid/fixture/image-001.png',
        rightsStatus: 'NOT_EVALUATED',
        evidenceReferences: [],
        provenance: offer.provenance,
      },
    ]);
    expect(Object.isFrozen(offer)).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not manufacture a target product missing from the existing FAKE catalog', async () => {
    const adapter = new ShopeeAffiliateAdapter(new FakeShopeeAffiliate());
    expect(await adapter.lookupProduct(itemId)).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('maps a controlled LIVE response with exact decimals and one existing transport call', async () => {
    const s = configured(page());
    const [offer] = await permitted(() => s.adapter.lookupProduct(itemId));
    expect(offer).toMatchObject({
      providerId: 'shopee',
      product: { externalProductId: itemId, url: originUrl },
      price: { amount: '12345678901234567890.00100', currency: null },
      priceRange: { min: { amount: '0.00000001', currency: null } },
      estimatedCommission: {
        amount: '0.00000001',
        rate: '0.01234500',
        currency: null,
        classification: 'ESTIMATE',
      },
      availability: 'UNKNOWN',
      linkAssociationStatus: 'NOT_VERIFIED',
      provenance: {
        providerId: 'shopee',
        mode: 'LIVE',
        fixtureVersion: null,
        sourceReference: null,
      },
    });
    expect(offer.provenance.observedAt).toEqual(expect.any(String));
    expect(s.adapter.getMediaReferences(offer)).toHaveLength(1);
    expect(s.fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(s.fetch.mock.calls[0][1]!.body as string);
    expect(payload.variables).toEqual({ page: 1, limit: 1 });
    expect(payload.query).toContain(`productOfferV2(itemId: ${itemId},`);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves absent observations as unknown instead of inferring business facts', async () => {
    const s = configured(page([{ itemId }]));
    const [offer] = await permitted(() => s.adapter.lookupProduct(itemId));
    expect(offer).toMatchObject({
      product: {
        externalProductId: itemId,
        name: null,
        description: null,
        url: null,
      },
      store: { externalStoreId: null, name: null },
      price: { amount: null, currency: null },
      priceRange: {
        min: { amount: null, currency: null },
        max: { amount: null, currency: null },
      },
      estimatedCommission: {
        amount: null,
        rate: null,
        currency: null,
        classification: 'ESTIMATE',
      },
      availability: 'UNKNOWN',
      reportedAffiliateUrl: null,
      mediaReferences: [],
    });
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it('binds product identity even when an injected source violates its port contract', async () => {
    const source = new FakeShopeeAffiliate();
    const [wrong] = await source.queryOffers();
    vi.spyOn(source, 'queryOfferPage').mockResolvedValue({
      offers: [wrong],
      pageInfo: { page: 1, limit: 1, hasNextPage: false, nextPage: null },
    });
    await expect(
      new ShopeeAffiliateAdapter(source).lookupProduct(itemId),
    ).rejects.toThrow('AFFILIATE_PROVIDER_RESPONSE_INVALID');
  });

  it.each(['0', '01', '9223372036854775808', '1) mutation { x', 23792533191])(
    'rejects an invalid lookup identity before delegation: %s',
    async (id) => {
      const source = new FakeShopeeAffiliate();
      const query = vi.spyOn(source, 'queryOfferPage');
      await expect(
        new ShopeeAffiliateAdapter(source).lookupProduct(id as string),
      ).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('generates a FAKE link through the existing source with no association evidence', async () => {
    const source = new FakeShopeeAffiliate();
    const generate = vi.spyOn(source, 'generateLink');
    const adapter = new ShopeeAffiliateAdapter(source);
    const [offer] = await adapter.lookupProduct(fakeItemId);
    const input = {
      externalProductId: fakeItemId,
      offerReference: offer.offerReference,
      originUrl: offer.product.url!,
      subIds: ['FICTITIOUS_TEST_ONLY'],
    };
    const pending = adapter.generateLink(input);
    input.subIds.push('later');
    const link = await pending;
    expect(generate).toHaveBeenCalledExactlyOnceWith({
      offerId: offer.offerReference,
      originUrl: offer.product.url,
      subIds: ['FICTITIOUS_TEST_ONLY'],
    });
    expect(link).toMatchObject({
      providerId: 'shopee',
      externalProductId: fakeItemId,
      offerReference: offer.offerReference,
      originUrl: offer.product.url,
      url: 'https://shopee-affiliate.invalid/link/fake-offer-001',
      associationVerified: false,
      evidenceReferences: [],
      subIds: ['FICTITIOUS_TEST_ONLY'],
      provenance: { mode: 'FAKE', sourceReference: null },
    });
    expect(Object.isFrozen(link.subIds)).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    `https://shopee.com.br/product/7/23792533192`,
    'https://s.shopee.com.br/FICTITIOUS_TEST_ONLY',
    `https://example.invalid/product/7/${itemId}`,
    `http://shopee.com.br/product/7/${itemId}`,
    `${originUrl}?token=synthetic-secret`,
  ])(
    'rejects an origin that does not canonically identify the product: %s',
    async (url) => {
      const source = new FakeShopeeAffiliate();
      const generate = vi.spyOn(source, 'generateLink');
      await expect(
        new ShopeeAffiliateAdapter(source).generateLink({
          ...linkInput(),
          originUrl: url,
        }),
      ).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it('preserves the existing LIVE permit and does not reserve or request an invalid link', async () => {
    const s = configured(page());
    await expect(s.adapter.lookupProduct(itemId)).rejects.toThrow(
      'SHOPEE_LIVE_AUTHORIZATION_REQUIRED',
    );
    await expect(s.adapter.generateLink(linkInput())).rejects.toThrow(
      'SHOPEE_LIVE_AUTHORIZATION_REQUIRED',
    );
    const reserve = vi.fn();
    await permitted(async () => {
      await expect(
        s.adapter.generateLink({ ...linkInput(), originUrl: `${originUrl}0` }),
      ).rejects.toThrow();
    }, reserve);
    expect(reserve).not.toHaveBeenCalled();
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('maps a controlled LIVE generated link without treating it as verified attribution', async () => {
    const s = configured({
      data: {
        generateShortLink: {
          shortLink: 'https://s.shopee.com.br/FICTITIOUS_TEST_ONLY',
        },
      },
    });
    const link = await permitted(() => s.adapter.generateLink(linkInput()));
    expect(link).toMatchObject({
      providerId: 'shopee',
      externalProductId: itemId,
      offerReference: `shopee-item-${itemId}`,
      originUrl,
      associationVerified: false,
      evidenceReferences: [],
      provenance: { mode: 'LIVE', fixtureVersion: null, sourceReference: null },
    });
    expect(s.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not extract references from a different provider', async () => {
    const adapter = new ShopeeAffiliateAdapter(new FakeShopeeAffiliate());
    const [offer] = await adapter.lookupProduct(fakeItemId);
    expect(() =>
      adapter.getMediaReferences({ ...offer, providerId: 'other' }),
    ).toThrow('AFFILIATE_PROVIDER_RESPONSE_INVALID');
  });

  it('validates a generated link even when an injected source returns an unsafe URL', async () => {
    const source = new FakeShopeeAffiliate();
    const input = {
      externalProductId: fakeItemId,
      offerReference: 'fake-offer-001',
      originUrl: `https://shopee.com.br/product/9007199254740991/${fakeItemId}`,
    };
    const valid = await source.generateLink({
      offerId: input.offerReference,
      originUrl: input.originUrl,
    });
    vi.spyOn(source, 'generateLink').mockResolvedValue({
      ...valid,
      url: 'javascript:invalid',
    });
    await expect(
      new ShopeeAffiliateAdapter(source).generateLink(input),
    ).rejects.toThrow('AFFILIATE_PROVIDER_RESPONSE_INVALID');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
