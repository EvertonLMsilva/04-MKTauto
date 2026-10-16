import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../administration/schema-provisioner.js';
describe('P4 schema 41', () => {
  it.each([0, 40])('migrates %s preserving history and replays', (v) => {
    const db = new DatabaseSync(':memory:');
    try {
      if (v) {
        provisionSchema(db, v);
        db.exec(
          "INSERT INTO trend_runs VALUES('historical','1','COMPLETED','old','old','1','{}')",
        );
      }
      const before = v
        ? db.prepare('SELECT * FROM schema_migrations').all()
        : [];
      const historical = v ? db.prepare('SELECT * FROM trend_runs').all() : [];
      provisionSchema(db, 41);
      if (v)
        expect(db.prepare('SELECT * FROM trend_runs').all()).toEqual(
          historical,
        );
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(41);
      expect(
        db.prepare('SELECT * FROM schema_migrations').all().slice(0, v),
      ).toEqual(before);
      db.prepare('SELECT * FROM campaign_executions').all();
      db.prepare('SELECT * FROM campaign_execution_events').all();
      provisionSchema(db, 41);
      expect(
        db.prepare('SELECT COUNT(*) n FROM schema_migrations').get()?.n,
      ).toBe(41);
    } finally {
      db.close();
    }
  });
  it('rolls back both the DDL and history when migration 41 is interrupted', () => {
    const db = new DatabaseSync(':memory:');
    try {
      provisionSchema(db, 40);
      const history = db.prepare('SELECT * FROM schema_migrations').all();
      db.exec('CREATE TABLE campaign_execution_events(incompatible TEXT)');
      expect(() => provisionSchema(db, 41)).toThrow();
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(40);
      expect(db.prepare('SELECT * FROM schema_migrations').all()).toEqual(
        history,
      );
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='campaign_executions'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
