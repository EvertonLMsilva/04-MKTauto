import {
  affiliateHash,
  type AffiliateCampaign,
  type AffiliateProduct,
} from './domain/affiliate-contracts.js';
import type { AffiliateCampaignSourceV1 } from './domain/affiliate-campaign-source.js';
import {
  evaluateCommercialImageReadiness,
  type CommercialImageReadinessInput,
} from './domain/commercial-image-readiness.js';
import { CommercialImageReferenceHandoffService } from './application/commercial-image-reference-handoff.service.js';
import { validateCommercialImageReferenceHandoffInput } from './domain/commercial-image-reference-handoff.js';

const at = '2026-11-12T12:00:00Z',
  hash = 'a'.repeat(64),
  mediaRef = 'media:product_018';
function fixture() {
  const spec = {
    id: 'ev_spec',
    kind: 'PRODUCT_SPECIFICATION' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:spec',
    recordedAt: at,
  };
  const grant = {
    id: 'ev_rights',
    kind: 'MEDIA_USAGE_RIGHT' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:license',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef,
      contentHash: hash,
      commercialUse: 'GRANTED' as const,
      processing: 'GRANTED' as const,
      localProcessing: true,
      externalProviders: ['openai'],
    },
  };
  const product: AffiliateProduct = {
    schemaVersion: 'affiliate-product/2.0.0',
    productId: 'shopee_118002',
    revision: 1,
    name: 'FICTITIOUS_TEST_ONLY Product',
    brand: {
      status: 'KNOWN',
      name: 'FICTITIOUS_TEST_ONLY Brand',
      evidenceRef: spec.id,
    },
    attributes: [{ name: 'color', value: 'blue', evidenceRef: spec.id }],
    media: [{ mediaRef, evidenceRef: grant.id }],
    evidence: [spec, structuredClone(grant)],
    localImage: {
      mediaReference: mediaRef,
      contentHash: hash,
      origin: 'AUTHORIZED_THIRD_PARTY',
      provider: null,
      rights: {
        usageBasis: 'LICENSED',
        commercialUseAllowed: true,
        evidence: [structuredClone(grant)],
      },
    },
  };
  const campaign: AffiliateCampaign = {
    schemaVersion: 'affiliate-campaign/1.0.0',
    campaignId: 'campaign_018',
    revision: 1,
    projectId: 'project_018',
    productId: product.productId,
    productRevision: 1,
    affiliateUrl: 'https://s.shopee.com.br/FICTITIOUS_TEST_ONLY',
    cta: 'Veja os detalhes.',
    disclosure: 'Publicidade. Posso receber comissão.',
  };
  const source: AffiliateCampaignSourceV1 = {
    schemaVersion: 'affiliate-campaign-source/1.0.0',
    sourceId: 'source_018',
    revision: 1,
    source: 'SHOPEE_AFFILIATE_API',
    offer: {
      offerId: 'offer_118002',
      productId: '118002',
      shopId: '718003',
      provenance: {
        source: 'SHOPEE_LIVE',
        fixtureVersion: null,
        observedAt: at,
      },
    },
    productId: product.productId,
    productRevision: 1,
    campaignId: campaign.campaignId,
    campaignRevision: 1,
    briefingId: null,
    affiliateUrl: campaign.affiliateUrl,
  };
  const reference: CommercialImageReadinessInput = {
    schemaVersion: 'commercial-image-readiness/1.0.0',
    product: { productId: product.productId, revision: 1 },
    campaign: { campaignId: campaign.campaignId, revision: 1 },
    source: { sourceId: source.sourceId, revision: 1 },
    media: { mediaRef, contentHash: hash },
    provider: 'openai',
    purpose: 'GENERATION_REFERENCE',
    evidenceRefs: ['ev_spec', 'ev_rights'],
  };
  const input = {
    schemaVersion: 'commercial-image-reference-handoff/1.0.0' as const,
    reference,
  };
  const context = {
    product,
    campaign,
    source,
    productCurrent: true,
    campaignCurrent: true,
    physical: {
      status: 'VERIFIED' as const,
      reason: null,
      contentHash: hash,
      sizeBytes: 100,
    },
  };
  const evaluate = vi.fn(async (raw: unknown) =>
    evaluateCommercialImageReadiness(raw, context),
  );
  return {
    input,
    context,
    evaluate,
    service: new CommercialImageReferenceHandoffService({ evaluate }),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
});

test('builds a versioned reference exclusively from C-017, preserving identities, documentary characteristics and the physical hash', async () => {
  const f = fixture(),
    prepared = await f.service.prepare(f.input);
  expect(f.evaluate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining(f.input.reference),
  );
  expect(prepared.schemaVersion).toBe(
    'commercial-image-reference-handoff/1.0.0',
  );
  expect(prepared.status).toBe('PREPARED_DOCUMENTARY_ONLY');
  expect(prepared.reference).toMatchObject({
    product: {
      productId: 'shopee_118002',
      revision: 1,
      name: f.context.product.name,
    },
    campaign: { campaignId: 'campaign_018', revision: 1 },
    media: { mediaReference: mediaRef, contentHash: hash },
    source: {
      status: 'DOCUMENTARILY_BOUND',
      offerId: 'offer_118002',
      externalProductId: '118002',
      shopId: '718003',
    },
    provider: 'openai',
  });
  expect(prepared.reference.product.brand).toEqual({
    name: 'FICTITIOUS_TEST_ONLY Brand',
    evidenceRef: 'ev_spec',
  });
  expect(prepared.reference.product.attributes).toEqual(
    f.context.product.attributes,
  );
  expect(prepared.rights).toMatchObject({
    localProcessing: 'DOCUMENTED',
    openaiProcessing: 'DOCUMENTED',
    kairogenProcessing: 'MISSING',
  });
  expect(prepared.physicalEvidence.status).toBe('VERIFIED');
  expect(prepared).toMatchObject({
    uploadAuthorized: false,
    generationAuthorized: false,
    publicationAuthorized: false,
    visualReviewRequired: true,
    revalidationRequiredBeforeUpload: true,
  });
  expect(prepared.unknownFacts).toEqual(
    expect.arrayContaining([
      'price',
      'discount',
      'packaging',
      'generatedOutputFidelity',
    ]),
  );
});

test.each([
  'archived',
  'stale',
  'physicalHash',
  'missingImage',
  'fake',
  'externalRight',
  'anotherCampaign',
  'anotherProduct',
  'invalidEvidence',
])('preserves the canonical C-017 refusal for %s', async (kind) => {
  const f = fixture();
  if (kind === 'archived') f.context.product.status = 'ARCHIVED';
  if (kind === 'stale') f.context.productCurrent = false;
  if (kind === 'physicalHash')
    Object.assign(f.context.physical, {
      status: 'INVALID',
      reason: 'LOCAL_IMAGE_HASH_MISMATCH',
      contentHash: null,
    });
  if (kind === 'missingImage')
    Object.assign(f.context.physical, {
      status: 'PENDING',
      reason: 'LOCAL_IMAGE_UNAVAILABLE_OR_INVALID',
      contentHash: null,
    });
  if (kind === 'fake')
    f.context.source.offer.provenance = {
      source: 'FAKE',
      fixtureVersion: 'shopee-affiliate-fake/1',
      observedAt: null,
    };
  if (kind === 'externalRight') f.input.reference.provider = 'kairogen';
  if (kind === 'anotherCampaign')
    f.context.source.campaignId = 'another_campaign';
  if (kind === 'anotherProduct') f.context.source.productId = 'another_product';
  if (kind === 'invalidEvidence')
    f.input.reference.evidenceRefs = ['unbound_evidence'];
  const result = await f.service.prepare(f.input);
  expect(result.status).toBe(kind === 'fake' ? 'FAKE_ONLY' : 'BLOCKED');
  expect(result.blockers.length).toBeGreaterThan(0);
  expect(result.uploadAuthorized).toBe(false);
  expect(result.visualReviewRequired).toBe(true);
});

test('unknown source/offer and campaign remain UNKNOWN instead of inventing commerce facts', async () => {
  const f = fixture();
  f.input.reference.source = null;
  f.input.reference.campaign = null;
  const result = await f.service.prepare(f.input);
  expect(result.reference.campaign).toBeNull();
  expect(result.reference.source).toMatchObject({
    status: 'UNKNOWN',
    offerId: null,
    externalProductId: null,
    shopId: null,
  });
  expect(result.unknownFacts).toContain('price');
});

test.each([
  'productRevision',
  'offerRevision',
  'mediaHash',
  'provider',
  'shop',
])(
  'changes reference identity for a different %s and rejects the old preparation hash',
  async (kind) => {
    const f = fixture(),
      original = await f.service.prepare(f.input);
    if (kind === 'productRevision') {
      f.input.reference.product.revision = 2;
      f.context.product.revision = 2;
      f.context.campaign.productRevision = 2;
      f.context.source.productRevision = 2;
    }
    if (kind === 'offerRevision') {
      f.input.reference.campaign!.revision = 2;
      f.context.campaign.revision = 2;
      f.context.source.campaignRevision = 2;
    }
    if (kind === 'mediaHash') {
      f.input.reference.media.contentHash = 'b'.repeat(64);
    }
    if (kind === 'provider') f.input.reference.provider = 'kairogen';
    if (kind === 'shop') f.context.source.offer.shopId = '718999';
    const changed = await f.service.prepare(f.input);
    expect(changed.referenceHash).not.toBe(original.referenceHash);
    expect(changed.preparationHash).not.toBe(original.preparationHash);
    await expect(
      f.service.revalidate(f.input, original.preparationHash),
    ).rejects.toThrow('COMMERCIAL_IMAGE_REFERENCE_CONFLICT');
  },
);

test('replay is immutable, deterministic and always re-reads C-017, even when the hash matches', async () => {
  const f = fixture(),
    before = affiliateHash(f.input),
    one = await f.service.prepare(f.input);
  const two = await f.service.prepare({
    ...f.input,
    expectedPreparationHash: one.preparationHash,
  });
  expect(two).toEqual(one);
  expect(await f.service.revalidate(f.input, one.preparationHash)).toEqual(one);
  expect(f.evaluate).toHaveBeenCalledTimes(3);
  expect(affiliateHash(f.input)).toBe(before);
  expect(Object.isFrozen(one.reference.product.attributes)).toBe(true);
  expect(one.uploadAuthorized).toBe(false);
});

test('projects evidence IDs/hashes without exposing private document URLs, paths, bytes or credentials', async () => {
  const f = fixture();
  const privateDocument =
    'https://private.invalid/license?access_token=FICTITIOUS_PRIVATE_TOKEN';
  f.context.product.evidence[0].sourceRef = privateDocument;
  const result = await f.service.prepare(f.input),
    serialized = JSON.stringify(result);
  expect(serialized).not.toContain(privateDocument);
  expect(serialized).not.toContain('FICTITIOUS_PRIVATE_TOKEN');
  expect(serialized).not.toContain('https://');
  expect(result.reference.evidence[0]).toMatchObject({
    id: 'ev_spec',
    kind: 'PRODUCT_SPECIFICATION',
    documentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  for (const key of [
    'bytes',
    'base64',
    'credentials',
    'sourceRef',
    'path',
    'url',
  ])
    expect(result).not.toHaveProperty(key);
});

test.each(['http', 'file', 'data', 'path'])(
  'rejects a %s media reference rather than serializing a private URL, file or image payload',
  (kind) => {
    const f = fixture();
    f.input.reference.media.mediaRef =
      kind === 'http'
        ? 'https://private.invalid/image?token=PRIVATE'
        : kind === 'file'
          ? 'file:///private/image.png'
          : kind === 'data'
            ? 'data:image/png;base64,PRIVATE'
            : 'D:\\private\\image.png';
    expect(() => validateCommercialImageReferenceHandoffInput(f.input)).toThrow(
      'COMMERCIAL_IMAGE_REFERENCE_INPUT_INVALID',
    );
  },
);

test.each(['root', 'nested', 'hash'])(
  'rejects unknown fields or invalid expected hash: %s',
  async (kind) => {
    const f = fixture(),
      raw: Record<string, unknown> = structuredClone(f.input);
    if (kind === 'root') raw.credentials = { secret: 'PRIVATE' };
    if (kind === 'nested')
      Object.assign(raw.reference as object, { uploadAuthorized: true });
    if (kind === 'hash') raw.expectedPreparationHash = 'invalid';
    await expect(f.service.prepare(raw)).rejects.toThrow();
    expect(f.evaluate).not.toHaveBeenCalled();
  },
);

test('rejects a canonical report for another request, a tampered report hash, or unsafe business metadata', async () => {
  const f = fixture(),
    report = await f.evaluate(f.input.reference);
  const wrong = new CommercialImageReferenceHandoffService({
    evaluate: vi.fn(async () => report),
  });
  await expect(
    wrong.prepare({
      ...f.input,
      reference: { ...f.input.reference, provider: 'kairogen' },
    }),
  ).rejects.toThrow('COMMERCIAL_IMAGE_REFERENCE_READINESS_MISMATCH');
  const damaged = new CommercialImageReferenceHandoffService({
    evaluate: vi.fn(async () => ({ ...report, reportHash: '0'.repeat(64) })),
  });
  await expect(damaged.prepare(f.input)).rejects.toThrow(
    'COMMERCIAL_IMAGE_REFERENCE_READINESS_MISMATCH',
  );
  f.context.product.name =
    'Product https://private.invalid/reference?token=PRIVATE';
  await expect(f.service.prepare(f.input)).rejects.toThrow(
    'COMMERCIAL_IMAGE_REFERENCE_PRIVATE_METADATA_FORBIDDEN',
  );
});
