import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { OperationsModule } from './operations.module.js';
import { ShopeeProjectLiveAuthorizationService } from '../affiliate/application/shopee-project-live-authorization.service.js';
import { ShopeeCatalogService } from '../affiliate/application/shopee-catalog.service.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { validateDynamicConfiguration } from '../affiliate/domain/shopee-dynamic.js';
import type { ShopeeDynamicAuthorization } from '../affiliate/domain/shopee-dynamic.js';
import { ShopeeDynamicJournal } from '../affiliate/infrastructure/shopee-dynamic-journal.js';
import { normalizeShopeeOfferPage } from '../affiliate/infrastructure/shopee-offers.js';
import {
  operationalQcIdentity,
  QcIdentityError,
} from '../publishing/application/local-qc-identity.js';

const projectId = 'project_empty',
  at = '2026-11-12T12:00:00Z';
let app: INestApplication, f: ReturnType<typeof p2EditorialFixture>;
let beforeTables: string, beforeFile: string;
const effectMethods = [
  'approveDiscovery',
  'executeDiscovery',
  'approveLink',
  'reserveLink',
] as const;
const effects: ReturnType<typeof vi.spyOn>[] = [];
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const externalProductId = '116002',
  shopId = '716003';
const linkDraft = () => ({
  authorizationId: 'fixture_link_proposal',
  operatorId: 'fixture_operator',
  notBefore: at,
  expiresAt: '2026-11-12T13:00:00Z',
  evidenceRef: 'FICTITIOUS_TEST_ONLY:link-review',
  costBasis: 'UNKNOWN',
  costEvidenceRef: null,
});
function body(id = projectId) {
  const configuration = structuredClone(
    validateDynamicConfiguration({
      projectId: id,
      niche: 'tecnologia',
      queries: [{ keyword: 'fone', limit: 1 }],
      maxPages: 1,
      maxSelected: 1,
      excludedProductIds: [],
      excludedShopIds: [],
      excludedTerms: [],
      subIds: [],
      authorizations: [],
    }),
  );
  return {
    schemaVersion: 'operations-project-shopee-live-preflight/1.0.0',
    projectId: id,
    projectVersion: 1,
    occurrenceId: 'fixture_occurrence',
    configuration,
    discoveryScope: {
      schemaVersion: 'shopee-project-discovery-authorization/1.0.0',
      kind: 'PROJECT_DISCOVERY_AUTHORIZATION',
      authorizationId: 'fixture_proposal',
      projectId: id,
      projectVersion: 1,
      occurrenceId: 'fixture_occurrence',
      configurationHash: affiliateHash(configuration),
      maxOfferPages: 1,
      maxLinks: 0,
      notBefore: at,
      expiresAt: '2026-11-12T13:00:00Z',
      evidenceRef: 'FICTITIOUS_TEST_ONLY:proposal',
      costBasis: 'UNKNOWN',
      costEvidenceRef: null,
    },
    snapshotHash: null as string | null,
    link: null as { draft: unknown; authorization: unknown } | null,
  };
}
const tables = () =>
  JSON.stringify(
    f.base.db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((row) => ({
        ...row,
        rows: f.base.db
          .prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}"`)
          .all(),
      })),
  );
const file = () =>
  createHash('sha256').update(readFileSync(f.database)).digest('hex');
const submit = (value: object = body(), id = projectId) =>
  request(app.getHttpServer())
    .post(`/operations/projects/${id}/shopee-live/preflight`)
    .set('Authorization', 'Bearer isolated-fixture')
    .send(value);
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at));
  f = p2EditorialFixture();
  provisionSchema(f.base.db);
  f.base.create({
    id: projectId,
    name: 'FICTITIOUS_TEST_ONLY',
    version: 1,
    niche: 'Tecnologia',
    subniches: [],
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
    CONTENT_EDITORIAL_PROVIDER: 'fake',
    CAMPAIGN_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_SCHEDULER_ENABLED: 'false',
  }))
    vi.stubEnv(key, value);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_FORBIDDEN');
    }),
  );
  vi.spyOn(operationalQcIdentity, 'authenticate').mockImplementation(
    async (raw) => {
      if (raw !== 'Bearer isolated-fixture')
        throw new QcIdentityError('QC_IDENTITY_REQUIRED', 401);
      return { id: 'fixture_operator' } as never;
    },
  );
  vi.spyOn(operationalQcIdentity, 'assertActive').mockImplementation(
    (raw) => raw as never,
  );
  const module = await Test.createTestingModule({
    imports: [OperationsModule],
  }).compile();
  app = module.createNestApplication();
  app.useLogger(false);
  await app.init();
  effects.length = 0;
  for (const name of effectMethods)
    effects.push(
      vi.spyOn(ShopeeProjectLiveAuthorizationService.prototype, name),
    );
  effects.push(vi.spyOn(app.get(ShopeeCatalogService), 'discover'));
  effects.push(vi.spyOn(app.get(AffiliateService), 'prepareShopeeCatalog'));
  beforeTables = tables();
  beforeFile = file();
});
afterEach(async () => {
  try {
    expect(tables()).toBe(beforeTables);
    expect(file()).toBe(beforeFile);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    for (const effect of effects) expect(effect).not.toHaveBeenCalled();
  } finally {
    await app?.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    f.cleanup();
  }
});
test('project without a campaign receives a read-only, financially blocked proposal with independent link permission', async () => {
  const response = await submit()
    .expect(200)
    .expect('Cache-Control', 'no-store');
  expect(response.body).toMatchObject({
    schemaVersion: 'operations-project-shopee-live-preflight/1.0.0',
    project: { projectId, projectVersion: 1 },
    campaignRequiredForDiscovery: false,
    discovery: {
      authorizationStatus: 'NOT_GRANTED',
      maxOfferPages: 1,
      maxLinks: 0,
    },
    finance: {
      status: 'BLOCKED_COST_UNCONFIRMED',
      trustedReaderConfigured: false,
    },
    snapshot: { status: 'NOT_STARTED' },
    link: { status: 'SNAPSHOT_REQUIRED', authorizationStatus: 'NOT_GRANTED' },
    executionAllowed: false,
  });
  expect(response.body.discovery.scopeHash).toMatch(/^[a-f0-9]{64}$/);
  expect(response.body.blockers).toContain('BLOCKED_COST_UNCONFIRMED');
  expect(JSON.stringify(response.body)).not.toContain(
    'FICTITIOUS_TEST_ONLY:proposal',
  );
});

test('an existing campaign does not change project discovery authorization', async () => {
  const result = await submit(body('project_001'), 'project_001').expect(200);
  expect(result.body.campaignRequiredForDiscovery).toBe(false);
  expect(result.body.executionAllowed).toBe(false);
});
test.each([
  'UNKNOWN',
  'PROVISIONAL_NO_CHARGE_ASSUMPTION_OPERATOR_ACCEPTED',
  'NO_CHARGE_CONFIRMED',
])(
  'documentary cost basis %s cannot bypass the missing trusted reader',
  async (basis) => {
    const input = body();
    input.discoveryScope.costBasis = basis;
    input.discoveryScope.costEvidenceRef = 'FICTITIOUS_TEST_ONLY:cost' as never;
    const result = await submit(input).expect(200);
    expect(result.body.finance.status).toBe('BLOCKED_COST_UNCONFIRMED');
    expect(result.body.executionAllowed).toBe(false);
  },
);
test.each([
  'project',
  'version',
  'niche',
  'configuration',
  'scope-project',
  'scope-occurrence',
  'links',
  'pages',
  'confirmation',
  'credentials',
  'snapshot-input',
])('rejects invalid %s before effects', async (kind) => {
  const input = body();
  if (kind === 'project') input.projectId = 'another_project';
  if (kind === 'version') {
    input.projectVersion = 2;
    input.discoveryScope.projectVersion = 2;
  }
  if (kind === 'niche') {
    input.configuration.niche = 'outro';
    input.discoveryScope.configurationHash = affiliateHash(input.configuration);
  }
  if (kind === 'configuration')
    input.discoveryScope.configurationHash = '0'.repeat(64);
  if (kind === 'scope-project')
    input.discoveryScope.projectId = 'another_project';
  if (kind === 'scope-occurrence')
    input.discoveryScope.occurrenceId = 'another_occurrence';
  if (kind === 'links') input.discoveryScope.maxLinks = 1;
  if (kind === 'pages') input.discoveryScope.maxOfferPages = 0;
  if (kind === 'snapshot-input') input.snapshotHash = 'invalid';
  await submit({
    ...input,
    ...(kind === 'confirmation' ? { confirmed: true } : {}),
    ...(kind === 'credentials' ? { token: 'PRIVATE_SENTINEL' } : {}),
  }).expect(400);
});
test('missing project returns a sanitized 404', async () => {
  const result = await submit(
    body('project_missing'),
    'project_missing',
  ).expect(404);
  expect(result.body).toEqual({ code: 'PROJECT_NOT_FOUND' });
});
test('authentication is required and error responses are not cached', async () => {
  await request(app.getHttpServer())
    .post(`/operations/projects/${projectId}/shopee-live/preflight`)
    .send(body())
    .expect(401)
    .expect('Cache-Control', 'no-store');
});
test('unexpected reader failures are sanitized', async () => {
  vi.spyOn(
    ShopeeProjectLiveAuthorizationService.prototype,
    'inspectDiscovery',
  ).mockRejectedValueOnce(new Error('PRIVATE_SENTINEL'));
  const result = await submit().expect(503);
  expect(result.body).toEqual({ code: 'SHOPEE_PROJECT_PREFLIGHT_UNAVAILABLE' });
});

async function frozenFixture() {
  const input = body();
  // Synthetic persisted facts in a disposable database, never evidence of real discovery.
  const page = normalizeShopeeOfferPage(
    {
      data: {
        productOfferV2: {
          nodes: [
            {
              itemId: externalProductId,
              shopId,
              productName: 'FICTITIOUS_TEST_ONLY',
              price: '100',
              commissionRate: '0.2',
              commission: '20',
              imageUrl: 'https://fixture.invalid/image.png',
              productLink: `https://shopee.com.br/product/${shopId}/${externalProductId}`,
              offerLink: 'https://s.shopee.com.br/FICTITIOUS_TEST_ONLY',
            },
          ],
          pageInfo: { page: 1, limit: 1, hasNextPage: false },
        },
      },
    },
    { page: 1, limit: 1 },
    at,
  );
  const identity = {
    projectId,
    projectVersion: 1,
    occurrenceId: input.occurrenceId,
  };
  const facts = {
    schemaVersion: 'shopee-project-discovery-result/1.0.0',
    identity,
    authorizationId: input.discoveryScope.authorizationId,
    scopeHash: affiliateHash(input.discoveryScope),
    configuration: input.configuration,
    discovery: { offers: page.offers, calls: 1, truncated: false },
    recordedAt: at,
  };
  const journal = new ShopeeDynamicJournal(f.database);
  journal.initialize();
  input.snapshotHash = affiliateHash(facts);
  journal.put('PROJECT_DISCOVERY', affiliateHash(identity), 'RESULT', {
    ...facts,
    snapshotHash: input.snapshotHash,
  });
  beforeTables = tables();
  beforeFile = file();
  return input;
}
function commercialFixture(): ShopeeDynamicAuthorization {
  const bytes = png(),
    hash = createHash('sha256').update(bytes).digest('hex');
  const root = join(dirname(f.database), 'media');
  vi.stubEnv('FFMPEG_MEDIA_ROOT', root);
  const path = join(root, 'sha256', hash.slice(0, 2), `${hash}.png`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  const spec = {
    id: 'fixture_spec',
    kind: 'PRODUCT_SPECIFICATION' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:spec',
    recordedAt: at,
  };
  const rights = {
    id: 'fixture_rights',
    kind: 'MEDIA_USAGE_RIGHT' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:license',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef: 'media:fixture',
      contentHash: hash,
      commercialUse: 'GRANTED' as const,
      processing: 'GRANTED' as const,
      localProcessing: true,
      externalProviders: [],
    },
  };
  const product = {
    schemaVersion: 'affiliate-product/2.0.0' as const,
    productId: `shopee_${externalProductId}`,
    revision: 1,
    name: 'FICTITIOUS_TEST_ONLY',
    brand: {
      status: 'NOT_PROVIDED' as const,
      name: null,
      evidenceRef: spec.id,
    },
    attributes: [{ name: 'tipo', value: 'TEST', evidenceRef: spec.id }],
    media: [{ mediaRef: 'media:fixture', evidenceRef: rights.id }],
    evidence: [spec, rights],
    localImage: {
      mediaReference: 'media:fixture',
      contentHash: hash,
      origin: 'AUTHORIZED_THIRD_PARTY' as const,
      provider: null,
      rights: {
        usageBasis: 'LICENSED' as const,
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
    externalProductId,
    shopId,
    product,
    mediaBinding: proof({
      externalProductId,
      shopId,
      imageUrl: 'https://fixture.invalid/image.png',
      mediaRef: 'media:fixture',
      contentHash: hash,
      faithful: true,
    }),
    commercialApproval: proof({
      projectId,
      externalProductId,
      shopId,
      productHash: affiliateHash(product),
    }),
  };
}
test.each([
  'missing',
  'mismatched',
  'unconfirmed',
  'different-configuration',
  'different-discovery-scope',
])('snapshot %s never reaches link preview', async (kind) => {
  const input = kind === 'missing' ? body() : await frozenFixture();
  input.link = { draft: linkDraft(), authorization: null };
  if (kind === 'missing' || kind === 'mismatched')
    input.snapshotHash = '0'.repeat(64);
  if (kind === 'unconfirmed') input.snapshotHash = null;
  if (kind === 'different-discovery-scope')
    input.discoveryScope.authorizationId = 'other_scope';
  if (kind === 'different-configuration') {
    input.configuration.excludedTerms.push('other');
    input.discoveryScope.configurationHash = affiliateHash(input.configuration);
  }
  const preview = vi.spyOn(
    ShopeeProjectLiveAuthorizationService.prototype,
    'previewLink',
  );
  const result = await submit(input).expect(200);
  expect(result.body.link.status).toBe('SNAPSHOT_REQUIRED');
  expect(preview).not.toHaveBeenCalled();
});
test.each([
  'none',
  'rights',
  'product',
  'product-identity',
  'commercial',
  'valid',
])(
  'frozen selection with %s commercial evidence stays unapproved and read-only',
  async (kind) => {
    const input = await frozenFixture();
    const evidence = kind === 'none' ? null : commercialFixture();
    if (evidence && kind === 'rights')
      evidence.product.evidence = evidence.product.evidence.filter(
        (e) => e.kind !== 'MEDIA_USAGE_RIGHT',
      );
    if (evidence && kind === 'product') evidence.externalProductId = '999';
    if (evidence && kind === 'product-identity')
      evidence.product.productId = 'shopee_999';
    if (evidence && kind === 'commercial') delete evidence.commercialApproval;
    input.link = { draft: linkDraft(), authorization: evidence };
    const preview = vi.spyOn(
      ShopeeProjectLiveAuthorizationService.prototype,
      'previewLink',
    );
    const result = await submit(input).expect(200);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(result.body.snapshot.status).toBe('FROZEN');
    expect(result.body.link.authorizationStatus).toBe('NOT_GRANTED');
    expect(result.body.link.associationVerified).toBe(false);
    expect(result.body.executionAllowed).toBe(false);
    if (kind === 'valid') {
      expect(result.body.link.status).toBe('PROPOSED_BLOCKED');
      expect(result.body.link.scopeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.body.link.selection.productId).toBe(externalProductId);
    } else expect(result.body.link.status).toBe('EVIDENCE_REQUIRED');
    expect(JSON.stringify(result.body)).not.toContain('FICTITIOUS_TEST_ONLY:');
  },
);
