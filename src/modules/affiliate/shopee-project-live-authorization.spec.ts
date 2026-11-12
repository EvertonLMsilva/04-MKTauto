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
import { NativeCampaignWorkflow } from '../content-operations/application/native-campaign-workflow.js';
import { AffiliateService } from './application/affiliate.service.js';
import { ShopeeCatalogService } from './application/shopee-catalog.service.js';
import { ShopeeDynamicService } from './application/shopee-dynamic.service.js';
import {
  ShopeeProjectLiveAuthorizationService,
  type ShopeeProjectLiveCostEvidenceReader,
} from './application/shopee-project-live-authorization.service.js';
import {
  affiliateHash,
  type AffiliateProduct,
} from './domain/affiliate-contracts.js';
import {
  type ShopeeDynamicAuthorization,
  type ShopeeDynamicConfiguration,
} from './domain/shopee-dynamic.js';
import {
  validateProjectDiscoveryAuthorization,
  validateSelectedOfferLinkAuthorization,
} from './domain/shopee-project-live-authorization.js';
import { ConfiguredShopeeAffiliate } from './infrastructure/shopee-affiliate.provider.js';
import { ShopeeCatalogCommit } from './infrastructure/shopee-catalog-commit.js';
import { ShopeeDynamicJournal } from './infrastructure/shopee-dynamic-journal.js';
import { SqliteAffiliatePersistence } from './infrastructure/sqlite-affiliate.persistence.js';

const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const at = '2026-11-12T12:00:00Z',
  projectId = 'project_live_auth';
const productId = '116002',
  shopId = '716003';
const node = (id = productId, rate = '0.2') => ({
  itemId: id,
  shopId,
  productName: `FICTITIOUS_TEST_ONLY ${id}`,
  price: '100.00',
  commissionRate: rate,
  commission: '20.00',
  imageUrl: `https://fixture.invalid/${id}.png`,
  productLink: `https://shopee.com.br/product/${shopId}/${id}`,
  offerLink: `https://s.shopee.com.br/FICTITIOUS_TEST_ONLY_${id}`,
});
let directory: string, database: string, imagePath: string;
let projects: SqliteOperationsRepository,
  affiliate: AffiliateService,
  journal: ShopeeDynamicJournal;
let service: ShopeeProjectLiveAuthorizationService,
  catalog: ShopeeCatalogService;
let configuration: ShopeeDynamicConfiguration;
let fetchDouble: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
let financialEvidence: ReturnType<
  typeof vi.fn<ShopeeProjectLiveCostEvidenceReader['verifyNoCharge']>
>;
let response: ReturnType<typeof page>;
const page = () => ({
  data: {
    productOfferV2: {
      nodes: [node('116001', '0.1'), node()],
      pageInfo: { page: 1, limit: 3, hasNextPage: true },
    },
  },
});
const identity = () => ({
  projectId,
  projectVersion: 1,
  occurrenceId: 'occurrence_016',
});
const scope = () => ({
  schemaVersion: 'shopee-project-discovery-authorization/1.0.0' as const,
  kind: 'PROJECT_DISCOVERY_AUTHORIZATION' as const,
  authorizationId: 'discovery_016',
  ...identity(),
  configurationHash: affiliateHash({ ...configuration, niche: 'tecnologia' }),
  notBefore: at,
  expiresAt: '2026-11-12T13:00:00Z',
  maxOfferPages: 1 as const,
  maxLinks: 0 as const,
  evidenceRef: 'FICTITIOUS_TEST_ONLY:operator-discovery',
  costBasis: 'NO_CHARGE_CONFIRMED' as const,
  costEvidenceRef: 'FICTITIOUS_TEST_ONLY:PROJECT_DISCOVERY_AUTHORIZATION',
});
const linkDraft = () => ({
  authorizationId: 'link_016',
  operatorId: 'operator_fixture',
  notBefore: at,
  expiresAt: '2026-11-12T13:00:00Z',
  evidenceRef: 'FICTITIOUS_TEST_ONLY:operator-link',
  costBasis: 'NO_CHARGE_CONFIRMED' as const,
  costEvidenceRef: 'FICTITIOUS_TEST_ONLY:SELECTED_OFFER_LINK_AUTHORIZATION',
});
const restart = (evidence = true) =>
  new ShopeeProjectLiveAuthorizationService(
    catalog,
    affiliate,
    new ShopeeDynamicJournal(database),
    { get: async (id: string, version?: number) => projects.get(id, version) },
    evidence ? { verifyNoCharge: financialEvidence } : undefined,
    () => Date.parse(at),
  );
async function grantDiscovery() {
  const preview = await service.previewDiscovery(configuration, scope());
  expect(preview.blockers).toEqual([]);
  await service.approveDiscovery(
    configuration,
    scope(),
    preview.scopeHash,
    'operator_fixture',
  );
  return preview;
}
async function discover() {
  await grantDiscovery();
  return service.executeDiscovery({
    ...identity(),
    authorizationId: scope().authorizationId,
  });
}
function commercialEvidence(): ShopeeDynamicAuthorization {
  const bytes = png(),
    hash = createHash('sha256').update(bytes).digest('hex');
  const root = join(directory, 'media');
  vi.stubEnv('FFMPEG_MEDIA_ROOT', root);
  imagePath = join(root, 'sha256', hash.slice(0, 2), `${hash}.png`);
  mkdirSync(dirname(imagePath), { recursive: true });
  writeFileSync(imagePath, bytes);
  const spec = {
    id: 'ev_spec',
    kind: 'PRODUCT_SPECIFICATION' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:spec',
    recordedAt: at,
  };
  const rights = {
    id: 'ev_rights',
    kind: 'MEDIA_USAGE_RIGHT' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:reusable-license',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef: `media:shopee_${productId}`,
      contentHash: hash,
      commercialUse: 'GRANTED' as const,
      processing: 'GRANTED' as const,
      localProcessing: true,
      externalProviders: [],
    },
  };
  const product: AffiliateProduct = {
    schemaVersion: 'affiliate-product/2.0.0',
    productId: `shopee_${productId}`,
    revision: 1,
    name: node().productName,
    brand: { status: 'NOT_PROVIDED', name: null, evidenceRef: spec.id },
    attributes: [{ name: 'tipo', value: 'TEST', evidenceRef: spec.id }],
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
    sourceRef: 'FICTITIOUS_TEST_ONLY:review',
    recordedAt: at,
    subjectHash: affiliateHash(subject),
  });
  return {
    externalProductId: productId,
    shopId,
    product,
    mediaBinding: proof({
      externalProductId: productId,
      shopId,
      imageUrl: node().imageUrl,
      mediaRef: product.localImage!.mediaReference,
      contentHash: hash,
      faithful: true,
    }),
    commercialApproval: proof({
      projectId,
      externalProductId: productId,
      shopId,
      productHash: affiliateHash(product),
    }),
  };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at));
  // LIVE mode exists only inside this disposable fixture with an injected double.
  // No private environment/configuration is loaded, and global transport is forbidden.
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_NETWORK_FORBIDDEN');
    }),
  );
  directory = mkdtempSync(join(tmpdir(), 'mktauto-project-live-auth-016-'));
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
  affiliate = new AffiliateService(
    new SqliteAffiliatePersistence(database),
    { get: async (id) => projects.get(id) },
    new ShopeeCatalogCommit(database),
  );
  journal = new ShopeeDynamicJournal(database);
  response = page();
  configuration = {
    projectId,
    niche: 'Tecnologia',
    queries: [{ keyword: 'FICTITIOUS_TEST_ONLY', limit: 3 }],
    maxPages: 1,
    maxSelected: 1,
    minCommissionRate: '0.01',
    excludedProductIds: [],
    excludedShopIds: [],
    excludedTerms: [],
    subIds: ['project016', 'TEST'],
    authorizations: [],
  };
  fetchDouble = vi.fn(async (_url, options) => {
    if (typeof options?.body !== 'string')
      throw new Error('EXPECTED_SERIALIZED_REQUEST');
    expect(JSON.parse(options.body).query).not.toContain('mutation');
    const key = affiliateHash(identity());
    expect(journal.get('PROJECT_DISCOVERY', key, 'CLAIM')).not.toBeNull();
    expect(
      journal.get('PROJECT_DISCOVERY', key, 'OFFER_PAGE_1'),
    ).not.toBeNull();
    return Response.json(response);
  });
  catalog = new ShopeeCatalogService(
    new ConfiguredShopeeAffiliate(
      { appId: 'synthetic-app', secret: 'FICTITIOUS_TEST_ONLY_SECRET' },
      fetchDouble,
    ),
  );
  // Explicit fictitious Finance adapter, never a production policy or zero-cost claim.
  financialEvidence = vi.fn(
    async (proof) =>
      proof.costEvidenceRef === `FICTITIOUS_TEST_ONLY:${proof.kind}` &&
      /^[a-f0-9]{64}$/.test(proof.scopeHash),
  );
  service = restart();
});
afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    projects?.db.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test('preview is read-only for a project with no campaign; historical authorization still requires a campaign', async () => {
  const before = readFileSync(database);
  const preview = await service.previewDiscovery(configuration, scope());
  expect(preview.scope).toMatchObject({
    kind: 'PROJECT_DISCOVERY_AUTHORIZATION',
    maxLinks: 0,
  });
  expect(Object.isFrozen(preview.scope)).toBe(true);
  expect(affiliate.catalogCandidates(projectId)).toEqual([]);
  expect(readFileSync(database)).toEqual(before);
  const legacy = new ShopeeDynamicService(catalog, affiliate, journal, {
    get: async (id) => projects.get(id),
  });
  await expect(
    legacy.previewLiveAuthorization(configuration, {
      authorizationId: 'legacy_fixture',
      campaignId: 'missing_campaign',
      campaignRevision: 1,
      productionDates: ['2026-11-12'],
      notBefore: at,
      expiresAt: '2026-11-12T13:00:00Z',
      maxOfferPages: 1,
      maxLinks: 0,
      periodic: false,
      evidenceRef: 'FICTITIOUS_TEST_ONLY',
      costBasis: 'NO_CHARGE_CONFIRMED',
      costEvidenceRef: 'FICTITIOUS_TEST_ONLY:verified-by-fixture',
    }),
  ).rejects.toThrow('SHOPEE_LIVE_SCOPE_MISMATCH');
  expect(fetchDouble).not.toHaveBeenCalled();
  const getCampaign = vi.fn(async () => null);
  await expect(
    NativeCampaignWorkflow.prototype.localRequest.call(
      { affiliate: { getCampaign } } as unknown as NativeCampaignWorkflow,
      {
        selectionMode: 'CATALOG',
        campaignId: 'missing_campaign',
        campaignRevision: 1,
        projectVersion: 1,
        requestId: 'fixture_local_request',
        requestedAt: at,
      },
    ),
  ).rejects.toThrow('CAMPAIGN_CONTEXT_NOT_FOUND');
  expect(getCampaign).toHaveBeenCalledExactlyOnceWith('missing_campaign', 1);
  expect(
    (
      await legacy
        .projectLiveAuthorization()
        .previewDiscovery(configuration, scope())
    ).blockers,
  ).toContain('BLOCKED_COST_UNCONFIRMED');
});

test.each(['campaignId', 'periodic', 'approved'])(
  'strict discovery scope rejects unknown %s',
  (field) => {
    expect(() =>
      validateProjectDiscoveryAuthorization({ ...scope(), [field]: true }),
    ).toThrow();
  },
);
test.each([1, -1, 2])(
  'a discovery authorization cannot have maxLinks=%i',
  (maxLinks) => {
    expect(() =>
      validateProjectDiscoveryAuthorization({ ...scope(), maxLinks }),
    ).toThrow();
  },
);

test('discovery approval never creates a campaign, and execution reserves persistently before the sole offer page', async () => {
  const frozen = await discover();
  expect(frozen.identity).toEqual(identity());
  expect(frozen.discovery.offers[0].provenance.source).toBe('SHOPEE_LIVE');
  expect(frozen.discovery.calls).toBe(1);
  expect(frozen.discovery.truncated).toBe(true);
  expect(JSON.stringify(frozen)).not.toContain('FICTITIOUS_TEST_ONLY_SECRET');
  expect(JSON.stringify(frozen)).not.toContain('synthetic-app');
  expect(fetchDouble).toHaveBeenCalledTimes(1);
  expect(affiliate.catalogCandidates(projectId)).toEqual([]);
  expect(
    await restart().executeDiscovery({
      ...identity(),
      authorizationId: scope().authorizationId,
    }),
  ).toEqual(frozen);
  expect(fetchDouble).toHaveBeenCalledTimes(1);
  expect((await service.inspectDiscovery(identity())).status).toBe('FROZEN');
});

test.each([
  'missingProject',
  'version',
  'hash',
  'otherProject',
  'expired',
  'notYetValid',
  'grantAbsent',
])('rejects %s before transport', async (kind) => {
  if (kind === 'grantAbsent') {
    await expect(
      service.executeDiscovery({ ...identity(), authorizationId: 'missing' }),
    ).rejects.toThrow('SHOPEE_PROJECT_AUTHORIZATION_REQUIRED');
  } else {
    const value = scope();
    if (kind === 'missingProject') {
      value.projectId = 'missing';
      configuration.projectId = 'missing';
      value.configurationHash = affiliateHash({
        ...configuration,
        niche: 'tecnologia',
      });
    }
    if (kind === 'version') value.projectVersion = 2;
    if (kind === 'hash') value.configurationHash = '0'.repeat(64);
    if (kind === 'otherProject') value.projectId = 'another';
    if (kind === 'expired') {
      value.notBefore = '2026-11-12T10:00:00Z';
      value.expiresAt = '2026-11-12T11:00:00Z';
    }
    if (kind === 'notYetValid') {
      value.notBefore = '2026-11-12T12:30:00Z';
    }
    await expect(
      service.approveDiscovery(
        configuration,
        value,
        '0'.repeat(64),
        'operator_fixture',
      ),
    ).rejects.toThrow();
  }
  expect(fetchDouble).not.toHaveBeenCalled();
});

test('default Finance policy is blocked; provisional acceptance is not zero-cost evidence or a grant', async () => {
  const before = readFileSync(database);
  const denied = await restart(false).previewDiscovery(configuration, scope());
  expect(denied.blockers).toContain('BLOCKED_COST_UNCONFIRMED');
  await expect(
    restart(false).approveDiscovery(
      configuration,
      scope(),
      denied.scopeHash,
      'operator_fixture',
    ),
  ).rejects.toThrow('BLOCKED_COST_UNCONFIRMED');
  const provisional = {
    ...scope(),
    costBasis: 'PROVISIONAL_NO_CHARGE_ASSUMPTION_OPERATOR_ACCEPTED' as const,
  };
  expect(
    (await service.previewDiscovery(configuration, provisional)).blockers,
  ).toContain('BLOCKED_COST_UNCONFIRMED');
  expect(readFileSync(database)).toEqual(before);
});

test('two concurrent executions share one persistent discovery claim', async () => {
  await grantDiscovery();
  const results = await Promise.allSettled([
    service.executeDiscovery({
      ...identity(),
      authorizationId: scope().authorizationId,
    }),
    restart().executeDiscovery({
      ...identity(),
      authorizationId: scope().authorizationId,
    }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(fetchDouble).toHaveBeenCalledTimes(1);
  expect((await service.inspectDiscovery(identity())).status).toBe('FROZEN');
});

test.each(['timeout', 'uncertain'])(
  'a simulated %s cannot be retried by restart or reapproval',
  async (failure) => {
    await grantDiscovery();
    fetchDouble.mockRejectedValue(
      new Error(`PRIVATE_UPSTREAM_${failure}_SECRET`),
    );
    await expect(
      service.executeDiscovery({
        ...identity(),
        authorizationId: scope().authorizationId,
      }),
    ).rejects.toThrow('SHOPEE_PROJECT_DISCOVERY_UNCERTAIN');
    await expect(
      restart().executeDiscovery({
        ...identity(),
        authorizationId: scope().authorizationId,
      }),
    ).rejects.toThrow('SHOPEE_PROJECT_DISCOVERY_IN_PROGRESS_OR_UNCERTAIN');
    const report = await service.inspectDiscovery(identity());
    expect(JSON.stringify(report)).not.toContain('PRIVATE_UPSTREAM');
    expect(JSON.stringify(report)).not.toContain('SECRET');
    expect(fetchDouble).toHaveBeenCalledTimes(1);
    const replacement = { ...scope(), authorizationId: 'replacement_grant' };
    const proposal = await service.previewDiscovery(configuration, replacement);
    await service.approveDiscovery(
      configuration,
      replacement,
      proposal.scopeHash,
      'operator_fixture',
    );
    await expect(
      service.executeDiscovery({
        ...identity(),
        authorizationId: replacement.authorizationId,
      }),
    ).rejects.toThrow('SHOPEE_PROJECT_SCOPE_MISMATCH');
    expect(fetchDouble).toHaveBeenCalledTimes(1);
  },
);

test('a discovery capability cannot authorize any mutation', async () => {
  const facade = new ConfiguredShopeeAffiliate(
    { appId: 'synthetic-app', secret: 'FICTITIOUS_TEST_ONLY' },
    fetchDouble,
  );
  const original = catalog.discover.bind(catalog);
  vi.spyOn(catalog, 'discover').mockImplementation(async (...args) => {
    expect(() =>
      facade.generateLink({
        offerId: 'shopee-item-116002',
        originUrl: node().productLink,
        subIds: ['TEST'],
      }),
    ).toThrow('SHOPEE_LIVE_CALL_LIMIT');
    return original(...args);
  });
  await discover();
  expect(fetchDouble).toHaveBeenCalledTimes(1);
});

test('discovery honors the existing page budget and binds a link to the deterministic candidate from the complete frozen ranking', async () => {
  configuration.maxPages = 2;
  configuration.queries[0].limit = 1;
  const proposalScope = { ...scope(), maxOfferPages: 2 };
  fetchDouble.mockImplementation(async (_url, options) => {
    if (typeof options?.body !== 'string') throw new Error('EXPECTED_BODY');
    const request = JSON.parse(options.body);
    expect(request.query).not.toContain('mutation');
    const currentPage = request.variables.page;
    expect(
      journal.get(
        'PROJECT_DISCOVERY',
        affiliateHash(identity()),
        `OFFER_PAGE_${currentPage}`,
      ),
    ).not.toBeNull();
    return Response.json({
      data: {
        productOfferV2: {
          nodes: [currentPage === 1 ? node('116001', '0.1') : node()],
          pageInfo: { page: currentPage, limit: 1, hasNextPage: true },
        },
      },
    });
  });
  const proposal = await service.previewDiscovery(configuration, proposalScope);
  await service.approveDiscovery(
    configuration,
    proposalScope,
    proposal.scopeHash,
    'operator_fixture',
  );
  const frozen = await service.executeDiscovery({
    ...identity(),
    authorizationId: proposalScope.authorizationId,
  });
  expect(frozen.discovery.calls).toBe(2);
  expect(fetchDouble).toHaveBeenCalledTimes(2);
  const link = await service.previewLink(
    { ...identity(), snapshotHash: frozen.snapshotHash },
    linkDraft(),
    commercialEvidence(),
  );
  expect(link.scope?.productId).toBe(productId);
  expect(link.scope?.maxLinks).toBe(1);
  expect(link.blockers).toEqual([]);
});

test('a separate selected-offer grant binds frozen selection, revisions and operator, then reserves the existing LINK claim once without mutation', async () => {
  const frozen = await discover(),
    evidence = commercialEvidence();
  const request = { ...identity(), snapshotHash: frozen.snapshotHash };
  const beforePreview = readFileSync(database);
  const preview = await service.previewLink(request, linkDraft(), evidence);
  expect(readFileSync(database)).toEqual(beforePreview);
  expect(preview.blockers).toEqual([]);
  expect(preview.blockers).not.toContain('REGISTERED_CAMPAIGN_REQUIRED');
  expect(preview.preparation).not.toHaveProperty('authorizationDependency');
  expect(preview.pendingAfterLink).toContain(
    'RETURNED_LINK_ASSOCIATION_EVIDENCE_REQUIRED',
  );
  expect(preview.scope).toMatchObject({
    kind: 'SELECTED_OFFER_LINK_AUTHORIZATION',
    productId,
    shopId,
    offerId: `shopee-item-${productId}`,
    originUrl: node().productLink,
    subIds: configuration.subIds,
    productRevision: 1,
    maxOfferPages: 0,
    maxLinks: 1,
    operatorId: 'operator_fixture',
  });
  expect(preview.preparation?.selection?.requestHash).toBe(
    preview.scope!.requestHash,
  );
  await service.approveLink(
    request,
    linkDraft(),
    evidence,
    preview.scopeHash!,
    'operator_fixture',
  );
  const reserved = await service.reserveLink(
    preview.scope!,
    preview.scopeHash!,
    'operator_fixture',
  );
  expect(reserved).toMatchObject({
    status: 'RESERVED',
    transportAuthorized: false,
    associationVerified: false,
  });
  expect(
    journal.get('LINK', preview.scope!.requestHash, 'CLAIM'),
  ).toMatchObject({
    input: preview.preparation!.selection!.request,
    occurrenceId: identity().occurrenceId,
  });
  expect(
    (
      await restart().reserveLink(
        preview.scope!,
        preview.scopeHash!,
        'operator_fixture',
      )
    ).status,
  ).toBe('ALREADY_RESERVED');
  expect(fetchDouble).toHaveBeenCalledTimes(1);
  expect(affiliate.catalogCandidates(projectId)).toEqual([]);
  expect(validateSelectedOfferLinkAuthorization(preview.scope)).toEqual(
    preview.scope,
  );
});

test.each([
  'outside',
  'rights',
  'commercial',
  'binding',
  'physical',
  'revision',
])('keeps a selected-offer grant blocked by %s evidence', async (kind) => {
  const frozen = await discover(),
    evidence = commercialEvidence();
  if (kind === 'outside') evidence.externalProductId = '999';
  if (kind === 'rights')
    evidence.product.evidence = evidence.product.evidence.filter(
      (e) => e.kind !== 'MEDIA_USAGE_RIGHT',
    );
  if (kind === 'commercial') evidence.commercialApproval = undefined;
  if (kind === 'binding') evidence.mediaBinding.subjectHash = '0'.repeat(64);
  if (kind === 'physical') rmSync(imagePath);
  if (kind === 'revision') evidence.product.revision = 2;
  const result = await service.previewLink(
    { ...identity(), snapshotHash: frozen.snapshotHash },
    linkDraft(),
    evidence,
  );
  expect(result.blockers.length).toBeGreaterThan(0);
  await expect(
    service.approveLink(
      { ...identity(), snapshotHash: frozen.snapshotHash },
      linkDraft(),
      evidence,
      result.scopeHash ?? '0'.repeat(64),
      'operator_fixture',
    ),
  ).rejects.toThrow();
  expect(fetchDouble).toHaveBeenCalledTimes(1);
});

test.each([
  'product',
  'shop',
  'origin',
  'subIds',
  'occurrence',
  'project',
  'operator',
  'snapshot',
])(
  'rejects changed %s in the reviewed selection before reservation',
  async (kind) => {
    const frozen = await discover(),
      evidence = commercialEvidence(),
      request = { ...identity(), snapshotHash: frozen.snapshotHash };
    const preview = await service.previewLink(request, linkDraft(), evidence);
    await service.approveLink(
      request,
      linkDraft(),
      evidence,
      preview.scopeHash!,
      'operator_fixture',
    );
    const changed = structuredClone(preview.scope!);
    if (kind === 'product') changed.productId = '999';
    if (kind === 'shop') changed.shopId = '999';
    if (kind === 'origin')
      changed.originUrl = 'https://shopee.com.br/product/716003/999';
    if (kind === 'subIds') changed.subIds = ['changed'];
    if (kind === 'occurrence') changed.occurrenceId = 'another_occurrence';
    if (kind === 'project') changed.projectId = 'another_project';
    if (kind === 'operator') changed.operatorId = 'another_operator';
    if (kind === 'snapshot') changed.snapshotHash = '0'.repeat(64);
    await expect(
      service.reserveLink(changed, preview.scopeHash!, 'operator_fixture'),
    ).rejects.toThrow();
    expect(journal.get('LINK', preview.scope!.requestHash, 'CLAIM')).toBeNull();
  },
);

test('a discovery grant cannot be passed as a link grant and a different snapshot cannot be reviewed', async () => {
  await discover();
  await expect(
    service.reserveLink(scope(), '0'.repeat(64), 'operator_fixture'),
  ).rejects.toThrow();
  await expect(
    service.previewLink(
      { ...identity(), snapshotHash: '0'.repeat(64) },
      linkDraft(),
      commercialEvidence(),
    ),
  ).rejects.toThrow('SHOPEE_PROJECT_SNAPSHOT_MISMATCH');
});

test('a stalled transport times out once and leaves durable uncertainty without leaking upstream details', async () => {
  await grantDiscovery();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fetchDouble.mockImplementation(() => new Promise<Response>(() => {}));
  const pending = expect(
    service.executeDiscovery({
      ...identity(),
      authorizationId: scope().authorizationId,
    }),
  ).rejects.toThrow('SHOPEE_PROJECT_DISCOVERY_UNCERTAIN');
  await vi.advanceTimersByTimeAsync(10001);
  await pending;
  expect(fetchDouble).toHaveBeenCalledTimes(1);
  await expect(
    restart().executeDiscovery({
      ...identity(),
      authorizationId: scope().authorizationId,
    }),
  ).rejects.toThrow('SHOPEE_PROJECT_DISCOVERY_IN_PROGRESS_OR_UNCERTAIN');
});

test('expired or financially revoked discovery grants stop before any transport', async () => {
  await grantDiscovery();
  const late = new ShopeeProjectLiveAuthorizationService(
    catalog,
    affiliate,
    journal,
    { get: async (id) => projects.get(id) },
    { verifyNoCharge: financialEvidence },
    () => Date.parse('2026-11-12T14:00:00Z'),
  );
  await expect(
    late.executeDiscovery({
      ...identity(),
      authorizationId: scope().authorizationId,
    }),
  ).rejects.toThrow('SHOPEE_PROJECT_AUTHORIZATION_NOT_CURRENT');
  financialEvidence.mockResolvedValue(false);
  await expect(
    service.executeDiscovery({
      ...identity(),
      authorizationId: scope().authorizationId,
    }),
  ).rejects.toThrow('BLOCKED_COST_UNCONFIRMED');
  expect(fetchDouble).not.toHaveBeenCalled();
});

test('Finance exceptions and truthy non-booleans fail closed without leaking secrets or persisting a grant', async () => {
  const before = readFileSync(database);
  financialEvidence.mockRejectedValue(new Error('PRIVATE_FINANCE_SECRET'));
  const result = await service.previewDiscovery(configuration, scope());
  expect(result.blockers).toEqual(['BLOCKED_COST_UNCONFIRMED']);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_FINANCE_SECRET');
  financialEvidence.mockResolvedValue('truthy' as unknown as boolean);
  expect(
    (await service.previewDiscovery(configuration, scope())).blockers,
  ).toContain('BLOCKED_COST_UNCONFIRMED');
  expect(readFileSync(database)).toEqual(before);
});

test('a selected-offer proposal cannot reserve before independent approval or after image/rights changes', async () => {
  const frozen = await discover(),
    evidence = commercialEvidence(),
    request = { ...identity(), snapshotHash: frozen.snapshotHash };
  const proposed = await service.previewLink(request, linkDraft(), evidence);
  await expect(
    service.reserveLink(
      proposed.scope!,
      proposed.scopeHash!,
      'operator_fixture',
    ),
  ).rejects.toThrow('SHOPEE_PROJECT_AUTHORIZATION_REQUIRED');
  await service.approveLink(
    request,
    linkDraft(),
    evidence,
    proposed.scopeHash!,
    'operator_fixture',
  );
  writeFileSync(imagePath, 'FICTITIOUS_TEST_ONLY:changed-bytes');
  await expect(
    service.reserveLink(
      proposed.scope!,
      proposed.scopeHash!,
      'operator_fixture',
    ),
  ).rejects.toThrow('LOCAL_IMAGE_HASH_MISMATCH');
  expect(journal.get('LINK', proposed.scope!.requestHash, 'CLAIM')).toBeNull();
});

test('discovery cost evidence does not authorize mutation and fake mode cannot execute project LIVE discovery', async () => {
  const frozen = await discover();
  const proposed = await service.previewLink(
    { ...identity(), snapshotHash: frozen.snapshotHash },
    { ...linkDraft(), costEvidenceRef: scope().costEvidenceRef },
    commercialEvidence(),
  );
  expect(proposed.blockers).toContain('BLOCKED_COST_UNCONFIRMED');
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  await expect(
    service.executeDiscovery({
      ...identity(),
      authorizationId: scope().authorizationId,
    }),
  ).rejects.toThrow('SHOPEE_PROJECT_LIVE_MODE_REQUIRED');
  expect(fetchDouble).toHaveBeenCalledTimes(1);
});

test('concurrent selected-offer reservations use the existing atomic claim and never expose a transport capability', async () => {
  const frozen = await discover(),
    evidence = commercialEvidence(),
    request = { ...identity(), snapshotHash: frozen.snapshotHash };
  const proposed = await service.previewLink(request, linkDraft(), evidence);
  await service.approveLink(
    request,
    linkDraft(),
    evidence,
    proposed.scopeHash!,
    'operator_fixture',
  );
  const results = await Promise.allSettled([
    service.reserveLink(
      proposed.scope!,
      proposed.scopeHash!,
      'operator_fixture',
    ),
    restart().reserveLink(
      proposed.scope!,
      proposed.scopeHash!,
      'operator_fixture',
    ),
  ]);
  const reserved = results.filter(
    (r) => r.status === 'fulfilled' && r.value.status === 'RESERVED',
  );
  expect(reserved).toHaveLength(1);
  expect(
    projects.db
      .prepare(
        "SELECT count(*) AS n FROM affiliate_shopee_dynamic_events_v1 WHERE topic='LINK' AND event='CLAIM'",
      )
      .get()?.n,
  ).toBe(1);
  expect(fetchDouble).toHaveBeenCalledTimes(1);
});

test.each(['maxLinks', 'maxOfferPages', 'associationVerified', 'periodic'])(
  'strict link scope rejects escalation via %s',
  async (field) => {
    const frozen = await discover(),
      proposed = await service.previewLink(
        { ...identity(), snapshotHash: frozen.snapshotHash },
        linkDraft(),
        commercialEvidence(),
      );
    expect(() =>
      validateSelectedOfferLinkAuthorization({ ...proposed.scope, [field]: 2 }),
    ).toThrow();
  },
);
