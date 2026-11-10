import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  createFeedSnapshot,
  compareFeedSnapshots,
} from './application/feed-synchronization.service.js';
import { runFeedSynchronization } from './synchronize-feeds.js';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { SqliteAffiliateRepository } from './infrastructure/sqlite-affiliate.repository.js';
import { affiliateHash } from './domain/affiliate-contracts.js';

let root: string;
const at = '2026-11-10T12:00:00Z';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'affiliate-sync-'));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('NETWORK_FORBIDDEN'));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
function row(
  id: string,
  title = 'Fixture',
  price = '10',
  shop = '7',
  attrs = '[]',
  currency = '',
) {
  return (
    [
      id,
      title,
      price,
      `https://shopee.com.br/product/${shop}/${id}`,
      attrs,
      currency,
    ]
      .map((x) => '"' + x.replaceAll('"', '""') + '"')
      .join(',') + '\n'
  );
}
async function snapshot(
  name: string,
  content: string,
  feedId = 'same_source',
  dates: object = {},
) {
  const csv = join(root, name + '.csv');
  const text =
    'itemid,title,price,product_link,global_item_attributes,currency\n' +
    content;
  writeFileSync(csv, text);
  const configPath = join(root, name + '.config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      feeds: [
        {
          feedId,
          provider: 'shopee',
          sourcePath: csv,
          columns: { externalId: 'itemid', name: 'title' },
          delimiter: ',',
          maxRecordChars: 1048576,
          expectedSha256: createHash('sha256').update(text).digest('hex'),
        },
      ],
    }),
  );
  return createFeedSnapshot({
    configPath,
    feedId,
    sourceRef: 'fixture:source-document',
    ...dates,
  });
}
test('detects added, absent, title/attribute/price/link changes, duplicates, incomplete and unchanged without claims of current commerce', async () => {
  const a = await snapshot(
    'before',
    row('1') + row('2') + row('3') + row('4') + row('5') + row('6') + row('7'),
  );
  const b = await snapshot(
    'after',
    row('1', 'New title') +
      row(
        '2',
        'Fixture',
        '10',
        '7',
        '[{"attr_id":1,"formatted_value":"New"}]',
      ) +
      row('3', 'Fixture', '11') +
      row('4', 'Fixture', '10', '8') +
      row('6') +
      row('7') +
      row('8') +
      row('9') +
      row('9') +
      row('10', ''),
  );
  const report = compareFeedSnapshots(a, b, at);
  const get = (id: string) =>
    report.items.find((x) => x.externalProductId === id)!;
  expect(get('1').changedFields).toContain('name');
  expect(get('2').changedFields).toContain('attributes');
  expect(get('3').changedFields).toContain('historicalPrice');
  expect(get('4').changedFields).toContain('productUrl');
  expect(get('5').presence).toBe('ABSENT_FROM_SNAPSHOT');
  expect(get('6').presence).toBe('UNCHANGED_OBSERVABLE');
  expect(get('8').presence).toBe('NEW_IN_SNAPSHOT');
  expect(get('9').issues).toContain('DUPLICATE_PRODUCT');
  expect(get('10').issues).toContain('INCOMPLETE_DATA');
  expect(report.registrationAuthorized).toBe(false);
  expect(report.freshness.currentPriceConfirmed).toBe(false);
  expect(report.freshness.storeVerification).toBe('NOT_VERIFIED');
  expect(report.freshness.validity).toBe('UNPROVEN');
  expect(report.summary.unchanged).toBe(2);
});
test('snapshot/reports replay deterministically and protect all serialized bytes against tampering', async () => {
  const a = await snapshot('a', row('1'));
  expect(await snapshot('a', row('1'))).toEqual(a);
  expect(compareFeedSnapshots(a, a, at)).toEqual(
    compareFeedSnapshots(JSON.parse(JSON.stringify(a)), a, at),
  );
  const corrupt = JSON.parse(JSON.stringify(a));
  corrupt.rows[0].value.name = 'Tampered';
  expect(() => compareFeedSnapshots(corrupt, a, at)).toThrow(
    'FEED_SNAPSHOT_INTEGRITY',
  );
});
test('refuses different origins, source references and formats, including legacy feed200149 versus200150', async () => {
  const a = await snapshot('a', row('1'), '200149');
  const b = await snapshot('b', row('1'), '200150');
  expect(() => compareFeedSnapshots(a, b, at)).toThrow(
    'FEED_SNAPSHOT_ORIGIN_MISMATCH',
  );
  const c = await createFeedSnapshot({
    configPath: join(root, 'a.config.json'),
    feedId: '200149',
    sourceRef: 'other:source',
  });
  expect(() => compareFeedSnapshots(a, c, at)).toThrow(
    'FEED_SNAPSHOT_ORIGIN_MISMATCH',
  );
  const format = structuredClone(a);
  format.file.columnMapping.currency = 'other_currency';
  const { snapshotId: _id, ...body } = format;
  format.snapshotId = affiliateHash({ payload: body });
  expect(() => compareFeedSnapshots(a, format, at)).toThrow(
    'FEED_SNAPSHOT_FORMAT_MISMATCH',
  );
});
test('dates require timezone and evidence; filenames, config timestamps and capture date never prove product freshness', async () => {
  const a = await snapshot('20261110', row('1'));
  expect(a.dates.obtained).toBeNull();
  expect(a.dates.reference).toBeNull();
  await expect(
    snapshot('bad', row('1'), 'same_source', {
      obtained: { at, evidenceRef: '' },
    }),
  ).rejects.toThrow();
  await expect(
    snapshot('bad2', row('1'), 'same_source', {
      obtained: { at: '2026-11-10', evidenceRef: 'fixture:date' },
    }),
  ).rejects.toThrow();
  const b = await snapshot('b', row('1'), 'same_source', {
    reference: { at: '2026-11-01T00:00:00Z', evidenceRef: 'fixture:date' },
    validUntil: { at: '2026-11-02T00:00:00Z', evidenceRef: 'fixture:validity' },
  });
  expect(compareFeedSnapshots(a, b, at).freshness.validity).toBe('EXPIRED');
  expect(compareFeedSnapshots(a, b, at).freshness.temporalBasis).toBe(
    'DOCUMENTED_REFERENCE',
  );
  const c = await snapshot('c', row('1'), 'same_source', {
    reference: { at, evidenceRef: 'fixture:date' },
  });
  expect(() => compareFeedSnapshots(c, b, at)).toThrow(
    'FEED_SNAPSHOT_REVERSED_REFERENCE_ORDER',
  );
});
test('preserves reported currencies, raw unknown values and canonical attributes without claiming store verification', async () => {
  const a = await snapshot(
    'a',
    row(
      '1',
      'Fixture',
      '10',
      '7',
      '[{"attr_id":1,"formatted_value":"Red","status":1}]',
      'BRL',
    ),
  );
  const b = await snapshot(
    'b',
    row(
      '1',
      'Fixture',
      '10',
      '7',
      '[{"status":1,"formatted_value":"Red","attr_id":1}]',
      'USD',
    ),
  );
  const x = compareFeedSnapshots(a, b, at).items[0];
  expect(x.changedFields).toEqual(['currency']);
  expect(x.before!.currency).toBe('BRL');
  expect(x.after!.currency).toBe('USD');
  expect(x.after!.availability).toBeNull();
  expect(x.after!.commission).toBeNull();
});
test('uses pinned CSV hashes and refuses multi-source input instead of treating separate origins as versions', async () => {
  await snapshot('a', row('1'));
  writeFileSync(join(root, 'a.csv'), 'itemid,title\n1,changed\n');
  await expect(
    createFeedSnapshot({
      configPath: join(root, 'a.config.json'),
      feedId: 'same_source',
      sourceRef: 'fixture:source-document',
    }),
  ).rejects.toThrow('EXTERNAL_CATALOG_SOURCE_INTEGRITY');
  const config = JSON.parse(readFileSync(join(root, 'a.config.json'), 'utf8'));
  config.feeds.push({ ...config.feeds[0], feedId: 'other' });
  writeFileSync(join(root, 'multi.json'), JSON.stringify(config));
  await expect(
    createFeedSnapshot({
      configPath: join(root, 'multi.json'),
      feedId: 'same_source',
      sourceRef: 'fixture:source-document',
    }),
  ).rejects.toThrow('FEED_SNAPSHOT_SINGLE_SOURCE_REQUIRED');
});
test('prepares a reviewed revision preserving old evidence, media/rights and affiliate URLs; never writes the supplied SQLite catalog', async () => {
  const f = p2EditorialFixture();
  try {
    const repository = new SqliteAffiliateRepository(f.database);
    const product = repository.getProduct('prod_001', 1)!;
    const offer = repository.getCampaign('camp_001', 1)!;
    repository.close();
    const a = await snapshot('a', row('1', product.name));
    const b = await snapshot('b', row('1', 'New fixture name'));
    const before = readFileSync(f.database);
    const report = compareFeedSnapshots(a, b, at, [
      {
        externalProductId: '1',
        mappingEvidenceRef: 'FICTITIOUS_TEST_ONLY:export',
        product,
        offers: [offer],
      },
    ]);
    const proposal = report.revisionProposals[0];
    expect(proposal.productDraft!.product.revision).toBe(2);
    expect(proposal.productDraft!.product.media).toEqual(product.media);
    expect(
      proposal.productDraft!.product.evidence.slice(0, product.evidence.length),
    ).toEqual(product.evidence);
    expect(proposal.offerDrafts[0].campaign.affiliateUrl).toBe(
      offer.affiliateUrl,
    );
    expect(proposal.offerDrafts[0].campaign.productRevision).toBe(2);
    expect(proposal.finalPayload).toBeNull();
    expect(readFileSync(f.database)).toEqual(before);
    const price = await snapshot('price', row('1', product.name, '15'));
    const priceProposal = compareFeedSnapshots(a, price, at, [
      {
        externalProductId: '1',
        mappingEvidenceRef: 'FICTITIOUS_TEST_ONLY:export',
        product,
        offers: [offer],
      },
    ]).revisionProposals[0];
    expect(priceProposal.productDraft).toBeNull();
    expect(priceProposal.proposedRevision).toBeNull();
    const newCatalogName = { ...product, name: 'New fixture name' };
    expect(
      compareFeedSnapshots(a, b, at, [
        {
          externalProductId: '1',
          mappingEvidenceRef: 'FICTITIOUS_TEST_ONLY:export',
          product: newCatalogName,
          offers: [offer],
        },
      ]).revisionProposals[0].proposedRevision,
    ).toBeNull();
    expect(
      compareFeedSnapshots(b, b, at, [
        {
          externalProductId: '1',
          mappingEvidenceRef: 'FICTITIOUS_TEST_ONLY:export',
          product,
          offers: [offer],
        },
      ]).revisionProposals[0].proposedRevision,
    ).toBe(2);
    const incomplete = await snapshot('incomplete', row('1', ''));
    expect(
      compareFeedSnapshots(a, incomplete, at, [
        {
          externalProductId: '1',
          mappingEvidenceRef: 'FICTITIOUS_TEST_ONLY:export',
          product,
          offers: [offer],
        },
      ]).revisionProposals[0].productDraft,
    ).toBeNull();
    expect(() =>
      compareFeedSnapshots(a, b, at, [
        {
          externalProductId: '1',
          mappingEvidenceRef: 'FICTITIOUS_TEST_ONLY:export',
          product,
          offers: [{ ...offer, productRevision: 2 }],
        },
      ]),
    ).toThrow('FEED_REVISION_EXPORT_INVALID');
  } finally {
    f.cleanup();
  }
});
test('CLI runs snapshot/compare without app/database initialization, never overwrites artifacts or changes inputs', async () => {
  const a = await snapshot('a', row('1'));
  const b = await snapshot('b', row('1', 'Changed'));
  const snapshotRequest = join(root, 'snapshot-request.json'),
    snapshotOutput = join(root, 'snapshot-output.json');
  writeFileSync(
    snapshotRequest,
    JSON.stringify({
      configPath: 'a.config.json',
      feedId: 'same_source',
      sourceRef: 'fixture:source-document',
    }),
  );
  await runFeedSynchronization([
    'snapshot',
    '--input',
    snapshotRequest,
    '--output',
    snapshotOutput,
  ]);
  expect(JSON.parse(readFileSync(snapshotOutput, 'utf8'))).toEqual(a);
  await expect(
    runFeedSynchronization([
      'snapshot',
      '--input',
      snapshotRequest,
      '--output',
      snapshotOutput,
    ]),
  ).rejects.toThrow();
  const left = join(root, 'left.json'),
    right = join(root, 'right.json'),
    input = join(root, 'compare.json'),
    output = join(root, 'report.json');
  writeFileSync(left, JSON.stringify(a));
  writeFileSync(right, JSON.stringify(b));
  writeFileSync(
    input,
    JSON.stringify({ before: left, after: right, evaluatedAt: at }),
  );
  await runFeedSynchronization([
    'compare',
    '--input',
    input,
    '--output',
    output,
  ]);
  const bytes = readFileSync(output);
  expect(JSON.parse(bytes.toString()).summary.changed).toBe(1);
  await expect(
    runFeedSynchronization(['compare', '--input', input, '--output', output]),
  ).rejects.toThrow();
  expect(readFileSync(output)).toEqual(bytes);
  expect(JSON.parse(readFileSync(left, 'utf8'))).toEqual(a);
});
test('large fictitious snapshots retain unique identities, deterministic comparison and all duplicate/incomplete evidence', async () => {
  const rows = Array.from({ length: 110000 }, (_, i) =>
    row(String(i + 1)),
  ).join('');
  const a = await snapshot('largeA', rows);
  const b = await snapshot('largeB', rows + row('110001'));
  const x = compareFeedSnapshots(a, b, at);
  expect(x.summary.new).toBe(1);
  expect(x.summary.unchanged).toBe(110000);
  expect(compareFeedSnapshots(a, b, at).reportId).toBe(x.reportId);
}, 60000);
