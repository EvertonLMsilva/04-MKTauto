import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { affiliateFixture } from '../../../test/support/affiliate-fixture.js';
import {
  discoveryCandidate,
  discoveryAt,
} from '../../../test/support/discovery-fixture.js';
import { ConfiguredDiscoverySource } from './configured-discovery-source.js';
import {
  historicalDiscovery,
  csvScope,
  configuredScope,
} from '../../../test/support/historical-discovery.js';
describe('configured authorized discovery source', () => {
  let f: ReturnType<typeof affiliateFixture>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(discoveryAt);
    f = affiliateFixture();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    f.cleanup();
  });
  it('does not load the retired catalog runtime', () => {
    expect(
      readFileSync(
        new URL('./configured-discovery-source.spec.ts', import.meta.url),
        'utf8',
      ),
    ).not.toMatch(/new URL\(\s*['"]\.\.\/\.\.\/\.\.\/\.\.\/src\/[^'"]+\.js/);
  });
  it('loads the existing local feed configuration and matches aggregate JS enumeration', async () => {
    const root = dirname(f.database),
      path = join(root, 'config.json'),
      c = discoveryCandidate();
    const cell = (s: string) => `"${s.replaceAll('"', '""')}"`;
    writeFileSync(
      join(root, 'feed.csv'),
      'id,name,discovery\n' +
        [c.externalProductId, c.productName, JSON.stringify(c)]
          .map(cell)
          .join(','),
    );
    const feed = {
      feedId: 'feed_001',
      provider: 'shopee',
      sourcePath: 'feed.csv',
      columns: { externalId: 'id', name: 'name', discovery: 'discovery' },
      delimiter: ',',
      maxRecordChars: 100000,
      discovery: {
        sourceId: 'shopee_feed',
        authorized: true,
        authorizationRef: 'authorized_fixture',
      },
    };
    const config = {
      cacheRoot: 'cache',
      policy: { type: 'DAILY', timeZone: 'America/Sao_Paulo' },
      feeds: [feed],
    };
    writeFileSync(path, JSON.stringify(config));
    vi.stubEnv('AFFILIATE_DISCOVERY_CONFIG', path);
    const source = await new ConfiguredDiscoverySource().open(),
      batch = await source.enumerateCandidates();
    const expectedScope = csvScope({
      ...feed,
      sourcePath: join(root, 'feed.csv'),
      cacheRoot: join(root, 'cache'),
      cacheKey: feed.feedId,
      timeZone: config.policy.timeZone,
    });
    expect(source.scope).toBe(
      configuredScope([{ feedId: feed.feedId, scope: expectedScope }]),
    );
    expect(batch).toEqual(historicalDiscovery.configured);
    writeFileSync(
      path,
      JSON.stringify({
        ...config,
        feeds: [
          { ...feed, discovery: { ...feed.discovery, authorized: false } },
        ],
      }),
    );
    await expect(new ConfiguredDiscoverySource().open()).rejects.toMatchObject({
      code: 'EXTERNAL_CATALOG_CONFIGURATION_INVALID',
    });
  });
});
