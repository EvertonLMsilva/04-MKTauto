import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from 'pg';
import {
  POSTGRES_CONFIG,
  validatePostgresConfig,
  type PostgresConfig,
} from './postgres.config.js';
import {
  isPostgresDriverError,
  PostgresError,
  postgresFailure,
} from './postgres.errors.js';

export const POSTGRES_POOL_FACTORY = Symbol('POSTGRES_POOL_FACTORY');
export type PostgresPoolFactory = (config: PoolConfig) => Pool;
export const createPostgresPool: PostgresPoolFactory = (config) =>
  new Pool(config);

@Injectable()
export class PostgresDatabase implements OnApplicationShutdown {
  private readonly pool: Pool;
  private closing?: Promise<void>;
  private readonly logger = new Logger(PostgresDatabase.name);

  constructor(
    @Inject(POSTGRES_CONFIG) config: PostgresConfig,
    @Inject(POSTGRES_POOL_FACTORY)
    factory: PostgresPoolFactory = createPostgresPool,
  ) {
    const validated = validatePostgresConfig(config);
    try {
      // Explicit identity, TLS and startup settings prevent ambient PG* configuration fallback.
      const options: PoolConfig & { replication: string; binary: boolean } = {
        ...validated,
        sslnegotiation: 'postgres',
        application_name: 'mktauto',
        client_encoding: 'UTF8',
        options: '-c search_path=pg_catalog',
        replication: 'false',
        binary: false,
      };
      this.pool = factory(options);
      this.pool.on('error', () =>
        this.logger.error('POSTGRES_IDLE_CLIENT_FAILED'),
      );
    } catch (error) {
      throw postgresFailure('POSTGRES_CONNECTION_FAILED', error);
    }
  }

  private assertOpen(): void {
    if (this.closing) throw new PostgresError('POSTGRES_DATABASE_CLOSED');
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    this.assertOpen();
    try {
      return await this.pool.query<R>(text, values);
    } catch (error) {
      throw postgresFailure('POSTGRES_QUERY_FAILED', error);
    }
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    this.assertOpen();
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw postgresFailure('POSTGRES_CONNECTION_FAILED', error);
    }
    let started = false;
    let stage: 'begin' | 'work' | 'commit' = 'begin';
    let discard = false;
    let value!: T;
    let failure: { error: unknown } | undefined;
    try {
      await client.query('BEGIN');
      started = true;
      stage = 'work';
      value = await work(client);
      stage = 'commit';
      await client.query('COMMIT');
    } catch (error) {
      if (started) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      } else {
        discard = true;
      }
      // Domain failures keep their identity; pg failures expose only stable code and SQLSTATE.
      failure = {
        error:
          stage !== 'work' || isPostgresDriverError(error)
            ? postgresFailure('POSTGRES_TRANSACTION_FAILED', error)
            : error,
      };
    }
    try {
      if (discard) client.release(true);
      else client.release();
    } catch (error) {
      failure ??= { error: postgresFailure('POSTGRES_RELEASE_FAILED', error) };
    }
    if (failure) throw failure.error;
    return value;
  }

  async healthcheck(): Promise<boolean> {
    const result = await this.query<{ healthy: number }>(
      'SELECT 1::integer AS healthy',
    );
    return result.rows[0]?.healthy === 1;
  }

  close(): Promise<void> {
    this.closing ??= Promise.resolve()
      .then(() => this.pool.end())
      .catch((error) => {
        throw postgresFailure('POSTGRES_CLOSE_FAILED', error);
      });
    return this.closing;
  }

  onApplicationShutdown(): Promise<void> {
    return this.close();
  }
}
