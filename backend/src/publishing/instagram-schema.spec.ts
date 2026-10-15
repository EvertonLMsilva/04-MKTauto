import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../administration/schema-provisioner.js';

describe('P5 schema 42', () => {
  it.each([0, 41])('upgrades %s preserving history and repeats', (version) => {
    const db = new DatabaseSync(':memory:');
    try {
      if (version) provisionSchema(db, version);
      const before = version
        ? db.prepare('SELECT * FROM schema_migrations').all()
        : [];
      provisionSchema(db, 42);
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(42);
      expect(
        db.prepare('SELECT * FROM schema_migrations').all().slice(0, version),
      ).toEqual(before);
      const after = db.prepare('SELECT * FROM schema_migrations').all();
      provisionSchema(db, 42);
      expect(db.prepare('SELECT * FROM schema_migrations').all()).toEqual(
        after,
      );
      for (const table of [
        'instagram_approval_revocations',
        'instagram_publication_reservations',
      ])
        expect(
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?",
            )
            .all(table),
        ).toHaveLength(3);
    } finally {
      db.close();
    }
  });
  it('rolls back DDL and history on conflict', () => {
    const db = new DatabaseSync(':memory:');
    try {
      provisionSchema(db, 41);
      const before = db.prepare('SELECT * FROM schema_migrations').all();
      db.exec(
        'CREATE TABLE instagram_publication_reservations(incompatible TEXT)',
      );
      expect(() => provisionSchema(db, 42)).toThrow();
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(41);
      expect(db.prepare('SELECT * FROM schema_migrations').all()).toEqual(
        before,
      );
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='instagram_approval_revocations'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
