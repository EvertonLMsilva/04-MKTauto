import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { SqliteOperationsRepository } from '../content-operations/infrastructure/sqlite-operations.repository.js';
import { FirstLinkPreparationService } from './application/first-link-preparation.js';
import { AffiliateService } from './application/affiliate.service.js';
import { ShopeeCatalogService } from './application/shopee-catalog.service.js';
import {
  ShopeeDynamicService,
  type ShopeeLiveAuthorizationScope,
} from './application/shopee-dynamic.service.js';
import {
  affiliateHash,
  type AffiliateProduct,
} from './domain/affiliate-contracts.js';
import {
  dynamicCampaignId,
  type ShopeeDynamicConfiguration,
} from './domain/shopee-dynamic.js';
import {
  ConfiguredShopeeAffiliate,
  withShopeeLiveAuthorization,
} from './infrastructure/shopee-affiliate.provider.js';
import { ShopeeDynamicJournal } from './infrastructure/shopee-dynamic-journal.js';
import { ShopeeCatalogCommit } from './infrastructure/shopee-catalog-commit.js';
import { SqliteAffiliatePersistence } from './infrastructure/sqlite-affiliate.persistence.js';
import { buildShopeeLinkMutation } from './infrastructure/shopee-links.js';

const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
// Independently authored fictitious values, never taken from C-012/C-013.
const at = '2026-11-12T12:00:00Z',
  projectId = 'project_first_link';
const node = (itemId = '115002', rate = '0.20000000000000000001') => ({
  itemId,
  shopId: '715003',
  productName: `FICTITIOUS_TEST_ONLY ${itemId}`,
  price: '100.00000000000000000001',
  commission: '0.00000000000000000001',
  commissionRate: rate,
  imageUrl: `https://first-link-fixture.invalid/${itemId}.png`,
  productLink: `https://shopee.com.br/product/715003/${itemId}`,
  offerLink: `https://s.shopee.com.br/FICTITIOUS_TEST_ONLY_offer_${itemId}`,
});
const returnedUrl = (id = '115002') =>
  `https://s.shopee.com.br/FICTITIOUS_TEST_ONLY_generated_${id}`;
function requestBody(options?: RequestInit) {
  if (typeof options?.body !== 'string')
    throw new Error('EXPECTED_SERIALIZED_REQUEST');
  return JSON.parse(options.body) as {
    query: string;
    variables: { input: { originUrl: string; subIds: string[] } };
  };
}
let directory: string, database: string;
let projects: SqliteOperationsRepository, affiliate: AffiliateService;
let journal: ShopeeDynamicJournal,
  dynamic: ShopeeDynamicService,
  preview: FirstLinkPreparationService;
let configuration: ShopeeDynamicConfiguration;
let response: {
  data: {
    productOfferV2: {
      nodes: ReturnType<typeof node>[];
      pageInfo: { page: number; limit: number; hasNextPage: boolean };
    };
  };
};
let fetchDouble: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
let mutationCalls: number;
const observation = () => ({
  dataOrigin: 'SIMULATED' as const,
  observedAt: at,
  response,
});
const input = () => ({
  projectVersion: 1,
  configuration,
  observation: observation(),
});
const permitted = <T>(run: () => Promise<T>) =>
  withShopeeLiveAuthorization(
    {
      mode: 'SHOPEE_LIVE',
      expiresAt: '2100-01-01T00:00:00Z',
      maxOfferPages: 1,
      maxLinks: 1,
      // Ephemeral test-only capability, never a persisted operator grant.
      reserve: () => {},
    },
    run,
  );
const restart = () =>
  new ShopeeDynamicService(
    new ShopeeCatalogService(
      new ConfiguredShopeeAffiliate(
        { appId: 'synthetic-app', secret: 'FICTITIOUS_TEST_ONLY' },
        fetchDouble,
      ),
    ),
    affiliate,
    new ShopeeDynamicJournal(database),
    { get: async (id) => projects.get(id) },
  );

beforeEach(() => {
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_NETWORK_FORBIDDEN');
    }),
  );
  directory = mkdtempSync(join(tmpdir(), 'mktauto-first-link-015-'));
  database = join(directory, 'disposable.sqlite');
  const db = new DatabaseSync(database);
  try {
    provisionSchema(db, 43);
  } finally {
    db.close();
  }
  projects = new SqliteOperationsRepository(database);
  projects.create(
    {
      id: projectId,
      name: 'FICTITIOUS_TEST_ONLY',
      version: 1,
      niche: 'Tecnologia',
      subniches: ['Fones'],
      audience: { profile: 'Adultos', language: 'pt-BR' },
      references: [],
      channel: {
        publishing: {
          contentsPerDay: 1,
          networks: ['instagram'],
          timezone: 'America/Sao_Paulo',
          times: ['10:00'],
        },
      },
    },
    { createdAt: at },
  );
  const reader = {
    get: async (id: string, version?: number) => projects.get(id, version),
  };
  affiliate = new AffiliateService(
    new SqliteAffiliatePersistence(database),
    reader,
    new ShopeeCatalogCommit(database),
  );
  journal = new ShopeeDynamicJournal(database);
  preview = new FirstLinkPreparationService(reader, affiliate);
  configuration = {
    projectId,
    niche: 'Tecnologia',
    queries: [{ keyword: 'FICTITIOUS_TEST_ONLY', limit: 3 }],
    maxPages: 1,
    maxSelected: 1,
    minCommissionRate: '0.01',
    minPrice: '1',
    maxPrice: '1000',
    excludedProductIds: [],
    excludedShopIds: [],
    excludedTerms: [],
    subIds: ['firstlink015', 'FICTITIOUS_TEST_ONLY'],
    authorizations: [],
  };
  response = {
    data: {
      productOfferV2: {
        nodes: [node('115001', '0.2'), node()],
        pageInfo: { page: 1, limit: 3, hasNextPage: true },
      },
    },
  };
  mutationCalls = 0;
  fetchDouble = vi.fn(async (_url, options) => {
    const request = requestBody(options);
    if (!request.query.includes('mutation')) return Response.json(response);
    mutationCalls++;
    const selected = request.variables.input.originUrl.split('/').at(-1);
    if (!selected) throw new Error('EXPECTED_SYNTHETIC_PRODUCT_ID');
    const callId = affiliateHash({
      projectId,
      campaignId: dynamicCampaignId(projectId, selected),
      productId: selected,
      shopId: '715003',
      input: { offerId: `shopee-item-${selected}`, ...request.variables.input },
    });
    expect(journal.get('LINK', callId, 'CLAIM')).toMatchObject({
      callId,
      projectId,
    });
    expect(
      journal.get(
        'LINK_SCOPE',
        affiliateHash({ projectId, productId: selected, shopId: '715003' }),
        callId,
      ),
    ).toEqual({ callId });
    return Response.json({
      data: { generateShortLink: { shortLink: returnedUrl(selected) } },
    });
  });
  dynamic = restart();
});
afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(process.env.SHOPEE_AFFILIATE_MODE).toBe('fake');
  } finally {
    projects?.db.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test('exact-item preparation rejects a snapshot containing another product before selection', async () => {
  configuration.queries = [{ itemId: '115002', limit: 3 }];
  await expect(preview.preview(input())).rejects.toThrow(
    'SHOPEE_OFFERS_RESPONSE_INVALID',
  );
  expect(fetchDouble).not.toHaveBeenCalled();
});

test('exact-item preparation accepts matching controlled data without granting commercial or link rights', async () => {
  configuration.queries = [{ itemId: '115002', limit: 3 }];
  response.data.productOfferV2.nodes = [node()];
  const result = await preview.preview(input());
  expect(result).toMatchObject({
    authorizationStatus: 'NOT_GRANTED',
    executionAllowed: false,
    associationVerified: false,
    liveOfferSnapshotStatus: 'SIMULATED_NOT_LIVE_EVIDENCE',
  });
  expect(fetchDouble).not.toHaveBeenCalled();
});

function authorizeFixture(id = '115002') {
  const offer = node(id),
    bytes = png(),
    hash = createHash('sha256').update(bytes).digest('hex');
  const root = join(directory, 'media');
  vi.stubEnv('FFMPEG_MEDIA_ROOT', root);
  const path = join(root, 'sha256', hash.slice(0, 2), `${hash}.png`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  const spec = {
    id: 'ev_spec',
    kind: 'PRODUCT_SPECIFICATION' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:specification',
    recordedAt: at,
  };
  const rights = {
    id: 'ev_rights',
    kind: 'MEDIA_USAGE_RIGHT' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:reusable-license',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef: `media:shopee_${id}`,
      contentHash: hash,
      commercialUse: 'GRANTED' as const,
      processing: 'GRANTED' as const,
      localProcessing: true,
      externalProviders: [],
    },
  };
  const product: AffiliateProduct = {
    schemaVersion: 'affiliate-product/2.0.0',
    productId: `shopee_${id}`,
    revision: 1,
    name: offer.productName,
    brand: { status: 'NOT_PROVIDED', name: null, evidenceRef: spec.id },
    attributes: [
      { name: 'tipo', value: 'FICTITIOUS_TEST_ONLY', evidenceRef: spec.id },
    ],
    media: [
      { mediaRef: rights.mediaAuthorization.mediaRef, evidenceRef: rights.id },
    ],
    evidence: [spec, rights],
    localImage: {
      mediaReference: rights.mediaAuthorization.mediaRef,
      contentHash: hash,
      origin: 'AUTHORIZED_THIRD_PARTY',
      provider: null,
      rights: {
        usageBasis: 'LICENSED',
        commercialUseAllowed: true,
        evidence: [rights],
      },
    },
  };
  const proof = (subject: unknown) => ({
    sourceRef: 'FICTITIOUS_TEST_ONLY:explicit-review',
    recordedAt: at,
    subjectHash: affiliateHash(subject),
  });
  configuration.authorizations = [
    {
      externalProductId: id,
      shopId: offer.shopId,
      product,
      mediaBinding: proof({
        externalProductId: id,
        shopId: offer.shopId,
        imageUrl: offer.imageUrl,
        mediaRef: product.localImage!.mediaReference,
        contentHash: hash,
        faithful: true,
      }),
      commercialApproval: proof({
        projectId,
        externalProductId: id,
        shopId: offer.shopId,
        productHash: affiliateHash(product),
      }),
      association: proof({
        projectId,
        campaignId: dynamicCampaignId(projectId, id),
        productId: id,
        shopId: offer.shopId,
        offerId: `shopee-item-${id}`,
        originUrl: offer.productLink,
        url: returnedUrl(id),
        subIds: configuration.subIds,
      }),
    },
  ];
  return { path, product };
}

test('prepares an immutable read-only request with automatic exact ranking, identities and conservative blockers', async () => {
  const before = readFileSync(database);
  const result = await preview.preview(input());
  expect(result.selection).toMatchObject({
    productId: '115002',
    shopId: '715003',
    offerId: 'shopee-item-115002',
    campaignId: dynamicCampaignId(projectId, '115002'),
    campaignRevision: null,
    productRevision: null,
    provenance: { source: 'SHOPEE_LIVE', observedAt: at },
    eligibility: 'FILTER_ELIGIBLE_REVIEW_REQUIRED',
  });
  expect(result.selection?.request).toEqual({
    offerId: 'shopee-item-115002',
    originUrl: node().productLink,
    subIds: configuration.subIds,
  });
  expect(result.selection?.requestHash).toBe(
    affiliateHash({
      projectId,
      campaignId: dynamicCampaignId(projectId, '115002'),
      productId: '115002',
      shopId: '715003',
      input: result.selection?.request,
    }),
  );
  expect(result.selection?.mutationHash).toBe(
    affiliateHash(buildShopeeLinkMutation(result.selection!.request)),
  );
  expect(result.context).toMatchObject({ projectId, projectVersion: 1 });
  expect(result).toMatchObject({
    authorizationStatus: 'NOT_GRANTED',
    executionAllowed: false,
    associationVerified: false,
    liveOfferSnapshotStatus: 'SIMULATED_NOT_LIVE_EVIDENCE',
    proposedLimits: { maxOfferPages: 1, maxMutations: 1, retryMutation: false },
  });
  expect(result.blockers).toEqual(
    expect.arrayContaining([
      'BLOCKED_COST_UNCONFIRMED',
      'LIVE_AUTHORIZATION_REQUIRED',
      'FRESH_AUTHORIZED_OBSERVATION_REQUIRED',
      'REGISTERED_CAMPAIGN_REQUIRED',
    ]),
  );
  expect(result.missingFields).toEqual(
    expect.arrayContaining([
      'product',
      'mediaBinding',
      'commercialApproval',
      'association',
    ]),
  );
  expect(result.previewHash).toBe((await preview.preview(input())).previewHash);
  expect(Object.isFrozen(result.selection!.request.subIds)).toBe(true);
  expect(readFileSync(database)).toEqual(before);
  expect(fetchDouble).not.toHaveBeenCalled();
  expect(
    projects.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='affiliate_shopee_dynamic_events_v1'",
      )
      .get(),
  ).toBeUndefined();
});

test('reports missing observations without presuming an identity or asking for a manual product URL', async () => {
  const result = await preview.preview({ ...input(), observation: null });
  expect(result.selection).toBeNull();
  expect(result.liveOfferSnapshotStatus).toBe('MISSING');
  expect(result.missingFields).toContain('observation');
  expect(result.nextHumanAction).toBe(
    'REVIEW_EVIDENCE_AND_COORDINATE_PROJECT_FIRST_LIVE_AUTHORIZATION',
  );
});

test('reuses exclusions and rejects an unmatched canonical identity without following any URL', async () => {
  configuration.excludedProductIds = ['115002'];
  expect((await preview.preview(input())).selection?.productId).toBe('115001');
  configuration.excludedProductIds = [];
  response.data.productOfferV2.nodes[1].productLink =
    'https://shopee.com.br/product/715003/999';
  expect((await preview.preview(input())).selection?.productId).toBe('115001');
  response.data.productOfferV2.nodes[0].productLink =
    'https://evil.invalid/offer';
  const result = await preview.preview(input());
  expect(result.selection).toBeNull();
  expect(result.blockers).toContain('NO_FILTER_ELIGIBLE_CANONICAL_CANDIDATE');
});

test('a valid empty page is an observation, never an authentication or commercial success claim', async () => {
  response.data.productOfferV2.nodes = [];
  const result = await preview.preview(input());
  expect(result.selection).toBeNull();
  expect(result.blockers).toContain('NO_FILTER_ELIGIBLE_CANONICAL_CANDIDATE');
  expect(result.liveOfferSnapshotStatus).toBe('SIMULATED_NOT_LIVE_EVIDENCE');
});

test('an unverified supplied snapshot cannot assert LIVE authentication or remove refresh/authorization blockers', async () => {
  const result = await preview.preview({
    ...input(),
    observation: { ...observation(), dataOrigin: 'UNVERIFIED_SNAPSHOT' },
  });
  expect(result.liveOfferSnapshotStatus).toBe('UNVERIFIED_NOT_LIVE_EVIDENCE');
  expect(result.executionAllowed).toBe(false);
  expect(result.blockers).toEqual(
    expect.arrayContaining([
      'FRESH_AUTHORIZED_OBSERVATION_REQUIRED',
      'LIVE_AUTHORIZATION_REQUIRED',
    ]),
  );
});

test('snapshots the exact input before awaiting context reads', async () => {
  const request = input(),
    expectedSubIds = [...configuration.subIds];
  const isolated = new FirstLinkPreparationService(
    {
      get: async (id, version) => {
        request.projectVersion = 2;
        configuration.subIds = ['changed'];
        response.data.productOfferV2.nodes[1].itemId = '999';
        return projects.get(id, version);
      },
    },
    affiliate,
  );
  const result = await isolated.preview(request);
  expect(result.context.projectVersion).toBe(1);
  expect(result.selection?.productId).toBe('115002');
  expect(result.selection?.request.subIds).toEqual(expectedSubIds);
});

test.each([
  'pages',
  'queries',
  'selected',
  'projectVersion',
  'niche',
  'project',
  'origin',
])('fails closed for invalid %s context or operation limits', async (kind) => {
  const request = input();
  if (kind === 'pages') configuration.maxPages = 2;
  if (kind === 'queries') {
    configuration.queries.push({ keyword: 'another' });
    configuration.maxPages = 2;
  }
  if (kind === 'selected') configuration.maxSelected = 2;
  if (kind === 'projectVersion') request.projectVersion = 2;
  if (kind === 'niche') configuration.niche = 'Outro';
  if (kind === 'project') configuration.projectId = 'missing';
  if (kind === 'origin')
    Object.assign(request.observation, { dataOrigin: 'LIVE_AUTHENTICATED' });
  await expect(preview.preview(request)).rejects.toThrow();
  expect(fetchDouble).not.toHaveBeenCalled();
});

test('binds evidence references and revision to the preview hash without approving rights or a transport', async () => {
  authorizeFixture();
  Object.assign(configuration.authorizations[0].mediaBinding, {
    extraPrivateDetail: 'FICTITIOUS_TEST_ONLY_OMIT',
  });
  const result = await preview.preview(input());
  expect(result.selection).toMatchObject({
    productRevision: 1,
    productHash: affiliateHash(configuration.authorizations[0].product),
  });
  expect(result.evidenceReferences.product.map((e) => e.sourceRef)).toEqual([
    'FICTITIOUS_TEST_ONLY:specification',
    'FICTITIOUS_TEST_ONLY:reusable-license',
  ]);
  expect(result.evidenceReferences.mediaBinding?.sourceRef).toBe(
    'FICTITIOUS_TEST_ONLY:explicit-review',
  );
  expect(result.evidenceReferences.mediaBinding).not.toHaveProperty(
    'extraPrivateDetail',
  );
  expect(result.missingFields).toEqual([]);
  expect(result.rightsAndCommercialStatus).toBe(
    'REQUIRES_EXISTING_EXECUTION_GATES',
  );
  const firstHash = result.previewHash;
  configuration.authorizations[0].product.revision = 2;
  expect((await preview.preview(input())).previewHash).not.toBe(firstHash);
  expect(result.executionAllowed).toBe(false);
  const subIds = [...configuration.subIds];
  configuration.subIds = ['different'];
  expect((await preview.preview(input())).selection!.requestHash).not.toBe(
    result.selection!.requestHash,
  );
  configuration.subIds = subIds;
});

test('reuses the official mutation once, with a persisted claim first, and replays without a second transport', async () => {
  authorizeFixture();
  const planned = await preview.preview(input());
  await dynamic.configure(configuration);
  const result = await permitted(() =>
    dynamic.runCycle(projectId, 'cycle_one'),
  );
  expect(result.decisions[0]).toMatchObject({
    productId: '115002',
    status: 'PREPARED',
    callId: planned.selection!.requestHash,
  });
  expect(fetchDouble).toHaveBeenCalledTimes(2);
  expect(mutationCalls).toBe(1);
  const stored = journal.get('LINK', planned.selection!.requestHash, 'RESULT');
  expect(stored).toMatchObject({
    url: returnedUrl(),
    originUrl: node().productLink,
    subIds: configuration.subIds,
    associationVerified: false,
    provenance: { source: 'SHOPEE_LIVE', fixtureVersion: null },
  });
  const mutation = requestBody(fetchDouble.mock.calls[1][1]);
  expect(mutation).toEqual(buildShopeeLinkMutation(planned.selection!.request));
  expect(mutation.variables.input).not.toHaveProperty('offerId');
  const restarted = restart();
  expect(await restarted.runCycle(projectId, 'cycle_one')).toEqual(result);
  expect(await restarted.recoverCycle(projectId, 'cycle_one')).toEqual(result);
  expect(fetchDouble).toHaveBeenCalledTimes(2);
  expect(affiliate.catalogCandidates(projectId)).toHaveLength(1);
  const after = await preview.preview(input());
  expect(after.selection?.campaignRevision).toBe(1);
  expect(after.blockers).not.toContain('REGISTERED_CAMPAIGN_REQUIRED');
  expect(after.authorizationStatus).toBe('NOT_GRANTED');
});

test('an uncertain mutation survives restart, recovery and changed SubIDs without another attempt', async () => {
  authorizeFixture();
  const normal = fetchDouble.getMockImplementation()!;
  fetchDouble.mockImplementation(async (url, options) => {
    if (requestBody(options).query.includes('mutation')) {
      await normal(url, options);
      throw new Error('FICTITIOUS_TEST_ONLY_UNCERTAIN');
    }
    return normal(url, options);
  });
  await dynamic.configure(configuration);
  const first = await permitted(() =>
    dynamic.runCycle(projectId, 'cycle_uncertain'),
  );
  expect(first.decisions[0]).toMatchObject({
    status: 'WAITING',
    reasons: ['LINK_RECONCILIATION_REQUIRED'],
  });
  expect(await restart().recoverCycle(projectId, 'cycle_uncertain')).toEqual(
    first,
  );
  configuration.subIds = ['changed'];
  await dynamic.configure(configuration);
  const next = await permitted(() =>
    restart().runCycle(projectId, 'cycle_after_uncertainty'),
  );
  expect(next.decisions[0].reasons).toEqual(['LINK_RECONCILIATION_REQUIRED']);
  expect(mutationCalls).toBe(1);
  expect(affiliate.catalogCandidates(projectId)).toEqual([]);
});

test('a returned link still waits for exact documentary association; missing commercial/media evidence prevents mutation', async () => {
  const fixture = authorizeFixture();
  configuration.authorizations[0].association = undefined;
  await dynamic.configure(configuration);
  const result = await permitted(() =>
    dynamic.runCycle(projectId, 'cycle_no_association'),
  );
  expect(result.decisions[0].reasons).toEqual([
    'AFFILIATE_ASSOCIATION_EVIDENCE_REQUIRED',
  ]);
  expect(mutationCalls).toBe(1);
  expect(affiliate.catalogCandidates(projectId)).toEqual([]);
  configuration.authorizations[0].commercialApproval = undefined;
  await dynamic.configure(configuration);
  expect(
    (await permitted(() => dynamic.runCycle(projectId, 'cycle_no_commercial')))
      .decisions[0].reasons,
  ).toEqual(['COMMERCIAL_APPROVAL_REQUIRED']);
  authorizeFixture();
  rmSync(fixture.path);
  await dynamic.configure(configuration);
  expect(
    (await permitted(() => dynamic.runCycle(projectId, 'cycle_no_image')))
      .decisions[0].status,
  ).toBe('WAITING');
  expect(mutationCalls).toBe(1);
});

test('recovers a stopped catalog write from the existing journal without querying or generating again', async () => {
  authorizeFixture();
  await dynamic.configure(configuration);
  const stop = vi
    .spyOn(affiliate, 'prepareShopeeCatalog')
    .mockRejectedValueOnce(new Error('FICTITIOUS_TEST_ONLY_STOP'));
  await expect(
    permitted(() => dynamic.runCycle(projectId, 'cycle_stopped')),
  ).rejects.toThrow('FICTITIOUS_TEST_ONLY_STOP');
  stop.mockRestore();
  expect(
    (await restart().recoverCycle(projectId, 'cycle_stopped')).decisions[0]
      .status,
  ).toBe('PREPARED');
  expect(fetchDouble).toHaveBeenCalledTimes(2);
  expect(mutationCalls).toBe(1);
});

test('refuses duplicate conflicting item identities and never reuses a recorded link for another product', async () => {
  authorizeFixture();
  await dynamic.configure(configuration);
  await permitted(() => dynamic.runCycle(projectId, 'cycle_original'));
  response.data.productOfferV2.nodes = [node('115003')];
  const unapproved = await permitted(() =>
    dynamic.runCycle(projectId, 'cycle_other_product'),
  );
  expect(unapproved.decisions[0]).toMatchObject({
    productId: '115003',
    status: 'WAITING',
    reasons: ['PRODUCT_AUTHORIZATION_REQUIRED'],
  });
  expect(mutationCalls).toBe(1);
  response.data.productOfferV2.nodes = [node(), { ...node(), shopId: '999' }];
  await expect(
    permitted(() => dynamic.runCycle(projectId, 'cycle_conflict')),
  ).rejects.toThrow('SHOPEE_CONTRACT_ERROR');
  expect(mutationCalls).toBe(1);
});

test('the facade requires authorization before any transport, and the existing scope rejects provisional cost', async () => {
  const facade = new ConfiguredShopeeAffiliate(
    { appId: 'synthetic-app', secret: 'FICTITIOUS_TEST_ONLY' },
    fetchDouble,
  );
  expect(() =>
    facade.generateLink({
      offerId: 'shopee-item-115002',
      originUrl: node().productLink,
      subIds: configuration.subIds,
    }),
  ).toThrow('SHOPEE_LIVE_AUTHORIZATION_REQUIRED');
  const before = readFileSync(database);
  const provisionalScope = {
    authorizationId: 'fixture_authorization',
    campaignId: dynamicCampaignId(projectId, '115002'),
    campaignRevision: 1,
    productionDates: ['2026-11-12'],
    notBefore: at,
    expiresAt: '2026-11-12T13:00:00Z',
    maxOfferPages: 1,
    maxLinks: 1,
    periodic: false,
    evidenceRef: 'FICTITIOUS_TEST_ONLY',
    costBasis: 'PROVISIONAL_NO_CHARGE_ASSUMPTION_OPERATOR_ACCEPTED',
    costEvidenceRef: 'FICTITIOUS_TEST_ONLY:not-official-proof',
  };
  await expect(
    dynamic.previewLiveAuthorization(
      configuration,
      provisionalScope as unknown as ShopeeLiveAuthorizationScope,
    ),
  ).rejects.toThrow('SHOPEE_LIVE_AUTHORIZATION_INVALID');
  expect(
    await affiliate.getCampaign(provisionalScope.campaignId, 1),
  ).toBeNull();
  expect(readFileSync(database)).toEqual(before);
  expect(fetchDouble).not.toHaveBeenCalled();
});
