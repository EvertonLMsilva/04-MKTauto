import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { catalogRowEntries } from './csv-discovery-reader.js';
import {
  LocalCatalogCache,
  dailyCatalogPolicy,
} from './local-discovery-cache.js';
import { catalogError, errorCode } from './discovery-error.js';
import { validateAffiliateDiscovery } from '../domain/affiliate-discovery.js';
import type { DiscoveryCandidate } from '../domain/affiliate-discovery.js';
import type {
  CatalogMetadata,
  DiscoverySource,
} from '../application/ports/discovery.port.js';
export interface CsvDiscoveryConfig {
  provider: string;
  sourcePath: string;
  cacheRoot: string;
  cacheKey: string;
  columns: Record<string, string>;
  delimiter: string;
  maxRecordChars: number;
  sourceUpdatedAt?: string | null;
  timeZone: string;
  discovery: {
    sourceId: string;
    authorized: boolean;
    authorizationRef: string;
  };
}
export class CsvDiscoverySource implements DiscoverySource {
  readonly scope: string;
  private readonly cache: LocalCatalogCache;
  readonly config: CsvDiscoveryConfig;
  constructor(
    config: CsvDiscoveryConfig,
    clock: () => Date = () => new Date(),
  ) {
    if (
      !config ||
      config.provider !== 'shopee' ||
      typeof config.sourcePath !== 'string' ||
      !config.sourcePath ||
      typeof config.cacheKey !== 'string' ||
      !config.cacheKey ||
      !config.columns ||
      !Object.hasOwn(config.columns, 'externalId') ||
      !Object.hasOwn(config.columns, 'name') ||
      Object.keys(config.columns).some(
        (k) => !['externalId', 'name', 'brand', 'discovery'].includes(k),
      ) ||
      Object.values(config.columns).some((v) => typeof v !== 'string' || !v) ||
      typeof config.delimiter !== 'string' ||
      Array.from(config.delimiter).length !== 1 ||
      /["\r\n]/.test(config.delimiter) ||
      !Number.isSafeInteger(config.maxRecordChars) ||
      config.maxRecordChars < 1 ||
      (config.sourceUpdatedAt != null &&
        (typeof config.sourceUpdatedAt !== 'string' ||
          !Number.isFinite(Date.parse(config.sourceUpdatedAt))))
    )
      throw catalogError('EXTERNAL_CATALOG_CONFIGURATION_INVALID');
    if (
      !config.discovery ||
      !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(config.discovery.sourceId) ||
      config.discovery.authorized !== true ||
      typeof config.discovery.authorizationRef !== 'string' ||
      !config.discovery.authorizationRef.trim() ||
      !config.columns.discovery
    )
      throw catalogError('EXTERNAL_CATALOG_CONFIGURATION_INVALID');
    this.config = Object.freeze({
      ...config,
      sourcePath: resolve(config.sourcePath),
      columns: Object.freeze({ ...config.columns }),
      discovery: Object.freeze({ ...config.discovery }),
    });
    const c = this.config;
    this.scope = createHash('sha256')
      .update(
        JSON.stringify({
          provider: c.provider,
          sourcePath: c.sourcePath,
          columns: Object.entries(c.columns).sort((a, b) =>
            String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
          ),
          delimiter: c.delimiter,
          maxRecordChars: c.maxRecordChars,
          sourceUpdatedAt: c.sourceUpdatedAt ?? null,
          discovery: c.discovery,
        }),
      )
      .digest('hex');
    this.cache = new LocalCatalogCache({
      root: c.cacheRoot,
      clock,
      isFresh: dailyCatalogPolicy({ timeZone: c.timeZone }),
    });
  }
  async enumerateCandidates() {
    const c = this.config;
    const snapshot = await this.cache.acquire({
      key: c.cacheKey,
      scope: this.scope,
      sourceUpdatedAt: c.sourceUpdatedAt,
      produce: async (destination) => {
        const before = await stat(c.sourcePath);
        if (!before.isFile())
          throw catalogError('EXTERNAL_CATALOG_INVALID_SOURCE');
        await pipeline(
          createReadStream(c.sourcePath),
          createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
        );
        const after = await stat(c.sourcePath),
          copy = await stat(destination);
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ino !== after.ino ||
          copy.size !== before.size
        )
          throw catalogError('EXTERNAL_CATALOG_SOURCE_CHANGED');
      },
      validate: async (path) => {
        let count = 0;
        for await (const _row of catalogRowEntries(path, c)) count++;
        return count;
      },
    });
    const { scope: _scope, ...metadata } = snapshot.metadata;
    const source: CatalogMetadata = Object.freeze(metadata),
      candidates: DiscoveryCandidate[] = [],
      errors: { rowNumber: number; code: string }[] = [];
    for await (const entry of catalogRowEntries(snapshot.path, c)) {
      if (entry.error) {
        errors.push({ rowNumber: entry.rowNumber, ...entry.error });
        continue;
      }
      try {
        const row = entry.value!;
        const raw = JSON.parse(row.discovery) as Record<string, unknown>;
        if (
          raw.sourceId !== c.discovery.sourceId ||
          raw.sourceType !== 'AUTHORIZED_CSV' ||
          raw.externalProductId !== row.externalId ||
          raw.productName !== row.name ||
          (c.columns.brand && raw.brand !== (row.brand || null))
        )
          throw catalogError('DISCOVERY_ROW_IDENTITY_MISMATCH');
        candidates.push(
          validateAffiliateDiscovery({
            ...raw,
            provenance: {
              sourceHash: source.sha256,
              rowNumber: entry.rowNumber,
              authorizationRef: c.discovery.authorizationRef,
              obtainedAt: source.obtainedAt,
            },
            eligibilityStatus: 'UNKNOWN',
            eligibilityReasons: [],
          }),
        );
      } catch (error) {
        errors.push({
          rowNumber: entry.rowNumber,
          code:
            error instanceof SyntaxError
              ? 'DISCOVERY_JSON_INVALID'
              : (errorCode(error) ?? 'DISCOVERY_ROW_INVALID'),
        });
      }
    }
    return { candidates, errors, source };
  }
}
