import { createHash } from 'node:crypto';
import { PostgresDatabase } from './postgres.database.js';
import { PostgresError } from './postgres.errors.js';

/** Trusted, versioned SQL constants; qualify relations and omit transaction control. */
export interface PostgresMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}
export interface PostgresMigrationResult {
  readonly applied: number[];
  readonly currentVersion: number;
}
export const postgresMigrationChecksum = (sql: string): string =>
  createHash('sha256').update(sql, 'utf8').digest('hex');

export class PostgresMigrationRunner {
  constructor(private readonly database: PostgresDatabase) {}

  async migrate(
    migrations: readonly PostgresMigration[],
  ): Promise<PostgresMigrationResult> {
    if (
      !Array.isArray(migrations) ||
      migrations.some(
        (migration, index) =>
          !migration ||
          !Number.isSafeInteger(migration.version) ||
          migration.version !== index + 1 ||
          typeof migration.name !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(migration.name) ||
          typeof migration.sql !== 'string' ||
          !migration.sql.trim(),
      )
    )
      throw new PostgresError('POSTGRES_MIGRATIONS_INVALID');
    const definitions = migrations.map((migration) => ({
      ...migration,
      checksum: postgresMigrationChecksum(migration.sql),
    }));
    return this.database.transaction(async (client) => {
      // One transaction-scoped lock serializes both ledger initialization and every migration.
      await client.query(
        'SELECT pg_catalog.pg_advisory_xact_lock($1::integer,$2::integer)',
        [1296782401, 1],
      );
      await client.query("SET LOCAL search_path = ''");
      await client.query('CREATE SCHEMA IF NOT EXISTS platform');
      await client.query(`CREATE TABLE IF NOT EXISTS platform.schema_migrations (
        version integer PRIMARY KEY CHECK (version > 0),
        name text NOT NULL,
        checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
      )`);
      const history = await client.query<{
        version: number;
        name: string;
        checksum: string;
      }>(
        'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
      );
      for (const [index, row] of history.rows.entries()) {
        const expected = definitions[index];
        if (
          !expected ||
          row.version !== expected.version ||
          row.name !== expected.name
        )
          throw new PostgresError('POSTGRES_MIGRATION_HISTORY_MISMATCH');
        if (row.checksum !== expected.checksum)
          throw new PostgresError('POSTGRES_MIGRATION_CHECKSUM_MISMATCH');
      }
      const applied: number[] = [];
      for (const migration of definitions.slice(history.rows.length)) {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO platform.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',
          [migration.version, migration.name, migration.checksum],
        );
        applied.push(migration.version);
      }
      return { applied, currentVersion: definitions.length };
    });
  }
}
