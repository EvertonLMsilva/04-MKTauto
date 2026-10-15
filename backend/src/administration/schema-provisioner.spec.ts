import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSchema } from './schema-provisioner.js';

describe('administrative schema provisioning', () => {
  let directory: string;
  let db: DatabaseSync;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mktauto-cutover-'));
    db = new DatabaseSync(join(directory, 'test.sqlite'));
  });
  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true });
  });
  const version = () => db.prepare('PRAGMA user_version').get()?.user_version;
  const snapshot = () =>
    db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();

  it('provisions an empty database to 40 and is idempotent', () => {
    provisionSchema(db);
    expect(version()).toBe(40);
    expect(snapshot()).toHaveLength(40);
    expect(
      db.prepare('SELECT version FROM tts_finance_metadata').get()?.version,
    ).toBe(1);
    const before = db
      .prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name')
      .all();
    const history = snapshot();
    provisionSchema(db);
    expect(snapshot()).toEqual(history);
    expect(
      db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all(),
    ).toEqual(before);
  });

  it.each([1, 30, 31, 32, 38, 39])(
    'upgrades historical schema %s and preserves historical rows',
    (historicalVersion) => {
      provisionSchema(db, historicalVersion);
      db.exec(
        "INSERT INTO trend_runs VALUES('historical','1','COMPLETED','old','old','1','{}')",
      );
      const before = db.prepare('SELECT * FROM trend_runs').all();
      const history = snapshot();
      provisionSchema(db);
      expect(version()).toBe(40);
      expect(db.prepare('SELECT * FROM trend_runs').all()).toEqual(before);
      expect(snapshot().slice(0, historicalVersion)).toEqual(history);
    },
  );

  it('preserves an existing schema 40 database including financial history', () => {
    provisionSchema(db);
    db.exec(
      "INSERT INTO global_paid_operations(operation_id,request_hash,provider,maximum_usd,proof_json,created_at,state) VALUES('old','hash','provider','1','{}','old','RESERVED')",
    );
    const before = db.prepare('SELECT * FROM global_paid_operations').all();
    provisionSchema(db);
    expect(db.prepare('SELECT * FROM global_paid_operations').all()).toEqual(
      before,
    );
  });

  it.each([41, -1])('rejects incompatible version %s without changes', (v) => {
    db.exec(`PRAGMA user_version=${v}`);
    expect(() => provisionSchema(db)).toThrow('SCHEMA_VERSION_UNSUPPORTED');
    expect(version()).toBe(v);
  });

  it('rejects inconsistent history and rolls back an interrupted upgrade', () => {
    provisionSchema(db, 38);
    const before = snapshot();
    db.exec('CREATE TABLE cost_adjustments(id TEXT)');
    expect(() => provisionSchema(db)).toThrow();
    expect(version()).toBe(38);
    expect(snapshot()).toEqual(before);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='affiliate_discovery_decisions'",
        )
        .get(),
    ).toBeUndefined();
    db.exec("UPDATE schema_migrations SET name='wrong' WHERE version=38");
    expect(() => provisionSchema(db)).toThrow('SCHEMA_HISTORY_INCOMPATIBLE');
  });

  it('rejects a nonempty unversioned database and active transactions', () => {
    db.exec('CREATE TABLE private_data(id TEXT)');
    expect(() => provisionSchema(db)).toThrow('SCHEMA_HISTORY_INCOMPATIBLE');
    db.exec('BEGIN');
    expect(() => provisionSchema(db)).toThrow('SCHEMA_TRANSACTION_ACTIVE');
    db.exec('ROLLBACK');
  });

  it('rejects incomplete schema 40 without rewriting history', () => {
    provisionSchema(db);
    const before = snapshot();
    db.exec('DROP TABLE cost_adjustments');
    expect(() => provisionSchema(db)).toThrow();
    expect(version()).toBe(40);
    expect(snapshot()).toEqual(before);
  });
});
