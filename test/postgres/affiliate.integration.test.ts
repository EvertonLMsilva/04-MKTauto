import { dirname } from 'node:path';
import { dynamicFixture } from './affiliate-dynamic-fixture.js';
import {
  discoveryCandidate,
  discoveryAt,
} from '../support/discovery-fixture.js';
import { PostgresDiscoveryPersistence } from '../../src/modules/affiliate/infrastructure/postgres-discovery.persistence.js';
import { DiscoveryPersistence } from '../../src/modules/affiliate/infrastructure/discovery.persistence.js';
import { AffiliateDiscoveryService } from '../../src/modules/affiliate/application/discovery.service.js';
import { ShopeeDynamicJournal } from '../../src/modules/affiliate/infrastructure/shopee-dynamic-journal.js';
import { ShopeeDynamicService } from '../../src/modules/affiliate/application/shopee-dynamic.service.js';
import { ShopeeCatalogService } from '../../src/modules/affiliate/application/shopee-catalog.service.js';
import { SqliteAffiliatePersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { SqliteProjectPersistence } from '../../src/modules/project/infrastructure/sqlite-project.persistence.js';
import type { ShopeeOfferPagePort } from '../../src/modules/affiliate/application/ports/shopee-affiliate.port.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { AFFILIATE_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.migrations.js';
import { PostgresAffiliatePersistence } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.persistence.js';
import { PostgresAffiliateSessionFactory } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.session.js';
import { PostgresProjectPersistence } from '../../src/modules/project/infrastructure/postgres-project.persistence.js';
import { SqliteAffiliateRepository } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate.repository.js';
import { AffiliateService } from '../../src/modules/affiliate/application/affiliate.service.js';
import { ShopeeCatalogCommit } from '../../src/modules/affiliate/infrastructure/shopee-catalog-commit.js';
import { AffiliateModule } from '../../src/modules/affiliate/affiliate.module.js';
import { AffiliateRunContextService } from '../../src/modules/affiliate/application/affiliate-run-context.service.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';
import {
  product,
  campaign,
  project,
  sqliteAffiliateFixture,
  failure,
  source,
  at,
} from './affiliate-fixture.js';

describe('Affiliate real PostgreSQL', () => {
  let database: PostgresDatabase;
  let persistence: PostgresAffiliatePersistence;
  let projects: PostgresProjectPersistence;
  let sessions: PostgresAffiliateSessionFactory;
  let sqlite: SqliteAffiliateRepository;
  let fixture: ReturnType<typeof sqliteAffiliateFixture>;
  const readers = {
    executions: { getRun: () => null },
    activity: { hasStarted: () => false },
  };
  beforeAll(async () => {
    database = new PostgresDatabase(getTestPostgresConfig());
    await assertDisposableDatabase(database);
  });
  beforeEach(async () => {
    await assertDisposableDatabase(database);
    for (const schema of [
      'affiliate',
      'content',
      'research',
      'project',
      'platform',
    ])
      await database.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await new PostgresMigrationRunner(database).migrate(migrations);
    projects = new PostgresProjectPersistence(database);
    const repo = await projects.open();
    try {
      await repo.create(project(), { createdAt: at });
    } finally {
      await repo.close();
    }
    sessions = new PostgresAffiliateSessionFactory(database, readers);
    persistence = new PostgresAffiliatePersistence(sessions);
    fixture = sqliteAffiliateFixture();
    sqlite = new SqliteAffiliateRepository(fixture.path);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    sqlite?.close();
    fixture?.cleanup();
  });
  afterAll(async () => {
    await database?.close();
  });
  it('records v4 after unmodified v1/v2/v3, reexecutes and rejects checksum drift', async () => {
    expect(migrations.map((m) => m.version)).toEqual([1, 2, 3, 4]);
    expect(
      (
        await database.query(
          'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual(
      migrations.map((m) => ({
        version: m.version,
        name: m.name,
        checksum: postgresMigrationChecksum(m.sql),
      })),
    );
    expect(
      await new PostgresMigrationRunner(database).migrate(migrations),
    ).toEqual({ applied: [], currentVersion: 4 });
    await expect(
      new PostgresMigrationRunner(database).migrate([
        ...migrations.slice(0, 3),
        { ...migrations[3], sql: migrations[3].sql + '\n--drift' },
      ]),
    ).rejects.toThrow();
    await expect(
      new PostgresMigrationRunner(database).migrate([
        ...migrations,
        {
          version: 5,
          name: '005_failed_fixture',
          sql: 'CREATE TABLE affiliate.rollback_probe(id integer); SELECT fixture_missing();',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (
        await database.query(
          "SELECT pg_catalog.to_regclass('affiliate.rollback_probe') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull();
  });
  it('preserves products, revisions, campaigns, briefings, receipts, catalog order and exact JSON', async () => {
    const pg = await persistence.open();
    for (const item of [product(), product({ revision: 2, name: 'Revisao 2' })])
      expect(
        await pg.registerProduct(item, `product_${item.revision}`),
      ).toEqual(sqlite.registerProduct(item, `product_${item.revision}`));
    const c = campaign({ productRevision: 2 });
    expect(await pg.registerCampaign(c, 'campaign_one', true)).toEqual(
      sqlite.registerCampaign(c, 'campaign_one', true),
    );
    const input = {
      briefingId: 'brief_001',
      campaignId: c.campaignId,
      campaignRevision: 1,
    };
    const briefing = await pg.createBriefing(input, 'brief_one', true);
    expect(briefing).toEqual(sqlite.createBriefing(input, 'brief_one', true));
    expect(await pg.getBriefing('brief_001')).toEqual(briefing);
    expect(await pg.catalogCandidates('project_001')).toEqual(
      sqlite.catalogCandidates('project_001'),
    );
    expect(await pg.registerCampaign(c, 'campaign_one', false)).toEqual(c);
    const rows = (
      await database.query(
        'SELECT result_json::text AS raw,result_hash FROM affiliate.affiliate_commands ORDER BY idempotency_key',
      )
    ).rows;
    expect(rows).toEqual(
      sqlite.db
        .prepare(
          'SELECT result_json AS raw,result_hash FROM affiliate_commands ORDER BY idempotency_key',
        )
        .all(),
    );
    await pg.close();
  });
  it('preserves errors, idempotency conflicts and competing revision outcomes', async () => {
    const pg = await persistence.open();
    await pg.registerProduct(product(), 'product_one');
    sqlite.registerProduct(product(), 'product_one');
    for (const item of [
      product({ name: 'Different' }),
      product({ revision: 3 }),
    ])
      expect(
        await failure(() => pg.registerProduct(item, 'product_other')),
      ).toEqual(
        await failure(() => sqlite.registerProduct(item, 'product_other')),
      );
    expect(
      await failure(() =>
        pg.registerProduct(product({ name: 'Different' }), 'product_one'),
      ),
    ).toEqual(
      await failure(() =>
        sqlite.registerProduct(product({ name: 'Different' }), 'product_one'),
      ),
    );
    const other = await persistence.open();
    const results = await Promise.all([
      pg.registerProduct(product(), 'product_replay'),
      other.registerProduct(product(), 'product_replay'),
    ]);
    expect(results[0]).toEqual(results[1]);
    await pg.close();
    await other.close();
  });
  it('commits product + campaign + source + receipts atomically and retries after rollback', async () => {
    const commit = new ShopeeCatalogCommit<true>(persistence),
      p = product(),
      c = campaign({ affiliateUrl: 'https://s.shopee.com.br/fixture_001' }),
      s = source(p, c);
    await expect(commit.commit(p, c, s, [], 'failed')).rejects.toMatchObject({
      code: 'SHOPEE_MEDIA_NOT_VERIFIED',
    });
    for (const table of [
      'affiliate_product_revisions',
      'affiliate_campaign_revisions',
      'affiliate_campaign_sources_v1',
      'affiliate_commands',
    ])
      expect(
        (await database.query(`SELECT count(*) FROM affiliate.${table}`))
          .rows[0].count,
      ).toBe('0');
    expect(
      await commit.commit(
        p,
        c,
        s,
        p.media.map((m: any) => m.mediaRef),
        'retry',
      ),
    ).toEqual(s);
    expect(
      await commit.commit(
        p,
        c,
        s,
        p.media.map((m: any) => m.mediaRef),
        'retry',
      ),
    ).toEqual(s);
    expect(
      (
        await database.query(
          'SELECT count(*) FROM affiliate.affiliate_commands',
        )
      ).rows[0].count,
    ).toBe('3');
  });
  it('protects immutable history, foreign keys, read-only and closed handles', async () => {
    const pg = await persistence.open();
    await pg.registerProduct(product(), 'product_one');
    await expect(
      database.query('DELETE FROM affiliate.affiliate_product_revisions'),
    ).rejects.toMatchObject({ sqlState: 'P4001' });
    await expect(
      database.query(
        "INSERT INTO affiliate.affiliate_campaign_revisions VALUES('camp_missing',1,'project_001','missing_product',1,$1,'{}')",
        ['a'.repeat(64)],
      ),
    ).rejects.toMatchObject({ sqlState: '23503' });
    const read = await persistence.open(true);
    await expect(
      read.registerProduct(product({ revision: 2 }), 'product_two'),
    ).rejects.toThrow();
    await read.close();
    await pg.close();
    await expect(pg.getProduct('prod_001', 1)).rejects.toThrow(
      'AFFILIATE_HANDLE_CLOSED',
    );
  });
  it('shares the application rules and blocks Operations-dependent writes before effects', async () => {
    const service = new AffiliateService<true>(
      persistence,
      projects,
      new ShopeeCatalogCommit<true>(persistence),
    );
    expect(
      await service.registerProduct({
        product: product(),
        idempotencyKey: 'product_one',
      }),
    ).toEqual(product());
    expect(
      await service.registerCampaign({
        campaign: campaign(),
        idempotencyKey: 'campaign_one',
      }),
    ).toEqual(campaign());
    const contexts = new AffiliateRunContextService<true>(persistence);
    await expect(
      contexts.bindRun(
        { pipelineRunId: 'run_001', briefingId: 'brief_001' },
        'binding_one',
      ),
    ).rejects.toThrow('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
    expect(
      (
        await database.query(
          'SELECT count(*) FROM affiliate.affiliate_run_bindings',
        )
      ).rows[0].count,
    ).toBe('0');
  });
  it('preserves journal hashes, exact decimal strings, event order and atomic link claims', async () => {
    const pg = new ShopeeDynamicJournal<true>(sessions),
      native = new ShopeeDynamicJournal(fixture.path);
    await pg.initialize();
    native.initialize();
    const value = {
      price: '12345678901234567890.123456789012345678',
      rate: '0.00000000000000000000000000000001',
      subIds: ['project001', 'fones'],
      optional: undefined,
    };
    expect(await pg.put('CONFIGURATION', 'project_001', 'v1', value)).toBe(
      native.put('CONFIGURATION', 'project_001', 'v1', value),
    );
    expect(await pg.put('CONFIGURATION', 'project_001', 'v1', value)).toBe(
      false,
    );
    expect(await pg.get('CONFIGURATION', 'project_001')).toEqual(
      native.get('CONFIGURATION', 'project_001'),
    );
    const left = 'a'.repeat(64),
      right = 'b'.repeat(64),
      scope = 'c'.repeat(64);
    const results = await Promise.all([
      pg.claimLink(left, scope, { callId: left }),
      new ShopeeDynamicJournal<true>(sessions).claimLink(right, scope, {
        callId: right,
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? left : right,
      loser = results[0] ? right : left;
    expect(await pg.get('LINK', loser, 'CLAIM')).toBeNull();
    await pg.put('LINK', winner, 'UNCERTAIN', {
      code: 'LINK_RECONCILIATION_REQUIRED',
    });
    expect(await pg.claimLink(loser, scope, { callId: loser })).toBe(false);
    await pg.put('LINK', winner, 'RECONCILED', {
      url: 'https://s.shopee.com.br/fixture',
    });
    expect(await pg.claimLink(loser, scope, { callId: loser })).toBe(true);
    expect(
      (
        await database.query(
          "SELECT content_json::text AS raw FROM affiliate.affiliate_shopee_dynamic_events_v1 WHERE topic='CONFIGURATION'",
        )
      ).rows[0].raw,
    ).toBe(JSON.stringify(value));
    await expect(
      database.query(
        'DELETE FROM affiliate.affiliate_shopee_dynamic_events_v1',
      ),
    ).rejects.toMatchObject({ sqlState: 'P4001' });
  });
  it('reserves discovery decisions once, keeps history and matches SQLite ranking and exclusion', async () => {
    const batch = {
      candidates: [
        discoveryCandidate('item_001'),
        discoveryCandidate('item_002'),
      ],
      errors: [],
      source: { fixture: 'offline' },
    };
    const sources = {
      open: async () => ({
        scope: 'fixture:affiliate',
        enumerateCandidates: async () => batch,
      }),
    };
    const pg = new AffiliateDiscoveryService<true>(
      new PostgresDiscoveryPersistence(sessions),
      sources,
      projects,
      () => discoveryAt,
    );
    const native = new AffiliateDiscoveryService(
      new DiscoveryPersistence(fixture.path),
      sources,
      new SqliteProjectPersistence(fixture.path),
      () => discoveryAt,
    );
    const input = {
      discoveryRunId: 'discovery_001',
      projectId: 'project_001',
      projectVersion: 1,
    };
    expect(await pg.select(input)).toEqual(await native.select(input));
    expect(await pg.select(input)).toEqual(await native.select(input));
    const next = { ...input, discoveryRunId: 'discovery_002' };
    expect(await pg.select(next)).toEqual(await native.select(next));
    expect(
      (
        await database.query(
          'SELECT count(*) FROM affiliate.affiliate_discovery_events',
        )
      ).rows[0].count,
    ).toBe('2');
    expect(await pg.get(input.discoveryRunId)).toEqual(
      native.get(input.discoveryRunId),
    );
  });
  it('serializes competing discovery requests and rolls back failed event writes', async () => {
    const store = new PostgresDiscoveryPersistence(sessions),
      a = await store.open(),
      b = await store.open();
    const sources = {
      open: async () => ({
        scope: 'fixture:affiliate',
        enumerateCandidates: async () => ({
          candidates: [discoveryCandidate()],
          errors: [],
          source: { fixture: 'offline' },
        }),
      }),
    };
    const svc = new AffiliateDiscoveryService<true>(
      store,
      sources,
      projects,
      () => discoveryAt,
    );
    await database.query(
      "CREATE FUNCTION affiliate.fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER fixture_fail BEFORE INSERT ON affiliate.affiliate_discovery_events FOR EACH ROW EXECUTE FUNCTION affiliate.fixture_fail()",
    );
    const input = {
      discoveryRunId: 'discovery_001',
      projectId: 'project_001',
      projectVersion: 1,
    };
    await expect(svc.select(input)).rejects.toThrow();
    expect(
      (
        await database.query(
          'SELECT count(*) FROM affiliate.affiliate_discovery_decisions',
        )
      ).rows[0].count,
    ).toBe('0');
    await database.query(
      'DROP TRIGGER fixture_fail ON affiliate.affiliate_discovery_events',
    );
    const result = await svc.select(input);
    expect(await a.get(input.discoveryRunId)).toEqual(result);
    const replay = await Promise.all([svc.select(input), svc.select(input)]);
    expect(replay).toEqual([result, result]);
    await a.close();
    await b.close();
  });
  it('preserves WAITING/PREPARED, SubIDs and recovery with a local fake provider and real PostgreSQL', async () => {
    const f = dynamicFixture(dirname(fixture.path));
    vi.stubEnv('FFMPEG_MEDIA_ROOT', f.mediaRoot);
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
    const network = vi.fn(() => {
      throw new Error('No external network permitted');
    });
    vi.stubGlobal('fetch', network);
    let calls = 0;
    const port: ShopeeOfferPagePort = {
      queryOffers: async () => [f.offer],
      queryOfferPage: async () => ({
        offers: [f.offer],
        pageInfo: { page: 1, limit: 2, hasNextPage: false, nextPage: null },
      }),
      generateLink: async () => {
        calls++;
        return f.link;
      },
    };
    const catalog = new ShopeeCatalogService(port),
      pgAffiliate = new AffiliateService<true>(
        persistence,
        projects,
        new ShopeeCatalogCommit<true>(persistence),
      ),
      pgJournal = new ShopeeDynamicJournal<true>(sessions);
    const service = new ShopeeDynamicService<true>(
      catalog,
      pgAffiliate,
      pgJournal,
      projects,
    );
    await service.configure({ ...f.config, authorizations: [] });
    expect(
      (await service.runCycle('project_001', 'cycle_wait')).decisions[0].status,
    ).toBe('WAITING');
    expect(calls).toBe(0);
    await service.configure(f.config);
    const result = await service.runCycle('project_001', 'cycle_ready');
    expect(result.decisions[0]).toMatchObject({
      status: 'PREPARED',
      reasons: ['CATALOG_READY'],
    });
    expect(calls).toBe(1);
    expect(await service.runCycle('project_001', 'cycle_ready')).toEqual(
      result,
    );
    expect(calls).toBe(1);
    const snapshot = await pgJournal.get<any>(
      'LINK',
      result.decisions[0].callId!,
      'CLAIM',
    );
    expect(snapshot.input.subIds).toEqual(f.config.subIds);
    expect(snapshot.offer.estimatedCommission.rate).toBe(
      f.offer.estimatedCommission.rate,
    );
    const nativeAffiliate = new AffiliateService(
      new SqliteAffiliatePersistence(fixture.path),
      new SqliteProjectPersistence(fixture.path),
      new ShopeeCatalogCommit(fixture.path),
    );
    const native = new ShopeeDynamicService(
      catalog,
      nativeAffiliate,
      new ShopeeDynamicJournal(fixture.path),
      new SqliteProjectPersistence(fixture.path),
    );
    await native.configure(f.config);
    expect(await native.runCycle('project_001', 'cycle_ready')).toEqual(result);
    const restarted = new ShopeeDynamicService<true>(
      catalog,
      pgAffiliate,
      new ShopeeDynamicJournal<true>(sessions),
      projects,
    );
    expect(await restarted.recoverCycle('project_001', 'cycle_ready')).toEqual(
      result,
    );
    expect(network).not.toHaveBeenCalled();
  });
  it('retains uncertain remote outcomes across restart and reconciles without a second mutation', async () => {
    const f = dynamicFixture(dirname(fixture.path));
    vi.stubEnv('FFMPEG_MEDIA_ROOT', f.mediaRoot);
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
    let calls = 0;
    const network = vi.fn(() => {
      throw new Error('No network');
    });
    vi.stubGlobal('fetch', network);
    const port: ShopeeOfferPagePort = {
      queryOffers: async () => [f.offer],
      queryOfferPage: async () => ({
        offers: [f.offer],
        pageInfo: { page: 1, limit: 2, hasNextPage: false, nextPage: null },
      }),
      generateLink: async () => {
        calls++;
        throw new Error('private uncertain fixture');
      },
    };
    const catalog = new ShopeeCatalogService(port),
      affiliate = new AffiliateService<true>(
        persistence,
        projects,
        new ShopeeCatalogCommit<true>(persistence),
      );
    const service = new ShopeeDynamicService<true>(
      catalog,
      affiliate,
      new ShopeeDynamicJournal<true>(sessions),
      projects,
    );
    await service.configure(f.config);
    const result = await service.runCycle('project_001', 'cycle_uncertain');
    expect(result.decisions[0]).toMatchObject({
      status: 'WAITING',
      reasons: ['LINK_RECONCILIATION_REQUIRED'],
    });
    expect(calls).toBe(1);
    const restarted = new ShopeeDynamicService<true>(
      catalog,
      affiliate,
      new ShopeeDynamicJournal<true>(sessions),
      projects,
    );
    expect(
      (await restarted.runCycle('project_001', 'cycle_next')).decisions[0]
        .reasons,
    ).toEqual(['LINK_RECONCILIATION_REQUIRED']);
    expect(calls).toBe(1);
    await restarted.reconcileLink(result.decisions[0].callId!, {
      url: f.link.url,
      sourceRef: 'FICTITIOUS_TEST_ONLY:reconciled',
      recordedAt: at,
    });
    expect(
      (await restarted.runCycle('project_001', 'cycle_reconciled')).decisions[0]
        .status,
    ).toBe('PREPARED');
    expect(calls).toBe(1);
    expect(network).not.toHaveBeenCalled();
    await expect(
      restarted.runAuthorizedScheduledCycle(
        'project_001',
        'cycle_live',
        'grant_001',
        'campaign_001',
        '2026-11-11',
      ),
    ).rejects.toThrow('SHOPEE_POSTGRES_LIVE_RESERVATION_UNSUPPORTED');
    expect(calls).toBe(1);
  });
  it('allows one competing revision and keeps no losing command receipt', async () => {
    const a = await persistence.open(),
      b = await persistence.open();
    await a.registerProduct(product(), 'product_one');
    const outcomes = await Promise.allSettled([
      a.registerProduct(
        product({ revision: 2, name: 'First' }),
        'revision_first',
      ),
      b.registerProduct(
        product({ revision: 2, name: 'Second' }),
        'revision_second',
      ),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((o) => o.status === 'rejected')).toMatchObject({
      reason: { code: 'AFFILIATE_REVISION_CONFLICT' },
    });
    expect(
      (
        await database.query(
          "SELECT count(*) FROM affiliate.affiliate_commands WHERE idempotency_key IN ('revision_first','revision_second')",
        )
      ).rows[0].count,
    ).toBe('1');
    await a.close();
    await b.close();
  });
  it('rolls back both link identities when scope reservation fails', async () => {
    const journal = new ShopeeDynamicJournal<true>(sessions);
    await journal.initialize();
    await database.query(
      "CREATE FUNCTION affiliate.reject_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic='LINK_SCOPE' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_scope BEFORE INSERT ON affiliate.affiliate_shopee_dynamic_events_v1 FOR EACH ROW EXECUTE FUNCTION affiliate.reject_scope()",
    );
    await expect(
      journal.claimLink('d'.repeat(64), 'scope_001', { request: 'one' }),
    ).rejects.toThrow();
    expect(
      (
        await database.query(
          'SELECT count(*) FROM affiliate.affiliate_shopee_dynamic_events_v1',
        )
      ).rows[0].count,
    ).toBe('0');
    await database.query(
      'DROP TRIGGER reject_scope ON affiliate.affiliate_shopee_dynamic_events_v1',
    );
    expect(
      await journal.claimLink('d'.repeat(64), 'scope_001', { request: 'one' }),
    ).toBe(true);
  });
  it('prevents two different discovery runs from selecting the same product concurrently', async () => {
    const source = {
      open: async () => ({
        scope: 'fixture:one-product',
        enumerateCandidates: async () => ({
          candidates: [discoveryCandidate()],
          errors: [],
          source: { fixture: 'offline' },
        }),
      }),
    };
    const service = new AffiliateDiscoveryService<true>(
      new PostgresDiscoveryPersistence(sessions),
      source,
      projects,
      () => discoveryAt,
    );
    const results = await Promise.all(
      ['discovery_left', 'discovery_right'].map((discoveryRunId) =>
        service.select({
          discoveryRunId,
          projectId: 'project_001',
          projectVersion: 1,
        }),
      ),
    );
    expect(results.filter((result) => result.selection !== null)).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.selection === null)).toHaveLength(
      1,
    );
    expect(
      (
        await database.query(
          'SELECT count(*) FROM affiliate.affiliate_discovery_events',
        )
      ).rows[0].count,
    ).toBe('2');
  });
  it('resumes after catalog commit but before journal completion without repeating provider work', async () => {
    const f = dynamicFixture(dirname(fixture.path));
    vi.stubEnv('FFMPEG_MEDIA_ROOT', f.mediaRoot);
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
    let calls = 0;
    const page = vi.fn(async () => ({
      offers: [f.offer],
      pageInfo: { page: 1, limit: 2, hasNextPage: false, nextPage: null },
    }));
    const port: ShopeeOfferPagePort = {
      queryOffers: async () => [f.offer],
      queryOfferPage: page,
      generateLink: async () => {
        calls++;
        return f.link;
      },
    };
    const journal = new ShopeeDynamicJournal<true>(sessions),
      affiliate = new AffiliateService<true>(
        persistence,
        projects,
        new ShopeeCatalogCommit<true>(persistence),
      ),
      catalog = new ShopeeCatalogService(port);
    const service = new ShopeeDynamicService<true>(
      catalog,
      affiliate,
      journal,
      projects,
    );
    await service.configure(f.config);
    const original = journal.put.bind(journal);
    let interrupted = false;
    vi.spyOn(journal, 'put').mockImplementation(
      async (topic, id, event, value) => {
        if (topic === 'PREPARATION' && event === 'COMPLETE' && !interrupted) {
          interrupted = true;
          throw new Error('fixture process interruption');
        }
        return original(topic, id, event, value);
      },
    );
    await expect(
      service.runCycle('project_001', 'cycle_interrupted'),
    ).rejects.toThrow('fixture process interruption');
    expect(calls).toBe(1);
    expect(
      (
        await database.query(
          'SELECT count(*) FROM affiliate.affiliate_campaign_sources_v1',
        )
      ).rows[0].count,
    ).toBe('1');
    page.mockImplementation(async () => {
      throw new Error('Recovery must not query provider');
    });
    const restarted = new ShopeeDynamicService<true>(
      catalog,
      affiliate,
      new ShopeeDynamicJournal<true>(sessions),
      projects,
    );
    expect(
      (await restarted.recoverCycle('project_001', 'cycle_interrupted'))
        .decisions[0].status,
    ).toBe('PREPARED');
    expect(calls).toBe(1);
    expect(page).toHaveBeenCalledTimes(1);
    expect(
      (
        await database.query(
          'SELECT count(*) FROM affiliate.affiliate_commands',
        )
      ).rows[0].count,
    ).toBe('3');
  });
  it('reads historical run contexts and rejects new Operations-dependent writes without partial data', async () => {
    const pg = await persistence.open();
    await pg.registerProduct(product(), 'product_one');
    await pg.registerCampaign(campaign(), 'campaign_one', true);
    const brief = await pg.createBriefing(
      { briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 },
      'brief_one',
      true,
    );
    // Fixture-only historical rows, not an import path or an enabled operational writer.
    await database.query(
      'INSERT INTO affiliate.affiliate_run_bindings VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        'run_001',
        brief.briefingId,
        brief.contentHash,
        brief.campaignId,
        brief.campaignRevision,
        brief.productId,
        brief.productRevision,
      ],
    );
    await database.query(
      'INSERT INTO affiliate.affiliate_script_contexts VALUES($1,$2,$3,$4)',
      ['generation_one', 'a'.repeat(64), 'run_001', brief.contentHash],
    );
    const contextReaders = {
      executions: {
        getRun: () => ({
          pipelineRunId: 'run_001',
          projectId: 'project_001',
          projectVersion: 1,
          state: 'RUNNING' as const,
        }),
      },
      activity: { hasStarted: () => false },
    };
    const store = new PostgresAffiliatePersistence(
        new PostgresAffiliateSessionFactory(database, contextReaders),
      ),
      contexts = new AffiliateRunContextService<true>(store);
    expect(await contexts.resolveRunBriefing('run_001', 'brief_001')).toEqual(
      brief,
    );
    expect(await contexts.inspectRun('run_001')).toMatchObject({
      binding: { briefingHash: brief.contentHash },
      briefing: brief,
    });
    await contexts.verifyScriptGenerationContext(
      { generationRequestId: 'generation_one', contentHash: 'a'.repeat(64) },
      'run_001',
      brief,
    );
    await expect(
      contexts.prepareScriptGeneration(
        { generationRequestId: 'generation_new', contentHash: 'b'.repeat(64) },
        'run_001',
      ),
    ).rejects.toThrow('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED');
    expect(
      (
        await database.query(
          'SELECT count(*) FROM affiliate.affiliate_script_contexts',
        )
      ).rows[0].count,
    ).toBe('1');
    await pg.close();
  });
  it('keeps an active cycle claim exclusive and replays the committed result', async () => {
    const f = dynamicFixture(dirname(fixture.path));
    vi.stubEnv('FFMPEG_MEDIA_ROOT', f.mediaRoot);
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
    let release!: () => void,
      started!: () => void,
      calls = 0;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      entered = new Promise<void>((resolve) => {
        started = resolve;
      });
    const port: ShopeeOfferPagePort = {
      queryOffers: async () => [f.offer],
      queryOfferPage: async () => {
        started();
        await gate;
        return {
          offers: [f.offer],
          pageInfo: { page: 1, limit: 2, hasNextPage: false, nextPage: null },
        };
      },
      generateLink: async () => {
        calls++;
        return f.link;
      },
    };
    const affiliate = new AffiliateService<true>(
        persistence,
        projects,
        new ShopeeCatalogCommit<true>(persistence),
      ),
      catalog = new ShopeeCatalogService(port);
    const service = new ShopeeDynamicService<true>(
      catalog,
      affiliate,
      new ShopeeDynamicJournal<true>(sessions),
      projects,
    );
    await service.configure(f.config);
    const first = service.runCycle('project_001', 'cycle_concurrent');
    let result!: Awaited<typeof first>;
    try {
      await entered;
      await expect(
        service.runCycle('project_001', 'cycle_concurrent'),
      ).rejects.toThrow('SHOPEE_CYCLE_IN_PROGRESS_OR_RECOVERY_REQUIRED');
    } finally {
      release();
      result = await first;
    }
    expect(result.decisions[0].status).toBe('PREPARED');
    expect(await service.runCycle('project_001', 'cycle_concurrent')).toEqual(
      result,
    );
    expect(calls).toBe(1);
  });
  it('exposes real NestJS opt-in HTTP without changing default SQLite or external providers', async () => {
    const module = await Test.createTestingModule({
      imports: [AffiliateModule.postgres(getTestPostgresConfig(), { readers })],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer())
        .post('/affiliate/products')
        .send({ idempotencyKey: 'product_one', product: product() })
        .expect(201)
        .expect(({ body }) => expect(body).toEqual(product()));
      await request(app.getHttpServer())
        .get('/affiliate/products/prod_001/revisions/1')
        .expect(200);
      await request(app.getHttpServer())
        .post('/affiliate/products')
        .send({
          idempotencyKey: 'product_one',
          product: product({ name: 'Different' }),
        })
        .expect(409);
      await request(app.getHttpServer())
        .post('/affiliate/run-bindings')
        .send({})
        .expect(409)
        .expect(({ body }) =>
          expect(body.code).toBe('AFFILIATE_CROSS_DOMAIN_TRANSACTION_REQUIRED'),
        );
      await request(app.getHttpServer())
        .get('/affiliate/runs/run_missing')
        .expect(404)
        .expect(({ body }) => expect(body.code).toBe('PIPELINE_RUN_NOT_FOUND'));
    } finally {
      await app.close();
    }
  });
});
