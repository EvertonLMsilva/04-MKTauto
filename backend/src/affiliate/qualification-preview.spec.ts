import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { QualificationPreviewService } from './application/qualification-preview.service.js';
import { QualificationPreviewController } from './qualification-preview.controller.js';
import { AffiliateService } from './application/affiliate.service.js';
import { SqliteAffiliatePersistence } from './infrastructure/sqlite-affiliate.persistence.js';
import { affiliateHash } from './domain/affiliate-contracts.js';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { runQualificationPreview } from './preview-product.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);

const at = '2026-11-10T12:00:00Z';
let root: string;
let f: ReturnType<typeof p2EditorialFixture>;
let feeds: FeedQualificationService;
let preview: QualificationPreviewService;
let input: any;
let factory: SqliteAffiliatePersistence;
let projects: any;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'affiliate-preview-'));
  writeFileSync(
    join(root, 'feed.csv'),
    'itemid,title,price,product_link,global_category2\n4251540175,Cesto de fixture N04,45.9,https://shopee.com.br/product/7/4251540175,Kitchenware\n',
  );
  writeFileSync(
    join(root, 'config.json'),
    JSON.stringify({
      feeds: [
        {
          feedId: 'fixture',
          provider: 'shopee',
          sourcePath: 'feed.csv',
          columns: { externalId: 'itemid', name: 'title' },
          delimiter: ',',
          maxRecordChars: 1048576,
        },
      ],
    }),
  );
  vi.stubEnv('AFFILIATE_DISCOVERY_CONFIG', join(root, 'config.json'));
  vi.stubEnv('FFMPEG_MEDIA_ROOT', join(root, 'media'));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('NETWORK_FORBIDDEN'),
  );
  f = p2EditorialFixture({ projectId: 'project_kate_mkt' });
  factory = new SqliteAffiliatePersistence(f.database);
  projects = {
    get: async (id: string, version?: number) => f.base.get(id, version),
  };
  feeds = new FeedQualificationService();
  preview = new QualificationPreviewService(feeds, factory, projects);
  input = {
    reportId: (await feeds.qualify()).reportId,
    externalProductId: '4251540175',
    projectId: 'project_kate_mkt',
    recordedAt: at,
  };
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  f.cleanup();
  rmSync(root, { recursive: true, force: true });
});
async function complete() {
  const initial = await preview.preview(input);
  const product = structuredClone(initial.productDraft.product) as any;
  const bytes = png();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const dir = join(root, 'media', 'sha256', hash.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, hash + '.png');
  writeFileSync(path, bytes);
  const mediaRef = 'media:fixture_image';
  const grant = {
    id: 'ev_fixture_media',
    kind: 'MEDIA_USAGE_RIGHT',
    sourceRef: 'FICTITIOUS_TEST_ONLY:commercial-local-reusable-permission',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef,
      contentHash: hash,
      commercialUse: 'GRANTED',
      processing: 'GRANTED',
      localProcessing: true,
      externalProviders: [],
    },
  };
  product.media = [{ mediaRef, evidenceRef: grant.id }];
  product.evidence.push(grant);
  product.localImage = {
    mediaReference: mediaRef,
    contentHash: hash,
    origin: 'OPERATOR_OWNED',
    provider: null,
    rights: {
      usageBasis: 'OWNED',
      commercialUseAllowed: true,
      evidence: [grant],
    },
  };
  const campaign = {
    ...(initial.offerDraft.campaign as any),
    affiliateUrl: 'https://s.shopee.com.br/fixture_only',
  };
  const affiliateEvidence = {
    sourceRef: 'FICTITIOUS_TEST_ONLY:affiliate-association',
    recordedAt: at,
    subjectHash: affiliateHash({
      externalProductId: input.externalProductId,
      affiliateUrl: campaign.affiliateUrl,
    }),
  };
  return { request: { ...input, product, campaign, affiliateEvidence }, path };
}
test('missing brand/currency/image/link creates current DTO drafts and exact pending gates without database writes', async () => {
  const before = readFileSync(f.database);
  const result = await preview.preview(input);
  expect(result.status).toBe('BLOCKED');
  expect(result.finalPayload).toBeNull();
  expect(result.productDraft.product).toMatchObject({
    schemaVersion: 'affiliate-product/2.0.0',
    productId: 'prod_shopee_4251540175',
    brand: { status: 'NOT_PROVIDED', name: null },
  });
  expect(result.productDraft.product).not.toHaveProperty('price');
  expect(result.commercialSnapshot.historicalPrice).toMatchObject({
    amount: '45.9',
    currency: null,
    current: false,
  });
  expect(result.offerDraft.campaign).toMatchObject({
    projectId: 'project_kate_mkt',
    affiliateUrl: null,
  });
  expect(result.pending).toEqual(
    expect.arrayContaining([
      'AFFILIATE_LINK_REQUIRED',
      'AFFILIATE_ASSOCIATION_EVIDENCE_REQUIRED',
      'LOCAL_IMAGE_REQUIRED',
      'REUSABLE_MEDIA_RIGHTS_REQUIRED',
    ]),
  );
  expect(result.registrationAuthorized).toBe(false);
  expect(
    await new QualificationPreviewService(
      new FeedQualificationService(),
      factory,
      projects,
    ).preview(input),
  ).toEqual(result);
  expect(readFileSync(f.database)).toEqual(before);
});
test('complete fictitious evidence produces review payloads, never registration or approval', async () => {
  const c = await complete();
  const before = readFileSync(f.database);
  const result = await preview.preview(c.request);
  expect(result.status).toBe('READY_FOR_OPERATOR_REVIEW');
  expect(result.mediaEvidence.status).toBe('VERIFIED');
  expect(result.pending).toEqual([]);
  expect(result.registrationAuthorized).toBe(false);
  expect(result.finalPayload?.product).toEqual(result.productDraft);
  expect(result.finalPayload?.offer).toEqual(result.offerDraft);
  expect(
    await new QualificationPreviewService(
      new FeedQualificationService(),
      factory,
      projects,
    ).preview(c.request),
  ).toEqual(result);
  expect(readFileSync(f.database)).toEqual(before);
  expect(
    f.base.db
      .prepare(
        'SELECT COUNT(*) n FROM affiliate_product_revisions WHERE product_id=?',
      )
      .get('prod_shopee_4251540175')?.n,
  ).toBe(0);
});
test.each([
  'no-image',
  'no-rights',
  'local-denied',
  'scoped-rights',
  'no-affiliate-proof',
  'wrong-affiliate-proof',
  'malformed-evidence',
  'invalid-proof-date',
  'corrupt-bytes',
])('blocks %s without using source image URLs as permission', async (kind) => {
  const c = await complete();
  if (kind === 'no-image') delete c.request.product.localImage;
  if (kind === 'no-rights') c.request.product.localImage.rights.evidence = [];
  if (kind === 'local-denied')
    c.request.product.localImage.rights.evidence[0].mediaAuthorization.localProcessing = false;
  if (kind === 'scoped-rights')
    c.request.product.localImage.rights.evidence[0].mediaAuthorization.operationScope =
      'fixture_qc_only';
  if (kind === 'no-affiliate-proof')
    delete (c.request as any).affiliateEvidence;
  if (kind === 'wrong-affiliate-proof')
    c.request.affiliateEvidence.subjectHash = 'f'.repeat(64);
  if (kind === 'malformed-evidence') c.request.product.evidence.push(null);
  if (kind === 'invalid-proof-date')
    c.request.affiliateEvidence.recordedAt = '2026-11-10';
  if (kind === 'corrupt-bytes')
    writeFileSync(c.path, 'deliberately tampered fixture');
  const result = await preview.preview(c.request);
  expect(result.status).toBe('BLOCKED');
  expect(result.finalPayload).toBeNull();
  expect(result.catalogValidationPassed).toBe(false);
  if (kind === 'corrupt-bytes')
    expect(result.mediaEvidence.reason).toBe('LOCAL_IMAGE_HASH_MISMATCH');
});
test('existing revisions and subsequent offer revision remain explicit, without overwriting old revisions', async () => {
  const c = await complete();
  const ready = await preview.preview(c.request);
  const affiliate = new AffiliateService(factory, projects);
  await affiliate.registerProduct(ready.productDraft);
  await affiliate.registerCampaign(ready.offerDraft);
  const identical = await preview.preview(c.request);
  expect(identical.status).toBe('READY_FOR_OPERATOR_REVIEW');
  const conflict = structuredClone(c.request);
  conflict.campaign.cta = 'Outro CTA';
  expect((await preview.preview(conflict)).pending).toContain(
    'OFFER_REVISION_CONFLICT',
  );
  const next = structuredClone(c.request);
  next.campaign.revision = 2;
  next.campaign.cta = 'Outro CTA';
  const revision = await preview.preview(next);
  expect(revision.status).toBe('READY_FOR_OPERATOR_REVIEW');
  const readonly = factory.open(true);
  try {
    expect(readonly.getCampaign(next.campaign.campaignId, 2)).toBeNull();
  } finally {
    readonly.close();
  }
  expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
test('offline preview never opens operational storage and cannot declare readiness', async () => {
  const names = readdirSync(root).sort();
  const result = await new QualificationPreviewService(feeds).preview(input);
  expect(result.pending).toEqual(
    expect.arrayContaining([
      'PROJECT_SCOPE_UNVERIFIED',
      'REVISION_SCOPE_UNVERIFIED',
    ]),
  );
  expect(result.finalPayload).toBeNull();
  expect(readdirSync(root).sort()).toEqual(names);
});

test('offline CLI writes only a new review artifact and never replaces inputs or prior packages', async () => {
  const inputPath = join(root, 'preview-input.json');
  const output = join(root, 'preview-output.json');
  writeFileSync(inputPath, JSON.stringify(input));
  const database = readFileSync(f.database);
  await runQualificationPreview(['--input', inputPath, '--output', output]);
  const first = readFileSync(output);
  const result = JSON.parse(first.toString('utf8'));
  expect(result.pending).toContain('PROJECT_SCOPE_UNVERIFIED');
  expect(result.registrationAuthorized).toBe(false);
  await expect(
    runQualificationPreview(['--input', inputPath, '--output', output]),
  ).rejects.toThrow();
  expect(readFileSync(output)).toEqual(first);
  expect(readFileSync(f.database)).toEqual(database);
});
test('HTTP preview rejects stale sources and payload scope changes while persisting no commands', async () => {
  const module = await Test.createTestingModule({
    controllers: [QualificationPreviewController],
    providers: [{ provide: QualificationPreviewService, useValue: preview }],
  }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const before = readFileSync(f.database);
    await request(app.getHttpServer())
      .post('/affiliate/feed-qualifications/preview')
      .send(input)
      .expect(200)
      .expect((r) => expect(r.body.registrationAuthorized).toBe(false));
    await request(app.getHttpServer())
      .post('/affiliate/feed-qualifications/preview')
      .send({ ...input, reportId: 'a'.repeat(64) })
      .expect(409);
    const c = await complete();
    c.request.product.productId = 'prod_wrong';
    await request(app.getHttpServer())
      .post('/affiliate/feed-qualifications/preview')
      .send(c.request)
      .expect(400);
    expect(readFileSync(f.database)).toEqual(before);
  } finally {
    await app.close();
  }
});
