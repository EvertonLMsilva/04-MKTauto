import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  affiliateFixture,
  product,
  campaign,
} from '../../../test/support/affiliate-fixture.js';
import { SqliteAffiliateRepository } from './sqlite-affiliate.repository.js';
import { raceProducts } from '../../../test/support/affiliate-concurrency.js';

describe('Affiliate SQLite JS × TS', () => {
  let fixture: ReturnType<typeof affiliateFixture>;
  let ts: SqliteAffiliateRepository;
  beforeEach(() => {
    fixture = affiliateFixture();
    ts = new SqliteAffiliateRepository(fixture.database);
  });
  afterEach(() => {
    ts?.close();
    fixture?.cleanup();
  });
  it('reads JS history and receipts, writes TS records readable/replayable by JS', () => {
    const v1 = fixture.catalog.registerProduct(product(), 'product_one');
    expect(ts.getProduct('prod_001', 1)).toEqual(v1);
    expect(ts.registerProduct(product(), 'product_one')).toEqual(v1);
    const v2 = product({
      revision: 2,
      schemaVersion: 'affiliate-product/2.0.0',
      brand: { status: 'NOT_PROVIDED', name: null, evidenceRef: 'ev_spec' },
    });
    ts.registerProduct(v2, 'product_two');
    expect(fixture.catalog.getProduct('prod_001', 2)).toEqual(v2);
    expect(fixture.catalog.registerProduct(v2, 'product_two')).toEqual(v2);
    const c = campaign({ productRevision: 2 });
    ts.registerCampaign(c, 'campaign_one', true);
    expect(fixture.catalog.getCampaign('camp_001', 1)).toEqual(c);
    expect(fixture.catalog.registerCampaign(c, 'campaign_one')).toEqual(c);
    const input = {
      briefingId: 'brief_001',
      campaignId: 'camp_001',
      campaignRevision: 1,
    };
    const b = fixture.catalog.createBriefing(input, 'brief_one');
    expect(ts.getBriefing('brief_001')).toEqual(b);
    expect(ts.createBriefing(input, 'brief_one', true)).toEqual(b);
    const other = { ...input, briefingId: 'brief_002' };
    const saved = ts.createBriefing(other, 'brief_two', true);
    expect(fixture.catalog.getBriefing('brief_002')).toEqual(saved);
    expect(fixture.catalog.createBriefing(other, 'brief_two')).toEqual(saved);
    expect(ts.db.prepare('PRAGMA user_version').get()?.user_version).toBe(39);
  });
  it('preserves V1 briefings and receipts across V2 revisions and reopen', () => {
    fixture.catalog.registerProduct(product(), 'legacy_product');
    fixture.catalog.registerCampaign(campaign(), 'legacy_campaign');
    const input = {
      briefingId: 'brief_001',
      campaignId: 'camp_001',
      campaignRevision: 1,
    };
    const historical = fixture.catalog.createBriefing(input, 'legacy_brief');
    const saved = ts.db
      .prepare(
        'SELECT content_json FROM affiliate_briefings WHERE briefing_id=?',
      )
      .get('brief_001')?.content_json;
    ts.registerProduct(
      product({
        revision: 2,
        schemaVersion: 'affiliate-product/2.0.0',
        brand: { status: 'KNOWN', name: 'Marca real', evidenceRef: 'ev_spec' },
      }),
      'v2_product',
    );
    ts.registerCampaign(
      campaign({ revision: 2, productRevision: 2, cta: 'Novo CTA' }),
      'v2_campaign',
      true,
    );
    ts.close();
    ts = new SqliteAffiliateRepository(fixture.database);
    expect(ts.getBriefing('brief_001')).toEqual(historical);
    expect(ts.createBriefing(input, 'legacy_brief', true)).toEqual(historical);
    expect(ts.getCampaign('camp_001', 1)).toEqual(campaign());
    expect(
      ts.db
        .prepare(
          'SELECT content_json FROM affiliate_briefings WHERE briefing_id=?',
        )
        .get('brief_001')?.content_json,
    ).toBe(saved);
  });
  it('preserves consecutive revisions, global receipt scope and errors', () => {
    ts.registerProduct(product(), 'product_one');
    for (const [value, key] of [
      [product({ revision: 3 }), 'skip'],
      [product({ name: 'Changed' }), 'changed'],
      [product({ name: 'Changed' }), 'product_one'],
    ] as const) {
      const error = (run: () => unknown) => {
        try {
          run();
        } catch (e) {
          const x = e as { code: string; field: string };
          return { code: x.code, field: x.field };
        }
      };
      expect(error(() => ts.registerProduct(value, key))).toEqual(
        error(() => fixture.catalog.registerProduct(value, key)),
      );
    }
    expect(() => ts.registerCampaign(campaign(), 'product_one', true)).toThrow(
      'AFFILIATE_IDEMPOTENCY_CONFLICT',
    );
    expect(() =>
      ts.registerCampaign(campaign(), 'missing_project', false),
    ).toThrow('PROJECT_NOT_FOUND');
    expect(() =>
      ts.registerCampaign(
        campaign({ productRevision: 2 }),
        'missing_product',
        true,
      ),
    ).toThrow('AFFILIATE_PRODUCT_NOT_FOUND');
    expect(() =>
      ts.createBriefing(
        { briefingId: 'brief_001', campaignId: 'missing', campaignRevision: 1 },
        'missing_campaign',
        true,
      ),
    ).toThrow('AFFILIATE_CAMPAIGN_NOT_FOUND');
  });
  it('rolls back the entity when receipt insertion fails and preserves SQL immutability', () => {
    ts.db.exec(
      "CREATE TRIGGER force_receipt_failure BEFORE INSERT ON affiliate_commands WHEN NEW.idempotency_key='rollback' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
    );
    expect(() => ts.registerProduct(product(), 'rollback')).toThrow(
      'fixture failure',
    );
    expect(ts.getProduct('prod_001', 1)).toBeNull();
    expect(
      ts.db.prepare('SELECT count(*) n FROM affiliate_commands').get()?.n,
    ).toBe(0);
    ts.registerProduct(product(), 'ok_product');
    ts.registerCampaign(campaign(), 'ok_campaign', true);
    ts.createBriefing(
      { briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 },
      'ok_brief',
      true,
    );
    for (const table of [
      'affiliate_product_revisions',
      'affiliate_campaign_revisions',
      'affiliate_briefings',
      'affiliate_commands',
    ]) {
      expect(() => ts.db.exec(`DELETE FROM ${table}`)).toThrow('IMMUTABLE_');
      expect(() =>
        ts.db.exec(
          `UPDATE ${table} SET ${table === 'affiliate_commands' ? 'payload_hash=payload_hash' : 'content_hash=content_hash'}`,
        ),
      ).toThrow('IMMUTABLE_');
    }
  });
  it('detects corrupted entity and receipt hashes', () => {
    ts.registerProduct(product(), 'product_one');
    ts.db.exec('DROP TRIGGER affiliate_product_revisions_no_update;');
    ts.db
      .prepare('UPDATE affiliate_product_revisions SET content_json=?')
      .run(JSON.stringify(product({ name: 'Tampered' })));
    expect(() => ts.getProduct('prod_001', 1)).toThrow(
      'AFFILIATE_HASH_MISMATCH',
    );
    ts.db.exec('DROP TRIGGER affiliate_commands_no_update;');
    ts.db
      .prepare('UPDATE affiliate_commands SET result_hash=?')
      .run('f'.repeat(64));
    expect(() => ts.registerProduct(product(), 'product_one')).toThrow(
      'AFFILIATE_HASH_MISMATCH',
    );
  });
  it('rejects absent/old databases without creating or migrating them', () => {
    const absent = join(fixture.database, '..', 'absent.sqlite');
    expect(() => new SqliteAffiliateRepository(absent)).toThrow();
    expect(existsSync(absent)).toBe(false);
    const oldPath = join(fixture.database, '..', 'old.sqlite');
    const old = new DatabaseSync(oldPath);
    old.exec('PRAGMA user_version=38;');
    old.close();
    const bytes = readFileSync(oldPath);
    expect(() => new SqliteAffiliateRepository(oldPath)).toThrow(
      'AFFILIATE_SCHEMA_VERSION_UNSUPPORTED',
    );
    expect(readFileSync(oldPath)).toEqual(bytes);
  });
  it('serializes concurrent exact retries on independent connections', async () => {
    const results = await raceProducts(fixture.database, [
      { product: product(), key: 'same_key' },
      { product: product(), key: 'same_key' },
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(
      ts.db.prepare('SELECT count(*) n FROM affiliate_product_revisions').get()
        ?.n,
    ).toBe(1);
    expect(
      ts.db.prepare('SELECT count(*) n FROM affiliate_commands').get()?.n,
    ).toBe(1);
  });
  it('rejects a competing revision without recording the losing receipt', async () => {
    const results = await raceProducts(fixture.database, [
      { product: product(), key: 'first_key' },
      { product: product({ name: 'Competing' }), key: 'other_key' },
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.code).toBe(
      'AFFILIATE_REVISION_CONFLICT',
    );
    expect(
      ts.db.prepare('SELECT count(*) n FROM affiliate_commands').get()?.n,
    ).toBe(1);
  });
});
