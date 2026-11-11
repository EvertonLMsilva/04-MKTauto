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
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
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

async function batchInput(count = 1, incompleteSecond = false) {
  const ids = Array.from({ length: count }, (_, i) =>
    String(4251540175n + BigInt(i)),
  );
  writeFileSync(
    join(root, 'feed.csv'),
    'itemid,title,price,product_link,global_category2\n' +
      ids
        .map(
          (id, i) =>
            `${id},${i === 0 ? 'Cesto de fixture N04' : incompleteSecond && i === 1 ? '' : `Cesto ${i}`},45.9,https://shopee.com.br/product/7/${id},Kitchenware\n`,
        )
        .join(''),
  );
  const report = await feeds.analyze();
  input.reportId = report.reportId;
  return {
    reportId: report.reportId,
    projectId: input.projectId,
    recordedAt: at,
    candidates: ids.map((externalProductId, i) => ({
      externalProductId,
      source: { feedId: 'fixture', rowNumber: i + 2 },
    })),
  };
}

test.each([1, 20])(
  'batch previews %i items with two consistent feed reads and deterministic ordering',
  async (count) => {
    const batch = await batchInput(count),
      before = readFileSync(f.database);
    const analyze = vi.spyOn(feeds, 'analyze');
    const first = await preview.previewBatch({
      ...batch,
      candidates: [...batch.candidates].reverse(),
    });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(first.items).toHaveLength(count);
    expect(first.items.map((i) => i.identity.externalProductId)).toEqual(
      batch.candidates.map((c) => c.externalProductId),
    );
    expect(first.registrationAuthorized).toBe(false);
    expect(first.operationallyRegistered).toBe(false);
    expect(first.reportId).toBe(batch.reportId);
    expect(await preview.previewBatch(batch)).toEqual(first);
    expect(readFileSync(f.database)).toEqual(before);
  },
);

test('batch mixes complete and incomplete candidates without authorizing or changing individual policy', async () => {
  const batch = await batchInput(2, true),
    c = await complete();
  const individual = await preview.preview(c.request);
  const first = {
    ...batch.candidates[0],
    product: c.request.product,
    campaign: c.request.campaign,
    affiliateEvidence: c.request.affiliateEvidence,
  };
  const before = readFileSync(f.database);
  const result = await preview.previewBatch({
    ...batch,
    candidates: [first, batch.candidates[1]],
  });
  expect(result.items[0].preview).toEqual(individual);
  expect(result.items[0]).toMatchObject({
    status: 'READY_FOR_OPERATOR_REVIEW',
    associationVerified: false,
    registrationAuthorized: false,
    operationallyRegistered: false,
  });
  expect(result.items[0].evidence.present).toContain(
    'DOCUMENTED_AFFILIATE_ASSOCIATION',
  );
  expect(result.items[1]).toMatchObject({
    status: 'NOT_PREVIEWABLE',
    preview: null,
  });
  expect(result.items[1].blockers).toContain('NAME_REQUIRED');
  expect(readFileSync(f.database)).toEqual(before);
});

test.each(['rights', 'affiliate'])(
  'batch preserves missing %s evidence as a per-candidate blocker',
  async (kind) => {
    const batch = await batchInput(),
      c = await complete();
    if (kind === 'rights') c.request.product.localImage.rights.evidence = [];
    else delete (c.request as any).affiliateEvidence;
    const result = await preview.previewBatch({
      ...batch,
      candidates: [
        {
          ...batch.candidates[0],
          product: c.request.product,
          campaign: c.request.campaign,
          ...(c.request.affiliateEvidence
            ? { affiliateEvidence: c.request.affiliateEvidence }
            : {}),
        },
      ],
    });
    expect(result.items[0].status).toBe('BLOCKED');
    expect(result.items[0].evidence.missing).toContain(
      kind === 'rights'
        ? 'REUSABLE_MEDIA_RIGHTS'
        : 'DOCUMENTED_AFFILIATE_ASSOCIATION',
    );
    expect(result.items[0].registrationAuthorized).toBe(false);
  },
);

test('batch rejects oversized/empty requests and duplicate product identities before reading feeds', async () => {
  const batch = await batchInput(),
    analyze = vi.spyOn(feeds, 'analyze');
  for (const candidates of [
    [],
    Array(21).fill(batch.candidates[0]),
    [
      batch.candidates[0],
      { ...batch.candidates[0], source: { feedId: 'other', rowNumber: 3 } },
    ],
  ])
    await expect(
      preview.previewBatch({ ...batch, candidates }),
    ).rejects.toThrow('QUALIFICATION_PREVIEW_BATCH_');
  expect(analyze).not.toHaveBeenCalled();
});

test('batch rejects both an obsolete report and a feed changed during processing', async () => {
  const batch = await batchInput();
  await expect(
    preview.previewBatch({ ...batch, reportId: 'a'.repeat(64) }),
  ).rejects.toThrow('FEED_QUALIFICATION_REPORT_CHANGED');
  const get = projects.get;
  projects.get = async (...args: any[]) => {
    writeFileSync(
      join(root, 'feed.csv'),
      readFileSync(join(root, 'feed.csv'), 'utf8').replace('45.9', '46.9'),
    );
    return get(...args);
  };
  await expect(preview.previewBatch(batch)).rejects.toThrow(
    'FEED_QUALIFICATION_REPORT_CHANGED',
  );
});

test('batch identifies candidate failures and source mismatch without suppressing other results', async () => {
  const batch = await batchInput(3);
  const result = await preview.previewBatch({
    ...batch,
    candidates: [
      { ...batch.candidates[0], product: { productId: 'wrong' } },
      { ...batch.candidates[1], source: { feedId: 'fixture', rowNumber: 999 } },
      batch.candidates[2],
    ],
  });
  expect(result.items.map((i) => i.status)).toEqual([
    'ERROR',
    'ERROR',
    'BLOCKED',
  ]);
  expect(result.items[0].error?.code).toBe(
    'QUALIFICATION_PREVIEW_SCOPE_MISMATCH',
  );
  expect(result.items[1].error?.code).toBe(
    'QUALIFICATION_PREVIEW_CANDIDATE_IDENTITY_MISMATCH',
  );
  expect(result.items[0].preview).toBeNull();
});

test('batch HTTP shares individual behavior, bounds requests and returns 409 for changed reports', async () => {
  const batch = await batchInput();
  const module = await Test.createTestingModule({
    controllers: [QualificationPreviewController],
    providers: [{ provide: QualificationPreviewService, useValue: preview }],
  }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const before = readFileSync(f.database);
    await request(app.getHttpServer())
      .post('/affiliate/feed-qualifications/preview/batch')
      .send(batch)
      .expect(200)
      .expect((r) =>
        expect(r.body.items[0].registrationAuthorized).toBe(false),
      );
    await request(app.getHttpServer())
      .post('/affiliate/feed-qualifications/preview/batch')
      .send({ ...batch, candidates: [] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/affiliate/feed-qualifications/preview/batch')
      .send({ ...batch, reportId: 'a'.repeat(64) })
      .expect(409);
    await request(app.getHttpServer())
      .post('/affiliate/feed-qualifications/preview')
      .send(input)
      .expect(200);
    expect(readFileSync(f.database)).toEqual(before);
  } finally {
    await app.close();
  }
});

test('batch preserves Int64 product identity and historical decimals and suppresses invalid offer drafts', async () => {
  const id = '9007199254740993',
    amount = '9007199254740993.123456789012345678';
  writeFileSync(
    join(root, 'feed.csv'),
    `itemid,title,price,product_link,global_category2\n${id},Cesto preciso,${amount},https://shopee.com.br/product/7/${id},Kitchenware\n`,
  );
  const report = await feeds.analyze();
  const result = await preview.previewBatch({
    reportId: report.reportId,
    projectId: input.projectId,
    recordedAt: at,
    candidates: [
      { externalProductId: id, source: { feedId: 'fixture', rowNumber: 2 } },
    ],
  });
  expect(result.items[0].identity.externalProductId).toBe(id);
  expect(result.items[0].commercialSnapshot?.historicalPrice).toMatchObject({
    amount,
    current: false,
    currency: null,
  });
  expect(result.items[0].productDraft).toBeNull();
  expect(result.items[0].evidence.missing).toContain('PRODUCT_CONTRACT');
  expect(result.items[0].productIssues.length).toBeGreaterThan(0);
  expect(result.items[0].offerIssues.length).toBeGreaterThan(0);
  expect(result.items[0].offerDraft).toBeNull();
  expect(result.items[0].preview).toBeNull();
  expect(result.items[0].previewHash).toMatch(/^[a-f0-9]{64}$/);
  const { packageHash, ...body } = result;
  expect(affiliateHash(body)).toBe(packageHash);
});

test('batch exposes unexpected candidate errors only as sanitized failures and continues reviewing', async () => {
  const batch = await batchInput(2),
    original = (preview as any).previewFromReport.bind(preview);
  const invoke = vi
    .spyOn(preview as any, 'previewFromReport')
    .mockRejectedValueOnce(new Error('PRIVATE_INTERNAL_DETAIL'))
    .mockImplementation(original);
  const result = await preview.previewBatch(batch);
  expect(result.items[0]).toMatchObject({
    status: 'ERROR',
    error: { code: 'QUALIFICATION_PREVIEW_UNAVAILABLE', stage: 'PREVIEW' },
    evidence: { present: [], missing: [] },
  });
  expect(result.items[0].evidence.unverified.length).toBeGreaterThan(0);
  expect(result.items[1].status).toBe('BLOCKED');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_INTERNAL_DETAIL');
  invoke.mockRestore();
});

test('batch CLI is explicit, offline and writes a new artifact without overwriting previous results', async () => {
  const batch = await batchInput(2),
    path = join(root, 'batch-input.json'),
    output = join(root, 'batch-output.json');
  writeFileSync(path, JSON.stringify(batch));
  const before = readFileSync(f.database);
  await runQualificationPreview([
    '--batch',
    '--input',
    path,
    '--output',
    output,
  ]);
  const bytes = readFileSync(output),
    result = JSON.parse(bytes.toString('utf8'));
  expect(result.items).toHaveLength(2);
  expect(result.registrationAuthorized).toBe(false);
  expect(
    result.items.every((item: any) =>
      item.evidence.missing.includes('PROJECT_SCOPE'),
    ),
  ).toBe(true);
  await expect(
    runQualificationPreview(['--batch', '--input', path, '--output', output]),
  ).rejects.toThrow();
  expect(readFileSync(output)).toEqual(bytes);
  expect(readFileSync(f.database)).toEqual(before);
});
