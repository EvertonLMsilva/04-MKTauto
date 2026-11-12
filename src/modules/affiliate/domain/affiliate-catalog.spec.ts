import {
  eligibleCatalogCandidate,
  evaluateCatalogCandidate,
  type AffiliateCatalogCandidate,
} from './affiliate-catalog.js';

function candidate(): AffiliateCatalogCandidate {
  const grant = {
    id: 'ev_media',
    kind: 'MEDIA_USAGE_RIGHT' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:reusable-permission',
    recordedAt: '2026-11-11T12:00:00Z',
    mediaAuthorization: {
      mediaRef: 'media:fixture',
      contentHash: 'a'.repeat(64),
      commercialUse: 'GRANTED' as const,
      processing: 'GRANTED' as const,
      localProcessing: true,
      externalProviders: [],
    },
  };
  return {
    product: {
      schemaVersion: 'affiliate-product/2.0.0',
      productId: 'prod_fixture',
      revision: 1,
      name: 'Fixture',
      brand: { status: 'NOT_PROVIDED', name: null, evidenceRef: 'ev_spec' },
      attributes: [
        { name: 'categoria', value: 'Fixture', evidenceRef: 'ev_spec' },
      ],
      media: [{ mediaRef: 'media:fixture', evidenceRef: grant.id }],
      evidence: [
        {
          id: 'ev_spec',
          kind: 'PRODUCT_SPECIFICATION',
          sourceRef: 'FICTITIOUS_TEST_ONLY:feed-origin',
          recordedAt: '2026-11-11T12:00:00Z',
        },
        grant,
      ],
      localImage: {
        mediaReference: 'media:fixture',
        contentHash: 'a'.repeat(64),
        origin: 'OPERATOR_OWNED',
        provider: null,
        rights: {
          usageBasis: 'OWNED',
          commercialUseAllowed: true,
          evidence: [grant],
        },
      },
    },
    campaign: {
      schemaVersion: 'affiliate-campaign/1.0.0',
      campaignId: 'offer_fixture',
      revision: 1,
      projectId: 'project_001',
      productId: 'prod_fixture',
      productRevision: 1,
      affiliateUrl: 'https://s.shopee.com.br/fixture_only',
      cta: 'Confira os detalhes',
      disclosure: 'Publicidade. Link afiliado.',
    },
  };
}

test('technical eligibility never establishes commercial evidence, current data, LIVE or publication authorization', () => {
  const c = candidate(),
    before = structuredClone(c),
    result = evaluateCatalogCandidate(c);
  expect(result).toMatchObject({
    productValid: true,
    offerValid: true,
    affiliateLinkPresent: true,
    reusableMediaRights: true,
    briefingCompatible: true,
    technicalEligibility: 'ELIGIBLE',
    technicalBlockers: [],
    associationVerified: false,
    commercialApprovalVerified: false,
    externalRightsVerified: false,
    currentShopeeDataVerified: false,
    liveAuthorized: false,
    publicationAuthorized: false,
    operationallyAuthorized: false,
  });
  expect(result.operationalBlockers).toContain('BLOCKED_COST_UNCONFIRMED');
  expect(result.operationalBlockers).toContain(
    'AFFILIATE_ASSOCIATION_UNVERIFIED',
  );
  expect(result.currentCommercialData).toEqual({
    price: null,
    availability: null,
    commission: null,
  });
  expect(eligibleCatalogCandidate(c)).toBe(true);
  expect(c).toEqual(before);
  expect(Object.isFrozen(result)).toBe(true);
});

test.each([
  [
    'archived',
    (c: any) => {
      c.product.status = 'ARCHIVED';
    },
    'PRODUCT_ARCHIVED',
  ],
  [
    'invalid product',
    (c: any) => {
      c.product.revision = 0;
    },
    'PRODUCT_CONTRACT_INVALID',
  ],
  [
    'invalid offer',
    (c: any) => {
      c.campaign.cta = 'Preço R$ 20';
    },
    'OFFER_CONTRACT_INVALID',
  ],
  [
    'missing affiliation',
    (c: any) => {
      c.campaign.affiliateUrl = null;
    },
    'OFFER_CONTRACT_INVALID',
  ],
  [
    'incompatible revision',
    (c: any) => {
      c.campaign.productRevision = 2;
    },
    'BRIEFING_SCOPE_INVALID',
  ],
  [
    'missing media',
    (c: any) => {
      delete c.product.localImage;
    },
    'REUSABLE_MEDIA_RIGHTS_REQUIRED',
  ],
  [
    'unconfirmed commercial rights',
    (c: any) => {
      c.product.evidence[1].mediaAuthorization.commercialUse = 'UNCONFIRMED';
    },
    'REUSABLE_MEDIA_RIGHTS_REQUIRED',
  ],
  [
    'denied processing',
    (c: any) => {
      c.product.localImage.rights.evidence[0].mediaAuthorization.processing =
        'DENIED';
    },
    'REUSABLE_MEDIA_RIGHTS_REQUIRED',
  ],
  [
    'wrong hash',
    (c: any) => {
      c.product.localImage.contentHash = 'b'.repeat(64);
    },
    'REUSABLE_MEDIA_RIGHTS_REQUIRED',
  ],
  [
    'operation-only permission',
    (c: any) => {
      c.product.localImage.rights.evidence[0].mediaAuthorization.operationScope =
        'fixture_qc';
    },
    'REUSABLE_MEDIA_RIGHTS_REQUIRED',
  ],
])(
  '%s remains blocked independently of the presence of a link',
  (_name, mutate, blocker) => {
    const c = candidate();
    (mutate as (c: any) => void)(c);
    const result = evaluateCatalogCandidate(c);
    expect(result.technicalEligibility).toBe('BLOCKED');
    expect(result.technicalBlockers).toContain(blocker);
    expect(eligibleCatalogCandidate(c)).toBe(false);
    expect(result.operationallyAuthorized).toBe(false);
  },
);
