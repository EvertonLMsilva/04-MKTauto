import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { FINANCE_LEDGER_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/finance/infrastructure/postgres-finance-ledger.migrations.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { PostgresFinanceLedgerPersistence } from '../../src/modules/finance/infrastructure/postgres-finance-ledger.persistence.js';
import {
  FinancePostgresModule,
  POSTGRES_FINANCE_LEDGER,
} from '../../src/modules/finance/finance-postgres.module.js';
import { CostLedgerRepository } from '../../src/modules/finance/infrastructure/cost-ledger.repository.js';
import {
  validateCostEvent,
  createCostLedger,
} from '../../src/modules/finance/domain/cost-event-contracts.js';
import { adjustmentHash } from '../../src/modules/finance/domain/cost-adjustment-contracts.js';
import { validateArtifactLineage } from '../../src/modules/content/domain/artifact-lineage-contracts.js';
import { PostgresProjectPersistence } from '../../src/modules/project/infrastructure/postgres-project.persistence.js';
import { PostgresOperationsPersistence } from '../../src/modules/content-operations/infrastructure/postgres-campaign.persistence.js';
import { SqliteOperationsRepository } from '../../src/modules/content-operations/infrastructure/sqlite-operations.repository.js';
import { project, at, sqliteAffiliateFixture } from './affiliate-fixture.js';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const runId = 'run_finance_001';
const event = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 'cost-event/1.0.0',
  costEventId: 'cost_finance_001',
  category: 'ai_cost',
  pipelineRunId: runId,
  projectId: 'project_001',
  projectVersion: 1,
  contentIdentity: null,
  artifactId: null,
  amount: '0.123456789012345678',
  currency: 'USD',
  occurredAt: at,
  origin: 'operator',
  attributionRuleVersion: 'fixture/1.0.0',
  recordedAt: at,
  ...overrides,
});
const start = (snapshot: any, id = runId) => ({
  execution: {
    pipelineRunId: id,
    projectId: 'project_001',
    projectVersion: 1,
    startedAt: at,
  },
  projectSnapshot: snapshot,
});
const adjustment = () => {
  const body = {
    schemaVersion: 'cost-adjustment/2.0.0' as const,
    adjustmentId: 'adjustment_finance_001',
    originalCostEventId: 'tts_cost:tts_finance_001',
    ttsOperationId: 'tts_finance_001',
    deltaUnits: '-123456789012345678',
    currency: 'USD' as const,
    evidenceReference: 'fixture/invoice',
    evidenceHash: 'e'.repeat(64),
    idempotencyKey: 'adjustment_key_001',
    createdAt: at,
  };
  return { ...body, contentHash: adjustmentHash(body) };
};
const artifact = (id = 'artifact_finance_001', run = runId) =>
  validateArtifactLineage({
    schemaVersion: 'artifact-lineage/1.0.0',
    artifactId: id,
    artifactType: 'script',
    artifactVersion: 1,
    pipelineRunId: run,
    projectId: 'project_001',
    projectVersion: 1,
    contentIdentity: 'content_finance_001',
    hashAlgorithm: 'sha256',
    contentHash: 'a'.repeat(64),
    inputs: [],
    generationMetadata: null,
    createdAt: at,
  });

describe('Finance ledger PostgreSQL foundation', () => {
  let db: PostgresDatabase;
  beforeAll(async () => {
    db = new PostgresDatabase(getTestPostgresConfig());
    await assertDisposableDatabase(db);
  });
  beforeEach(async () => {
    await assertDisposableDatabase(db);
    for (const schema of [
      'finance',
      'campaign',
      'affiliate',
      'content',
      'research',
      'project',
      'platform',
    ])
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  });
  afterAll(async () => {
    await db?.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('appends v6 without changing v1-v5, reexecutes and rejects checksum drift', async () => {
    expect(migrations.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6]);
    await new PostgresMigrationRunner(db).migrate(migrations);
    expect(
      (
        await db.query(
          'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual(
      migrations.map((m) => ({
        version: m.version,
        name: m.name,
        checksum: postgresMigrationChecksum(m.sql),
      })),
    );
    expect(await new PostgresMigrationRunner(db).migrate(migrations)).toEqual({
      applied: [],
      currentVersion: 6,
    });
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 5),
        { ...migrations[5], sql: migrations[5].sql + '\n-- drift' },
      ]),
    ).rejects.toThrow();
  });
  it('rolls back the entire v6 DDL and version entry on a migration failure', async () => {
    await new PostgresMigrationRunner(db).migrate(migrations.slice(0, 5));
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 5),
        {
          ...migrations[5],
          sql: migrations[5].sql + '\nSELECT missing_finance_fixture();',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT pg_catalog.to_regnamespace('finance') AS schema"))
        .rows[0].schema,
    ).toBeNull();
    expect(
      (
        await db.query(
          'SELECT max(version) AS version FROM platform.schema_migrations',
        )
      ).rows[0].version,
    ).toBe(5);
  });
  describe('supported ledger operations', () => {
    let persistence: PostgresFinanceLedgerPersistence, snapshot: any;
    beforeEach(async () => {
      await new PostgresMigrationRunner(db).migrate(migrations);
      const projects = await new PostgresProjectPersistence(db).open();
      snapshot = await projects.create(project(), { createdAt: at });
      await projects.close();
      const ops = await new PostgresOperationsPersistence(db).open();
      await ops.startRun(start(snapshot));
      await ops.close();
      persistence = new PostgresFinanceLedgerPersistence(db);
    });
    const insertArtifact = async (value: any) =>
      db.query(
        `INSERT INTO content.artifact_lineage(artifact_id,schema_version,artifact_type,artifact_version,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12)`,
        [
          value.artifactId,
          value.schemaVersion,
          value.artifactType,
          value.artifactVersion,
          hash(value),
          value.pipelineRunId,
          value.projectId,
          value.projectVersion,
          value.contentIdentity,
          value.hashAlgorithm,
          value.contentHash,
          value.createdAt,
        ],
      );
    it('preserves exact amounts, normalized identity, receipts and stable currency totals', async () => {
      const repo = await persistence.open();
      try {
        const values = [
          event({ amount: '0000.100000000000000000', costEventId: 'cost_z' }),
          event({
            amount: '9'.repeat(40) + '.123456789012345678',
            costEventId: 'cost_a',
          }),
          event({
            amount: '0.000000000000000001',
            costEventId: 'cost_tiny',
            currency: 'BRL',
          }),
        ];
        for (const value of values)
          expect(await repo.registerCostEvent(value)).toEqual(
            validateCostEvent(value),
          );
        const ordered = values
          .map(validateCostEvent)
          .sort((a, b) => (a.costEventId < b.costEventId ? -1 : 1));
        expect(await repo.getCostLedgerByPipelineRun(runId)).toEqual(
          createCostLedger({
            pipelineRunId: runId,
            projectId: 'project_001',
            projectVersion: 1,
            events: ordered,
          }),
        );
        expect(
          (
            await db.query(
              "SELECT amount FROM finance.cost_events WHERE cost_event_id='cost_a'",
            )
          ).rows[0].amount,
        ).toBe(values[1].amount);
        const receipt = await repo.getReceipt('cost_z');
        expect(receipt).toEqual({
          costEventId: 'cost_z',
          identityHash: hash(validateCostEvent(values[0])),
          resultHash: hash(validateCostEvent(values[0])),
          result: validateCostEvent(values[0]),
        });
      } finally {
        await repo.close();
      }
    });
    it('rejects zero, unknown, inexact or invalid cost values without creating records', async () => {
      const repo = await persistence.open();
      try {
        for (const amount of [
          null,
          undefined,
          0,
          0.1,
          '0',
          '-1',
          'NaN',
          'Infinity',
          '1e-3',
          '0.0000000000000000001',
        ])
          await expect(
            repo.registerCostEvent(event({ amount })),
          ).rejects.toMatchObject({ code: 'INVALID_COST_AMOUNT' });
        expect(
          (await db.query('SELECT count(*) FROM finance.cost_events')).rows[0]
            .count,
        ).toBe('0');
      } finally {
        await repo.close();
      }
    });
    it('replays normalized events and rejects conflicting identities, including competing workers', async () => {
      const a = await persistence.open(),
        b = await persistence.open();
      try {
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            (i % 2 ? a : b).registerCostEvent(event()),
          ),
        );
        for (const result of results) expect(result).toEqual(results[0]);
        expect(
          await b.registerCostEvent(event({ amount: '0.1234567890123456780' })),
        ).toEqual(results[0]);
        await expect(
          a.registerCostEvent(event({ amount: '2' })),
        ).rejects.toMatchObject({
          code: 'COST_EVENT_ID_REUSED',
          field: 'costEventId',
        });
        expect(
          (await db.query('SELECT count(*) FROM finance.cost_events')).rows[0]
            .count,
        ).toBe('1');
        expect(
          (await db.query('SELECT count(*) FROM finance.ledger_receipts'))
            .rows[0].count,
        ).toBe('1');
      } finally {
        await a.close();
        await b.close();
      }
    });
    it('revalidates canonical run/artifact integrity and preserves scope errors', async () => {
      const repo = await persistence.open();
      try {
        await expect(
          repo.registerCostEvent(event({ pipelineRunId: 'run_missing' })),
        ).rejects.toMatchObject({
          code: 'PIPELINE_RUN_NOT_FOUND',
          field: 'pipelineRunId',
        });
        await expect(
          repo.registerCostEvent(event({ projectVersion: 2 })),
        ).rejects.toMatchObject({
          code: 'COST_EVENT_RUN_SCOPE_MISMATCH',
          field: 'projectVersion',
        });
        await expect(
          repo.registerCostEvent(event({ projectId: 'project_other' })),
        ).rejects.toMatchObject({
          code: 'COST_EVENT_RUN_SCOPE_MISMATCH',
          field: 'projectId',
        });
        await expect(
          repo.registerCostEvent(event({ artifactId: 'artifact_missing' })),
        ).rejects.toMatchObject({ code: 'COST_EVENT_ARTIFACT_NOT_FOUND' });
        const value = artifact();
        await insertArtifact(value);
        await expect(
          repo.registerCostEvent(
            event({
              artifactId: value.artifactId,
              contentIdentity: 'wrong_content',
            }),
          ),
        ).rejects.toMatchObject({ code: 'COST_EVENT_CONTENT_MISMATCH' });
        expect(
          await repo.registerCostEvent(
            event({
              artifactId: value.artifactId,
              contentIdentity: value.contentIdentity,
            }),
          ),
        ).toEqual(
          validateCostEvent(
            event({
              artifactId: value.artifactId,
              contentIdentity: value.contentIdentity,
            }),
          ),
        );
      } finally {
        await repo.close();
      }
    });
    it('rolls back the event when receipt persistence fails and permits exact recovery', async () => {
      await db.query(
        "CREATE FUNCTION finance.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER fail_receipt BEFORE INSERT ON finance.ledger_receipts FOR EACH ROW EXECUTE FUNCTION finance.fail_receipt()",
      );
      const repo = await persistence.open();
      try {
        await expect(repo.registerCostEvent(event())).rejects.toMatchObject({
          code: 'COST_EVENT_PERSISTENCE_FAILED',
        });
        for (const table of ['cost_events', 'ledger_receipts'])
          expect(
            (await db.query(`SELECT count(*) FROM finance.${table}`)).rows[0]
              .count,
          ).toBe('0');
        await db.query('DROP TRIGGER fail_receipt ON finance.ledger_receipts');
        expect(await repo.registerCostEvent(event())).toEqual(
          validateCostEvent(event()),
        );
      } finally {
        await repo.close();
      }
    });
    it('enforces bidirectional receipt integrity and rejects precision rounding at the SQL boundary', async () => {
      const repo = await persistence.open();
      await repo.registerCostEvent(event());
      await repo.close();
      await expect(
        db.query(
          "INSERT INTO finance.ledger_receipts(cost_event_id,identity_hash,result_hash,result_json) VALUES('cost_orphan',$1,$1,'{}')",
          ['a'.repeat(64)],
        ),
      ).rejects.toMatchObject({ sqlState: '23503' });
      await expect(
        db.query(
          "INSERT INTO finance.cost_events SELECT 'cost_without_receipt',schema_version,identity_hash,category,pipeline_run_id,project_id,project_version,content_identity,artifact_id,amount,currency,occurred_at,origin,attribution_rule_version,recorded_at FROM finance.cost_events LIMIT 1",
        ),
      ).rejects.toMatchObject({ sqlState: '23503' });
      for (const amount of [
        'NaN',
        'Infinity',
        '-Infinity',
        '0',
        '1e40',
        '0.0000000000000000001',
      ])
        await expect(
          db.query('SELECT $1::finance.positive_amount', [amount]),
        ).rejects.toMatchObject({ sqlState: '23514' });
    });
    it('keeps events, receipts and adjustment records immutable at SQL level', async () => {
      const repo = await persistence.open();
      await repo.registerCostEvent(event());
      await repo.close();
      for (const table of ['cost_events', 'ledger_receipts'])
        for (const verb of ['UPDATE', 'DELETE'])
          await expect(
            db.query(
              verb === 'UPDATE'
                ? `UPDATE finance.${table} SET identity_hash=identity_hash`
                : `DELETE FROM finance.${table}`,
            ),
          ).rejects.toMatchObject({ sqlState: 'P6008' });
    });
    it('rejects corrupted persisted amounts and receipts rather than repairing or replaying them', async () => {
      const repo = await persistence.open();
      try {
        await repo.registerCostEvent(event());
        await assertDisposableDatabase(db);
        await db.transaction(async (client) => {
          await client.query(
            'ALTER TABLE finance.cost_events DISABLE TRIGGER immutable_cost_events',
          );
          await client.query("UPDATE finance.cost_events SET amount='2'");
          await client.query(
            'ALTER TABLE finance.cost_events ENABLE TRIGGER immutable_cost_events',
          );
        });
        await expect(
          repo.getCostEvent(event().costEventId),
        ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_COST_EVENT' });
        await expect(repo.registerCostEvent(event())).rejects.toMatchObject({
          code: 'INVALID_PERSISTED_COST_EVENT',
        });
        await expect(
          repo.getReceipt(event().costEventId),
        ).rejects.toMatchObject({ code: 'INVALID_PERSISTED_COST_EVENT' });
      } finally {
        await repo.close();
      }
    });
    it('gives exactly one winner to conflicting concurrent cost identities', async () => {
      const a = await persistence.open(),
        b = await persistence.open();
      try {
        const results = await Promise.allSettled([
          a.registerCostEvent(event({ amount: '1' })),
          b.registerCostEvent(event({ amount: '2' })),
        ]);
        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(
          results.find((result) => result.status === 'rejected'),
        ).toMatchObject({ reason: { code: 'COST_EVENT_ID_REUSED' } });
        expect(
          (await db.query('SELECT count(*) FROM finance.cost_events')).rows[0]
            .count,
        ).toBe('1');
        expect(
          (await db.query('SELECT count(*) FROM finance.ledger_receipts'))
            .rows[0].count,
        ).toBe('1');
      } finally {
        await a.close();
        await b.close();
      }
    });
    it('recovers replay after closing the database/pool and reopening only the disposable identity', async () => {
      const firstDb = new PostgresDatabase(getTestPostgresConfig());
      await assertDisposableDatabase(firstDb);
      const first = await new PostgresFinanceLedgerPersistence(firstDb).open();
      await first.registerCostEvent(event());
      const receipt = await first.getReceipt(event().costEventId);
      await first.close();
      await firstDb.close();
      const restartedDb = new PostgresDatabase(getTestPostgresConfig());
      try {
        await assertDisposableDatabase(restartedDb);
        const restarted = await new PostgresFinanceLedgerPersistence(
          restartedDb,
        ).open();
        try {
          expect(await restarted.registerCostEvent(event())).toEqual(
            validateCostEvent(event()),
          );
          expect(await restarted.getReceipt(event().costEventId)).toEqual(
            receipt,
          );
        } finally {
          await restarted.close();
        }
      } finally {
        await restartedDb.close();
      }
    });
    it('matches SQLite reads and totals using a read-only Finance handle on a synthetic fixture', async () => {
      const fixture = sqliteAffiliateFixture();
      let native: CostLedgerRepository | undefined;
      try {
        const ops = new SqliteOperationsRepository(fixture.path);
        ops.startRun(start(snapshot));
        ops.close();
        const seed = new DatabaseSync(fixture.path);
        const values = [
          validateCostEvent(event()),
          validateCostEvent(
            event({
              costEventId: 'cost_eur',
              currency: 'EUR',
              amount: '12345678901234567890.123456789012345678',
            }),
          ),
        ];
        for (const value of values)
          seed
            .prepare(
              'INSERT INTO cost_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .run(
              value.costEventId,
              value.schemaVersion,
              hash(value),
              value.category,
              value.pipelineRunId,
              value.projectId,
              value.projectVersion,
              value.contentIdentity,
              value.artifactId,
              value.amount,
              value.currency,
              value.occurredAt,
              value.origin,
              value.attributionRuleVersion,
              value.recordedAt,
            );
        seed.close();
        native = new CostLedgerRepository(fixture.path, { readOnly: true });
        const pg = await persistence.open();
        try {
          for (const value of values)
            expect(await pg.registerCostEvent(value)).toEqual(
              native.getCostEvent(value.costEventId),
            );
          expect(await pg.listCostEventsByPipelineRun(runId)).toEqual(
            native.listCostEventsByPipelineRun(runId),
          );
          expect(await pg.getCostLedgerByPipelineRun(runId)).toEqual(
            native.getCostLedgerByPipelineRun(runId),
          );
          expect(() =>
            native!.registerCostEvent(
              event({ costEventId: 'readonly_forbidden' }),
            ),
          ).toThrow();
        } finally {
          await pg.close();
        }
      } finally {
        native?.close();
        fixture.cleanup();
      }
    });
    it('reads validated adjustment records without pretending to reconcile or write TTS state', async () => {
      const repo = await persistence.open();
      const value = adjustment();
      try {
        await repo.registerCostEvent(
          event({
            costEventId: value.originalCostEventId,
            category: 'voice_cost',
            origin: 'openai',
            amount: '1',
          }),
        );
        // Historical records are seeded only in the disposable fixture; no adjustment write API is exposed.
        const params = [
          value.adjustmentId,
          value.originalCostEventId,
          value.ttsOperationId,
          value.deltaUnits,
          value.currency,
          value.evidenceReference,
          value.evidenceHash,
          value.idempotencyKey,
          value.createdAt,
          value.contentHash,
        ];
        const insert =
          'INSERT INTO finance.cost_adjustments VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
        await expect(db.query(insert, params)).rejects.toMatchObject({
          sqlState: 'P6009',
        });
        // Bypass only the unavailable TTS gate inside this marked, disposable historical-record fixture.
        await assertDisposableDatabase(db);
        await db.transaction(async (client) => {
          await client.query(
            'ALTER TABLE finance.cost_adjustments DISABLE TRIGGER require_adjustment_reconciliation',
          );
          await client.query(insert, params);
          await client.query(
            'ALTER TABLE finance.cost_adjustments ENABLE TRIGGER require_adjustment_reconciliation',
          );
        });
        expect(
          await repo.listAdjustmentRecords(value.originalCostEventId),
        ).toEqual([value]);
        for (const verb of [
          'UPDATE finance.cost_adjustments SET identity_hash=identity_hash',
          'DELETE FROM finance.cost_adjustments',
        ])
          await expect(db.query(verb)).rejects.toMatchObject({
            sqlState: 'P6008',
          });
        expect(repo).not.toHaveProperty('registerTtsAdjustment');
        expect(repo).not.toHaveProperty('getLedgerV2ByPipelineRun');
        expect(repo).not.toHaveProperty('executePaid');
        expect(repo).not.toHaveProperty('reserveGlobal');
      } finally {
        await repo.close();
      }
    });
    it('uses one physical transaction/connection for both event and receipt', async () => {
      let pool!: Pool;
      const observedDb = new PostgresDatabase(
        { ...getTestPostgresConfig(), max: 1 },
        (config) => (pool = new Pool(config)),
      );
      try {
        await assertDisposableDatabase(observedDb);
        const repo = await new PostgresFinanceLedgerPersistence(
          observedDb,
        ).open();
        const client = await pool.connect();
        const queries = vi.spyOn(client, 'query');
        client.release();
        const connects = vi.spyOn(pool, 'connect'),
          independent = vi.spyOn(pool, 'query');
        await repo.registerCostEvent(event());
        const texts = queries.mock.calls.map(([q]) =>
          typeof q === 'string' ? q : (q as any).text,
        );
        expect(connects).toHaveBeenCalledTimes(1);
        expect(independent).not.toHaveBeenCalled();
        expect(texts.filter((text) => text === 'BEGIN')).toHaveLength(1);
        expect(texts.filter((text) => text === 'COMMIT')).toHaveLength(1);
        expect(texts.filter((text) => text === 'ROLLBACK')).toHaveLength(0);
        await repo.close();
      } finally {
        vi.restoreAllMocks();
        await observedDb.close();
      }
    });
    it('preserves read-only/closed handles and refuses participation in the existing three-domain unit', async () => {
      const repo = await persistence.open(true);
      await expect(repo.registerCostEvent(event())).rejects.toMatchObject({
        code: 'FINANCE_LEDGER_READ_ONLY',
      });
      expect(await repo.getCostEvent(event().costEventId)).toBeNull();
      await repo.close();
      await expect(
        repo.getCostEvent(event().costEventId),
      ).rejects.toMatchObject({ code: 'FINANCE_LEDGER_HANDLE_CLOSED' });
      await expect(
        db.unitOfWork(['content', 'affiliate', 'campaign'], () =>
          persistence.open(),
        ),
      ).rejects.toMatchObject({
        code: 'FINANCE_CROSS_DOMAIN_TRANSACTION_REQUIRED',
      });
    });
    it('rejects absent/drifted provisioning and never creates finance objects on startup', async () => {
      await db.query(
        'UPDATE platform.schema_migrations SET checksum=$1 WHERE version=6',
        ['a'.repeat(64)],
      );
      await expect(persistence.open()).rejects.toMatchObject({
        code: 'FINANCE_LEDGER_SCHEMA_VERSION_UNSUPPORTED',
      });
      await db.query('DROP SCHEMA finance CASCADE');
      await db.query('DELETE FROM platform.schema_migrations WHERE version=6');
      const idle = new PostgresDatabase(getTestPostgresConfig());
      const queries = vi.spyOn(idle, 'query'),
        transactions = vi.spyOn(idle, 'transaction');
      const app = await Test.createTestingModule({
        imports: [FinancePostgresModule.register(getTestPostgresConfig())],
      })
        .overrideProvider(PostgresDatabase)
        .useValue(idle)
        .compile();
      try {
        await app.init();
        expect(queries).not.toHaveBeenCalled();
        expect(transactions).not.toHaveBeenCalled();
        expect(app.get(POSTGRES_FINANCE_LEDGER)).toBeInstanceOf(
          PostgresFinanceLedgerPersistence,
        );
        await expect(
          app
            .get<PostgresFinanceLedgerPersistence>(POSTGRES_FINANCE_LEDGER)
            .open(),
        ).rejects.toMatchObject({
          code: 'FINANCE_LEDGER_SCHEMA_VERSION_UNSUPPORTED',
        });
        expect(
          (
            await db.query(
              "SELECT pg_catalog.to_regnamespace('finance') AS schema",
            )
          ).rows[0].schema,
        ).toBeNull();
      } finally {
        await app.close();
      }
    });
  });
});
