import { AffiliateProviderService } from './application/affiliate-provider.service.js';
import type { AffiliateProviderAdapter } from './application/ports/affiliate-provider.port.js';
import {
  externalAffiliateKey,
  validateExternalAffiliateOffer,
  type AffiliateGeneratedLink,
  type AffiliateObservation,
  type ExternalAffiliateOffer,
} from './domain/affiliate-provider.js';

// Provider doubles only; no named second production adapter or operational data.
const observation = (providerId: string): AffiliateObservation => ({
  providerId,
  mode: 'FAKE',
  observedAt: null,
  sourceReference: null,
  fixtureVersion: 'FICTITIOUS_TEST_ONLY',
});
function offer(
  providerId = 'fixture_a',
  externalProductId = '9007199254740993',
): ExternalAffiliateOffer {
  return {
    schemaVersion: 'affiliate-external-offer/1.0.0',
    providerId,
    offerReference: 'opaque-offer',
    product: { externalProductId, name: null, description: null, url: null },
    store: { externalStoreId: null, name: null },
    price: { amount: '12345678901234567890.00100', currency: null },
    priceRange: {
      min: { amount: null, currency: null },
      max: { amount: null, currency: null },
    },
    estimatedCommission: {
      amount: null,
      currency: null,
      rate: null,
      classification: 'ESTIMATE',
    },
    availability: 'UNKNOWN',
    reportedAffiliateUrl: null,
    linkAssociationStatus: 'NOT_VERIFIED',
    mediaReferences: [],
    provenance: observation(providerId),
  };
}
const lookupDouble = (providerId: string): AffiliateProviderAdapter => ({
  providerId,
  capabilities: {
    offerLookup: { lookupProduct: async (id) => [offer(providerId, id)] },
  },
});

describe('neutral Affiliate capabilities', () => {
  it('consumes independent small ports without importing a Shopee class', async () => {
    const service = new AffiliateProviderService([
      lookupDouble('fixture_a'),
      lookupDouble('fixture_b'),
    ]);
    const a = await service.lookupProduct('fixture_a', 'same:opaque/id');
    const b = await service.lookupProduct('fixture_b', 'same:opaque/id');
    expect(a[0].product.externalProductId).toBe(b[0].product.externalProductId);
    expect(
      externalAffiliateKey(
        a[0].providerId,
        'PRODUCT',
        a[0].product.externalProductId,
      ),
    ).not.toBe(
      externalAffiliateKey(
        b[0].providerId,
        'PRODUCT',
        b[0].product.externalProductId,
      ),
    );
    expect(Object.isFrozen(a[0].price)).toBe(true);
  });

  it('does not collide entity kinds or delimiter-shaped external identities', () => {
    expect(externalAffiliateKey('fixture_a', 'PRODUCT', '123')).not.toBe(
      externalAffiliateKey('fixture_a', 'STORE', '123'),
    );
    expect(externalAffiliateKey('fixture_a', 'PRODUCT', 'x","y')).not.toBe(
      externalAffiliateKey('fixture_a', 'PRODUCT', 'x'),
    );
  });

  it('declares absent and future capabilities without manufacturing reports', async () => {
    const service = new AffiliateProviderService([
      { providerId: 'fixture_a', capabilities: {} },
    ]);
    expect(service.capabilities('fixture_a')).toEqual({
      offerLookup: false,
      linkGeneration: false,
      mediaReferences: false,
      conversions: false,
      realizedCommissions: false,
    });
    await expect(service.lookupProduct('fixture_a', '123')).rejects.toThrow(
      'AFFILIATE_CAPABILITY_UNSUPPORTED',
    );
    expect(() => service.mediaReferences('fixture_a', offer())).toThrow(
      'AFFILIATE_CAPABILITY_UNSUPPORTED',
    );
    expect(() => service.requireCapability('fixture_a', 'conversions')).toThrow(
      'AFFILIATE_CAPABILITY_UNSUPPORTED',
    );
    expect(() =>
      service.requireCapability('fixture_a', 'realizedCommissions'),
    ).toThrow('AFFILIATE_CAPABILITY_UNSUPPORTED');
    await expect(
      service.generateLink('fixture_a', {
        externalProductId: '123',
        offerReference: 'offer',
        originUrl: 'https://example.invalid/product',
      }),
    ).rejects.toThrow('AFFILIATE_CAPABILITY_UNSUPPORTED');
  });

  it('rejects duplicate or unknown provider bindings', () => {
    expect(
      () =>
        new AffiliateProviderService([
          lookupDouble('fixture_a'),
          lookupDouble('fixture_a'),
        ]),
    ).toThrow('AFFILIATE_PROVIDER_DUPLICATE');
    expect(() =>
      new AffiliateProviderService([]).capabilities('fixture_a'),
    ).toThrow('AFFILIATE_PROVIDER_NOT_FOUND');
  });

  it('rejects a declared capability without its operation', () => {
    expect(
      () =>
        new AffiliateProviderService([
          {
            providerId: 'fixture_a',
            capabilities: { offerLookup: {} as never },
          },
        ]),
    ).toThrow('AFFILIATE_PROVIDER_CAPABILITY_INVALID');
  });

  it('rejects a non-list lookup response without leaking provider data', async () => {
    const adapter: AffiliateProviderAdapter = {
      providerId: 'fixture_a',
      capabilities: {
        offerLookup: {
          lookupProduct: async () => ({ raw: 'PRIVATE_FIXTURE' }) as never,
        },
      },
    };
    await expect(
      new AffiliateProviderService([adapter]).lookupProduct('fixture_a', '123'),
    ).rejects.toThrow(/^AFFILIATE_PROVIDER_RESPONSE_INVALID$/);
  });

  it('keeps exact decimals, unknown values and zero distinct without permissions', async () => {
    const service = new AffiliateProviderService([lookupDouble('fixture_a')]);
    const [value] = await service.lookupProduct(
      'fixture_a',
      '9007199254740993',
    );
    expect(value.price.amount).toBe('12345678901234567890.00100');
    expect(value.estimatedCommission).toEqual({
      amount: null,
      currency: null,
      rate: null,
      classification: 'ESTIMATE',
    });
    expect(value.availability).toBe('UNKNOWN');
    expect(value.store.externalStoreId).toBeNull();
    const zero = offer();
    zero.price.amount = '0.00';
    expect(validateExternalAffiliateOffer(zero, 'fixture_a').price.amount).toBe(
      '0.00',
    );
    expect(value.linkAssociationStatus).toBe('NOT_VERIFIED');
  });

  it.each(['provider', 'product', 'provenance'])(
    'rejects a cross-provider or wrong-product response (%s)',
    async (field) => {
      const value = offer();
      if (field === 'provider') value.providerId = 'fixture_b';
      if (field === 'provenance') value.provenance.providerId = 'fixture_b';
      if (field === 'product') value.product.externalProductId = 'different';
      const adapter: AffiliateProviderAdapter = {
        providerId: 'fixture_a',
        capabilities: {
          offerLookup: { lookupProduct: async () => [value] },
        },
      };
      await expect(
        new AffiliateProviderService([adapter]).lookupProduct(
          'fixture_a',
          '9007199254740993',
        ),
      ).rejects.toThrow('AFFILIATE_PROVIDER_RESPONSE_INVALID');
    },
  );

  it.each([
    (v: ExternalAffiliateOffer) => {
      v.price.amount = 1.23 as never;
    },
    (v: ExternalAffiliateOffer) => {
      Object.assign(v.store, { externalStoreId: undefined });
    },
    (v: ExternalAffiliateOffer) => {
      v.estimatedCommission.rate = 'NaN';
    },
    (v: ExternalAffiliateOffer) => {
      v.estimatedCommission.classification = 'REALIZED' as never;
    },
    (v: ExternalAffiliateOffer) => {
      v.linkAssociationStatus = 'VERIFIED' as never;
    },
    (v: ExternalAffiliateOffer) => {
      v.product.url = 'javascript:invalid';
    },
    (v: ExternalAffiliateOffer) => {
      v.reportedAffiliateUrl = 'https://user:password@example.invalid/link';
    },
    (v: ExternalAffiliateOffer) => {
      v.provenance.observedAt = 'invalid-date';
    },
    (v: ExternalAffiliateOffer) => {
      Object.assign(v, { rawGraphql: { data: {} } });
    },
  ])(
    'rejects invalid facts or leaked provider payload instead of asserting eligibility',
    (patch) => {
      const value = offer();
      patch(value);
      expect(() => validateExternalAffiliateOffer(value, 'fixture_a')).toThrow(
        'AFFILIATE_PROVIDER_RESPONSE_INVALID',
      );
    },
  );

  it('keeps media references separate, immutable and free of implicit rights', () => {
    const value = offer();
    value.mediaReferences = [
      {
        providerId: 'fixture_a',
        externalProductId: value.product.externalProductId,
        kind: 'IMAGE',
        url: 'https://example.invalid/reference.png',
        rightsStatus: 'NOT_EVALUATED',
        evidenceReferences: [],
        provenance: observation('fixture_a'),
      },
    ];
    const references = vi.fn((v: ExternalAffiliateOffer) => v.mediaReferences);
    const service = new AffiliateProviderService([
      {
        providerId: 'fixture_a',
        capabilities: { mediaReferences: { getMediaReferences: references } },
      },
    ]);
    const result = service.mediaReferences('fixture_a', value);
    expect(result[0].rightsStatus).toBe('NOT_EVALUATED');
    expect(result[0].evidenceReferences).toEqual([]);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(references).toHaveBeenCalledTimes(1);
    value.mediaReferences[0].rightsStatus = 'GRANTED' as never;
    expect(() => service.mediaReferences('fixture_a', value)).toThrow(
      'AFFILIATE_PROVIDER_RESPONSE_INVALID',
    );
  });

  it('does not allow a media port to return another product or an unsafe URL', () => {
    for (const patch of [
      { externalProductId: 'other' },
      { url: 'javascript:invalid' },
    ]) {
      const service = new AffiliateProviderService([
        {
          providerId: 'fixture_a',
          capabilities: {
            mediaReferences: {
              getMediaReferences: () => [
                {
                  providerId: 'fixture_a',
                  externalProductId: '9007199254740993',
                  kind: 'IMAGE',
                  url: 'https://example.invalid/reference.png',
                  rightsStatus: 'NOT_EVALUATED',
                  evidenceReferences: [],
                  provenance: observation('fixture_a'),
                  ...patch,
                },
              ],
            },
          },
        },
      ]);
      expect(() => service.mediaReferences('fixture_a', offer())).toThrow(
        'AFFILIATE_PROVIDER_RESPONSE_INVALID',
      );
    }
  });

  it('snapshots link input and preserves subIds and unverified association independently', async () => {
    const generate = vi.fn(
      async (
        input: Parameters<
          NonNullable<
            AffiliateProviderAdapter['capabilities']['linkGeneration']
          >['generateLink']
        >[0],
      ): Promise<AffiliateGeneratedLink> => ({
        providerId: 'fixture_a',
        externalProductId: input.externalProductId,
        offerReference: input.offerReference,
        originUrl: input.originUrl,
        url: 'https://example.invalid/affiliate',
        subIds: input.subIds ?? null,
        associationVerified: false,
        evidenceReferences: [],
        provenance: observation('fixture_a'),
      }),
    );
    const service = new AffiliateProviderService([
      {
        providerId: 'fixture_a',
        capabilities: { linkGeneration: { generateLink: generate } },
      },
    ]);
    const input = {
      externalProductId: '123',
      offerReference: 'offer',
      originUrl: 'https://example.invalid/product',
      subIds: ['first'],
    };
    const pending = service.generateLink('fixture_a', input);
    input.subIds[0] = 'changed';
    const result = await pending;
    expect(result.subIds).toEqual(['first']);
    expect(result.associationVerified).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects invalid link input before invoking a capability', async () => {
    const generate = vi.fn();
    const service = new AffiliateProviderService([
      {
        providerId: 'fixture_a',
        capabilities: { linkGeneration: { generateLink: generate } },
      },
    ]);
    await expect(
      service.generateLink('fixture_a', {
        externalProductId: '123',
        offerReference: 'offer',
        originUrl: 'javascript:invalid',
      }),
    ).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
  });
});
