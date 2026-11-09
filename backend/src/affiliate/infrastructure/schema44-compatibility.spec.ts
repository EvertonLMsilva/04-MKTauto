import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSchema } from '../../administration/schema-provisioner.js';
import { SqliteAffiliateRepository } from './sqlite-affiliate.repository.js';
import { product } from '../../../test/support/affiliate-fixture.js';
function fixture(version: number) {
  const dir = mkdtempSync(join(tmpdir(), 'mktauto-affiliate-schema44-')),
    path = join(dir, 'isolated.sqlite'),
    db = new DatabaseSync(path);
  provisionSchema(db, version);
  return {
    path,
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true });
    },
  };
}
test.each([39, 40, 41, 42, 43, 44])(
  'Affiliate accepts validated schema %s and preserves product replay/read',
  (version) => {
    const f = fixture(version);
    try {
      const r = new SqliteAffiliateRepository(f.path);
      let saved;
      try {
        saved = r.registerProduct(product(), 'schema_compat_product');
        expect(r.registerProduct(product(), 'schema_compat_product')).toEqual(
          saved,
        );
        expect(
          r.getProduct(String(saved.productId), Number(saved.revision)),
        ).toEqual(saved);
      } finally {
        r.close();
      }
      const ro = new SqliteAffiliateRepository(f.path, { readOnly: true });
      try {
        expect(
          ro.getProduct(String(saved.productId), Number(saved.revision)),
        ).toEqual(saved);
      } finally {
        ro.close();
      }
    } finally {
      f.cleanup();
    }
  },
);
test.each([38, 45])('rejects unsupported schema %s', (version) => {
  const f = fixture(43);
  try {
    f.db.exec('PRAGMA user_version=' + version);
    expect(() => new SqliteAffiliateRepository(f.path)).toThrow(
      'AFFILIATE_SCHEMA_VERSION_UNSUPPORTED',
    );
  } finally {
    f.cleanup();
  }
});
test('43 to 44 leaves Affiliate objects and data unchanged; new persistence remains idempotent', () => {
  const f = fixture(43);
  try {
    const r = new SqliteAffiliateRepository(f.path);
    let saved;
    try {
      saved = r.registerProduct(product(), 'before_upgrade');
    } finally {
      r.close();
    }
    const objects = () =>
      f.db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name LIKE 'affiliate_%' ORDER BY type,name",
        )
        .all();
    const before = objects();
    const tables = f.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'affiliate_%'",
      )
      .all();
    const rows = () =>
      Object.fromEntries(
        tables.map((t) => [
          String(t.name),
          f.db.prepare('SELECT * FROM ' + t.name + ' ORDER BY rowid').all(),
        ]),
      );
    const data = rows();
    provisionSchema(f.db, 44);
    expect(objects()).toEqual(before);
    expect(rows()).toEqual(data);
    const after = new SqliteAffiliateRepository(f.path);
    try {
      expect(after.registerProduct(product(), 'before_upgrade')).toEqual(saved);
      const next = after.registerProduct(
        product({ productId: 'prod_schema44' }),
        'after_upgrade',
      );
      expect(
        after.getProduct(String(next.productId), Number(next.revision)),
      ).toEqual(next);
    } finally {
      after.close();
    }
    expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(f.db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe(
      'ok',
    );
  } finally {
    f.cleanup();
  }
});
