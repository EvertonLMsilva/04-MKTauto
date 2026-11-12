import {
  affiliateHash,
  type AffiliateCampaign,
  type AffiliateProduct,
} from './domain/affiliate-contracts.js';
import type { AffiliateCampaignSourceV1 } from './domain/affiliate-campaign-source.js';
import {
  evaluateCommercialImageReadiness,
  validateCommercialImageReadinessInput,
  type CommercialImageReadinessInput,
} from './domain/commercial-image-readiness.js';

const at = '2026-11-12T12:00:00Z',
  hash = 'a'.repeat(64),
  mediaRef = 'media:product_017';
function fixture() {
  // All documentary grants here are FICTITIOUS_TEST_ONLY, never real approvals.
  const spec = {
    id: 'ev_spec',
    kind: 'PRODUCT_SPECIFICATION' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:spec',
    recordedAt: at,
  };
  const right = {
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
      externalProviders: ['openai', 'kairogen'],
    },
  };
  const product: AffiliateProduct = {
    schemaVersion: 'affiliate-product/2.0.0',
    productId: 'shopee_117002',
    revision: 1,
    name: 'FICTITIOUS_TEST_ONLY Product',
    brand: {
      status: 'KNOWN',
      name: 'FICTITIOUS_TEST_ONLY Brand',
      evidenceRef: spec.id,
    },
    attributes: [{ name: 'color', value: 'blue', evidenceRef: spec.id }],
    media: [{ mediaRef, evidenceRef: right.id }],
    evidence: [spec, structuredClone(right)],
    localImage: {
      mediaReference: mediaRef,
      contentHash: hash,
      origin: 'AUTHORIZED_THIRD_PARTY',
      provider: null,
      rights: {
        usageBasis: 'LICENSED',
        commercialUseAllowed: true,
        evidence: [structuredClone(right)],
      },
    },
  };
  const campaign: AffiliateCampaign = {
    schemaVersion: 'affiliate-campaign/1.0.0',
    campaignId: 'campaign_017',
    revision: 1,
    projectId: 'project_017',
    productId: product.productId,
    productRevision: 1,
    affiliateUrl: 'https://s.shopee.com.br/FICTITIOUS_TEST_ONLY',
    cta: 'Veja os detalhes.',
    disclosure: 'Publicidade. Posso receber comissão.',
  };
  const source: AffiliateCampaignSourceV1 = {
    schemaVersion: 'affiliate-campaign-source/1.0.0',
    sourceId: 'source_017',
    revision: 1,
    source: 'SHOPEE_AFFILIATE_API',
    offer: {
      offerId: 'offer_117002',
      productId: '117002',
      shopId: '717003',
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
  const input: CommercialImageReadinessInput = {
    schemaVersion: 'commercial-image-readiness/1.0.0',
    product: { productId: product.productId, revision: 1 },
    campaign: { campaignId: campaign.campaignId, revision: 1 },
    source: { sourceId: source.sourceId, revision: 1 },
    media: { mediaRef, contentHash: hash },
    provider: 'openai',
    purpose: 'GENERATION_REFERENCE',
    evidenceRefs: ['ev_spec', 'ev_rights'],
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
  const rights = () => [
    product.evidence.find((e) => e.kind === 'MEDIA_USAGE_RIGHT')!
      .mediaAuthorization!,
    product.localImage!.rights.evidence![0].mediaAuthorization!,
  ];
  return {
    input,
    context,
    rights,
    assess: () => evaluateCommercialImageReadiness(input, context),
  };
}

test('binds the exact documented image, product/shop, name, brand, attributes and offer revision without approving execution', () => {
  const f = fixture(),
    result = f.assess();
  expect(result.schemaVersion).toBe('commercial-image-readiness/1.0.0');
  expect(result.eligibility).toBe('DOCUMENTARILY_ELIGIBLE');
  expect(result.binding).toMatchObject({
    productId: 'shopee_117002',
    productRevision: 1,
    campaignId: 'campaign_017',
    campaignRevision: 1,
    mediaRef,
    contentHash: hash,
    shopId: '717003',
    externalProductId: '117002',
    offerId: 'offer_117002',
  });
  expect(result.fidelity).toMatchObject({
    productName: f.context.product.name,
    brand: { name: 'FICTITIOUS_TEST_ONLY Brand', evidenceRef: 'ev_spec' },
    attributes: f.context.product.attributes,
    originalImage: { mediaReference: mediaRef, contentHash: hash },
  });
  expect(result.rights).toMatchObject({
    localProcessing: 'DOCUMENTED',
    openaiProcessing: 'DOCUMENTED',
    kairogenProcessing: 'DOCUMENTED',
    commercialSourceUse: 'DOCUMENTED',
  });
  expect(result).toMatchObject({
    visualReviewRequired: true,
    generatedOutputFidelityVerified: false,
    generatedOutputRightsVerified: false,
    processingAuthorized: false,
    publicationAuthorized: false,
    externalRightsVerified: false,
  });
  expect(result.reviewRequirements).toContain('EXACT_OUTPUT_VISUAL_REVIEW');
});

test.each([
  'archived',
  'evidence',
  'image',
  'media',
  'hash',
  'campaign',
  'productRevision',
  'campaignRevision',
  'source',
])('blocks invalid or stale %s bindings', (kind) => {
  const f = fixture();
  if (kind === 'archived') f.context.product.status = 'ARCHIVED';
  if (kind === 'evidence') f.context.product.evidence = [];
  if (kind === 'image') delete f.context.product.localImage;
  if (kind === 'media') f.input.media.mediaRef = 'another_image';
  if (kind === 'hash') f.input.media.contentHash = 'b'.repeat(64);
  if (kind === 'campaign') f.context.campaign.productRevision = 2;
  if (kind === 'productRevision') f.context.productCurrent = false;
  if (kind === 'campaignRevision') f.context.campaignCurrent = false;
  if (kind === 'source') f.context.source.productRevision = 2;
  const result = f.assess();
  expect(result.eligibility).toBe('BLOCKED');
  expect(result.blockers.length).toBeGreaterThan(0);
  expect(result.visualReviewRequired).toBe(true);
});

test.each(['openai', 'kairogen'] as const)(
  'local commercial permission does not allow transfer to %s',
  (provider) => {
    const f = fixture();
    f.input.provider = provider;
    f.rights().forEach((grant) => {
      grant.externalProviders = [];
    });
    const result = f.assess();
    expect(result.rights.localProcessing).toBe('DOCUMENTED');
    expect(result.rights.commercialSourceUse).toBe('DOCUMENTED');
    expect(result.rights.openaiProcessing).toBe('MISSING');
    expect(result.rights.kairogenProcessing).toBe('MISSING');
    expect(result.eligibility).toBe('BLOCKED');
    expect(result.missingPermissions).toContain(
      provider === 'openai'
        ? 'OPENAI_REFERENCE_TRANSFER_REQUIRED'
        : 'KAIROGEN_REFERENCE_TRANSFER_REQUIRED',
    );
  },
);

test('a grant for OpenAI does not authorize Kairogen', () => {
  const f = fixture();
  f.input.provider = 'kairogen';
  f.rights().forEach((grant) => {
    grant.externalProviders = ['openai'];
  });
  const result = f.assess();
  expect(result.rights.openaiProcessing).toBe('DOCUMENTED');
  expect(result.rights.kairogenProcessing).toBe('MISSING');
  expect(result.eligibility).toBe('BLOCKED');
});

test('a video reference requires its exact provider and still requires visual/output-rights review', () => {
  const f = fixture();
  f.input.purpose = 'VIDEO_REFERENCE';
  f.input.provider = 'kairogen';
  expect(f.assess().eligibility).toBe('DOCUMENTARILY_ELIGIBLE');
  f.rights().forEach((grant) => {
    grant.externalProviders = ['openai'];
  });
  const result = f.assess();
  expect(result.eligibility).toBe('BLOCKED');
  expect(result.visualReviewRequired).toBe(true);
  expect(result.generatedOutputRightsVerified).toBe(false);
});

test('local-only evidence can assess a local commercial post without implying external transfer', () => {
  const f = fixture();
  f.input.purpose = 'COMMERCIAL_POST';
  f.input.provider = 'local';
  f.rights().forEach((grant) => {
    grant.externalProviders = [];
  });
  expect(f.assess().eligibility).toBe('DOCUMENTARILY_ELIGIBLE');
  expect(f.assess().rights.openaiProcessing).toBe('MISSING');
});

test('missing commercial publication rights block ads even if processing permissions are present', () => {
  const f = fixture();
  f.input.purpose = 'COMMERCIAL_POST';
  f.input.provider = 'local';
  f.context.product.localImage!.rights.commercialUseAllowed = false;
  const result = f.assess();
  expect(result.missingPermissions).toContain(
    'COMMERCIAL_PUBLICATION_RIGHTS_REQUIRED',
  );
  expect(result.eligibility).toBe('BLOCKED');
});

test('QC-only evidence cannot be reused for commercial production or external transfer', () => {
  const f = fixture();
  f.rights().forEach((grant) =>
    Object.assign(grant, {
      operationScope: 'qc_operation',
      campaignId: f.context.campaign.campaignId,
      purpose: 'HUMAN_QC_REVIEW',
    }),
  );
  const result = f.assess();
  expect(result.eligibility).toBe('BLOCKED');
  expect(result.rights.localProcessing).toBe('MISSING');
  expect(result.rights.openaiProcessing).toBe('MISSING');
});

test('fake provenance remains explicit and cannot become real commercial evidence', () => {
  const f = fixture();
  f.context.source.offer.provenance = {
    source: 'FAKE',
    fixtureVersion: 'shopee-affiliate-fake/1',
    observedAt: null,
  };
  const result = f.assess();
  expect(result.eligibility).toBe('FAKE_ONLY');
  expect(result.blockers).toContain('FAKE_SOURCE_NOT_COMMERCIAL_EVIDENCE');
  expect(result.provenance?.source).toBe('FAKE');
  expect(result.publicationAuthorized).toBe(false);
});

test.each(['omitted', 'unknown', 'conflict', 'wrongHash'])(
  'does not hide unfavorable or unbound evidence: %s',
  (kind) => {
    const f = fixture();
    if (kind === 'omitted') f.input.evidenceRefs = ['ev_spec'];
    if (kind === 'unknown') f.input.evidenceRefs.push('another_evidence');
    if (kind === 'conflict')
      f.context.product.localImage!.rights.evidence![0].sourceRef =
        'FICTITIOUS_TEST_ONLY:conflicting-same-id';
    if (kind === 'wrongHash') f.rights()[0].contentHash = 'b'.repeat(64);
    expect(f.assess().eligibility).toBe('BLOCKED');
  },
);

test('an independently granted external reference does not imply local processing or publication of a generated output', () => {
  const f = fixture();
  f.rights().forEach((grant) => {
    grant.localProcessing = false;
  });
  const reference = f.assess();
  expect(reference.eligibility).toBe('DOCUMENTARILY_ELIGIBLE');
  expect(reference.rights.localProcessing).toBe('MISSING');
  expect(reference.generatedOutputRightsVerified).toBe(false);
  f.input.purpose = 'COMMERCIAL_POST';
  expect(f.assess().eligibility).toBe('BLOCKED');
});

test('supports an image before a campaign exists and preserves unknown shop/provenance for human review', () => {
  const f = fixture();
  const result = evaluateCommercialImageReadiness(
    { ...f.input, campaign: null, source: null },
    { ...f.context, campaign: null, source: null },
  );
  expect(result.eligibility).toBe('DOCUMENTARILY_ELIGIBLE');
  expect(result.binding.shopId).toBeNull();
  expect(result.provenance).toBeNull();
  expect(result.reviewRequirements).toContain('PRODUCT_SHOP_BINDING_REVIEW');
});

test('repeats deterministically without mutating inputs or asserting legal verification', () => {
  const f = fixture(),
    before = affiliateHash({ input: f.input, context: f.context });
  const one = f.assess(),
    two = f.assess();
  expect(one).toEqual(two);
  expect(one.reportHash).toBe(two.reportHash);
  expect(affiliateHash({ input: f.input, context: f.context })).toBe(before);
  expect(Object.isFrozen(f.context.physical)).toBe(false);
  expect(Object.isFrozen(one.fidelity)).toBe(true);
});

test.each([
  'provider',
  'purpose',
  'schemaVersion',
  'hash',
  'revision',
  'unexpected',
])('rejects invalid %s input without echoing values', (kind) => {
  const f = fixture();
  const input: Record<string, unknown> = structuredClone(
    f.input,
  ) as unknown as Record<string, unknown>;
  if (kind === 'provider') input.provider = 'OPENAI';
  if (kind === 'purpose') input.purpose = 'HUMAN_QC_REVIEW';
  if (kind === 'schemaVersion') input.schemaVersion = 'future';
  if (kind === 'hash') input.media = { mediaRef, contentHash: 'invalid' };
  if (kind === 'revision')
    input.product = { productId: 'shopee_117002', revision: 0 };
  if (kind === 'unexpected') input.approved = true;
  expect(() => validateCommercialImageReadinessInput(input)).toThrow(
    'COMMERCIAL_IMAGE_READINESS_INPUT_INVALID',
  );
});
