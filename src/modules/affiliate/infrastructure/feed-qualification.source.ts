import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { csvRecords } from './csv-discovery-reader.js';
import { fileDigest } from './local-discovery-cache.js';
import { catalogError } from './discovery-error.js';
import type { RawQualificationRow } from '../domain/feed-qualification.js';

export async function readQualificationFeeds(
  configPath: string | undefined,
  includeCurrency = false,
) {
  if (!configPath || !isAbsolute(configPath))
    throw catalogError('EXTERNAL_CATALOG_CONFIGURATION_INVALID');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (
    !Array.isArray(config?.feeds) ||
    !config.feeds.length ||
    config.feeds.length > 20
  )
    throw catalogError('EXTERNAL_CATALOG_CONFIGURATION_INVALID');
  const rows: RawQualificationRow[] = [];
  const sources = [];
  const ids = new Set<string>();
  for (const feed of [...config.feeds].sort((a, b) =>
    a.feedId < b.feedId ? -1 : a.feedId > b.feedId ? 1 : 0,
  )) {
    if (
      !feed ||
      typeof feed.feedId !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(feed.feedId) ||
      ids.has(feed.feedId) ||
      feed.provider !== 'shopee' ||
      typeof feed.sourcePath !== 'string' ||
      !feed.sourcePath ||
      feed.sourcePath.includes('://') ||
      typeof feed.columns?.externalId !== 'string' ||
      typeof feed.columns?.name !== 'string' ||
      !feed.columns.externalId ||
      !feed.columns.name ||
      typeof feed.delimiter !== 'string' ||
      Array.from(feed.delimiter).length !== 1 ||
      /["\r\n]/.test(feed.delimiter) ||
      !Number.isSafeInteger(feed.maxRecordChars) ||
      feed.maxRecordChars < 1 ||
      feed.maxRecordChars > 4194304 ||
      (feed.expectedSha256 !== undefined &&
        !/^[a-f0-9]{64}$/.test(feed.expectedSha256)) ||
      (feed.sourceUpdatedAt != null &&
        (typeof feed.sourceUpdatedAt !== 'string' ||
          !Number.isFinite(Date.parse(feed.sourceUpdatedAt))))
    )
      throw catalogError('EXTERNAL_CATALOG_CONFIGURATION_INVALID');
    ids.add(feed.feedId);
    const path = resolve(dirname(configPath), feed.sourcePath);
    const before = await fileDigest(path);
    if (
      feed.expectedSha256 !== undefined &&
      before.sha256 !== feed.expectedSha256
    )
      throw catalogError('EXTERNAL_CATALOG_SOURCE_INTEGRITY');
    let headers: string[] | undefined;
    let rowNumber = 0;
    const columns = {
      externalId: feed.columns.externalId,
      name: feed.columns.name,
      productUrl: 'product_link',
      historicalPrice: 'price',
      salePrice: 'sale_price',
      category: 'global_category1',
      subcategory: 'global_category2',
      imageUrl: 'image_link',
      attributes: 'global_item_attributes',
      reportedAffiliateUrl: 'product_short link',
      ...(includeCurrency ? { currency: 'currency' } : {}),
    };
    for await (const row of csvRecords(path, {
      delimiter: feed.delimiter,
      maxRecordChars: feed.maxRecordChars,
      columns,
      recoverRecords: true,
    })) {
      rowNumber++;
      if (!headers) {
        if (
          !Array.isArray(row) ||
          !row.length ||
          new Set(row).size !== row.length ||
          row.some((h) => !h.trim()) ||
          !row.includes(columns.externalId) ||
          !row.includes(columns.name)
        )
          throw catalogError('EXTERNAL_CATALOG_INVALID_HEADERS');
        headers = row;
        continue;
      }
      if (!Array.isArray(row) || row.length !== headers.length) {
        rows.push({
          feedId: feed.feedId,
          rowNumber,
          value: {},
          error: 'CSV_ROW_INVALID',
        });
        continue;
      }
      rows.push({
        feedId: feed.feedId,
        rowNumber,
        value: Object.fromEntries(
          Object.entries(columns).map(([key, column]) => [
            key,
            headers!.includes(column) ? row[headers!.indexOf(column)] : '',
          ]),
        ),
      });
    }
    if (!headers) throw catalogError('EXTERNAL_CATALOG_INVALID_HEADERS');
    const after = await fileDigest(path);
    if (before.sha256 !== after.sha256 || before.sizeBytes !== after.sizeBytes)
      throw catalogError('EXTERNAL_CATALOG_SOURCE_INTEGRITY');
    sources.push({
      feedId: feed.feedId,
      ...before,
      headers,
      recordCount: rowNumber - 1,
      columnMapping: columns,
      sourceUpdatedAt: feed.sourceUpdatedAt ?? null,
      sourceUpdateEvidence:
        typeof feed.sourceUpdateEvidence === 'string'
          ? feed.sourceUpdateEvidence
          : null,
      originVerified: false,
    });
  }
  return { rows, sources };
}
