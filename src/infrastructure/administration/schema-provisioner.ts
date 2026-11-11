import { provisionSocialContext } from '../../modules/publishing/infrastructure/social-publication.repository.js';
import { readFileSync, readdirSync } from 'node:fs';
import {
  provisionProductContain,
  provisionCompositionReframing,
} from './composition-reframing.js';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

// Same relative location from src/infrastructure/administration and dist/infrastructure/administration.
const directory = fileURLToPath(
  new URL('../database/migrations/', import.meta.url),
);
const migrations = Array.from({ length: 44 }, (_, i) => {
  const version = i + 1;
  const files = readdirSync(directory).filter(
    (name) =>
      name.startsWith(`${String(version).padStart(3, '0')}_`) &&
      name.endsWith('.sql') &&
      ![
        '031_fal_generations.sql',
        '032_fal_financial_settlements.sql',
      ].includes(name),
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

const falNames = ['031_fal_generations', '032_fal_financial_settlements'];
function validateHistory(db: DatabaseSync, version: number): 'fal' | 'nestjs' {
  if (version === 0) {
    if (
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
        .get()
    )
      throw new Error('SCHEMA_HISTORY_INCOMPATIBLE');
    return 'nestjs';
  }
  const rows = db
    .prepare('SELECT version,name FROM schema_migrations ORDER BY version')
    .all();
  const lineage = rows[30]?.name === falNames[0] ? 'fal' : 'nestjs';
  if (
    rows.length !== version ||
    rows.some(
      (row, i) =>
        row.version !== i + 1 ||
        row.name !==
          (lineage === 'fal' && (i === 30 || i === 31)
            ? falNames[i - 30]
            : migrations[i]?.name),
    )
  )
    throw new Error('SCHEMA_HISTORY_INCOMPATIBLE');
  return lineage;
}

// A separate, versioned ledger records complementary historical DDL. Applied
// schema_migrations rows and the original 031/032 files are never rewritten.
function reconcileLineages(db: DatabaseSync, lineage: 'fal' | 'nestjs') {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_lineage_extensions_v1 (
    lineage TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL,
    sql_sha256 TEXT NOT NULL, applied_at TEXT NOT NULL,
    PRIMARY KEY(lineage,version))`);
  const other = lineage === 'fal' ? 'nestjs' : 'fal';
  for (const version of [31, 32]) {
    const name =
      other === 'fal' ? falNames[version - 31]! : migrations[version - 1]!.name;
    const sql = extension(name);
    const hash = createHash('sha256')
      .update(sql.replace(/\r\n/g, '\n'))
      .digest('hex');
    const prior = db
      .prepare(
        'SELECT name,sql_sha256 FROM schema_lineage_extensions_v1 WHERE lineage=? AND version=?',
      )
      .get(other, version);
    if (prior) {
      if (prior.name !== name || prior.sql_sha256 !== hash)
        throw new Error('SCHEMA_EXTENSION_INCOMPATIBLE');
    } else {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_lineage_extensions_v1 VALUES(?,?,?,?,?)',
      ).run(other, version, name, hash, new Date().toISOString());
    }
  }
  for (const table of [
    'fal_generations',
    'fal_generation_requests',
    'fal_financial_settlements',
    'video_generation_operations',
    'video_generation_billing',
  ]) {
    if (
      !db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    )
      throw new Error('SCHEMA_EXTENSION_INCOMPATIBLE');
  }
  const expected = new DatabaseSync(':memory:');
  const normalize = (sql: string) =>
    sql
      .replace(/IF NOT EXISTS /g, '')
      .replace(/\s+/g, ' ')
      .trim();
  try {
    for (const name of [
      ...falNames,
      migrations[30]!.name,
      migrations[31]!.name,
    ])
      expected.exec(extension(name));
    for (const row of expected
      .prepare('SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL')
      .all()) {
      const actual = db
        .prepare('SELECT sql FROM sqlite_master WHERE name=?')
        .get(row.name!);
      if (
        typeof actual?.sql !== 'string' ||
        normalize(actual.sql) !== normalize(String(row.sql))
      )
        throw new Error('SCHEMA_EXTENSION_INCOMPATIBLE');
    }
  } finally {
    expected.close();
  }
}

function financialExtensions(db: DatabaseSync) {
  for (const [marker, name] of [
    ['tts_finance_metadata', 'tts_finance_v1'],
    ['global_finance_policy', 'global_finance_v1'],
    ['tts_risk_dispatches_v2', 'tts_risk_policy_v2'],
  ]) {
    if (!db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(marker!))
      db.exec(extension(name!));
  }
  if (
    db.prepare('SELECT version FROM tts_finance_metadata').get()?.version !== 1
  )
    throw new Error('SCHEMA_EXTENSION_INCOMPATIBLE');
}

function campaignSourceExtension(db: DatabaseSync) {
  const name = 'affiliate_campaign_source_v1';
  const sql = extension(name);
  const hash = createHash('sha256')
    .update(sql.replace(/\r\n/g, '\n'))
    .digest('hex');
  const prior = db
    .prepare(
      'SELECT name,sql_sha256 FROM schema_lineage_extensions_v1 WHERE lineage=? AND version=1',
    )
    .get('affiliate-campaign-source');
  if (!prior) {
    db.exec(sql);
    db.prepare(
      'INSERT INTO schema_lineage_extensions_v1 VALUES(?,?,?,?,?)',
    ).run('affiliate-campaign-source', 1, name, hash, new Date().toISOString());
  } else if (prior.name !== name || prior.sql_sha256 !== hash) {
    throw new Error('SCHEMA_EXTENSION_INCOMPATIBLE');
  }
  const expected = new DatabaseSync(':memory:');
  try {
    expected.exec(sql);
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
    for (const row of expected
      .prepare('SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL')
      .all()) {
      const actual = db
        .prepare('SELECT sql FROM sqlite_master WHERE name=?')
        .get(row.name!);
      if (
        typeof actual?.sql !== 'string' ||
        normalize(actual.sql) !== normalize(String(row.sql))
      )
        throw new Error('SCHEMA_EXTENSION_INCOMPATIBLE');
    }
  } finally {
    expected.close();
  }
}

export function provisionSchema(db: DatabaseSync, target = 43): void {
  if (db.isTransaction) throw new Error('SCHEMA_TRANSACTION_ACTIVE');
  if (!Number.isInteger(target) || target < 1 || target > 44)
    throw new Error('SCHEMA_VERSION_UNSUPPORTED');
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  // Schema 44 rebuilds the ledger. SQLite requires FK toggling outside the
  // transaction; foreign_key_check remains mandatory before commit.
  const legacyAlter = Number(
    db.prepare('PRAGMA legacy_alter_table').get()?.legacy_alter_table,
  );
  if (target === 44)
    db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON');
  try {
    db.exec('BEGIN IMMEDIATE');
    const version = Number(
      db.prepare('PRAGMA user_version').get()?.user_version,
    );
    if (version < 0 || version > target)
      throw new Error('SCHEMA_VERSION_UNSUPPORTED');
    const lineage = validateHistory(db, version);
    if (version >= 32) reconcileLineages(db, lineage);
    for (const migration of migrations.slice(version, target)) {
      if (migration.version === 33) {
        db.exec(
          compatible(migrations[30]!.sql) + compatible(migrations[31]!.sql),
        );
      }
      if (migration.version === 40) financialExtensions(db);
      const name =
        lineage === 'fal' && [31, 32].includes(migration.version)
          ? falNames[migration.version - 31]!
          : migration.name;
      const ledgerObjects =
        migration.version === 44
          ? db
              .prepare(
                "SELECT sql FROM sqlite_master WHERE tbl_name='social_publication_operations' AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name",
              )
              .all()
          : [];
      db.exec(name === migration.name ? migration.sql : extension(name));
      for (const object of ledgerObjects) db.exec(String(object.sql));
      db.prepare(
        'INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)',
      ).run(migration.version, name, new Date().toISOString());
      db.exec(`PRAGMA user_version=${migration.version}`);
      if (migration.version === 32) reconcileLineages(db, lineage);
    }
    if (target >= 40) {
      financialExtensions(db);
      // Prepare these queries even on reexecution to reject incomplete schema 40.
      db.prepare('SELECT adjustment_id FROM cost_adjustments LIMIT 0').all();
      db.prepare('SELECT operation_id FROM tts_operations LIMIT 0').all();
      db.prepare(
        'SELECT operation_id FROM global_paid_operations LIMIT 0',
      ).all();
    }
    if (target >= 41) {
      provisionProductContain(db);
      provisionCompositionReframing(db);
      db.prepare(
        'SELECT execution_id,claim_token,version FROM campaign_executions LIMIT 0',
      ).all();
      db.prepare(
        'SELECT execution_id,sequence,evidence_json FROM campaign_execution_events LIMIT 0',
      ).all();
    }
    if (target >= 42) {
      db.exec(extension('instagram_editorial_v1'));
      campaignSourceExtension(db);
      provisionSocialContext(db);
      db.prepare(
        'SELECT review_hash FROM instagram_approval_revocations LIMIT 0',
      ).all();
      db.prepare(
        'SELECT operation_id FROM instagram_publication_reservations LIMIT 0',
      ).all();
    }
    if (target >= 43)
      db.prepare(
        'SELECT execution_id,network,account_id,operation_id,package_hash,review_hash FROM multi_network_publication_reservations LIMIT 0',
      ).all();
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('SCHEMA_REFERENTIAL_INTEGRITY');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    if (target === 44)
      db.exec(
        `PRAGMA legacy_alter_table=${legacyAlter}; PRAGMA foreign_keys=ON`,
      );
  }
}
