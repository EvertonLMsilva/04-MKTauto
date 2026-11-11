import type {
  PostgresConfig,
  PostgresDatabase,
} from '../../src/infrastructure/database/postgres/index.js';

export function getTestPostgresConfig(): PostgresConfig {
  const marker = process.env.MKTAUTO_POSTGRES_TEST_MARKER;
  if (!marker || !/^MKTAUTO_PG001_DISPOSABLE_[a-f0-9]{32}$/.test(marker))
    throw new Error(
      'Run npm run test:postgres to create a marked disposable database',
    );
  let url: URL;
  try {
    url = new URL(process.env.MKTAUTO_POSTGRES_TEST_URL ?? '');
  } catch {
    throw new Error('Disposable PostgreSQL connection configuration required');
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/mktauto' ||
    url.username !== 'mktauto_test' ||
    !url.password ||
    !url.port ||
    Number(url.port) === 5432 ||
    url.search
  )
    throw new Error('Only the isolated loopback PostgreSQL fixture is allowed');
  return {
    host: url.hostname,
    port: Number(url.port),
    database: 'mktauto',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
    max: 8,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 1000,
  };
}

/** No destructive test SQL may run before this independently verified marker. */
export async function assertDisposableDatabase(
  database: PostgresDatabase,
): Promise<void> {
  const expected = process.env.MKTAUTO_POSTGRES_TEST_MARKER;
  getTestPostgresConfig();
  const result = await database.query<{
    database: string;
    role: string;
    marker: string | null;
  }>(
    `SELECT pg_catalog.current_database() AS database, CURRENT_USER AS role,
     pg_catalog.shobj_description(d.oid,'pg_database') AS marker
     FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()`,
  );
  const actual = result.rows[0];
  if (
    actual?.database !== 'mktauto' ||
    actual.role !== 'mktauto_test' ||
    actual.marker !== expected
  )
    throw new Error('Refusing unmarked or non-disposable PostgreSQL database');
}
