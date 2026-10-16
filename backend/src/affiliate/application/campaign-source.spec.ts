import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSchema } from '../../administration/schema-provisioner.js';
import { SqliteAffiliateRepository } from '../infrastructure/sqlite-affiliate.repository.js';
import { AffiliateService } from './affiliate.service.js';
import { validateAffiliateCampaignSource } from '../domain/affiliate-campaign-source.js';
import { product, campaign } from '../../../test/support/affiliate-fixture.js';
import { falFixture } from '../../../test/support/fal-fixture.js';
import { raceCampaignSources } from '../../../test/support/affiliate-concurrency.js';

export const source = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 'affiliate-campaign-source/1.0.0',
  sourceId: 'source_001',
  revision: 1,
  source: 'SHOPEE_AFFILIATE_API',
  offer: {
    offerId: 'offer-001',
    productId: '9007199254740993',
    shopId: 'shop-001',
    provenance: {
      source: 'FAKE',
      fixtureVersion: 'shopee-affiliate-fake/1',
      observedAt: null,
    },
  },
  productId: 'prod_001',
  productRevision: 1,
  campaignId: 'camp_001',
  campaignRevision: 1,
  briefingId: null,
  affiliateUrl: 'https://s.shopee.com.br/abc123',
  ...overrides,
});
const refs = ['authorized-image-001'];

describe('versioned Shopee campaign source, offline', () => {
  let f: ReturnType<typeof falFixture>;
  let repo: SqliteAffiliateRepository;
  let service: AffiliateService;
  beforeEach(() => {
    f = falFixture();
    repo = new SqliteAffiliateRepository(f.database);
    repo.registerProduct(product(), 'product_one');
    repo.registerCampaign(
      campaign({ affiliateUrl: source().affiliateUrl }),
      'campaign_one',
      true,
    );
    service = new AffiliateService(
      {
        open: (readOnly = false) =>
          new SqliteAffiliateRepository(f.database, { readOnly }),
      },
      { get: vi.fn(async () => f.base.get('project_001')) },
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('NETWORK_FORBIDDEN');
      }),
    );
  });
  afterEach(() => {
    repo.close();
    f.cleanup();
    vi.unstubAllGlobals();
  });
  const command = (value = source(), key = 'source_one') => ({
    source: value,
    idempotencyKey: key,
    confirmed: true,
    verifiedMediaRefs: refs,
  });
  it('resolves the exact briefing snapshot, never the latest source revision', async () => {
    await service.associateCampaignSource(
      command(source({ briefingId: 'brief_one' })),
    );
    await service.associateCampaignSource(
      command(source({ revision: 2, briefingId: 'brief_two' }), 'source_two'),
    );
    expect(await service.resolveBriefingSource('brief_one')).toEqual(
      source({ briefingId: 'brief_one' }),
    );
    expect(await service.resolveBriefingSource('brief_two')).toEqual(
      source({ revision: 2, briefingId: 'brief_two' }),
    );
    await expect(
      service.resolveBriefingSource('missing'),
    ).rejects.toMatchObject({ code: 'AFFILIATE_BRIEFING_NOT_FOUND' });
  });
  it('rejects a Shopee campaign briefing without an explicit source binding', async () => {
    await service.associateCampaignSource(command());
    repo.createBriefing(
      {
        briefingId: 'brief_loose',
        campaignId: 'camp_001',
        campaignRevision: 1,
      },
      'brief_loose',
      true,
    );
    await expect(
      service.resolveBriefingSource('brief_loose'),
    ).rejects.toMatchObject({ code: 'AFFILIATE_SOURCE_BRIEFING_NOT_BOUND' });
  });
  it('detects ambiguous and inconsistent persisted source links', async () => {
    await service.associateCampaignSource(
      command(source({ briefingId: 'brief_one' })),
    );
    repo.db.exec('DROP INDEX affiliate_campaign_source_briefing_v1');
    repo.db
      .prepare(
        'INSERT INTO affiliate_campaign_sources_v1 SELECT source_id,2,campaign_id,campaign_revision,product_id,product_revision,briefing_id,content_hash,content_json FROM affiliate_campaign_sources_v1',
      )
      .run();
    await expect(
      service.resolveBriefingSource('brief_one'),
    ).rejects.toMatchObject({ code: 'AFFILIATE_SOURCE_AMBIGUOUS' });
    repo.db.exec(
      'DROP TRIGGER affiliate_campaign_sources_v1_no_delete; DELETE FROM affiliate_campaign_sources_v1 WHERE revision=2; DROP TRIGGER affiliate_campaign_sources_v1_no_update;',
    );
    repo.registerCampaign(
      campaign({ revision: 2, affiliateUrl: source().affiliateUrl }),
      'campaign_two',
      true,
    );
    repo.db
      .prepare('UPDATE affiliate_campaign_sources_v1 SET campaign_revision=2')
      .run();
    await expect(
      service.resolveBriefingSource('brief_one'),
    ).rejects.toMatchObject({ code: 'AFFILIATE_SOURCE_SCOPE_MISMATCH' });
  });
  it('validates a strict versioned, immutable contract', () => {
    expect(validateAffiliateCampaignSource(source())).toEqual(source());
    expect(
      Object.isFrozen(
        validateAffiliateCampaignSource(source()).offer.provenance,
      ),
    ).toBe(true);
    for (const value of [
      source({ schemaVersion: 'wrong' }),
      source({ revision: 0 }),
      source({ approved: true }),
      source({ offer: { ...source().offer, rights: true } }),
      source({
        offer: {
          ...source().offer,
          provenance: { source: 'FAKE', observedAt: null },
        },
      }),
      source({
        offer: {
          ...source().offer,
          provenance: {
            source: 'SHOPEE_LIVE',
            fixtureVersion: null,
            observedAt: 'yesterday',
          },
        },
      }),
    ])
      expect(() => validateAffiliateCampaignSource(value)).toThrow();
  });
  it('associates a registered eligible product, preserving exact identity and provenance after reopen', async () => {
    const result = await service.associateCampaignSource(command());
    expect(result).toEqual(source());
    expect(await service.getCampaignSource('source_001', 1)).toEqual(result);
    expect(result).not.toHaveProperty('approved');
    expect(result).not.toHaveProperty('rights');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(repo.getProduct('prod_001', 1)?.evidence).toEqual(
      product().evidence,
    );
  });
  it('requires explicit confirmation before opening persistence', async () => {
    const open = vi.fn();
    const local = new AffiliateService({ open }, { get: vi.fn() });
    await expect(
      local.associateCampaignSource({ ...command(), confirmed: undefined }),
    ).rejects.toThrow('CONFIRMATION_REQUIRED');
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    null,
    '',
    'http://s.shopee.com.br/abc',
    'https://evil.invalid/abc',
    'https://shopee.com.br/product',
    'https://s.shopee.com.br/abc?token=private',
  ])('rejects invalid affiliate link %s', async (affiliateUrl) => {
    await expect(
      service.associateCampaignSource(command(source({ affiliateUrl }))),
    ).rejects.toThrow();
    expect(
      repo.db
        .prepare('SELECT count(*) n FROM affiliate_campaign_sources_v1')
        .get()?.n,
    ).toBe(0);
  });
  it.each([
    { productId: 'missing' },
    { productRevision: 2 },
    { campaignId: 'missing' },
    { campaignRevision: 2 },
  ])('rejects missing references %j', async (override) => {
    await expect(
      service.associateCampaignSource(command(source(override))),
    ).rejects.toThrow();
    expect(
      repo.db
        .prepare('SELECT count(*) n FROM affiliate_campaign_sources_v1')
        .get()?.n,
    ).toBe(0);
  });
  it('does not infer media verification from an offer or its provenance', async () => {
    await expect(
      service.associateCampaignSource({ ...command(), verifiedMediaRefs: [] }),
    ).rejects.toThrow('SHOPEE_MEDIA_NOT_VERIFIED');
  });
  it('does not infer product eligibility from identity and provenance', async () => {
    // Empty media/spec evidence cannot turn an offer into a registered eligible product.
    await expect(
      service.registerProduct({
        idempotencyKey: 'incomplete',
        product: product({ media: [], evidence: [] }),
      }),
    ).rejects.toThrow();
    await expect(
      service.associateCampaignSource(
        command(source({ productId: 'unregistered' })),
      ),
    ).rejects.toThrow('AFFILIATE_PRODUCT_NOT_FOUND');
  });
  it('serializes identical and conflicting attempts across concurrent SQLite workers', async () => {
    const input = {
      source: source({ briefingId: 'brief_race' }),
      key: 'source_race',
      refs,
    };
    expect(await raceCampaignSources(f.database, [input, input])).toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(
      repo.db
        .prepare('SELECT count(*) n FROM affiliate_campaign_sources_v1')
        .get()?.n,
    ).toBe(1);
    expect(
      repo.db.prepare('SELECT count(*) n FROM affiliate_briefings').get()?.n,
    ).toBe(1);
    expect(
      repo.db
        .prepare(
          "SELECT count(*) n FROM affiliate_commands WHERE command_type='CAMPAIGN_SOURCE'",
        )
        .get()?.n,
    ).toBe(1);
    const changed = {
      ...input,
      source: source({
        briefingId: 'brief_race',
        offer: { ...source().offer, offerId: 'other-offer' },
      }),
    };
    const results = await raceCampaignSources(f.database, [input, changed]);
    expect(results).toEqual([
      { ok: true },
      { ok: false, code: 'AFFILIATE_IDEMPOTENCY_CONFLICT' },
    ]);
  });
  it('prevents concurrent competing associations under different keys', async () => {
    const input = { source: source(), key: 'race_one', refs };
    const other = {
      source: source({
        sourceId: 'other_source',
        offer: { ...source().offer, offerId: 'other-offer' },
      }),
      key: 'race_two',
      refs,
    };
    const results = await raceCampaignSources(f.database, [input, other]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: 'AFFILIATE_SOURCE_CONFLICT' },
    ]);
    expect(
      repo.db
        .prepare('SELECT count(*) n FROM affiliate_campaign_sources_v1')
        .get()?.n,
    ).toBe(1);
  });
  it('includes verification references and every commercial reference in the idempotent payload', async () => {
    await service.associateCampaignSource(command());
    for (const changed of [
      source({ offer: { ...source().offer, productId: 'other-product' } }),
      source({ productRevision: 2 }),
      source({ campaignRevision: 2 }),
      source({ briefingId: 'brief_other' }),
    ])
      await expect(
        service.associateCampaignSource(command(changed)),
      ).rejects.toThrow('AFFILIATE_IDEMPOTENCY_CONFLICT');
    await expect(
      service.associateCampaignSource({
        ...command(),
        verifiedMediaRefs: [...refs, 'another'],
      }),
    ).rejects.toThrow('AFFILIATE_IDEMPOTENCY_CONFLICT');
  });
  it('refuses provenance changes in a later source revision', async () => {
    await service.associateCampaignSource(command());
    const changed = source({
      revision: 2,
      briefingId: 'brief_001',
      offer: {
        ...source().offer,
        provenance: {
          source: 'SHOPEE_LIVE',
          fixtureVersion: null,
          observedAt: '2026-10-16T12:00:00Z',
        },
      },
    });
    await expect(
      service.associateCampaignSource(command(changed, 'next_source')),
    ).rejects.toThrow('AFFILIATE_SOURCE_CONFLICT');
    expect(repo.getBriefing('brief_001')).toBeNull();
  });
  it('replays identical commands and rejects changed provenance under the same or another key', async () => {
    const first = await service.associateCampaignSource(command());
    expect(await service.associateCampaignSource(command())).toEqual(first);
    const changed = source({
      offer: {
        ...source().offer,
        provenance: {
          source: 'FAKE',
          fixtureVersion: 'other/1',
          observedAt: null,
        },
      },
    });
    await expect(
      service.associateCampaignSource(command(changed)),
    ).rejects.toThrow('AFFILIATE_IDEMPOTENCY_CONFLICT');
    await expect(
      service.associateCampaignSource(command(changed, 'source_two')),
    ).rejects.toThrow('AFFILIATE_SOURCE_CONFLICT');
    await expect(
      service.associateCampaignSource(
        command(source({ sourceId: 'source_other' }), 'source_other'),
      ),
    ).rejects.toThrow('AFFILIATE_SOURCE_CONFLICT');
  });
  it('creates a briefing and a new source revision explicitly, keeping the old snapshot unchanged', async () => {
    await service.associateCampaignSource(command());
    const next = source({ revision: 2, briefingId: 'brief_001' });
    await expect(
      service.associateCampaignSource({
        ...command(next, 'brief_source'),
        confirmed: false,
      }),
    ).rejects.toThrow('CONFIRMATION_REQUIRED');
    expect(
      await service.associateCampaignSource(command(next, 'brief_source')),
    ).toEqual(next);
    expect(
      await service.associateCampaignSource(command(next, 'brief_source')),
    ).toEqual(next);
    expect(repo.getBriefing('brief_001')?.affiliateUrl).toBe(next.affiliateUrl);
    expect(repo.getCampaignSource('source_001', 1)?.briefingId).toBeNull();
    expect(repo.getCampaignSource('source_001', 2)?.briefingId).toBe(
      'brief_001',
    );
    const third = source({ revision: 3, briefingId: 'brief_002' });
    expect(
      await service.associateCampaignSource(command(third, 'brief_second')),
    ).toEqual(third);
    expect(repo.getCampaignSource('source_001', 2)?.briefingId).toBe(
      'brief_001',
    );
    expect(repo.getBriefing('brief_002')?.affiliateUrl).toBe(
      third.affiliateUrl,
    );
    expect(() =>
      repo.db.exec('UPDATE affiliate_campaign_sources_v1 SET briefing_id=NULL'),
    ).toThrow();
    expect(() =>
      repo.db.exec('DELETE FROM affiliate_campaign_sources_v1'),
    ).toThrow();
  });
  it('does not silently attach a previously created briefing', async () => {
    repo.createBriefing(
      { briefingId: 'brief_old', campaignId: 'camp_001', campaignRevision: 1 },
      'old_brief',
      true,
    );
    await expect(
      service.associateCampaignSource(
        command(source({ briefingId: 'brief_old' })),
      ),
    ).rejects.toThrow('AFFILIATE_SOURCE_BRIEFING_EXISTS');
  });
  it('rolls back the new briefing, source and command receipt on an injected source write failure', async () => {
    repo.db.exec(
      "CREATE TRIGGER injected_source_failure BEFORE INSERT ON affiliate_campaign_sources_v1 BEGIN SELECT RAISE(ABORT,'INJECTED'); END;",
    );
    await expect(
      service.associateCampaignSource(
        command(source({ briefingId: 'brief_new' })),
      ),
    ).rejects.toThrow('INJECTED');
    expect(repo.getBriefing('brief_new')).toBeNull();
    expect(
      repo.db
        .prepare(
          "SELECT * FROM affiliate_commands WHERE idempotency_key='source_one'",
        )
        .get(),
    ).toBeUndefined();
    repo.db.exec('DROP TRIGGER injected_source_failure');
    expect(
      await service.associateCampaignSource(
        command(source({ briefingId: 'brief_new' })),
      ),
    ).toHaveProperty('briefingId', 'brief_new');
  });
  it('rolls back both entities when the command receipt fails', async () => {
    repo.db.exec(
      "CREATE TRIGGER injected_receipt_failure BEFORE INSERT ON affiliate_commands WHEN NEW.command_type='CAMPAIGN_SOURCE' BEGIN SELECT RAISE(ABORT,'RECEIPT_FAILED'); END;",
    );
    await expect(
      service.associateCampaignSource(
        command(source({ briefingId: 'brief_new' })),
      ),
    ).rejects.toThrow('RECEIPT_FAILED');
    expect(repo.getBriefing('brief_new')).toBeNull();
    expect(repo.getCampaignSource('source_001', 1)).toBeNull();
  });
  it('preserves legacy campaigns and rejects link/scope mismatch', async () => {
    expect(repo.getCampaign('camp_001', 1)).not.toHaveProperty('source');
    await expect(
      service.associateCampaignSource(
        command(source({ affiliateUrl: 'https://s.shopee.com.br/other' })),
      ),
    ).rejects.toThrow('AFFILIATE_SOURCE_SCOPE_MISMATCH');
    repo.registerProduct(product({ productId: 'prod_other' }), 'product_other');
    await expect(
      service.associateCampaignSource(
        command(source({ productId: 'prod_other' })),
      ),
    ).rejects.toThrow('AFFILIATE_SOURCE_SCOPE_MISMATCH');
  });
  it('preserves pre-extension product, campaign, briefing and command records', async () => {
    const briefing = repo.createBriefing(
      { briefingId: 'brief_old', campaignId: 'camp_001', campaignRevision: 1 },
      'legacy_briefing',
      true,
    );
    repo.db.exec(
      "DROP TABLE affiliate_campaign_sources_v1; DELETE FROM schema_lineage_extensions_v1 WHERE lineage='affiliate-campaign-source';",
    );
    const tables = [
      'affiliate_product_revisions',
      'affiliate_campaign_revisions',
      'affiliate_briefings',
      'affiliate_commands',
    ];
    const before = tables.map((table) =>
      repo.db.prepare(`SELECT * FROM ${table}`).all(),
    );
    provisionSchema(repo.db);
    expect(
      tables.map((table) => repo.db.prepare(`SELECT * FROM ${table}`).all()),
    ).toEqual(before);
    expect(repo.getBriefing('brief_old')).toEqual(briefing);
    await service.associateCampaignSource(command());
    expect(repo.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

describe('additive campaign source migration', () => {
  it('upgrades an old schema 42 without changing historical rows; detects damaged protection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'source-migration-'));
    const db = new DatabaseSync(join(directory, 'test.sqlite'));
    try {
      provisionSchema(db);
      // Recreate the pre-extension state of an already provisioned schema 42.
      db.exec(
        "DROP TABLE affiliate_campaign_sources_v1; DELETE FROM schema_lineage_extensions_v1 WHERE lineage='affiliate-campaign-source';",
      );
      const before = db.prepare('SELECT * FROM schema_migrations').all();
      provisionSchema(db);
      expect(db.prepare('SELECT * FROM schema_migrations').all()).toEqual(
        before,
      );
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(42);
      db.exec('DROP TRIGGER affiliate_campaign_sources_v1_no_update');
      expect(() => provisionSchema(db)).toThrow(
        'SCHEMA_EXTENSION_INCOMPATIBLE',
      );
    } finally {
      db.close();
      rmSync(directory, { recursive: true });
    }
  });
});
