import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import {
  getTestPostgresConfig,
  assertDisposableDatabase,
} from './test-database.js';

let database: PostgresDatabase;
const initial = {
  version: 1,
  name: 'infra_fixture',
  sql: 'CREATE SCHEMA infra_fixture; CREATE TABLE infra_fixture.items (id integer PRIMARY KEY, amount numeric(40,18));',
};
beforeAll(async () => {
  database = new PostgresDatabase(getTestPostgresConfig());
  await assertDisposableDatabase(database);
});
beforeEach(async () => {
  await database.query('DROP SCHEMA IF EXISTS infra_fixture CASCADE');
  await database.query('DROP SCHEMA IF EXISTS platform CASCADE');
});
afterAll(async () => {
  await database?.close();
});

describe('real disposable PostgreSQL infrastructure', () => {
  it('healthchecks and preserves NUMERIC precision as text', async () => {
    expect(await database.healthcheck()).toBe(true);
    const amount = '12345678901234567890.123456789012345678';
    expect(
      (
        await database.query<{ amount: string }>(
          'SELECT $1::numeric(40,18) AS amount',
          [amount],
        )
      ).rows[0]?.amount,
    ).toBe(amount);
  });
  it('commits a transaction on one backend client and rolls back a failing callback', async () => {
    await new PostgresMigrationRunner(database).migrate([initial]);
    await database.transaction(async (client) => {
      await client.query('INSERT INTO infra_fixture.items VALUES ($1,$2)', [
        1,
        '1.25',
      ]);
      expect(
        (
          await client.query(
            'SELECT count(*)::integer AS count FROM infra_fixture.items',
          )
        ).rows[0]?.count,
      ).toBe(1);
    });
    const original = new Error('APPLICATION_REJECTED');
    await expect(
      database.transaction(async (client) => {
        await client.query('INSERT INTO infra_fixture.items VALUES ($1,$2)', [
          2,
          '2.25',
        ]);
        throw original;
      }),
    ).rejects.toBe(original);
    expect(
      (await database.query('SELECT id FROM infra_fixture.items ORDER BY id'))
        .rows,
    ).toEqual([{ id: 1 }]);
  });
  it('applies ordered migrations exactly once under concurrent runners and records exact checksums', async () => {
    const results = await Promise.all([
      new PostgresMigrationRunner(database).migrate([initial]),
      new PostgresMigrationRunner(database).migrate([initial]),
    ]);
    expect(results.flatMap((result) => result.applied)).toEqual([1]);
    expect(
      (
        await database.query(
          'SELECT version,name,checksum FROM platform.schema_migrations',
        )
      ).rows,
    ).toEqual([
      {
        version: 1,
        name: initial.name,
        checksum: postgresMigrationChecksum(initial.sql),
      },
    ]);
    expect(
      await new PostgresMigrationRunner(database).migrate([initial]),
    ).toEqual({ applied: [], currentVersion: 1 });
  });
  it('fails closed on checksum drift without applying later migrations', async () => {
    const runner = new PostgresMigrationRunner(database);
    await runner.migrate([initial]);
    await expect(
      runner.migrate([
        { ...initial, sql: initial.sql + '\n' },
        {
          version: 2,
          name: 'later',
          sql: 'CREATE TABLE infra_fixture.later (id integer);',
        },
      ]),
    ).rejects.toThrow('POSTGRES_MIGRATION_CHECKSUM_MISMATCH');
    expect(
      (
        await database.query(
          "SELECT pg_catalog.to_regclass('infra_fixture.later') AS relation",
        )
      ).rows[0]?.relation,
    ).toBeNull();
  });
  it('rolls back DDL and migration ledger on SQL failure without leaking SQL', async () => {
    const runner = new PostgresMigrationRunner(database);
    await runner.migrate([initial]);
    await expect(
      runner.migrate([
        initial,
        {
          version: 2,
          name: 'invalid',
          sql: 'CREATE TABLE infra_fixture.partial (id integer); SELECT * FROM infra_fixture.private_secret_missing;',
        },
      ]),
    ).rejects.toMatchObject({
      code: 'POSTGRES_TRANSACTION_FAILED',
      sqlState: '42P01',
    });
    expect(
      (
        await database.query(
          'SELECT version FROM platform.schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual([{ version: 1 }]);
    expect(
      (
        await database.query(
          "SELECT pg_catalog.to_regclass('infra_fixture.partial') AS relation",
        )
      ).rows[0]?.relation,
    ).toBeNull();
  });
  it('rejects noncontiguous/duplicate migrations before any DDL', async () => {
    await expect(
      new PostgresMigrationRunner(database).migrate([
        { ...initial, version: 2 },
      ]),
    ).rejects.toThrow('POSTGRES_MIGRATIONS_INVALID');
    await expect(
      new PostgresMigrationRunner(database).migrate([initial, initial]),
    ).rejects.toThrow('POSTGRES_MIGRATIONS_INVALID');
    expect(
      (
        await database.query(
          "SELECT pg_catalog.to_regnamespace('platform') AS schema",
        )
      ).rows[0]?.schema,
    ).toBeNull();
  });
});
