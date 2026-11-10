import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FeedQualificationService } from './application/feed-qualification.service.js';
import { FeedQualificationController } from './feed-qualification.controller.js';
import { runFeedQualification } from './qualify-feeds.js';
import { collectAffiliateProductIssues } from './domain/affiliate-contracts.js';
import { eligibleCatalogCandidate } from './domain/affiliate-catalog.js';

let root: string;
let config: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'affiliate-prequalification-'));
  config = join(root, 'catalog.json');
  vi.stubEnv('AFFILIATE_DISCOVERY_CONFIG', config);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('NETWORK_FORBIDDEN'),
  );
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
const header =
  'itemid,title,price,sale_price,product_link,image_link,global_item_attributes\n';
function row(
  id = '100',
  title = 'Organizador de fixture',
  price = '12.50',
  url = `https://shopee.com.br/product/7/${id}`,
  attrs = '[]',
) {
  const cell = (s: string) => `"${s.replaceAll('"', '""')}"`;
  return (
    [id, title, price, price, url, 'https://example.com/image.jpg', attrs]
      .map(cell)
      .join(',') + '\n'
  );
}
function configure(feeds: { id: string; content: string }[]) {
  for (const f of feeds) writeFileSync(join(root, f.id + '.csv'), f.content);
  writeFileSync(
    config,
    JSON.stringify({
      feeds: feeds.map((f) => ({
        feedId: f.id,
        provider: 'shopee',
        sourcePath: f.id + '.csv',
        columns: { externalId: 'itemid', name: 'title' },
        delimiter: ',',
        maxRecordChars: 1048576,
        sourceUpdatedAt: null,
        sourceUpdateEvidence: null,
      })),
    }),
  );
}
test('raw feed without discovery JSON produces auditable pre-candidates, never eligible offers or operational writes', async () => {
  configure([{ id: 'a', content: header + row() }]);
  const names = readdirSync(root).sort();
  const original = readFileSync(join(root, 'a.csv'));
  const first = await new FeedQualificationService().qualify();
  expect(first.summary).toMatchObject({
    records: 1,
    uniqueProducts: 1,
    preCandidates: 1,
    catalogEligible: 0,
  });
  expect(first.items[0]).toMatchObject({
    externalProductId: '100',
    classification: 'PRE_CANDIDATE',
    catalogEligible: false,
    historicalPrice: { amount: '12.50', currency: null, current: false },
  });
  expect(first.items[0].reasons).toEqual(
    expect.arrayContaining([
      'LOCAL_IMAGE_REQUIRED',
      'MEDIA_RIGHTS_REQUIRED',
      'AFFILIATE_ASSOCIATION_UNPROVEN',
      'CURRENCY_UNPROVEN',
      'FEED_PROVENANCE_UNCONFIRMED',
    ]),
  );
  expect(first.sources[0]).toMatchObject({
    feedId: 'a',
    recordCount: 1,
    sourceUpdatedAt: null,
  });
  expect(first.sources[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await new FeedQualificationService().qualify()).toEqual(first);
  expect(readFileSync(join(root, 'a.csv'))).toEqual(original);
  expect(readdirSync(root).sort()).toEqual(names);
});
test('duplicates are deterministic across feed order, and conflicting data blocks every occurrence', async () => {
  const feeds = [
    { id: 'b', content: header + row() },
    { id: 'a', content: header + row() + row('200') },
  ];
  configure(feeds);
  const first = await new FeedQualificationService().qualify();
  expect(first.summary).toMatchObject({
    records: 3,
    uniqueProducts: 2,
    duplicates: 1,
    preCandidates: 2,
  });
  expect(first.items.find((x) => x.source.feedId === 'b')?.classification).toBe(
    'DUPLICATE',
  );
  configure(feeds.toReversed());
  expect(await new FeedQualificationService().qualify()).toEqual(first);
  writeFileSync(join(root, 'b.csv'), header + row('100', 'Conflicting title'));
  const changed = await new FeedQualificationService().qualify();
  expect(
    changed.items
      .filter((x) => x.externalProductId === '100')
      .every((x) => x.reasons.includes('DUPLICATE_DATA_CONFLICT')),
  ).toBe(true);
  await expect(
    new FeedQualificationService().qualify({ reportId: first.reportId }),
  ).rejects.toThrow(/REPORT_CHANGED/);
});

test('pre-candidate facts seed the existing product DTO but never satisfy its missing media gate', async () => {
  configure([{ id: 'a', content: header + row() }]);
  const report = await new FeedQualificationService().qualify();
  const candidate = report.items[0];
  const product = {
    schemaVersion: 'affiliate-product/2.0.0',
    productId: 'prod_shopee_100',
    revision: 1,
    name: candidate.name,
    brand: { status: 'NOT_PROVIDED', name: null, evidenceRef: 'ev_source' },
    attributes: [
      {
        name: 'source_itemid',
        value: candidate.externalProductId,
        evidenceRef: 'ev_source',
      },
    ],
    media: [],
    evidence: [
      {
        id: 'ev_source',
        kind: 'PRODUCT_SPECIFICATION',
        sourceRef: `fixture:sha256:${report.sources[0].sha256}:row:${candidate.source.rowNumber}`,
        recordedAt: '2026-11-10T12:00:00Z',
      },
    ],
  };
  expect(
    collectAffiliateProductIssues(product).some(
      (issue) => issue.field === 'media',
    ),
  ).toBe(true);
  expect(
    eligibleCatalogCandidate({ product: product as any, campaign: {} as any }),
  ).toBe(false);
});
test('incomplete records, invalid URL/identity, damaged text, price and attribute failures remain explicit', async () => {
  configure([
    {
      id: 'a',
      content:
        header +
        row('1', '') +
        row('2', 'Bad URL', '1', 'https://shopee.com.br/product/7/999') +
        row('3', 'Bad attributes', '1', undefined, '{bad') +
        row('4', 'Text\uFFFD') +
        row('5', 'No price', '') +
        row('6', 'Negative', '-1'),
    },
  ]);
  const result = await new FeedQualificationService().qualify();
  expect(result.summary.records).toBe(6);
  expect(
    result.items.find((x) => x.externalProductId === '1')?.reasons,
  ).toContain('NAME_REQUIRED');
  expect(
    result.items.find((x) => x.externalProductId === '2')?.reasons,
  ).toContain('PRODUCT_LINK_INVALID');
  expect(
    result.items.find((x) => x.externalProductId === '3')?.reasons,
  ).toContain('ATTRIBUTES_INVALID');
  expect(
    result.items.find((x) => x.externalProductId === '4')?.reasons,
  ).toContain('TEXT_CORRUPTED');
  expect(
    result.items.find((x) => x.externalProductId === '5')?.historicalPrice
      .amount,
  ).toBeNull();
  expect(
    result.items.find((x) => x.externalProductId === '6')?.reasons,
  ).toContain('HISTORICAL_PRICE_INVALID');
  expect(result.items.every((x) => !x.catalogEligible)).toBe(true);
});
test('missing headers, invalid UTF-8 and oversized records fail closed', async () => {
  configure([{ id: 'a', content: 'title\nMissing identity\n' }]);
  await expect(new FeedQualificationService().qualify()).rejects.toThrow(
    /HEADERS/,
  );
  writeFileSync(join(root, 'a.csv'), Buffer.from([0xff, 0xfe, 0x01]));
  await expect(new FeedQualificationService().qualify()).rejects.toThrow();
  writeFileSync(join(root, 'a.csv'), header + row('1', 'x'.repeat(1048577)));
  await expect(new FeedQualificationService().qualify()).rejects.toThrow(
    /TOO_LARGE/,
  );
});

test('optional source hash fails closed and the batch entry point never overwrites files', async () => {
  configure([{ id: 'a', content: header + row() }]);
  const service = new FeedQualificationService();
  const report = await service.qualify();
  const declared = JSON.parse(readFileSync(config, 'utf8'));
  declared.feeds[0].expectedSha256 = report.sources[0].sha256;
  writeFileSync(config, JSON.stringify(declared));
  const output = join(root, 'report.json');
  await runFeedQualification(['--output', output]);
  const first = readFileSync(output, 'utf8');
  expect(JSON.parse(first).summary.records).toBe(1);
  await expect(runFeedQualification(['--output', output])).rejects.toThrow();
  expect(readFileSync(output, 'utf8')).toBe(first);
  expect(await service.analyze()).toEqual(JSON.parse(first));
  writeFileSync(join(root, 'a.csv'), header + row('200'));
  await expect(service.qualify()).rejects.toThrow(/SOURCE_INTEGRITY/);
});
test('HTTP read-only qualification paginates one content-addressed report and rejects path injection', async () => {
  configure([{ id: 'a', content: header + row('1') + row('2') }]);
  const module = await Test.createTestingModule({
    controllers: [FeedQualificationController],
    providers: [FeedQualificationService],
  }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const first = await request(app.getHttpServer())
      .get('/affiliate/feed-qualifications?limit=1')
      .expect(200);
    const second = await request(app.getHttpServer())
      .get('/affiliate/feed-qualifications')
      .query({ offset: 1, limit: 1, reportId: first.body.reportId })
      .expect(200);
    expect(second.body.items[0].externalProductId).toBe('2');
    expect(second.body.reportId).toBe(first.body.reportId);
    await request(app.getHttpServer())
      .get('/affiliate/feed-qualifications?sourcePath=elsewhere')
      .expect(400);
    await request(app.getHttpServer())
      .get('/affiliate/feed-qualifications?limit=-1')
      .expect(400);
    await request(app.getHttpServer())
      .get('/affiliate/feed-qualifications?reportId=' + 'a'.repeat(64))
      .expect(409);
  } finally {
    await app.close();
  }
});
