import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { affiliateHash } from '../domain/affiliate-contracts.js';
import { catalogError } from './discovery-error.js';
import { CsvDiscoverySource } from './csv-discovery-source.js';
import type { CsvDiscoveryConfig } from './csv-discovery-source.js';
import type {
  DiscoveryBatch,
  DiscoverySourceFactory,
} from '../application/ports/discovery.port.js';
interface RuntimeConfig {
  cacheRoot: string;
  policy: { type: string; timeZone: string };
  feeds: (CsvDiscoveryConfig & {
    feedId: string;
    sourceUpdateEvidence?: string | null;
  })[];
}
@Injectable()
export class ConfiguredDiscoverySource implements DiscoverySourceFactory {
  async open() {
    try {
      const path = process.env.AFFILIATE_DISCOVERY_CONFIG;
      if (!path || !isAbsolute(path))
        throw Error('explicit configuration path required');
      const config = JSON.parse(await readFile(path, 'utf8')) as RuntimeConfig,
        base = dirname(path);
      if (
        !config ||
        typeof config.cacheRoot !== 'string' ||
        !config.cacheRoot ||
        config.policy?.type !== 'DAILY' ||
        !Array.isArray(config.feeds) ||
        !config.feeds.length
      )
        throw Error('invalid configuration');
      const ids = new Set<string>();
      const feeds = config.feeds.map((feed) => {
        if (
          !feed ||
          typeof feed.feedId !== 'string' ||
          !/^[a-zA-Z0-9_-]+$/.test(feed.feedId) ||
          ids.has(feed.feedId) ||
          typeof feed.sourcePath !== 'string' ||
          !feed.sourcePath ||
          (feed.sourceUpdatedAt != null &&
            (typeof feed.sourceUpdateEvidence !== 'string' ||
              !feed.sourceUpdateEvidence.trim())) ||
          (feed.sourceUpdatedAt == null && feed.sourceUpdateEvidence != null)
        )
          throw Error('invalid feed');
        ids.add(feed.feedId);
        // Non-discovery feeds retain no discovery responsibility.
        const adapter = feed.discovery
          ? new CsvDiscoverySource({
              ...feed,
              sourcePath: resolve(base, feed.sourcePath),
              cacheRoot: resolve(base, config.cacheRoot),
              cacheKey: feed.feedId,
              timeZone: config.policy.timeZone,
            })
          : null;
        return { feedId: feed.feedId, adapter };
      });
      const selected = feeds.filter(
        (f): f is { feedId: string; adapter: CsvDiscoverySource } =>
          f.adapter !== null,
      );
      if (!selected.length)
        throw catalogError('EXTERNAL_CATALOG_DISCOVERY_NOT_CONFIGURED');
      return {
        scope: affiliateHash(
          selected.map((f) => ({ feedId: f.feedId, scope: f.adapter.scope })),
        ),
        async enumerateCandidates(): Promise<DiscoveryBatch> {
          const candidates: DiscoveryBatch['candidates'] = [],
            errors: DiscoveryBatch['errors'] = [],
            sources: unknown[] = [];
          for (const feed of selected) {
            const batch = await feed.adapter.enumerateCandidates();
            candidates.push(...batch.candidates);
            errors.push(
              ...batch.errors.map((e) => ({ feedId: feed.feedId, ...e })),
            );
            sources.push({ feedId: feed.feedId, ...batch.source });
          }
          return { candidates, errors, source: sources };
        },
      };
    } catch (cause) {
      throw catalogError('EXTERNAL_CATALOG_CONFIGURATION_INVALID', cause);
    }
  }
}
