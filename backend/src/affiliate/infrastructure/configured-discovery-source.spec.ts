import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { affiliateFixture } from '../../../test/support/affiliate-fixture.js';
import { discoveryCandidate } from '../../../test/support/discovery-fixture.js';
import { ConfiguredDiscoverySource } from './configured-discovery-source.js';
const { loadExternalCatalogRuntime } = await import(
  new URL('../../../../src/external-catalog-runtime.js', import.meta.url).href
);
describe('configured authorized discovery source', () => {
  let f: ReturnType<typeof affiliateFixture>;
  beforeEach(() => {
    f = affiliateFixture();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    f.cleanup();
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
    const legacy = await loadExternalCatalogRuntime(path);
    expect(source.scope).toBe(legacy.scope);
    expect(batch).toEqual(await legacy.enumerateCandidates());
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
