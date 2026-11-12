import { ShopeeCatalogService } from '../affiliate/application/shopee-catalog.service.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { OperationsModule } from './operations.module.js';
import { FakeShopeeAffiliate } from '../affiliate/infrastructure/shopee-affiliate.provider.js';
import { SHOPEE_AFFILIATE } from '../affiliate/application/ports/shopee-affiliate.port.js';
import { ShopeeDynamicJournal } from '../affiliate/infrastructure/shopee-dynamic-journal.js';
import { ShopeeDynamicService } from '../affiliate/application/shopee-dynamic.service.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import {
  affiliateHash,
  type AffiliateProduct,
} from '../affiliate/domain/affiliate-contracts.js';
import {
  validateDynamicConfiguration,
  type ShopeeDynamicConfiguration,
} from '../affiliate/domain/shopee-dynamic.js';
import { provisionQcReviewer } from '../publishing/application/local-qc-identity.js';
import { ProjectShopeePreparationLock } from './project-shopee-preparation-lock.js';
import {
  PROJECT_SNAPSHOT_READER,
  type ProjectSnapshotReader,
} from '../project/application/ports/project-snapshot-reader.port.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const at = '2026-11-12T12:00:00Z',
  projectId = 'project_handoff';
let app: INestApplication,
  f: ReturnType<typeof p2EditorialFixture>,
  provider: FakeShopeeAffiliate,
  config: ShopeeDynamicConfiguration,
  directory: string,
  imagePath: string,
  credential: string;
const digest = () =>
  createHash('sha256').update(readFileSync(f.database)).digest('hex');
function command(occurrenceId = 'occurrence_1') {
  const configuration = validateDynamicConfiguration(config);
  const identity = {
    projectId,
    projectVersion: 1,
    occurrenceId,
    requestedAt: new Date(at).toISOString(),
    mode: 'FAKE',
  };
  return {
    schemaVersion: 'operations-project-shopee-handoff/1.0.0',
    mode: 'FAKE',
    intent: 'PREPARE_FAKE_CATALOG',
    projectVersion: 1,
    occurrenceId,
    requestedAt: at,
    configuration,
    configurationHash: affiliateHash(configuration),
    identityHash: affiliateHash(identity),
  };
}
async function start() {
  const module = await Test.createTestingModule({
    imports: [OperationsModule],
  }).compile();
  app = module.createNestApplication();
  app.useLogger(false);
  await app.init();
  provider = app.get(SHOPEE_AFFILIATE);
}
const submit = (body: object = command()) =>
  request(app.getHttpServer())
    .post(`/operations/projects/${projectId}/shopee-discovery/prepare`)
    .set('Authorization', 'Bearer ' + credential)
    .send(body);
beforeEach(async () => {
  f = p2EditorialFixture();
  provisionSchema(f.base.db);
  directory = dirname(f.database);
  f.base.create({
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
  });
  for (const [key, value] of Object.entries({
    PROJECT_API_DATABASE: f.database,
    SOCIAL_HISTORY_DATABASE: f.database,
    SHOPEE_AFFILIATE_MODE: 'fake',
    CAMPAIGN_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_SCHEDULER_ENABLED: 'false',
    CONTENT_EDITORIAL_PROVIDER: 'fake',
  }))
    vi.stubEnv(key, value);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_FORBIDDEN');
    }),
  );
  const identities = join(directory, 'identities.json'),
    secret = join(directory, 'reviewer');
  await provisionQcReviewer(identities, 'fixture_reviewer', secret);
  credential = readFileSync(secret, 'utf8').trim();
  vi.stubEnv('QC_IDENTITIES_FILE', identities);
  config = {
    projectId,
    niche: 'tecnologia',
    queries: [{ keyword: 'Synthetic', limit: 1 }],
    maxPages: 2,
    maxSelected: 1,
    excludedProductIds: [],
    excludedShopIds: [],
    excludedTerms: [],
    subIds: ['FICTITIOUS_TEST_ONLY'],
    authorizations: [],
  };
  await start();
});
afterEach(async () => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    await app?.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    f?.cleanup();
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

test('preview stays read-only and an explicit command without proof remains WAITING without registering a campaign', async () => {
  const before = digest();
  const links = vi.spyOn(provider, 'generateLink');
  await request(app.getHttpServer())
    .post(`/operations/projects/${projectId}/shopee-discovery/preview`)
    .set('Authorization', 'Bearer ' + credential)
    .send({
      schemaVersion: 'operations-project-shopee-discovery/1.0.0',
      projectVersion: 1,
      niche: 'tecnologia',
      queries: config.queries,
      maxPages: 2,
      maxCandidates: 2,
    })
    .expect(200);
  expect(digest()).toBe(before);
  const response = await submit()
    .expect(201)
    .expect('Cache-Control', 'no-store');
  expect(response.body.status).toBe('WAITING');
  expect(response.body.decisions[0].reasons).toEqual([
    'PRODUCT_AUTHORIZATION_REQUIRED',
  ]);
  expect(response.body.decisions[1].reasons).toContain('OFFER_DATA_INCOMPLETE');
  expect(app.get(AffiliateService).catalogCandidates(projectId)).toEqual([]);
  expect(links).not.toHaveBeenCalled();
});
test('the existing FAKE provider prepares the first campaign and exact briefing, with restart, concurrent retry and frozen replay', async () => {
  const offer = await authorizeFixture();
  const input = command();
  const links = vi.spyOn(provider, 'generateLink');
  const response = await submit(input).expect(201);
  expect(response.body.status).toBe('PREPARED');
  expect(response.body.briefing).toMatchObject({
    productId: `shopee_${offer.productId}`,
    productRevision: 1,
    campaignId: `shopee_${projectId}_${offer.productId}`,
    campaignRevision: 1,
    offerId: offer.offerId,
    shopId: offer.shopId,
    affiliateUrl: offer.affiliateUrl,
    selectionMethod: 'ROUND_ROBIN_ID_V1',
  });
  expect(response.body.briefing.cta).toBeTruthy();
  expect(response.body.briefing.disclosure).toContain('Publicidade');
  expect(links).toHaveBeenCalledTimes(1);
  const affiliate = app.get(AffiliateService);
  expect(affiliate.catalogCandidates(projectId)).toHaveLength(1);
  expect(
    await affiliate.getBriefing(response.body.briefing.briefingId),
  ).toMatchObject({
    contentHash: response.body.briefing.contentHash,
    productId: response.body.briefing.productId,
  });
  expect(
    await affiliate.resolveBriefingSource(response.body.briefing.briefingId),
  ).toMatchObject({
    campaignRevision: 1,
    offer: { productId: offer.productId, provenance: { source: 'FAKE' } },
  });
  await app.close();
  await start();
  const queries = vi.spyOn(provider, 'queryOfferPage'),
    afterRestartLinks = vi.spyOn(provider, 'generateLink');
  const responses = await Promise.all([submit(input), submit(input)]);
  expect(responses.some((r) => r.status === 201)).toBe(true);
  for (const r of responses)
    if (r.status === 201) expect(r.body).toEqual(response.body);
    else expect(r.status).toBe(409);
  expect((await submit(input).expect(201)).body).toEqual(response.body);
  expect(queries).not.toHaveBeenCalled();
  expect(afterRestartLinks).not.toHaveBeenCalled();
  expect(app.get(AffiliateService).catalogCandidates(projectId)).toHaveLength(
    1,
  );
  expect(response.body).toMatchObject({
    productionScheduled: false,
    publicationAuthorized: false,
    spendingAuthorized: false,
    operationalAcceptance: 'NOT_ASSESSED',
  });
});
test.each(['association', 'commercial', 'rights'] as const)(
  'missing %s proof is WAITING with no partial catalog',
  async (missing) => {
    await authorizeFixture();
    const authorization = config.authorizations[0];
    if (missing === 'association') delete authorization.association;
    if (missing === 'commercial') delete authorization.commercialApproval;
    if (missing === 'rights')
      authorization.product.evidence = authorization.product.evidence.filter(
        (e) => e.kind !== 'MEDIA_USAGE_RIGHT',
      );
    const response = await submit().expect(201);
    expect(response.body.status).toBe('WAITING');
    expect(app.get(AffiliateService).catalogCandidates(projectId)).toEqual([]);
    expect(response.body.briefing).toBeNull();
  },
);
test.each([
  { intent: 'PREPARE_LIVE' },
  { confirmation: true },
  { identityHash: '0'.repeat(64) },
  { configurationHash: '0'.repeat(64) },
  { projectVersion: 2 },
])('invalid/unconfirmed scope does not write %j', async (change) => {
  const before = digest();
  await submit({ ...command(), ...change }).expect(400);
  expect(digest()).toBe(before);
});
test('LIVE and unauthenticated commands are refused before discovery and writes', async () => {
  const before = digest(),
    queries = vi.spyOn(provider, 'queryOfferPage');
  await request(app.getHttpServer())
    .post(`/operations/projects/${projectId}/shopee-discovery/prepare`)
    .send(command())
    .expect(401);
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
  await submit().expect(403);
  expect(queries).not.toHaveBeenCalled();
  expect(digest()).toBe(before);
});
test('a changed scope for the same occurrence conflicts without a new link or revision', async () => {
  await authorizeFixture();
  await submit().expect(201);
  const links = vi.spyOn(provider, 'generateLink');
  config.excludedProductIds.push('unrelated');
  await submit().expect(409);
  expect(links).not.toHaveBeenCalled();
  expect(
    (await app.get(AffiliateService).catalogCandidates(projectId))[0].campaign
      .revision,
  ).toBe(1);
});

test.each(['same', 'different'])(
  'concurrent %s occurrence cannot replace the active project configuration',
  async (kind) => {
    await authorizeFixture();
    const input = command();
    const catalog = app.get(ShopeeCatalogService),
      original = catalog.discover.bind(catalog);
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve;
      });
    vi.spyOn(catalog, 'discover').mockImplementationOnce(async (...args) => {
      entered();
      await blocked;
      return original(...args);
    });
    const links = vi.spyOn(provider, 'generateLink');
    const first = submit(input).then((r) => r);
    await started;
    try {
      await submit(kind === 'same' ? input : command('occurrence_2')).expect(
        409,
      );
      await request(app.getHttpServer())
        .post('/operations/campaigns/shopee-dynamic')
        .set('Authorization', 'Bearer ' + credential)
        .send({ request: {}, configuration: config })
        .expect(409);
    } finally {
      release();
    }
    expect((await first).status).toBe(201);
    expect(links).toHaveBeenCalledTimes(1);
    expect((await submit(input).expect(201)).body.status).toBe('PREPARED');
  },
);
test.each(['discovery', 'reservation'])(
  'restart after %s commit requires verification and never initiates another link',
  async (stage) => {
    await authorizeFixture();
    const dynamic = app.get(ShopeeDynamicService);
    const journal = (dynamic as unknown as { journal: ShopeeDynamicJournal })
      .journal;
    const links = vi.spyOn(provider, 'generateLink');
    if (stage === 'discovery') {
      const put = journal.put.bind(journal);
      let interrupted = false;
      vi.spyOn(journal, 'put').mockImplementation((...args) => {
        const value = put(...args);
        if (!interrupted && args[0] === 'CYCLE' && args[2] === 'DISCOVERY') {
          interrupted = true;
          throw new Error('ISOLATED_INTERRUPTION_AFTER_DISCOVERY');
        }
        return value;
      });
    } else {
      const claim = journal.claimLink.bind(journal);
      vi.spyOn(journal, 'claimLink').mockImplementationOnce((...args) => {
        claim(...args);
        throw new Error('ISOLATED_INTERRUPTION_AFTER_RESERVATION');
      });
    }
    const input = command();
    await submit(input).expect(503);
    expect(links).not.toHaveBeenCalled();
    await app.close();
    await start();
    const afterRestartLinks = vi.spyOn(provider, 'generateLink');
    const result = await submit(input).expect(201);
    expect(result.body.status).toBe('WAITING');
    expect(result.body.decisions[0].reasons).toContain(
      'LINK_RECONCILIATION_REQUIRED',
    );
    expect(afterRestartLinks).not.toHaveBeenCalled();
    expect(app.get(AffiliateService).catalogCandidates(projectId)).toEqual([]);
  },
);
test('an uncertain provider mutation stays WAITING on replay without another link', async () => {
  await authorizeFixture();
  const generate = provider.generateLink.bind(provider);
  const links = vi
    .spyOn(provider, 'generateLink')
    .mockImplementationOnce(async (...args) => {
      await generate(...args);
      throw new Error('ISOLATED_RESPONSE_LOST');
    });
  const input = command();
  const first = await submit(input).expect(201);
  expect(first.body.status).toBe('WAITING');
  expect(first.body.decisions[0].reasons).toContain(
    'LINK_RECONCILIATION_REQUIRED',
  );
  expect((await submit(input).expect(201)).body).toEqual(first.body);
  expect(links).toHaveBeenCalledTimes(1);
});
test.each(['catalog', 'briefing'])(
  'retry after the %s boundary reuses the confirmed FAKE link and official receipts',
  async (stage) => {
    await authorizeFixture();
    const affiliate = app.get(AffiliateService),
      links = vi.spyOn(provider, 'generateLink');
    if (stage === 'catalog')
      vi.spyOn(affiliate, 'prepareShopeeCatalog').mockRejectedValueOnce(
        new Error('ISOLATED_CATALOG_UNAVAILABLE'),
      );
    else
      vi.spyOn(affiliate, 'createCatalogBriefing').mockRejectedValueOnce(
        new Error('ISOLATED_BRIEFING_UNAVAILABLE'),
      );
    const input = command();
    await submit(input).expect(503);
    expect(links).toHaveBeenCalledTimes(1);
    if (stage === 'catalog')
      expect(affiliate.catalogCandidates(projectId)).toEqual([]);
    await app.close();
    await start();
    const replayLinks = vi.spyOn(provider, 'generateLink');
    const replay = await submit(input).expect(201);
    expect(replay.body.status).toBe('PREPARED');
    expect(replayLinks).not.toHaveBeenCalled();
    expect(app.get(AffiliateService).catalogCandidates(projectId)).toHaveLength(
      1,
    );
  },
);
test('a new product revision creates the correct campaign/briefing revision without rewriting the previous occurrence', async () => {
  await authorizeFixture();
  const firstInput = command();
  const first = await submit(firstInput).expect(201);
  const authorization = config.authorizations[0];
  authorization.product = { ...authorization.product, revision: 2 };
  authorization.commercialApproval = {
    sourceRef: 'FICTITIOUS_TEST_ONLY:revision_2',
    recordedAt: at,
    subjectHash: affiliateHash({
      projectId,
      externalProductId: authorization.externalProductId,
      shopId: authorization.shopId,
      productHash: affiliateHash(authorization.product),
    }),
  };
  const second = await submit(command('occurrence_revision_2')).expect(201);
  expect(second.body.briefing.productRevision).toBe(2);
  expect(second.body.briefing.campaignRevision).toBe(2);
  expect((await submit(firstInput).expect(201)).body).toEqual(first.body);
});

test('a catalog revision without the official preparation receipt cannot be selected on handoff', async () => {
  await authorizeFixture();
  const affiliate = app.get<AffiliateService>(AffiliateService);
  const candidates = affiliate.catalogCandidates.bind(affiliate);
  const catalog = vi
    .spyOn(affiliate, 'catalogCandidates')
    .mockImplementationOnce((id) =>
      candidates(id).map((candidate) => ({
        ...candidate,
        campaign: {
          ...candidate.campaign,
          revision: candidate.campaign.revision + 1,
        },
      })),
    );
  const briefing = vi.spyOn(affiliate, 'createCatalogBriefing');
  const links = vi.spyOn(provider, 'generateLink');
  await submit().expect(409);
  expect(briefing).not.toHaveBeenCalled();
  catalog.mockRestore();
  const result = await submit().expect(201);
  expect(result.body.briefing.campaignRevision).toBe(1);
  expect(links).toHaveBeenCalledTimes(1);
});
test('a correctly hashed stale project version or incompatible niche fails before any journal write', async () => {
  let before = digest();
  const stale = command();
  stale.projectVersion = 2;
  stale.identityHash = affiliateHash({
    projectId,
    projectVersion: 2,
    occurrenceId: stale.occurrenceId,
    requestedAt: new Date(at).toISOString(),
    mode: 'FAKE',
  });
  await submit(stale).expect(400);
  expect(digest()).toBe(before);
  config.niche = 'outro';
  before = digest();
  await submit().expect(400);
  expect(digest()).toBe(before);
});

test('project version is rechecked at the preparation boundary before journal writes', async () => {
  const reader = app.get<ProjectSnapshotReader>(PROJECT_SNAPSHOT_READER);
  const project = await reader.get(projectId);
  const read = vi.spyOn(reader, 'get');
  read.mockResolvedValueOnce(project).mockResolvedValueOnce({
    ...project!,
    project: { ...project!.project, version: 2 },
  });
  const before = digest();
  await submit().expect(400);
  expect(digest()).toBe(before);
});

test('an abandoned persisted project lease blocks restart until expiry, then resumes without a timer', async () => {
  const journal = app.get(ProjectShopeePreparationLock).journal;
  journal.initialize();
  const now = Date.now();
  journal.put('OPERATIONS_PROJECT_LEASE', projectId, '1', {
    generation: 1,
    expiresAt: now + 300000,
  });
  await app.close();
  await start();
  const queries = vi.spyOn(provider, 'queryOfferPage');
  await submit().expect(409);
  expect(queries).not.toHaveBeenCalled();
  vi.spyOn(Date, 'now').mockReturnValue(now + 300001);
  expect((await submit().expect(201)).body.status).toBe('WAITING');
  expect(queries).toHaveBeenCalled();
});
