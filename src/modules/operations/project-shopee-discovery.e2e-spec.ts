import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { OperationsModule } from './operations.module.js';
import { SHOPEE_AFFILIATE } from '../affiliate/application/ports/shopee-affiliate.port.js';
import { FakeShopeeAffiliate } from '../affiliate/infrastructure/shopee-affiliate.provider.js';
import type { ShopeeAffiliateOfferDetails } from '../affiliate/domain/shopee-affiliate-contracts.js';
import {
  operationalQcIdentity,
  QcIdentityError,
} from '../publishing/application/local-qc-identity.js';

let app: INestApplication,
  f: ReturnType<typeof p2EditorialFixture>,
  provider: FakeShopeeAffiliate;
const pageCalls = vi.fn(),
  linkCalls = vi.fn();
let offers: ShopeeAffiliateOfferDetails[];
let before: string;
const digest = () =>
  createHash('sha256').update(readFileSync(f.database)).digest('hex');
const input = () => ({
  schemaVersion: 'operations-project-shopee-discovery/1.0.0',
  projectVersion: 1,
  niche: 'tecnologia',
  queries: [{ keyword: 'fone', limit: 10 }],
  maxPages: 2,
  maxCandidates: 5,
});
const preview = (id = 'project_empty', body: object = input()) =>
  request(app.getHttpServer())
    .post(`/operations/projects/${id}/shopee-discovery/preview`)
    .set('Authorization', 'Bearer isolated-fixture')
    .send(body);
beforeEach(async () => {
  pageCalls.mockClear();
  linkCalls.mockClear();
  f = p2EditorialFixture();
  provisionSchema(f.base.db);
  f.base.create({
    id: 'project_empty',
    name: 'Projeto sem campanhas',
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
  for (const [k, v] of Object.entries({
    PROJECT_API_DATABASE: f.database,
    SOCIAL_HISTORY_DATABASE: f.database,
    CAMPAIGN_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_SCHEDULER_ENABLED: 'false',
    SHOPEE_AFFILIATE_MODE: 'fake',
    CONTENT_EDITORIAL_PROVIDER: 'fake',
  }))
    vi.stubEnv(k, v);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_FORBIDDEN');
    }),
  );
  vi.spyOn(operationalQcIdentity, 'authenticate').mockImplementation(
    async (header) => {
      if (header !== 'Bearer isolated-fixture')
        throw new QcIdentityError('QC_AUTHENTICATION_REQUIRED', 401);
      return { id: 'fixture_reader', credentialHash: 'isolated-only' };
    },
  );
  provider = new FakeShopeeAffiliate();
  const sample = (await provider.queryOfferPage({ limit: 10 })).offers[0];
  offers = [
    {
      ...sample,
      productId: '10',
      shopId: '100',
      offerId: 'offer_10',
      name: 'Fone comum',
      price: { amount: '10', currency: 'BRL' },
      estimatedCommission: { amount: null, currency: null, rate: '0.1' },
    },
    {
      ...sample,
      productId: '20',
      shopId: '200',
      offerId: 'offer_20',
      name: 'Fone premium',
      price: { amount: '30', currency: 'BRL' },
      estimatedCommission: { amount: '6', currency: 'BRL', rate: '0.2' },
    },
    {
      ...sample,
      productId: '30',
      shopId: '300',
      offerId: 'offer_30',
      name: 'Fone sem comissao',
      price: { amount: null, currency: null },
      estimatedCommission: { amount: null, currency: null, rate: null },
    },
  ];
  vi.spyOn(provider, 'queryOfferPage').mockImplementation(async (query) => {
    pageCalls(query);
    const page = query?.page ?? 1,
      limit = query?.limit ?? 10,
      offset = (page - 1) * limit;
    return {
      offers: offers.slice(offset, offset + limit),
      pageInfo: {
        page,
        limit,
        hasNextPage: offset + limit < offers.length,
        nextPage: offset + limit < offers.length ? page + 1 : null,
      },
    };
  });
  vi.spyOn(provider, 'generateLink').mockImplementation(async () => {
    linkCalls();
    throw new Error('LINK_FORBIDDEN');
  });
  const module = await Test.createTestingModule({ imports: [OperationsModule] })
    .overrideProvider(SHOPEE_AFFILIATE)
    .useValue(provider)
    .compile();
  app = module.createNestApplication();
  app.useLogger(false);
  await app.init();
  before = digest();
});
afterEach(async () => {
  try {
    expect(digest()).toBe(before);
    expect(linkCalls).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    await app?.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    f?.cleanup();
  }
});
test.each(['project_empty', 'project_001'])(
  'project %s discovers candidates independently of campaigns and preserves SQLite on replay',
  async (id) => {
    const a = await preview(id).expect(200).expect('Cache-Control', 'no-store');
    const b = await preview(id).expect(200);
    expect(b.body).toEqual(a.body);
    expect(pageCalls).toHaveBeenCalledTimes(2);
    expect(a.body.schemaVersion).toBe(
      'operations-project-shopee-discovery-preview/1.0.0',
    );
    expect(a.body.candidates.map((c: any) => c.productId)).toEqual([
      '20',
      '10',
      '30',
    ]);
    expect(a.body.candidates[2].estimatedCommission.rate).toBeNull();
    expect(a.body.candidates[2].price.amount).toBeNull();
    expect(a.body.candidates[0].requiredReviews).toContain(
      'MEDIA_RIGHTS_REQUIRED',
    );
    expect(a.body.candidates[0].eligibility).toBe('NOT_EVALUATED');
    expect(a.body.authorizationsGranted).toBe(false);
    expect(a.body.handoff).toMatchObject({
      next: 'REVIEW_RIGHTS_AND_ASSOCIATION',
      campaignCreated: false,
      registrationPerformed: false,
      linkGenerated: false,
    });
    expect(a.body.handoff.stages).toEqual([
      'PROJECT',
      'DISCOVERY',
      'CANDIDATES',
      'RIGHTS_AND_ASSOCIATION_REVIEW',
      'EXISTING_AFFILIATE_REGISTRATION',
      'CAMPAIGN',
      'BRIEFING',
      'OPERATIONS',
    ]);
    expect(a.body).not.toHaveProperty('campaignId');
    if (id === 'project_empty')
      expect(
        f.base.db
          .prepare(
            'SELECT COUNT(*) AS n FROM affiliate_campaign_revisions WHERE project_id=?',
          )
          .get(id)?.n,
      ).toBe(0);
  },
);
test.each([
  ['not_found', {}, 404],
  ['project_empty', { niche: 'outro' }, 400],
  ['project_empty', { projectVersion: 2 }, 400],
] as const)(
  'rejects invalid project context %s %j',
  async (id, change, status) => {
    await preview(id, { ...input(), ...change }).expect(status);
    expect(pageCalls).not.toHaveBeenCalled();
  },
);
test('no candidates is an honest empty response', async () => {
  offers = [];
  const r = await preview().expect(200);
  expect(r.body.candidates).toEqual([]);
  expect(r.body.truncated).toBe(false);
});
test('uses Affiliate ranking and filters, retaining rejection reasons', async () => {
  const r = await preview('project_empty', {
    ...input(),
    maxPrice: '20',
    excludedShopIds: ['300'],
  }).expect(200);
  expect(r.body.candidates.map((c: any) => c.productId)).toEqual(['10']);
  expect(r.body.rejected.map((c: any) => c.reasons)).toEqual([
    ['PRICE_OUTSIDE_POLICY'],
    ['EXCLUDED_SHOP'],
  ]);
});
test('unknown commission stays unknown and requires evidence when the commercial filter is present', async () => {
  const r = await preview('project_empty', {
    ...input(),
    minCommissionRate: '0.15',
  }).expect(200);
  expect(r.body.rejected[0].reasons).toContain('COMMISSION_BELOW_POLICY');
  const unknown = r.body.candidates.find((c: any) => c.productId === '30');
  expect(unknown.estimatedCommission.rate).toBeNull();
  expect(unknown.reasons).toContain('COMMISSION_ESTIMATE_REQUIRED');
});
test('page and candidate limits explicitly report truncation', async () => {
  const a = await preview('project_empty', {
    ...input(),
    queries: [{ keyword: 'fone', limit: 1 }],
    maxPages: 1,
  }).expect(200);
  expect(a.body.limits.calls).toBe(1);
  expect(a.body.truncated).toBe(true);
  const b = await preview('project_empty', {
    ...input(),
    maxCandidates: 1,
  }).expect(200);
  expect(b.body.candidates).toHaveLength(1);
  expect(b.body.limits.omittedCandidates).toBe(2);
  expect(b.body.truncated).toBe(true);
});
test('LIVE is refused before any offer or link transport', async () => {
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
  await preview()
    .expect(403)
    .expect((r) =>
      expect(r.body).toEqual({ code: 'SHOPEE_PREVIEW_OFFLINE_ONLY' }),
    );
  expect(pageCalls).not.toHaveBeenCalled();
});
test('QC authentication is mandatory before discovery', async () => {
  await request(app.getHttpServer())
    .post('/operations/projects/project_empty/shopee-discovery/preview')
    .send(input())
    .expect(401);
  expect(pageCalls).not.toHaveBeenCalled();
});

test('only explicit operational fields are returned, without provider payloads or credential-bearing URLs', async () => {
  Object.assign(offers[0], {
    privatePayload: { credential: 'SECRET_NOT_FOR_RESPONSE' },
    productUrl: 'https://example.com/?token=SECRET_NOT_FOR_RESPONSE',
    affiliateUrl: 'https://example.com/?secret=SECRET_NOT_FOR_RESPONSE',
  });
  const response = await preview().expect(200);
  expect(JSON.stringify(response.body)).not.toContain(
    'SECRET_NOT_FOR_RESPONSE',
  );
  expect(response.body.candidates[1]).not.toHaveProperty('privatePayload');
});
