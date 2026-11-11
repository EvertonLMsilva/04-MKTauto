import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../../../infrastructure/administration/schema-provisioner.js';
import { p2EditorialFixture } from '../../../../test/support/p2-editorial-fixture.js';
import { SqliteAffiliatePersistence } from '../infrastructure/sqlite-affiliate.persistence.js';
import { ShopeeDynamicJournal } from '../infrastructure/shopee-dynamic-journal.js';
import { ShopeeCatalogCommit } from '../infrastructure/shopee-catalog-commit.js';
import {
  shopeeAffiliateProvider,
  withShopeeLiveAuthorization,
} from '../infrastructure/shopee-affiliate.provider.js';
import { AffiliateService } from './affiliate.service.js';
import { ShopeeCatalogService } from './shopee-catalog.service.js';
import {
  ShopeeDynamicService,
  shopeeOperationalCycleId,
} from './shopee-dynamic.service.js';
import { CampaignAdministration } from '../../content-operations/application/campaign-administration.js';
import { NativeCampaignWorkflow } from '../../content-operations/application/native-campaign-workflow.js';
import { executionRequest } from '../../content-operations/application/campaign-orchestrator.js';
import { affiliateHash } from '../domain/affiliate-contracts.js';
import { eligibleCatalogCandidate } from '../domain/affiliate-catalog.js';
import { freezeCatalogRequest } from '../../content-operations/domain/product-rotation.js';
import type { ShopeeDynamicConfiguration } from '../domain/shopee-dynamic.js';
import { SHOPEE_AFFILIATE } from './ports/shopee-affiliate.port.js';
const { png } = await import(
  new URL('../../../../test-support/physical-fixtures.js', import.meta.url).href
);
const at = '2026-11-11T12:00:00Z';
// These composition tests exercise transport/catalog behavior using an internal
// synthetic capability. Persisted operator-grant checks have their own suite.
const permitted = <T>(run: () => Promise<T>) =>
  withShopeeLiveAuthorization(
    {
      mode: 'SHOPEE_LIVE',
      expiresAt: '2100-01-01T00:00:00Z',
      maxOfferPages: 10,
      maxLinks: 5,
      reserve: () => {},
    },
    run,
  );
function compositionService(service: ShopeeDynamicService) {
  return new Proxy(service, {
    get(target, key, receiver) {
      const method = Reflect.get(target, key, receiver) as unknown;
      if (
        ['runCycle', 'recoverCycle', 'runScheduledCycle'].includes(
          String(key),
        ) &&
        typeof method === 'function'
      )
        return (...args: unknown[]) =>
          permitted(() => method.apply(target, args));
      return method;
    },
  });
}
const node = (id = '11', commission = '0.12') => ({
  itemId: id,
  shopId: '7',
  productName: `Fone ${id}`,
  price: '100.00',
  commissionRate: commission,
  commission: '12',
  imageUrl: `https://example.invalid/${id}.png`,
  productLink: `https://shopee.com.br/product/7/${id}`,
  offerLink: `https://s.shopee.com.br/offer_${id}`,
});
let f: ReturnType<typeof p2EditorialFixture>;
let service: ShopeeDynamicService;
let unscopedService: ShopeeDynamicService;
let affiliate: AffiliateService;
let journal: ShopeeDynamicJournal;
let config: ShopeeDynamicConfiguration;
let fetchMock: ReturnType<
  typeof vi.fn<(url: string, options: RequestInit) => Promise<Response>>
>;
let imagePath: string;

beforeEach(async () => {
  vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-11-11T12:00:00Z'));
  f = p2EditorialFixture();
  const db = new DatabaseSync(f.database);
  try {
    provisionSchema(db, 43);
  } finally {
    db.close();
  }
  const mediaRoot = join(dirname(f.database), 'media');
  vi.stubEnv('FFMPEG_MEDIA_ROOT', mediaRoot);
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
  vi.stubEnv('SHOPEE_AFFILIATE_APP_ID', 'synthetic-app');
  vi.stubEnv('SHOPEE_AFFILIATE_SECRET', 'synthetic-secret');
  fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (body.query.includes('mutation'))
      return Response.json({
        data: {
          generateShortLink: {
            shortLink: 'https://s.shopee.com.br/generated_11',
          },
        },
      });
    return Response.json({
      data: {
        productOfferV2: {
          nodes: [node()],
          pageInfo: {
            page: body.variables.page,
            limit: body.variables.limit,
            hasNextPage: false,
          },
        },
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const bytes = png();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const dir = join(mediaRoot, 'sha256', hash.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  imagePath = join(dir, hash + '.png');
  writeFileSync(imagePath, bytes);
  const grant = {
    id: 'ev_rights',
    kind: 'MEDIA_USAGE_RIGHT' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:reusable-local-transform-license',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef: 'media:shopee_11',
      contentHash: hash,
      commercialUse: 'GRANTED' as const,
      processing: 'GRANTED' as const,
      localProcessing: true,
      externalProviders: [],
    },
  };
  const spec = {
    id: 'ev_spec',
    kind: 'PRODUCT_SPECIFICATION' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:product_11',
    recordedAt: at,
  };
  const product = {
    schemaVersion: 'affiliate-product/2.0.0' as const,
    productId: 'shopee_11',
    revision: 1,
    name: 'Fone 11',
    brand: {
      status: 'NOT_PROVIDED' as const,
      name: null,
      evidenceRef: spec.id,
    },
    attributes: [{ name: 'tipo', value: 'Fone', evidenceRef: spec.id }],
    media: [
      { mediaRef: grant.mediaAuthorization.mediaRef, evidenceRef: grant.id },
    ],
    evidence: [spec, grant],
    localImage: {
      mediaReference: grant.mediaAuthorization.mediaRef,
      contentHash: hash,
      origin: 'AUTHORIZED_THIRD_PARTY' as const,
      provider: null,
      rights: {
        usageBasis: 'LICENSED' as const,
        commercialUseAllowed: true,
        evidence: [grant],
      },
    },
  };
  const proof = (subject: unknown) => ({
    sourceRef: 'FICTITIOUS_TEST_ONLY:operator-reviewed',
    recordedAt: at,
    subjectHash: affiliateHash(subject),
  });
  config = {
    projectId: 'project_001',
    niche: 'Tecnologia',
    queries: [{ keyword: 'Fone', productCatId: 3, sortType: 5, limit: 2 }],
    maxPages: 2,
    maxSelected: 1,
    minCommissionRate: '0.01',
    minPrice: '1',
    maxPrice: '1000',
    excludedProductIds: [],
    excludedShopIds: [],
    excludedTerms: [],
    subIds: ['project001', 'fones'],
    authorizations: [
      {
        externalProductId: '11',
        shopId: '7',
        product,
        mediaBinding: proof({
          externalProductId: '11',
          shopId: '7',
          imageUrl: node().imageUrl,
          mediaRef: product.localImage.mediaReference,
          contentHash: hash,
          faithful: true,
        }),
        commercialApproval: proof({
          projectId: 'project_001',
          externalProductId: '11',
          shopId: '7',
          productHash: affiliateHash(product),
        }),
        association: proof({
          projectId: 'project_001',
          campaignId: 'shopee_project_001_11',
          productId: '11',
          shopId: '7',
          offerId: 'shopee-item-11',
          originUrl: node().productLink,
          url: 'https://s.shopee.com.br/generated_11',
          subIds: ['project001', 'fones'],
        }),
      },
    ],
  };
  const factory = new SqliteAffiliatePersistence(f.database);
  const projects = { get: async (id: string) => f.base.get(id) };
  affiliate = new AffiliateService(
    factory,
    projects,
    new ShopeeCatalogCommit(f.database),
  );
  journal = new ShopeeDynamicJournal(f.database);
  unscopedService = new ShopeeDynamicService(
    new ShopeeCatalogService(shopeeAffiliateProvider.useFactory()),
    affiliate,
    journal,
    projects,
  );
  service = compositionService(unscopedService);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  f?.cleanup();
});

test('LIVE provider resolves Nest and isolates every page/link transport; no request at construction', async () => {
  const module = await Test.createTestingModule({
    providers: [shopeeAffiliateProvider],
  }).compile();
  const provider = module.get(SHOPEE_AFFILIATE);
  expect(fetchMock).not.toHaveBeenCalled();
  await permitted(async () => {
    await provider.queryOfferPage({ limit: 2 });
    await provider.queryOfferPage({ limit: 2 });
    await provider.generateLink({
      offerId: 'shopee-item-11',
      originUrl: node().productLink,
      subIds: ['one'],
    });
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[2][1].body).toContain('one');
  await module.close();
});

test('integrates discovery → deterministic selection → SubIDs → verified local rights → existing CATALOG, replay and next cycle', async () => {
  await service.configure(config);
  const result = await service.runCycle('project_001', 'cycle_001');
  expect(result.decisions).toMatchObject([
    { productId: '11', status: 'PREPARED', reasons: ['CATALOG_READY'] },
  ]);
  const candidates = affiliate.catalogCandidates('project_001');
  expect(candidates.filter(eligibleCatalogCandidate)).toHaveLength(1);
  const selected = freezeCatalogRequest(
    { briefingId: 'brief_dynamic' },
    candidates,
    null,
  ).catalogSelection!;
  expect(selected).toMatchObject({
    productId: 'shopee_11',
    method: 'ROUND_ROBIN_ID_V1',
  });
  const candidate = candidates.find(
    (c) => c.product.productId === selected.productId,
  )!;
  const campaign = candidate.campaign;
  const briefing = await affiliate.createCatalogBriefing(
    {
      briefingId: 'brief_dynamic',
      campaignId: campaign.campaignId,
      campaignRevision: campaign.revision,
    },
    selected.briefingHash,
  );
  expect(
    await affiliate.resolveBriefingSource(briefing.briefingId),
  ).toMatchObject({
    offer: { productId: '11', shopId: '7', offerId: 'shopee-item-11' },
  });
  const calls = fetchMock.mock.calls.length;
  const restarted = compositionService(
    new ShopeeDynamicService(
      new ShopeeCatalogService(shopeeAffiliateProvider.useFactory()),
      affiliate,
      new ShopeeDynamicJournal(f.database),
      { get: async (id) => f.base.get(id) },
    ),
  );
  expect(await restarted.runCycle('project_001', 'cycle_001')).toEqual(result);
  expect(fetchMock).toHaveBeenCalledTimes(calls);
  expect(
    (await restarted.runCycle('project_001', 'cycle_002')).decisions[0].status,
  ).toBe('PREPARED');
  expect(
    fetchMock.mock.calls.filter(([, options]) =>
      String(options.body).includes('mutation'),
    ),
  ).toHaveLength(1);
  expect(
    affiliate
      .catalogCandidates('project_001')
      .filter((c) => c.product.productId === 'shopee_11'),
  ).toHaveLength(1);
});

test('bounds pagination, deduplicates between pages and ranks decimal fractions without losing precision', async () => {
  fetchMock.mockImplementation(async (_url, options) => {
    const { variables } = JSON.parse(options.body as string);
    return Response.json({
      data: {
        productOfferV2: {
          nodes:
            variables.page === 1
              ? [
                  node('11', '0.10000000000000000001'),
                  node('12', '0.10000000000000000002'),
                ]
              : [node('11', '0.10000000000000000001')],
          pageInfo: {
            page: variables.page,
            limit: variables.limit,
            hasNextPage: true,
          },
        },
      },
    });
  });
  await service.configure({ ...config, authorizations: [] });
  const result = await service.runCycle('project_001', 'cycle_pages');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.truncated).toBe(true);
  expect(result.decisions.map((d) => d.productId)).toEqual(['12', '11']);
  expect(result.decisions.every((d) => d.status === 'WAITING')).toBe(true);
  expect(
    affiliate
      .catalogCandidates('project_001')
      .some((c) => c.product.productId === 'shopee_11'),
  ).toBe(false);
});

test.each([
  'rights',
  'physical',
  'binding',
  'association',
  'commercial',
  'identity',
])(
  'holds only the candidate lacking %s evidence without fabricating eligibility',
  async (missing) => {
    if (missing === 'rights')
      config.authorizations[0].product.evidence =
        config.authorizations[0].product.evidence.filter(
          (e) => e.kind !== 'MEDIA_USAGE_RIGHT',
        );
    if (missing === 'physical') rmSync(imagePath);
    if (missing === 'binding')
      config.authorizations[0].mediaBinding.subjectHash = 'a'.repeat(64);
    if (missing === 'association')
      config.authorizations[0].association = undefined;
    if (missing === 'commercial')
      config.authorizations[0].commercialApproval = undefined;
    if (missing === 'identity') config.authorizations[0].shopId = '999';
    await service.configure(config);
    const result = await service.runCycle('project_001', `cycle_${missing}`);
    expect(result.decisions[0].status).toBe('WAITING');
    expect(
      affiliate
        .catalogCandidates('project_001')
        .some((c) => c.product.productId === 'shopee_11'),
    ).toBe(false);
  },
);

test('mutation uncertainty survives restart and new cycles without retry; successful explicit reconciliation resumes', async () => {
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, options) => {
    if (String(options.body).includes('mutation'))
      throw new Error('private remote secret');
    return normal(url, options);
  });
  await service.configure(config);
  const first = await service.runCycle('project_001', 'cycle_uncertain');
  expect(first.decisions[0]).toMatchObject({
    status: 'WAITING',
    reasons: ['LINK_RECONCILIATION_REQUIRED'],
  });
  const next = await service.runCycle('project_001', 'cycle_later');
  expect(next.decisions[0].reasons).toEqual(['LINK_RECONCILIATION_REQUIRED']);
  expect(
    fetchMock.mock.calls.filter(([, o]) => String(o.body).includes('mutation')),
  ).toHaveLength(1);
  expect(JSON.stringify(first)).not.toContain('private remote secret');
  await service.reconcileLink(first.decisions[0].callId!, {
    url: 'https://s.shopee.com.br/generated_11',
    sourceRef: 'FICTITIOUS_TEST_ONLY:remote-reconciliation',
    recordedAt: at,
  });
  expect(
    (await service.runCycle('project_001', 'cycle_reconciled')).decisions[0]
      .status,
  ).toBe('PREPARED');
  expect(
    fetchMock.mock.calls.filter(([, o]) => String(o.body).includes('mutation')),
  ).toHaveLength(1);
});

test('rejects excluded candidates and never consumes a link call; niche must match the project', async () => {
  await expect(
    service.configure({ ...config, niche: 'Outro' }),
  ).rejects.toThrow('SHOPEE_PROJECT_NICHE_MISMATCH');
  await service.configure({ ...config, excludedProductIds: ['11'] });
  const result = await service.runCycle('project_001', 'cycle_excluded');
  expect(result.decisions[0]).toMatchObject({
    status: 'REJECTED',
    reasons: ['EXCLUDED_PRODUCT'],
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('two callers reserve the same cycle before network and cannot duplicate links or catalog writes', async () => {
  await service.configure(config);
  const results = await Promise.allSettled([
    service.runCycle('project_001', 'cycle_race'),
    service.runCycle('project_001', 'cycle_race'),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    fetchMock.mock.calls.filter(([, o]) => String(o.body).includes('mutation')),
  ).toHaveLength(1);
});

test.each([
  { status: 401, code: 'SHOPEE_AUTHENTICATION_REJECTED' },
  { status: 503, code: 'SHOPEE_UNAVAILABLE' },
  { status: 200, code: 'SHOPEE_CONTRACT_ERROR' },
])(
  'sanitizes and distinguishes remote failures: $code',
  async ({ status, code }) => {
    fetchMock.mockResolvedValue(
      new Response('private remote body', { status }),
    );
    await service.configure(config);
    await expect(
      service.runCycle('project_001', 'cycle_remote_error'),
    ).rejects.toThrow(code);
    await expect(
      service.runCycle('project_001', 'cycle_remote_error'),
    ).rejects.toThrow('SHOPEE_CYCLE_IN_PROGRESS_OR_RECOVERY_REQUIRED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

test('cross-page conflicting observations fail closed without catalog writes', async () => {
  fetchMock.mockImplementation(async (_url, options) => {
    const { variables } = JSON.parse(options.body as string);
    return Response.json({
      data: {
        productOfferV2: {
          nodes: [{ ...node(), price: variables.page === 1 ? '100' : '200' }],
          pageInfo: {
            page: variables.page,
            limit: variables.limit,
            hasNextPage: true,
          },
        },
      },
    });
  });
  await service.configure(config);
  await expect(
    service.runCycle('project_001', 'cycle_conflict'),
  ).rejects.toThrow('SHOPEE_OFFERS_DUPLICATE_CONFLICT');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('an ineligible higher-ranked item cannot prevent an authorized lower-ranked item', async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({
      data: {
        productOfferV2: {
          nodes: [node('12', '0.9'), node()],
          pageInfo: { page: 1, limit: 2, hasNextPage: false },
        },
      },
    }),
  );
  await service.configure(config);
  const result = await service.runCycle('project_001', 'cycle_filter');
  expect(result.decisions.map((d) => [d.productId, d.status])).toEqual([
    ['12', 'WAITING'],
    ['11', 'PREPARED'],
  ]);
});

test('uncertainty cannot be bypassed by changing SubIDs', async () => {
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, options) => {
    if (String(options.body).includes('mutation')) throw new Error('uncertain');
    return normal(url, options);
  });
  await service.configure(config);
  await service.runCycle('project_001', 'cycle_uncertain');
  await service.configure({ ...config, subIds: ['other'] });
  expect(
    (await service.runCycle('project_001', 'cycle_changed')).decisions[0]
      .reasons,
  ).toEqual(['LINK_RECONCILIATION_REQUIRED']);
  expect(
    fetchMock.mock.calls.filter(([, o]) => String(o.body).includes('mutation')),
  ).toHaveLength(1);
});

test('resumes persisted discovery and link after a crash during catalog registration', async () => {
  await service.configure(config);
  const register = vi
    .spyOn(affiliate, 'prepareShopeeCatalog')
    .mockRejectedValueOnce(new Error('INJECTED_WORKER_STOP'));
  await expect(
    service.runCycle('project_001', 'cycle_stopped'),
  ).rejects.toThrow('INJECTED_WORKER_STOP');
  const calls = fetchMock.mock.calls.length;
  register.mockRestore();
  expect(
    (await service.recoverCycle('project_001', 'cycle_stopped')).decisions[0]
      .status,
  ).toBe('PREPARED');
  expect(fetchMock).toHaveBeenCalledTimes(calls);
  expect(
    (await service.runCycle('project_001', 'cycle_stopped')).decisions[0]
      .status,
  ).toBe('PREPARED');
});

test('appends campaign revisions when a reviewed link changes and preserves historical offer and provenance', async () => {
  await service.configure(config);
  await service.runCycle('project_001', 'cycle_original');
  const old = await affiliate.getCampaign('shopee_project_001_11', 1);
  config.subIds = ['new_campaign'];
  config.authorizations[0].association!.subjectHash = affiliateHash({
    projectId: 'project_001',
    campaignId: 'shopee_project_001_11',
    productId: '11',
    shopId: '7',
    offerId: 'shopee-item-11',
    originUrl: node().productLink,
    url: 'https://s.shopee.com.br/new_reviewed',
    subIds: config.subIds,
  });
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, options) =>
    String(options.body).includes('mutation')
      ? Response.json({
          data: {
            generateShortLink: {
              shortLink: 'https://s.shopee.com.br/new_reviewed',
            },
          },
        })
      : normal(url, options),
  );
  await service.configure(config);
  expect(
    (await service.runCycle('project_001', 'cycle_updated')).decisions[0]
      .status,
  ).toBe('PREPARED');
  expect(await affiliate.getCampaign('shopee_project_001_11', 1)).toEqual(old);
  expect(await affiliate.getCampaign('shopee_project_001_11', 2)).toMatchObject(
    { affiliateUrl: 'https://s.shopee.com.br/new_reviewed' },
  );
});

test('a pending association can be completed by configuration, reusing the recorded returned link', async () => {
  const proof = config.authorizations[0].association;
  config.authorizations[0].association = undefined;
  await service.configure(config);
  const waiting = await service.runCycle('project_001', 'cycle_pending');
  expect(waiting.decisions[0].reasons).toEqual([
    'AFFILIATE_ASSOCIATION_EVIDENCE_REQUIRED',
  ]);
  const link = service.inspectLink(waiting.decisions[0].callId!);
  expect(link).toMatchObject({
    status: 'RETURNED',
    associationVerified: false,
    claim: {
      projectId: 'project_001',
      offer: { productId: '11', shopId: '7' },
    },
    result: {
      url: 'https://s.shopee.com.br/generated_11',
      subIds: ['project001', 'fones'],
    },
  });
  config.authorizations[0].association = proof;
  await service.configure(config);
  expect(
    (await service.runCycle('project_001', 'cycle_ready')).decisions[0].status,
  ).toBe('PREPARED');
  expect(
    fetchMock.mock.calls.filter(([, o]) => String(o.body).includes('mutation')),
  ).toHaveLength(1);
});

test('validates query limits and contracts before transport; journal rejects update/delete', async () => {
  await expect(service.configure({ ...config, maxPages: 11 })).rejects.toThrow(
    'SHOPEE_CONFIGURATION_INVALID',
  );
  await expect(
    service.configure({ ...config, queries: [{ limit: 50, keyword: 'fone' }] }),
  ).rejects.toThrow('SHOPEE_OFFERS_QUERY_INVALID');
  expect(fetchMock).not.toHaveBeenCalled();
  await service.configure(config);
  const db = new DatabaseSync(f.database);
  try {
    expect(() =>
      db.exec(
        "UPDATE affiliate_shopee_dynamic_events_v1 SET content_json='{}'",
      ),
    ).toThrow('APPEND_ONLY');
    expect(() =>
      db.exec('DELETE FROM affiliate_shopee_dynamic_events_v1'),
    ).toThrow('APPEND_ONLY');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(43);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
});

test('catalog commit rolls back product, offer, source and receipts together on an internal failure', async () => {
  await service.configure(config);
  f.base.db.exec(
    "CREATE TRIGGER injected_shopee_source BEFORE INSERT ON affiliate_campaign_sources_v1 BEGIN SELECT RAISE(ABORT,'INJECTED_SOURCE_FAILURE'); END",
  );
  await expect(service.runCycle('project_001', 'cycle_atomic')).rejects.toThrow(
    'INJECTED_SOURCE_FAILURE',
  );
  expect(await affiliate.getProduct('shopee_11', 1)).toBeNull();
  expect(await affiliate.getCampaign('shopee_project_001_11', 1)).toBeNull();
  const calls = fetchMock.mock.calls.length;
  f.base.db.exec('DROP TRIGGER injected_shopee_source');
  expect(
    (await service.recoverCycle('project_001', 'cycle_atomic')).decisions[0]
      .status,
  ).toBe('PREPARED');
  expect(fetchMock).toHaveBeenCalledTimes(calls);
});

test.each(['DENIED', 'UNCONFIRMED', 'SCOPED'])(
  'requires a reusable processing grant, including %s',
  async (state) => {
    const authorization = config.authorizations[0];
    const grant = authorization.product.evidence.find(
      (e) => e.kind === 'MEDIA_USAGE_RIGHT',
    )!.mediaAuthorization!;
    if (state === 'SCOPED') grant.operationScope = 'one_review_only';
    else grant.processing = state as 'DENIED' | 'UNCONFIRMED';
    authorization.commercialApproval!.subjectHash = affiliateHash({
      projectId: config.projectId,
      externalProductId: '11',
      shopId: '7',
      productHash: affiliateHash(authorization.product),
    });
    await service.configure(config);
    expect(
      (await service.runCycle('project_001', 'cycle_rights')).decisions[0],
    ).toMatchObject({
      status: 'WAITING',
      reasons: ['REUSABLE_MEDIA_RIGHTS_REQUIRED'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

const liveScope = (maxLinks = 1) => ({
  authorizationId: 'live_grant_fixture',
  campaignId: 'camp_001',
  campaignRevision: 1,
  productionDates: ['2026-11-11', '2026-11-12'],
  periodic: true,
  notBefore: '2026-11-01T00:00:00Z',
  expiresAt: '2026-12-01T00:00:00Z',
  maxOfferPages: 2,
  maxLinks,
  evidenceRef: 'FICTITIOUS_TEST_ONLY:operator-reviewed',
  costBasis: 'NO_CHARGE_CONFIRMED' as const,
  costEvidenceRef: 'FICTITIOUS_TEST_ONLY:terms',
});
async function approveLive(maxLinks = 1) {
  const scope = liveScope(maxLinks),
    preview = await unscopedService.previewLiveAuthorization(config, scope);
  await unscopedService.approveLiveAuthorization(
    config,
    scope,
    preview.scopeHash,
    'operator_001',
  );
  await unscopedService.configure(config);
  return scope.authorizationId;
}
test('persisted LIVE authorization drives real scheduler D1/D2 with HTTP doubles, SubIDs, rights and immutable CATALOG', async () => {
  const grant = await approveLive();
  const workflow = new NativeCampaignWorkflow(
    affiliate,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  vi.spyOn(workflow, 'execute').mockRejectedValue(
    Object.assign(new Error('EDITORIAL_PROVIDER_UNAVAILABLE'), {
      code: 'EDITORIAL_PROVIDER_UNAVAILABLE',
    }),
  );
  let clock = '2026-11-11T13:00:00.000Z';
  const open = () =>
    new CampaignAdministration(
      f.database,
      workflow,
      false,
      () => clock,
      undefined,
      unscopedService,
    );
  let admin = open();
  const input = {
    campaignId: 'camp_001',
    campaignRevision: 1,
    projectVersion: 1,
    requestId: 'live_activate_fixture',
    requestedAt: clock,
    selectionMode: 'CATALOG',
    recurrence: { enabled: true },
  };
  try {
    const first = await admin.startDynamicCatalog(
      input,
      config,
      'operator_001',
      grant,
    );
    const frozen = executionRequest(
      admin.history(first.execution_id),
    ).catalogSelection;
    expect(frozen).toMatchObject({
      productId: 'shopee_11',
      method: 'ROUND_ROBIN_ID_V1',
    });
    await admin.onModuleDestroy();
    clock = '2026-11-12T13:00:00.000Z';
    admin = open();
    await admin.tick();
    await admin.tick();
    expect(admin.list()).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([, o]) =>
        String(o.body).includes('mutation'),
      ),
    ).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      executionRequest(admin.history(first.execution_id)).catalogSelection,
    ).toEqual(frozen);
  } finally {
    await admin.onModuleDestroy();
  }
});
test('persisted LIVE grant recovers after a stopped catalog commit without repeating HTTP', async () => {
  const grant = await approveLive(),
    cycle = shopeeOperationalCycleId('camp_001', '2026-11-11');
  const commit = vi
    .spyOn(affiliate, 'prepareShopeeCatalog')
    .mockRejectedValueOnce(new Error('INJECTED_WORKER_STOP'));
  await expect(
    unscopedService.runAuthorizedScheduledCycle(
      'project_001',
      cycle,
      grant,
      'camp_001',
      '2026-11-11',
    ),
  ).rejects.toThrow('INJECTED_WORKER_STOP');
  const calls = fetchMock.mock.calls.length;
  commit.mockRestore();
  const restarted = new ShopeeDynamicService(
    new ShopeeCatalogService(shopeeAffiliateProvider.useFactory()),
    affiliate,
    new ShopeeDynamicJournal(f.database),
    { get: async (id) => f.base.get(id) },
  );
  expect(
    (
      await restarted.runAuthorizedScheduledCycle(
        'project_001',
        cycle,
        grant,
        'camp_001',
        '2026-11-11',
      )
    ).decisions[0].status,
  ).toBe('PREPARED');
  expect(fetchMock).toHaveBeenCalledTimes(calls);
});

test('a read-only grant leaves eligible product waiting for link permission without reserving an uncertain mutation', async () => {
  const grant = await approveLive(0),
    cycle = shopeeOperationalCycleId('camp_001', '2026-11-11');
  const result = await unscopedService.runAuthorizedScheduledCycle(
    'project_001',
    cycle,
    grant,
    'camp_001',
    '2026-11-11',
  );
  expect(result.decisions[0].reasons).toEqual([
    'LIVE_LINK_AUTHORIZATION_REQUIRED',
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test('authorized uncertain link is never repeated after restart or on the separately authorized next day', async () => {
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url, options) => {
    if (String(options.body).includes('mutation'))
      throw new Error('PRIVATE_REMOTE_FAILURE');
    return normal(url, options);
  });
  const grant = await approveLive();
  for (const day of ['2026-11-11', '2026-11-12']) {
    const restarted = new ShopeeDynamicService(
      new ShopeeCatalogService(shopeeAffiliateProvider.useFactory()),
      affiliate,
      new ShopeeDynamicJournal(f.database),
      { get: async (id) => f.base.get(id) },
    );
    const result = await restarted.runAuthorizedScheduledCycle(
      'project_001',
      shopeeOperationalCycleId('camp_001', day),
      grant,
      'camp_001',
      day,
    );
    expect(result.decisions[0].reasons).toEqual([
      'LINK_RECONCILIATION_REQUIRED',
    ]);
  }
  expect(
    fetchMock.mock.calls.filter(([, o]) => String(o.body).includes('mutation')),
  ).toHaveLength(1);
});
