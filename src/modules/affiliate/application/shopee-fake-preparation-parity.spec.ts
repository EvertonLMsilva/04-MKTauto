import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../../../infrastructure/administration/schema-provisioner.js';
import { SqliteOperationsRepository } from '../../content-operations/infrastructure/sqlite-operations.repository.js';
import { ProjectShopeeDiscoveryService } from '../../operations/project-shopee-discovery.service.js';
import {
  affiliateHash,
  type AffiliateProduct,
} from '../domain/affiliate-contracts.js';
import {
  dynamicOfferReasons,
  rankDynamicOffers,
  type ShopeeDynamicConfiguration,
} from '../domain/shopee-dynamic.js';
import { FakeShopeeAffiliate } from '../infrastructure/shopee-affiliate.provider.js';
import { ShopeeCatalogCommit } from '../infrastructure/shopee-catalog-commit.js';
import { ShopeeDynamicJournal } from '../infrastructure/shopee-dynamic-journal.js';
import { SqliteAffiliatePersistence } from '../infrastructure/sqlite-affiliate.persistence.js';
import { AffiliateService } from './affiliate.service.js';
import { ShopeeCatalogService } from './shopee-catalog.service.js';
import { ShopeeDynamicService } from './shopee-dynamic.service.js';
import { eligibleCatalogCandidate } from '../domain/affiliate-catalog.js';
import { freezeCatalogRequest } from '../../content-operations/domain/product-rotation.js';
import { InstagramPublicationService } from '../../publishing/application/instagram-publication.service.js';
import type { InstagramPublicationPorts } from '../../publishing/application/ports/instagram-publication.port.js';
import type { InstagramPublicationStore } from '../../publishing/application/ports/instagram-publication-store.port.js';

const { png } = await import(
  new URL('../../../../test-support/physical-fixtures.js', import.meta.url).href
);
const at = '2026-11-12T12:00:00Z';
const projectId = 'project_fake_parity';
let directory: string, database: string, imagePath: string;
let projects: SqliteOperationsRepository;
let provider: FakeShopeeAffiliate,
  catalog: ShopeeCatalogService,
  affiliate: AffiliateService;
let journal: ShopeeDynamicJournal, service: ShopeeDynamicService;
let config: ShopeeDynamicConfiguration;
let network: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Every artifact and every authorization below is FICTITIOUS_TEST_ONLY.
  // No .env, operational database, LIVE result or credential is loaded.
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  network = vi.fn(() => {
    throw new Error('Network forbidden in FAKE parity');
  });
  vi.stubGlobal('fetch', network);
  directory = mkdtempSync(join(tmpdir(), 'mktauto-fake-parity-014-'));
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
  const reader = { get: async (id: string) => projects.get(id) };
  provider = new FakeShopeeAffiliate();
  catalog = new ShopeeCatalogService(provider);
  affiliate = new AffiliateService(
    new SqliteAffiliatePersistence(database),
    reader,
    new ShopeeCatalogCommit(database),
  );
  journal = new ShopeeDynamicJournal(database);
  service = new ShopeeDynamicService(catalog, affiliate, journal, reader);
  config = {
    projectId,
    niche: 'Tecnologia',
    queries: [{ keyword: 'Synthetic', limit: 1 }],
    maxPages: 2,
    maxSelected: 1,
    minCommissionRate: '0.01',
    minPrice: '1',
    excludedProductIds: [],
    excludedShopIds: [],
    excludedTerms: [],
    subIds: ['FICTITIOUS_TEST_ONLY', 'project001'],
    authorizations: [],
  };
});

afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    projects?.db.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

async function authorizeFixture() {
  const [offer] = (await provider.queryOfferPage({ limit: 1 })).offers;
  const bytes = png();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const mediaRoot = join(directory, 'media');
  vi.stubEnv('FFMPEG_MEDIA_ROOT', mediaRoot);
  imagePath = join(mediaRoot, 'sha256', hash.slice(0, 2), `${hash}.png`);
  mkdirSync(dirname(imagePath), { recursive: true });
  writeFileSync(imagePath, bytes);
  const spec = {
    id: 'ev_spec',
    kind: 'PRODUCT_SPECIFICATION' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:specification',
    recordedAt: at,
  };
  const grant = {
    id: 'ev_rights',
    kind: 'MEDIA_USAGE_RIGHT' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:reusable-commercial-license',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef: `media:shopee_${offer.productId}`,
      contentHash: hash,
      commercialUse: 'GRANTED' as const,
      processing: 'GRANTED' as const,
      localProcessing: true,
      externalProviders: [],
    },
  };
  const product: AffiliateProduct = {
    schemaVersion: 'affiliate-product/2.0.0',
    productId: `shopee_${offer.productId}`,
    revision: 1,
    name: offer.name!,
    brand: { status: 'NOT_PROVIDED', name: null, evidenceRef: spec.id },
    attributes: [
      { name: 'tipo', value: 'FICTITIOUS_TEST_ONLY', evidenceRef: spec.id },
    ],
    media: [
      { mediaRef: grant.mediaAuthorization.mediaRef, evidenceRef: grant.id },
    ],
    evidence: [spec, grant],
    localImage: {
      mediaReference: grant.mediaAuthorization.mediaRef,
      contentHash: hash,
      origin: 'AUTHORIZED_THIRD_PARTY',
      provider: null,
      rights: {
        usageBasis: 'LICENSED',
        commercialUseAllowed: true,
        evidence: [grant],
      },
    },
  };
  const proof = (subject: unknown) => ({
    sourceRef: 'FICTITIOUS_TEST_ONLY:explicit-review',
    recordedAt: at,
    subjectHash: affiliateHash(subject),
  });
  config.authorizations = [
    {
      externalProductId: offer.productId,
      shopId: offer.shopId!,
      product,
      mediaBinding: proof({
        externalProductId: offer.productId,
        shopId: offer.shopId,
        imageUrl: offer.imageUrl,
        mediaRef: product.localImage!.mediaReference,
        contentHash: hash,
        faithful: true,
      }),
      commercialApproval: proof({
        projectId,
        externalProductId: offer.productId,
        shopId: offer.shopId,
        productHash: affiliateHash(product),
      }),
      association: proof({
        projectId,
        campaignId: `shopee_${projectId}_${offer.productId}`,
        productId: offer.productId,
        shopId: offer.shopId,
        offerId: offer.offerId,
        originUrl: offer.productUrl,
        url: `https://shopee-affiliate.invalid/link/${offer.offerId}`,
        subIds: config.subIds,
      }),
    },
  ];
  return offer;
}

test('discovers from a project without a campaign; complete data waits for authorization and replays after restart', async () => {
  expect(affiliate.catalogCandidates(projectId)).toEqual([]);
  const preview = await new ProjectShopeeDiscoveryService(
    catalog,
    { get: async (id) => projects.get(id) },
    provider,
  ).preview(projectId, {
    schemaVersion: 'operations-project-shopee-discovery/1.0.0',
    projectVersion: 1,
    niche: 'Tecnologia',
    queries: config.queries,
    maxPages: 2,
    maxCandidates: 2,
  });
  expect(preview.candidates[0]).toMatchObject({
    rank: 1,
    productId: '9007199254740993',
    reasons: [],
    eligibility: 'NOT_EVALUATED',
  });
  expect(preview.authorizationsGranted).toBe(false);
  const discovery = await catalog.discover(config.queries, 2);
  expect(discovery.calls).toBe(2);
  expect(rankDynamicOffers(discovery.offers).map((o) => o.offerId)).toEqual([
    'fake-offer-001',
    'fake-offer-002',
  ]);
  expect(dynamicOfferReasons(discovery.offers[0], config)).toEqual({
    rejected: false,
    reasons: [],
  });
  expect(dynamicOfferReasons(discovery.offers[1], config).reasons).toContain(
    'OFFER_DATA_INCOMPLETE',
  );
  const links = vi.spyOn(provider, 'generateLink');
  await service.configure(config);
  const result = await service.runCycle(projectId, 'cycle_without_evidence');
  expect(result.decisions[0]).toMatchObject({
    status: 'WAITING',
    reasons: ['PRODUCT_AUTHORIZATION_REQUIRED'],
  });
  expect(result.decisions[1].reasons).toContain('OFFER_DATA_INCOMPLETE');
  expect(links).not.toHaveBeenCalled();
  expect(affiliate.catalogCandidates(projectId)).toEqual([]);
  const queries = vi.spyOn(provider, 'queryOfferPage');
  const restarted = new ShopeeDynamicService(
    catalog,
    affiliate,
    new ShopeeDynamicJournal(database),
    { get: async (id) => projects.get(id) },
  );
  expect(await restarted.runCycle(projectId, 'cycle_without_evidence')).toEqual(
    result,
  );
  expect(
    await restarted.recoverCycle(projectId, 'cycle_without_evidence'),
  ).toEqual(result);
  expect(queries).not.toHaveBeenCalled();
});

test.each([
  ['rights', 'PRODUCT_CONTRACT_OR_RIGHTS_INVALID'],
  ['commercial', 'COMMERCIAL_APPROVAL_REQUIRED'],
  ['binding', 'FAITHFUL_PRODUCT_MEDIA_EVIDENCE_REQUIRED'],
  ['physical', 'LOCAL_IMAGE_UNAVAILABLE_OR_INVALID'],
  ['hash', 'LOCAL_IMAGE_HASH_MISMATCH'],
  ['association', 'AFFILIATE_ASSOCIATION_EVIDENCE_REQUIRED'],
])(
  'keeps the fixture WAITING when %s evidence is missing or invalid',
  async (missing, reason) => {
    await authorizeFixture();
    const authorization = config.authorizations[0];
    if (missing === 'rights')
      authorization.product.evidence = authorization.product.evidence.filter(
        (e) => e.kind !== 'MEDIA_USAGE_RIGHT',
      );
    if (missing === 'commercial') authorization.commercialApproval = undefined;
    if (missing === 'binding')
      authorization.mediaBinding.subjectHash = '0'.repeat(64);
    if (missing === 'physical') rmSync(imagePath);
    if (missing === 'hash')
      writeFileSync(imagePath, 'FICTITIOUS_TEST_ONLY:corrupted-image');
    if (missing === 'association') authorization.association = undefined;
    await service.configure(config);
    const result = await service.runCycle(
      projectId,
      `cycle_missing_${missing}`,
    );
    expect(result.decisions[0]).toMatchObject({
      status: 'WAITING',
      reasons: [reason],
    });
    expect(affiliate.catalogCandidates(projectId)).toEqual([]);
  },
);

test('prepares the authorized FAKE fixture, hands off to briefing and preserves revisions after replay and restart', async () => {
  const offer = await authorizeFixture();
  const links = vi.spyOn(provider, 'generateLink');
  await service.configure(config);
  const result = await service.runCycle(projectId, 'cycle_authorized_fixture');
  expect(result.decisions[0]).toMatchObject({
    status: 'PREPARED',
    reasons: ['CATALOG_READY'],
  });
  expect(result.decisions[1]).toMatchObject({ status: 'WAITING' });
  expect(result.decisions[1].reasons).toContain('OFFER_DATA_INCOMPLETE');
  const candidates = affiliate.catalogCandidates(projectId);
  expect(candidates.filter(eligibleCatalogCandidate)).toHaveLength(1);
  const candidate = candidates[0];
  expect(candidate.product).toEqual(config.authorizations[0].product);
  expect(
    candidate.product.evidence.every((e) =>
      e.sourceRef.startsWith('FICTITIOUS_TEST_ONLY:'),
    ),
  ).toBe(true);
  expect(candidate.campaign).toMatchObject({
    revision: 1,
    affiliateUrl: offer.affiliateUrl,
  });
  const selection = freezeCatalogRequest(
    { briefingId: 'brief_fake_parity' },
    candidates,
    null,
  ).catalogSelection!;
  expect(selection).toMatchObject({
    method: 'ROUND_ROBIN_ID_V1',
    productId: candidate.product.productId,
  });
  const briefing = await affiliate.createCatalogBriefing(
    {
      briefingId: 'brief_fake_parity',
      campaignId: candidate.campaign.campaignId,
      campaignRevision: 1,
    },
    selection.briefingHash,
  );
  expect(briefing.affiliateUrl).toBe(offer.affiliateUrl);
  const source = await affiliate.resolveBriefingSource(briefing.briefingId);
  expect(source).toMatchObject({
    affiliateUrl: offer.affiliateUrl,
    offer: {
      offerId: offer.offerId,
      productId: offer.productId,
      shopId: offer.shopId,
      provenance: offer.provenance,
    },
  });
  expect(source).not.toHaveProperty('approved');
  expect(source).not.toHaveProperty('associationVerified');
  const link = await links.mock.results[0].value;
  expect(link).toMatchObject({
    associationVerified: false,
    provenance: { source: 'FAKE' },
  });
  expect(links).toHaveBeenCalledExactlyOnceWith({
    offerId: offer.offerId,
    originUrl: offer.productUrl,
    subIds: config.subIds,
  });
  const queries = vi.spyOn(provider, 'queryOfferPage');
  const restarted = new ShopeeDynamicService(
    catalog,
    affiliate,
    new ShopeeDynamicJournal(database),
    { get: async (id) => projects.get(id) },
  );
  expect(
    await restarted.runCycle(projectId, 'cycle_authorized_fixture'),
  ).toEqual(result);
  expect(
    await restarted.recoverCycle(projectId, 'cycle_authorized_fixture'),
  ).toEqual(result);
  expect(queries).not.toHaveBeenCalled();
  expect(
    (await restarted.runCycle(projectId, 'cycle_next')).decisions[0].status,
  ).toBe('PREPARED');
  expect(links).toHaveBeenCalledTimes(1);
  expect(affiliate.catalogCandidates(projectId)).toEqual(candidates);
  expect(await affiliate.getProduct(candidate.product.productId, 2)).toBeNull();
  expect(
    await affiliate.getCampaign(candidate.campaign.campaignId, 2),
  ).toBeNull();
  expect(await affiliate.resolveBriefingSource(briefing.briefingId)).toEqual(
    source,
  );
  expect(projects.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

  // Acceptance of a source is not a publication authorization. Exercise the
  // official LIVE scheduling gate with no transport, storage or credentials.
  const openInstagram = vi.fn();
  const publishing = new InstagramPublicationService(
    { openInstagram } as unknown as InstagramPublicationStore,
    { publisher: { mode: 'live' } } as unknown as InstagramPublicationPorts,
  );
  expect(publishing.configuration()).toMatchObject({
    schedulerEnabled: false,
    liveAuthorized: false,
  });
  await expect(
    publishing.schedule(
      {
        execution_id: 'exec_fixture',
        run_id: 'run_fixture',
        campaign_id: candidate.campaign.campaignId,
      },
      { affiliateUrl: briefing.affiliateUrl },
      {},
      'FICTITIOUS_TEST_ONLY',
    ),
  ).rejects.toThrow('SOCIAL_LIVE_POST_BLOCKED');
  expect(openInstagram).not.toHaveBeenCalled();
});

test('rolls back an interrupted FAKE preparation and recovers twice without duplicate data or another link', async () => {
  const offer = await authorizeFixture();
  const links = vi.spyOn(provider, 'generateLink');
  await service.configure(config);
  projects.db.exec(
    "CREATE TRIGGER injected_fake_source BEFORE INSERT ON affiliate_campaign_sources_v1 BEGIN SELECT RAISE(ABORT,'FICTITIOUS_TEST_ONLY_SOURCE_FAILURE'); END",
  );
  await expect(
    service.runCycle(projectId, 'cycle_interrupted'),
  ).rejects.toThrow('FICTITIOUS_TEST_ONLY_SOURCE_FAILURE');
  expect(affiliate.catalogCandidates(projectId)).toEqual([]);
  expect(await affiliate.getProduct(`shopee_${offer.productId}`, 1)).toBeNull();
  expect(
    await affiliate.getCampaign(`shopee_${projectId}_${offer.productId}`, 1),
  ).toBeNull();
  expect(
    projects.db.prepare('SELECT count(*) AS n FROM affiliate_commands').get()
      ?.n,
  ).toBe(0);
  projects.db.exec('DROP TRIGGER injected_fake_source');
  const queries = vi.spyOn(provider, 'queryOfferPage');
  const restarted = new ShopeeDynamicService(
    catalog,
    affiliate,
    new ShopeeDynamicJournal(database),
    { get: async (id) => projects.get(id) },
  );
  const recovered = await restarted.recoverCycle(
    projectId,
    'cycle_interrupted',
  );
  expect(recovered.decisions[0]).toMatchObject({
    status: 'PREPARED',
    reasons: ['CATALOG_READY'],
  });
  const receipts = projects.db
    .prepare('SELECT count(*) AS n FROM affiliate_commands')
    .get()?.n;
  expect(receipts).toBe(3);
  expect(await restarted.recoverCycle(projectId, 'cycle_interrupted')).toEqual(
    recovered,
  );
  expect(await restarted.runCycle(projectId, 'cycle_interrupted')).toEqual(
    recovered,
  );
  expect(queries).not.toHaveBeenCalled();
  expect(links).toHaveBeenCalledTimes(1);
  expect(affiliate.catalogCandidates(projectId)).toHaveLength(1);
  expect(
    projects.db
      .prepare('SELECT count(*) AS n FROM affiliate_campaign_sources_v1')
      .get()?.n,
  ).toBe(1);
  expect(
    projects.db.prepare('SELECT count(*) AS n FROM affiliate_commands').get()
      ?.n,
  ).toBe(receipts);
  expect(projects.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
