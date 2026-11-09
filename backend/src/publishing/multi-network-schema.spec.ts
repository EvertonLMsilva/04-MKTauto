import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { FinanceSession } from '../finance/infrastructure/finance.session.js';
import { CostAdjustmentsRepository } from '../finance/infrastructure/cost-adjustments.repository.js';
import { validateConfiguration } from '../bootstrap.js';

test.each([0, 42])(
  'schema %s upgrades transactionally to 43; Finance and history survive replay',
  (version) => {
    const root = mkdtempSync(join(tmpdir(), 'multi-schema-'));
    const file = join(root, 'fixture.sqlite'),
      db = new DatabaseSync(file);
    try {
      if (version) provisionSchema(db, version);
      const history = version
        ? db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
        : [];
      provisionSchema(db, 43);
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(43);
      expect(
        validateConfiguration({ PROJECT_API_DATABASE: file, PORT: '0' }),
      ).toEqual({ port: 0 });
      expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
      expect(
        db
          .prepare('SELECT * FROM schema_migrations ORDER BY version')
          .all()
          .slice(0, version),
      ).toEqual(history);
      const schema = db
        .prepare('SELECT name,sql FROM sqlite_master ORDER BY name')
        .all();
      provisionSchema(db, 43);
      expect(
        db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),
      ).toEqual(schema);
      const finance = new FinanceSession(file);
      try {
        expect(new CostAdjustmentsRepository(finance as any).enabled()).toBe(
          true,
        );
      } finally {
        finance.close();
      }
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
      rmSync(root, { recursive: true });
    }
  },
);

test('failed 043 rolls back the complete upgrade and leaves schema 42 usable', () => {
  const db = new DatabaseSync(':memory:');
  try {
    provisionSchema(db, 42);
    db.exec(
      'CREATE TABLE multi_network_publication_reservations(conflict TEXT)',
    );
    expect(() => provisionSchema(db, 43)).toThrow();
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(42);
    expect(
      db.prepare('SELECT 1 FROM schema_migrations WHERE version=43').get(),
    ).toBeUndefined();
  } finally {
    db.close();
  }
});

test('Finance explicitly rejects future schema versions', () => {
  const root = mkdtempSync(join(tmpdir(), 'multi-future-')),
    file = join(root, 'fixture.sqlite');
  const db = new DatabaseSync(file);
  try {
    provisionSchema(db, 42);
    db.exec('PRAGMA user_version=45');
    expect(() => new FinanceSession(file)).toThrow(
      'FINANCE_SCHEMA_VERSION_UNSUPPORTED',
    );
    expect(new CostAdjustmentsRepository({ db } as any).enabled()).toBe(false);
  } finally {
    db.close();
    rmSync(root, { recursive: true });
  }
});
