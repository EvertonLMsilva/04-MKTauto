import { AsyncLocalStorage } from 'node:async_hooks';
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
export type PostgresParticipant =
  'content' | 'affiliate' | 'campaign' | 'media';
const participantLocks: Record<PostgresParticipant, number> = {
  content: 3,
  affiliate: 4,
  campaign: 5,
  media: 7,
};
interface UnitOfWork {
  database: PostgresDatabase;
  client: PoolClient;
  participants: ReadonlySet<PostgresParticipant>;
  active: boolean;
  rollbackOnly: boolean;
}
const units = new AsyncLocalStorage<UnitOfWork>();
const isolatedTransactions = new AsyncLocalStorage<{ active: boolean }>();
export const createPostgresPool: PostgresPoolFactory = (config) =>
  new Pool(config);

@Injectable()
export class PostgresDatabase implements OnApplicationShutdown {
  private readonly unit = units;
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
    participant?: PostgresParticipant,
  ): Promise<QueryResult<R>> {
    this.assertOpen();
    const unit = this.unit.getStore();
    if (unit) {
      this.assertParticipation(unit, participant);
      try {
        return await unit.client.query<R>(text, values);
      } catch (error) {
        unit.rollbackOnly = true;
        throw postgresFailure('POSTGRES_QUERY_FAILED', error);
      }
    }
    try {
      return await this.pool.query<R>(text, values);
    } catch (error) {
      throw postgresFailure('POSTGRES_QUERY_FAILED', error);
    }
  }

  /** Explicit enlistment only. An unadapted repository cannot silently open another transaction. */
  async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
    participant?: PostgresParticipant,
  ): Promise<T> {
    this.assertOpen();
    const unit = this.unit.getStore();
    if (unit) {
      this.assertParticipation(unit, participant);
      try {
        return await work(unit.client);
      } catch (error) {
        unit.rollbackOnly = true;
        throw isPostgresDriverError(error)
          ? postgresFailure('POSTGRES_TRANSACTION_FAILED', error)
          : error;
      }
    }
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
      const isolated = { active: true };
      try {
        value = await isolatedTransactions.run(isolated, () => work(client));
      } finally {
        isolated.active = false;
      }
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

  private assertParticipation(
    unit: UnitOfWork,
    participant?: PostgresParticipant,
  ): void {
    let code: string | undefined;
    if (!unit.active) code = 'POSTGRES_UNIT_OF_WORK_ENDED';
    else if (unit.database !== this) code = 'POSTGRES_DIFFERENT_DATABASE';
    else if (unit.rollbackOnly) code = 'POSTGRES_UNIT_OF_WORK_ABORTED';
    else if (!participant) code = 'POSTGRES_PARTICIPATION_REQUIRED';
    else if (!unit.participants.has(participant))
      code = 'POSTGRES_PARTICIPANT_NOT_ENLISTED';
    if (code) {
      unit.rollbackOnly = true;
      throw new PostgresError(code);
    }
  }

  inUnitOfWork(participant: PostgresParticipant): boolean {
    const unit = this.unit.getStore();
    if (!unit) return false;
    this.assertParticipation(unit, participant);
    return true;
  }

  /** Locks are acquired up front in domain order, before any repository observes state. */
  async unitOfWork<T>(
    participants: readonly PostgresParticipant[],
    work: () => Promise<T>,
  ): Promise<T> {
    const existing = this.unit.getStore();
    const ordered = [...new Set(participants)].sort(
      (a, b) => participantLocks[a] - participantLocks[b],
    );
    if (
      !ordered.length ||
      ordered.some((p) => !Object.hasOwn(participantLocks, p))
    ) {
      if (existing) existing.rollbackOnly = true;
      throw new PostgresError('POSTGRES_INVALID_PARTICIPANTS');
    }
    if (existing) {
      try {
        for (const participant of ordered)
          this.assertParticipation(existing, participant);
        return await work();
      } catch (error) {
        existing.rollbackOnly = true;
        throw error;
      }
    }
    if (isolatedTransactions.getStore()?.active)
      throw new PostgresError('POSTGRES_UNIT_OF_WORK_REQUIRES_ROOT');
    return this.transaction(async (client) => {
      for (const participant of ordered)
        await client.query('SELECT pg_catalog.pg_advisory_xact_lock($1,$2)', [
          1296782401,
          participantLocks[participant],
        ]);
      const unit: UnitOfWork = {
        database: this,
        client,
        participants: new Set(ordered),
        active: true,
        rollbackOnly: false,
      };
      try {
        const value = await this.unit.run(unit, work);
        if (unit.rollbackOnly)
          throw new PostgresError('POSTGRES_UNIT_OF_WORK_ABORTED');
        return value;
      } finally {
        unit.active = false;
      }
    });
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
