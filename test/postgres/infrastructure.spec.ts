import { Test } from '@nestjs/testing';
import { Client, DatabaseError, type Pool, type PoolClient } from 'pg';
import {
  loadPostgresConfig,
  POSTGRES_POOL_FACTORY,
  PostgresDatabase,
  PostgresModule,
} from '../../src/infrastructure/database/postgres/index.js';

const env = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5432',
  POSTGRES_DATABASE: 'mktauto',
  POSTGRES_USER: 'fixture',
  POSTGRES_PASSWORD: 'unit-only-secret',
};
function fixture() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [{ healthy: 1 }], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue(client),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
  const factory = vi.fn(() => pool as unknown as Pool);
  return {
    client,
    pool,
    factory,
    database: new PostgresDatabase(loadPostgresConfig(env), factory),
  };
}

describe('explicit PostgreSQL configuration', () => {
  it('requires all POSTGRES values and never substitutes PG environment values', () => {
    expect(() =>
      loadPostgresConfig({
        PGHOST: 'other',
        PGPORT: '5432',
        PGDATABASE: 'mktauto',
        PGUSER: 'user',
        PGPASSWORD: 'secret',
      }),
    ).toThrow('POSTGRES_CONFIGURATION_REQUIRED');
    const config = loadPostgresConfig({
      ...env,
      PGHOST: 'wrong',
      PGDATABASE: 'wrong',
      PGPASSWORD: 'wrong',
    });
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 5432,
      database: 'mktauto',
      user: 'fixture',
      password: env.POSTGRES_PASSWORD,
      ssl: false,
    });
    expect(config).not.toHaveProperty('connectionString');
  });
  it.each([
    { POSTGRES_DATABASE: 'other' },
    { POSTGRES_PORT: '5432oops' },
    { POSTGRES_PORT: '0' },
    { POSTGRES_PORT: '65536' },
    { POSTGRES_HOST: ' host ' },
    { POSTGRES_USER: '' },
    { POSTGRES_PASSWORD: '' },
    { POSTGRES_SSL: 'no-verify' },
  ])(
    'rejects malformed/private config without echoing values: %j',
    (replacement) => {
      expect(() => loadPostgresConfig({ ...env, ...replacement })).toThrow(
        /^POSTGRES_CONFIGURATION_/,
      );
    },
  );
  it('also blocks pg driver fallback to ambient connection, TLS and startup settings', async () => {
    for (const [key, value] of Object.entries({
      PGHOST: 'wrong',
      PGPORT: '1',
      PGDATABASE: 'wrong',
      PGUSER: 'wrong',
      PGPASSWORD: 'wrong',
      PGSSLMODE: 'no-verify',
      PGSSLNEGOTIATION: 'direct',
      PGOPTIONS: '-c search_path=public',
      PGAPPNAME: 'wrong',
      PGREPLICATION: 'database',
    }))
      vi.stubEnv(key, value);
    const f = fixture();
    let client: Client | undefined;
    const database = new PostgresDatabase(
      loadPostgresConfig(env),
      (options) => {
        client = new Client(options);
        return f.pool as unknown as Pool;
      },
    );
    try {
      expect(client).toMatchObject({
        host: env.POSTGRES_HOST,
        port: 5432,
        database: 'mktauto',
        user: env.POSTGRES_USER,
        password: env.POSTGRES_PASSWORD,
        ssl: false,
      });
      expect(client).toHaveProperty(
        'connectionParameters.options',
        '-c search_path=pg_catalog',
      );
      expect(client).toHaveProperty(
        'connectionParameters.replication',
        'false',
      );
      expect(client).toHaveProperty(
        'connectionParameters.application_name',
        'mktauto',
      );
      expect(client).toHaveProperty(
        'connectionParameters.sslnegotiation',
        'postgres',
      );
    } finally {
      vi.unstubAllEnvs();
      await database.close();
    }
  });
});

describe('PostgresDatabase lifecycle and transaction contract', () => {
  it('uses one lazy pool and preserves numeric strings', async () => {
    const f = fixture();
    f.pool.query.mockResolvedValueOnce({
      rows: [{ amount: '12345678901234567890.123456789' }],
      rowCount: 1,
    });
    expect(
      (
        await f.database.query('SELECT $1::numeric AS amount', [
          '12345678901234567890.123456789',
        ])
      ).rows[0]?.amount,
    ).toBe('12345678901234567890.123456789');
    expect(await f.database.healthcheck()).toBe(true);
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it('uses the same acquired client for BEGIN, callback and COMMIT and releases once', async () => {
    const f = fixture();
    const result = await f.database.transaction(async (client) => {
      expect(client).toBe(f.client);
      await client.query('SELECT $1::integer', [7]);
      return 7;
    });
    expect(result).toBe(7);
    expect(f.client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'SELECT $1::integer',
      'COMMIT',
    ]);
    expect(f.pool.query).not.toHaveBeenCalled();
    expect(f.client.release).toHaveBeenCalledExactlyOnceWith();
  });
  it('rolls back an application failure without replacing its identity', async () => {
    const f = fixture(),
      original = new Error('APPLICATION_REJECTED');
    await expect(
      f.database.transaction(() => Promise.reject(original)),
    ).rejects.toBe(original);
    expect(f.client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(f.client.release).toHaveBeenCalledExactlyOnceWith();
  });
  it('destroys a client when rollback fails and retains the primary application error', async () => {
    const f = fixture(),
      original = new Error('APPLICATION_REJECTED');
    f.client.query.mockImplementation(async (text) => {
      if (text === 'ROLLBACK') throw new Error('private rollback failure');
      return { rows: [], rowCount: 0 };
    });
    await expect(
      f.database.transaction(() => Promise.reject(original)),
    ).rejects.toBe(original);
    expect(f.client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('does not mask the primary failure when release also fails', async () => {
    const f = fixture(),
      original = new Error('APPLICATION_REJECTED');
    f.client.release.mockImplementation(() => {
      throw new Error('private release error');
    });
    await expect(
      f.database.transaction(() => Promise.reject(original)),
    ).rejects.toBe(original);
  });
  it('sanitizes driver SQL errors while preserving SQLSTATE', async () => {
    const f = fixture(),
      raw = new DatabaseError('secret SQL and password', 0, 'error');
    raw.code = '23505';
    raw.detail = 'private parameter';
    await expect(
      f.database.transaction(async (client: PoolClient) => {
        void client;
        throw raw;
      }),
    ).rejects.toMatchObject({
      code: 'POSTGRES_TRANSACTION_FAILED',
      sqlState: '23505',
    });
    f.pool.query.mockRejectedValueOnce(raw);
    await expect(f.database.query('private SQL', ['private'])).rejects.toThrow(
      'POSTGRES_QUERY_FAILED',
    );
    f.pool.query.mockRejectedValueOnce(raw);
    await f.database.query('private SQL').catch((error) => {
      expect(JSON.stringify(error)).not.toMatch(/secret|password|private/);
      expect(error).not.toHaveProperty('cause');
      expect(error.stack).not.toContain(raw.message);
    });
  });
  it('sanitizes acquisition and BEGIN failures and releases broken acquired clients', async () => {
    const f = fixture();
    f.pool.connect.mockRejectedValueOnce(
      new Error('credential-bearing connection failure'),
    );
    await expect(f.database.transaction(async () => 1)).rejects.toThrow(
      'POSTGRES_CONNECTION_FAILED',
    );
    f.client.query.mockRejectedValueOnce(
      new Error('credential-bearing begin failure'),
    );
    await expect(f.database.transaction(async () => 1)).rejects.toThrow(
      'POSTGRES_TRANSACTION_FAILED',
    );
    expect(f.client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('rolls back and releases on COMMIT failure, returning only a sanitized failure', async () => {
    const f = fixture();
    f.client.query.mockImplementation(async (text) => {
      if (text === 'COMMIT') throw new Error('private commit details');
      return { rows: [], rowCount: 0 };
    });
    await expect(f.database.transaction(async () => 1)).rejects.toThrow(
      'POSTGRES_TRANSACTION_FAILED',
    );
    expect(f.client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
    ]);
    expect(f.client.release).toHaveBeenCalledExactlyOnceWith();
  });
  it('sanitizes release failure after a successful COMMIT', async () => {
    const f = fixture();
    f.client.release.mockImplementation(() => {
      throw new Error('private release details');
    });
    await expect(f.database.transaction(async () => 1)).rejects.toThrow(
      'POSTGRES_RELEASE_FAILED',
    );
    expect(f.client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'COMMIT',
    ]);
  });
  it('closes once for explicit and Nest shutdown and refuses subsequent queries', async () => {
    const f = fixture();
    await Promise.all([
      f.database.close(),
      f.database.close(),
      f.database.onApplicationShutdown(),
    ]);
    expect(f.pool.end).toHaveBeenCalledTimes(1);
    await expect(f.database.query('SELECT 1')).rejects.toThrow(
      'POSTGRES_DATABASE_CLOSED',
    );
  });
  it('closes only once even when the driver rejects shutdown and sanitizes its error', async () => {
    const f = fixture();
    f.pool.end.mockRejectedValueOnce(
      new Error('password and connection details'),
    );
    const first = f.database.close();
    expect(f.database.close()).toBe(first);
    await expect(first).rejects.toThrow('POSTGRES_CLOSE_FAILED');
    await expect(f.database.onApplicationShutdown()).rejects.toThrow(
      'POSTGRES_CLOSE_FAILED',
    );
    expect(f.pool.end).toHaveBeenCalledTimes(1);
  });
  it('registers a singleton opt-in provider without connecting or applying migrations at startup', async () => {
    const f = fixture();
    f.factory.mockClear();
    const module = await Test.createTestingModule({
      imports: [PostgresModule.register(loadPostgresConfig(env))],
    })
      .overrideProvider(POSTGRES_POOL_FACTORY)
      .useValue(f.factory)
      .compile();
    try {
      expect(module.get(PostgresDatabase)).toBe(module.get(PostgresDatabase));
      expect(f.factory).toHaveBeenCalledTimes(1);
      expect(f.pool.query).not.toHaveBeenCalled();
      expect(f.pool.connect).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
    expect(f.pool.end).toHaveBeenCalledTimes(1);
  });
});
