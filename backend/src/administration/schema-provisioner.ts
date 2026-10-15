import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Same relative location from src/administration and dist/administration.
const directory = fileURLToPath(
  new URL('../../../src/db/migrations/', import.meta.url),
);
const migrations = Array.from({ length: 40 }, (_, i) => {
  const version = i + 1;
  const files = readdirSync(directory).filter(
    (name) =>
      name.startsWith(`${String(version).padStart(3, '0')}_`) &&
      name.endsWith('.sql'),
  );
  if (files.length !== 1)
    throw new Error(`SCHEMA_MIGRATION_MISSING: ${version}`);
  const file = files[0]!;
  return {
    version,
    name: file.slice(0, -4),
    sql: readFileSync(`${directory}/${file}`, 'utf8'),
  };
});
const extension = (name: string) =>
  readFileSync(`${directory}/${name}.sql`, 'utf8');
const compatible = (sql: string) =>
  sql
    .replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/CREATE UNIQUE INDEX /g, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace(/CREATE TRIGGER /g, 'CREATE TRIGGER IF NOT EXISTS ');

function validateHistory(db: DatabaseSync, version: number) {
  if (version === 0) {
    if (
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
        .get()
    )
      throw new Error('SCHEMA_HISTORY_INCOMPATIBLE');
    return;
  }
  const rows = db
    .prepare('SELECT version,name FROM schema_migrations ORDER BY version')
    .all();
  if (
    rows.length !== version ||
    rows.some(
      (row, i) => row.version !== i + 1 || row.name !== migrations[i]!.name,
    )
  )
    throw new Error('SCHEMA_HISTORY_INCOMPATIBLE');
}

function financialExtensions(db: DatabaseSync) {
  for (const [marker, name] of [
    ['tts_finance_metadata', 'tts_finance_v1'],
    ['global_finance_policy', 'global_finance_v1'],
  ]) {
    if (!db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(marker!))
      db.exec(extension(name!));
  }
  if (
    db.prepare('SELECT version FROM tts_finance_metadata').get()?.version !== 1
  )
    throw new Error('SCHEMA_EXTENSION_INCOMPATIBLE');
}

export function provisionSchema(db: DatabaseSync, target = 40): void {
  if (db.isTransaction) throw new Error('SCHEMA_TRANSACTION_ACTIVE');
  if (!Number.isInteger(target) || target < 1 || target > 40)
    throw new Error('SCHEMA_VERSION_UNSUPPORTED');
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  try {
    db.exec('BEGIN IMMEDIATE');
    const version = Number(
      db.prepare('PRAGMA user_version').get()?.user_version,
    );
    if (version < 0 || version > target)
      throw new Error('SCHEMA_VERSION_UNSUPPORTED');
    validateHistory(db, version);
    for (const migration of migrations.slice(version, target)) {
      if (migration.version === 33) {
        db.exec(
          compatible(migrations[30]!.sql) + compatible(migrations[31]!.sql),
        );
      }
      if (migration.version === 40) financialExtensions(db);
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)',
      ).run(migration.version, migration.name, new Date().toISOString());
      db.exec(`PRAGMA user_version=${migration.version}`);
    }
    if (target === 40) {
      financialExtensions(db);
      // Prepare these queries even on reexecution to reject incomplete schema 40.
      db.prepare('SELECT adjustment_id FROM cost_adjustments LIMIT 0').all();
      db.prepare('SELECT operation_id FROM tts_operations LIMIT 0').all();
      db.prepare(
        'SELECT operation_id FROM global_paid_operations LIMIT 0',
      ).all();
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('SCHEMA_REFERENTIAL_INTEGRITY');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
