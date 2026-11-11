import type { FinancialDatabase } from '../application/financial-readers.port.js';

// Explicit administrative migration; never invoked by session startup or HTTP.
export function migrateFinance40(
  db: FinancialDatabase,
  sql: string,
  now: string,
): 40 {
  if (db.isTransaction) throw new Error('FINANCE_MIGRATION_TRANSACTION_ACTIVE');
  if (!Number.isFinite(Date.parse(now)))
    throw new Error('FINANCE_MIGRATION_TIME_INVALID');
  try {
    db.exec('BEGIN IMMEDIATE');
    const version = Number(
      db.prepare('PRAGMA user_version').get()?.user_version,
    );
    if (version === 40) {
      if (
        !db
          .prepare("SELECT 1 FROM sqlite_master WHERE name='cost_adjustments'")
          .get() ||
        db.prepare('SELECT name FROM schema_migrations WHERE version=40').get()
          ?.name !== '040_financial_adjustments'
      )
        throw new Error('FINANCE_SCHEMA_REQUIRED');
      db.exec('COMMIT');
      return 40;
    }
    if (version !== 39) throw new Error('FINANCE_SCHEMA_VERSION_UNSUPPORTED');
    db.exec(sql);
    db.prepare(
      'INSERT INTO schema_migrations(version,name,applied_at) VALUES(40,?,?)',
    ).run('040_financial_adjustments', now);
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('FINANCE_MIGRATION_REFERENTIAL_INTEGRITY');
    db.exec('PRAGMA user_version=40');
    db.exec('COMMIT');
    return 40;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
