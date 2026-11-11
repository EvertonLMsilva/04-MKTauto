import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { affiliateFixture } from '../../../../test/support/affiliate-fixture.js';
import {
  discoveryCandidate,
  discoveryAt,
} from '../../../../test/support/discovery-fixture.js';
import { CsvDiscoverySource } from './csv-discovery-source.js';
import { SqliteDiscoveryRepository } from './sqlite-discovery.repository.js';
import {
  DEFAULT_AFFILIATE_DISCOVERY_POLICY as policy,
  rankAffiliateDiscovery,
} from '../domain/affiliate-discovery.js';
import { affiliateHash } from '../domain/affiliate-contracts.js';
import {
  historicalDiscovery,
  csvScope,
} from '../../../../test/support/historical-discovery.js';

describe('authorized discovery persistence and CSV', () => {
  let f: ReturnType<typeof affiliateFixture>;
  beforeEach(() => {
    f = affiliateFixture();
  });
  afterEach(() => f.cleanup());
  it('does not load retired CSV or discovery repositories', () => {
    expect(
      readFileSync(new URL('./discovery.spec.ts', import.meta.url), 'utf8'),
    ).not.toMatch(/new URL\(\s*['"]\.\.\/\.\.\/\.\.\/\.\.\/src\/[^'"]+\.js/);
  });
  it('shares concurrent cache refresh and retains the prior snapshot after a failed stale refresh', async () => {
    const root = join(f.database, '..'),
      sourcePath = join(root, 'cache-feed.csv'),
      cacheRoot = join(root, 'cache-atomic');
    const c = discoveryCandidate();
    const cell = (s: string) => `"${s.replaceAll('"', '""')}"`;
    writeFileSync(
      sourcePath,
      'id,name,discovery\n' +
        [c.externalProductId, c.productName, JSON.stringify(c)]
          .map(cell)
          .join(','),
    );
    let clock = new Date(discoveryAt);
    const source = new CsvDiscoverySource(
      {
        provider: 'shopee',
        sourcePath,
        cacheRoot,
        cacheKey: 'feed',
        columns: { externalId: 'id', name: 'name', discovery: 'discovery' },
        delimiter: ',',
        maxRecordChars: 100000,
        timeZone: 'America/Sao_Paulo',
        discovery: {
          sourceId: 'shopee_feed',
          authorized: true,
          authorizationRef: 'authorized_fixture',
        },
      },
      () => clock,
    );
    const [a, b] = await Promise.all([
      source.enumerateCandidates(),
      source.enumerateCandidates(),
    ]);
    expect(a).toEqual(b);
    const pointer = join(cacheRoot, 'feed', 'current.json'),
      before = readFileSync(pointer, 'utf8');
    clock = new Date('2026-10-14T12:00:00Z');
    writeFileSync(sourcePath, 'bad,headers\n1,2');
    await expect(source.enumerateCandidates()).rejects.toMatchObject({
      code: 'EXTERNAL_CATALOG_STALE',
      cause: { code: 'EXTERNAL_CATALOG_INVALID_HEADERS' },
    });
    expect(readFileSync(pointer, 'utf8')).toBe(before);
    clock = new Date(discoveryAt);
    expect(await source.enumerateCandidates()).toEqual(a);
  });
  it('imports authorized CSV, caches, reports row errors and binds provenance', async () => {
    const root = join(f.database, '..'),
      sourcePath = join(root, 'feed.csv');
    const c = discoveryCandidate();
    const cell = (s: string) => `"${s.replaceAll('"', '""')}"`;
    writeFileSync(
      sourcePath,
      'id,name,brand,discovery\n' +
        [
          c.externalProductId,
          c.productName,
          c.brand as string,
          JSON.stringify(c),
        ]
          .map(cell)
          .join(',') +
        '\nbad,Bad,Brand,not-json',
    );
    const source = new CsvDiscoverySource(
      {
        provider: 'shopee',
        sourcePath,
        cacheRoot: join(root, 'cache'),
        cacheKey: 'feed',
        columns: {
          externalId: 'id',
          name: 'name',
          brand: 'brand',
          discovery: 'discovery',
        },
        delimiter: ',',
        maxRecordChars: 100000,
        timeZone: 'America/Sao_Paulo',
        discovery: {
          sourceId: 'shopee_feed',
          authorized: true,
          authorizationRef: 'authorized_fixture',
        },
      },
      () => new Date(discoveryAt),
    );
    const batch = await source.enumerateCandidates();
    expect(batch.candidates).toHaveLength(1);
    expect(batch.errors).toEqual([
      { rowNumber: 3, code: 'DISCOVERY_JSON_INVALID' },
    ]);
    expect(source.scope).toBe(csvScope(source.config));
    expect(batch).toEqual(historicalDiscovery.csv);
    expect(batch.candidates[0].provenance.sourceHash).toBe(batch.source.sha256);
    writeFileSync(sourcePath, 'broken');
    expect(await source.enumerateCandidates()).toEqual(batch);
    expect(
      () =>
        new CsvDiscoverySource({
          ...source.config,
          discovery: { ...source.config.discovery, authorized: false },
        }),
    ).toThrow();
  });
  it('reserves/replays immutable selections, honors used ids and rolls back all tables', () => {
    const repo = new SqliteDiscoveryRepository(f.database);
    try {
      const c = discoveryCandidate();
      const create = () => ({
        discoveryRunId: 'discovery_one',
        selection: {
          ...rankAffiliateDiscovery([c], policy, discoveryAt).ranked[0],
          externalProductId: c.externalProductId,
          sourceId: c.sourceId,
          actor: { type: 'AUTOMATION' as const, id: 'kate_mkt_discovery' },
        },
        ranking: rankAffiliateDiscovery([c], policy, discoveryAt),
        candidates: [c],
        source: {},
        errors: [],
        policy,
        evaluatedAt: discoveryAt,
      });
      const hash = affiliateHash({ test: 1 });
      const saved = repo.reserve('discovery_one', hash, create, discoveryAt);
      const persisted = f.catalog.db
        .prepare(
          'SELECT payload_json FROM affiliate_discovery_decisions WHERE discovery_run_id=?',
        )
        .get('discovery_one');
      expect(JSON.parse(String(persisted.payload_json))).toEqual(saved);
      const historical = historicalDiscovery.historical;
      f.catalog.db
        .prepare('INSERT INTO affiliate_discovery_decisions VALUES(?,?,?,?,?)')
        .run(
          'historical_one',
          hash,
          null,
          historical.payloadHash,
          JSON.stringify(historical.decision),
        );
      f.catalog.db
        .prepare('INSERT INTO affiliate_discovery_execution VALUES(?,?,NULL)')
        .run('historical_one', 'BLOCKED');
      f.catalog.db
        .prepare(
          'INSERT INTO affiliate_discovery_events(discovery_run_id,state,recorded_at) VALUES(?,?,?)',
        )
        .run('historical_one', 'BLOCKED', discoveryAt);
      expect(repo.get('historical_one', hash)).toEqual(historical.decision);
      f.catalog.db
        .prepare(
          "UPDATE affiliate_discovery_execution SET state='UNKNOWN',result_json=? WHERE discovery_run_id='discovery_one'",
        )
        .run(JSON.stringify({ status: 'BLOCKED', reason: 'DISCOVERY_FAILED' }));
      expect(repo.get('discovery_one')).toEqual(saved);
      expect(
        repo.reserve(
          'discovery_one',
          hash,
          () => {
            throw Error('must not re-evaluate');
          },
          discoveryAt,
        ),
      ).toEqual(saved);
      expect(repo.used([c])).toEqual(new Set(['item_001']));
      expect(() =>
        repo.reserve(
          'discovery_one',
          affiliateHash({ test: 2 }),
          create,
          discoveryAt,
        ),
      ).toThrow('DISCOVERY_IDEMPOTENCY_CONFLICT');
      f.base.db.exec(
        "CREATE TRIGGER reject_discovery_event BEFORE INSERT ON affiliate_discovery_events BEGIN SELECT RAISE(ABORT,'fixture_failure'); END;",
      );
      expect(() =>
        repo.reserve(
          'discovery_two',
          hash,
          () => ({
            ...create(),
            discoveryRunId: 'discovery_two',
            selection: null,
          }),
          discoveryAt,
        ),
      ).toThrow('fixture_failure');
      expect(repo.get('discovery_two')).toBeNull();
      expect(
        f.base.db
          .prepare('SELECT count(*) n FROM affiliate_discovery_execution')
          .get().n,
      ).toBe(2);
      expect(f.base.db.prepare('PRAGMA user_version').get().user_version).toBe(
        39,
      );
    } finally {
      repo.close();
    }
  });
});
