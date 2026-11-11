import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { PostgresResearchPersistence } from '../../src/modules/research/infrastructure/postgres-research.persistence.js';
import { PostgresResearchRepository } from '../../src/modules/research/infrastructure/postgres-research.repository.js';
import { RESEARCH_POSTGRES_MIGRATION_REGISTRY } from '../../src/modules/research/infrastructure/postgres-research.migrations.js';
import { PROJECT_POSTGRES_MIGRATIONS } from '../../src/modules/project/infrastructure/postgres-project.migrations.js';
import { ResearchPersistence } from '../../src/modules/research/infrastructure/research.persistence.js';
import { ResearchModule } from '../../src/modules/research/research.module.js';
import { RESEARCH_DATABASE } from '../../src/modules/research/infrastructure/research-database.config.js';
import {
  RESEARCH_READER,
  RESEARCH_REPOSITORY,
} from '../../src/modules/research/application/research-repository.port.js';
import { ResearchService } from '../../src/modules/research/application/research.service.js';
import { buildResearchShortlist } from '../../src/modules/research/application/research-shortlist.js';
import { rankTrendCandidates } from '../../src/modules/research/domain/ranking.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';
import {
  batch,
  cluster,
  score,
  DAY_ONE,
  DAY_TWO,
  catalogContract,
  failureCode,
  lifecycleContract,
  researchArtifacts,
  researchHash,
  seedCatalog,
  sqliteResearchFixture,
} from './research-fixture.js';

describe('Research PostgreSQL integration', () => {
  let database: PostgresDatabase;
  let persistence: PostgresResearchPersistence;
  let repository: PostgresResearchRepository;
  let config: ReturnType<typeof getTestPostgresConfig>;

  beforeAll(async () => {
    config = getTestPostgresConfig();
    database = new PostgresDatabase(config);
    await assertDisposableDatabase(database);
  });
  beforeEach(async () => {
    // Independently verify the owned harness marker before every destructive DDL.
    await assertDisposableDatabase(database);
    await database.query('DROP SCHEMA IF EXISTS research CASCADE');
    await database.query('DROP SCHEMA IF EXISTS project CASCADE');
    await database.query('DROP SCHEMA IF EXISTS platform CASCADE');
    await new PostgresMigrationRunner(database).migrate(
      RESEARCH_POSTGRES_MIGRATION_REGISTRY,
    );
    persistence = new PostgresResearchPersistence(database);
    repository = await persistence.open();
  });
  afterEach(async () => {
    await repository?.close();
  });
  afterAll(async () => {
    await database?.close();
  });

  it('reuses Project version 1, applies Research version 2 once and records exact history', async () => {
    expect(
      RESEARCH_POSTGRES_MIGRATION_REGISTRY.map(({ version }) => version),
    ).toEqual([1, 2]);
    expect(RESEARCH_POSTGRES_MIGRATION_REGISTRY[0]).toEqual(
      PROJECT_POSTGRES_MIGRATIONS[0],
    );
    expect(
      await new PostgresMigrationRunner(database).migrate(
        RESEARCH_POSTGRES_MIGRATION_REGISTRY,
      ),
    ).toEqual({ applied: [], currentVersion: 2 });
    expect(
      (
        await database.query(
          'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual(
      RESEARCH_POSTGRES_MIGRATION_REGISTRY.map((migration) => ({
        version: migration.version,
        name: migration.name,
        checksum: postgresMigrationChecksum(migration.sql),
      })),
    );
  });

  it('rejects version-2 checksum drift and rolls back failed DDL without changing either ledger entry', async () => {
    const runner = new PostgresMigrationRunner(database);
    const ledger = (
      await database.query(
        'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
      )
    ).rows;
    await expect(
      runner.migrate([
        RESEARCH_POSTGRES_MIGRATION_REGISTRY[0],
        {
          ...RESEARCH_POSTGRES_MIGRATION_REGISTRY[1],
          sql: RESEARCH_POSTGRES_MIGRATION_REGISTRY[1].sql + '\n',
        },
        {
          version: 3,
          name: 'fixture_after_drift',
          sql: 'CREATE TABLE research.fixture_after_drift (id integer);',
        },
      ]),
    ).rejects.toMatchObject({ code: 'POSTGRES_MIGRATION_CHECKSUM_MISMATCH' });
    expect(
      (
        await database.query(
          "SELECT pg_catalog.to_regclass('research.fixture_after_drift') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull();
    await expect(
      runner.migrate([
        ...RESEARCH_POSTGRES_MIGRATION_REGISTRY,
        {
          version: 3,
          name: 'fixture_rollback',
          sql: 'CREATE TABLE research.fixture_partial (id integer); SELECT * FROM research.fixture_missing;',
        },
      ]),
    ).rejects.toMatchObject({
      code: 'POSTGRES_TRANSACTION_FAILED',
      sqlState: '42P01',
    });
    expect(
      (
        await database.query(
          "SELECT pg_catalog.to_regclass('research.fixture_partial') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull();
    expect(
      (
        await database.query(
          'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual(ledger);
  });

  it('matches SQLite catalog snapshots, operation hashes, history, reappearance and exact retries', async () => {
    const sqlite = sqliteResearchFixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(DAY_TWO));
    try {
      const expected = await catalogContract(sqlite.repository);
      const actual = await catalogContract(repository);
      expect(actual).toEqual(expected);
      expect(JSON.stringify(actual.history)).toBe(
        JSON.stringify(expected.history),
      );
      expect(actual.reused).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(actual.history.snapshots).toHaveLength(2);
      expect(actual.scopedHistory.snapshots).toHaveLength(1);
      expect(actual.first.sourceRuns[0].coverage).toEqual(
        expected.first.sourceRuns[0].coverage,
      );
      const operation = (
        await database.query(
          'SELECT payload_hash,trend_run_id,created_at FROM research.trend_operations WHERE idempotency_key=$1',
          ['one'],
        )
      ).rows[0];
      const sqliteOperation = sqlite.repository.db
        .prepare(
          'SELECT payload_hash,trend_run_id,created_at FROM trend_operations WHERE idempotency_key=?',
        )
        .get('one');
      expect(operation.payload_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(operation).toEqual(sqliteOperation);
    } finally {
      vi.useRealTimers();
      sqlite.cleanup();
    }
  });

  it('preserves deterministic candidate ordering, tied rankings and missing-metric evidence', async () => {
    const sqlite = sqliteResearchFixture();
    const ids = ['candidate-z', 'candidate-A', 'candidate-a', 'candidate-10'];
    const value = batch({ key: 'ordered', at: DAY_ONE, views: 100 });
    value.observations = ids.map(
      (candidateId, index) =>
        batch({
          key: `unused-${index}`,
          at: DAY_ONE,
          views: index === 3 ? undefined : 100,
          candidateId,
          snapshotId: `snapshot-${index}`,
          platformVideoId: `video-${index}`,
          canonicalUrl: `https://youtube.com/watch?v=video-${index}`,
        }).observations[0],
    );
    value.run.candidateIds = ids;
    const topic = {
      ...cluster(),
      candidateIds: ids,
      evidenceSnapshotIds: ids.map((_, index) => `snapshot-${index}`),
    };
    const scores = ids.map((candidateId, index) => ({
      ...score(),
      id: `score-${index}`,
      candidateId,
      components: Object.fromEntries(
        Object.entries(score().components).map(([key, component]) => [
          key,
          { ...component, evidenceSnapshotIds: [`snapshot-${index}`] },
        ]),
      ),
    }));
    async function exercise(
      store: typeof repository | typeof sqlite.repository,
    ) {
      await store.recordOperation(value);
      await store.recordAnalysis({
        idempotencyKey: 'ordered-analysis',
        runId: value.run.id,
        topicClusters: [topic],
        scores,
      });
      const catalog = await store.getRun(value.run.id);
      return {
        catalog,
        ranking: rankTrendCandidates({
          candidates: catalog.candidates,
          scores: catalog.scores,
          clusters: catalog.topicClusters,
        }),
      };
    }
    try {
      const invalid = structuredClone(value);
      invalid.run.candidateIds = ['candidate-é'];
      expect(await failureCode(() => repository.recordOperation(invalid))).toBe(
        'INVALID_ID',
      );
      expect(
        await failureCode(() => sqlite.repository.recordOperation(invalid)),
      ).toBe('INVALID_ID');
      expect(await exercise(repository)).toEqual(
        await exercise(sqlite.repository),
      );
    } finally {
      sqlite.cleanup();
    }
  });

  it.each(['COMPLETED', 'COMPLETED_WITH_GAPS', 'FAILED'])(
    'matches SQLite daily/reference steps, replay, decimal durations and persisted %s state',
    async (state) => {
      const sqlite = sqliteResearchFixture();
      try {
        const expected = await lifecycleContract(sqlite.repository, state);
        const actual = await lifecycleContract(repository, state);
        expect(actual).toEqual(expected);
        expect(actual.daily.state).toBe(state);
        expect(actual.reference.state).toBe(state);
        expect(actual.forbidden).toBe('FORBIDDEN_REFERENCE_STEP_FIELD');
        const reopened = await persistence.open(true);
        try {
          expect(await reopened.getResearchDailyRun('research-run')).toEqual(
            actual.daily,
          );
        } finally {
          await reopened.close();
        }
      } finally {
        sqlite.cleanup();
      }
    },
  );

  it('preserves artifact/shortlist/insight lineage, hashes, immutable evidence and Content reader contracts', async () => {
    const sqlite = sqliteResearchFixture();
    const f = researchArtifacts();
    try {
      for (const store of [sqlite.repository, repository]) {
        await seedCatalog(store);
        await store.beginResearchDailyRun(f.daily);
        expect(
          await store.recordResearchArtifact({
            researchDailyRunId: f.daily.id,
            artifact: f.catalog,
          }),
        ).toEqual(f.catalog);
        expect(
          await store.recordResearchArtifact({
            researchDailyRunId: f.daily.id,
            artifact: f.catalog,
          }),
        ).toEqual(f.catalog);
        expect(
          await failureCode(() =>
            store.recordResearchArtifact({
              researchDailyRunId: f.daily.id,
              artifact: { ...f.catalog, contentHash: '0'.repeat(64) },
            }),
          ),
        ).toBe('RESEARCH_ARTIFACT_HASH_MISMATCH');
        await store.finishResearchDailyRun({
          id: f.daily.id,
          state: 'COMPLETED',
          trendRunId: f.catalog.trendRunId,
          completedAt: DAY_TWO,
          durationMs: 1.25,
          result: {},
        });
        await store.beginReferenceAnalysisRun(f.referenceRun);
        expect(
          await store.recordReferenceInsight({
            referenceAnalysisRunId: f.referenceRun.id,
            artifact: f.insight,
          }),
        ).toEqual(f.insight);
        expect(
          await store.recordReferenceInsight({
            referenceAnalysisRunId: f.referenceRun.id,
            artifact: f.insight,
          }),
        ).toEqual(f.insight);
        expect(
          await failureCode(() =>
            store.recordReferenceInsight({
              referenceAnalysisRunId: f.referenceRun.id,
              artifact: { ...f.insight, projectVersion: 2 },
            }),
          ),
        ).toBe('REFERENCE_INSIGHT_LINEAGE_MISMATCH');
      }
      const shortlist = buildResearchShortlist({
        store: sqlite.repository,
        researchInput: f.input,
        researchTopicCatalog: f.catalog,
        clock: () => new Date(DAY_ONE),
      });
      expect(await repository.recordResearchShortlist(shortlist)).toEqual(
        shortlist,
      );
      expect(await repository.recordResearchShortlist(shortlist)).toEqual(
        shortlist,
      );
      expect(
        await failureCode(() =>
          repository.recordResearchShortlist({
            ...shortlist,
            contentHash: '0'.repeat(64),
          }),
        ),
      ).toBe('RESEARCH_SHORTLIST_HASH_MISMATCH');
      expect(await repository.getResearchArtifact(f.daily.id)).toEqual(
        await sqlite.repository.getResearchArtifact(f.daily.id),
      );
      expect(await repository.getShortlist(shortlist.artifactId)).toEqual(
        shortlist,
      );
      expect(
        await repository.getResearchShortlistByPipeline(f.daily.pipelineRunId),
      ).toEqual(shortlist);
      expect(await repository.getInsight(f.insight.artifactId)).toEqual(
        f.insight,
      );
      expect(await repository.getReferenceInsight(f.referenceRun.id)).toEqual(
        f.insight,
      );
      expect(await repository.getShortlist('missing')).toBeNull();
      expect(await repository.getInsight('missing')).toBeNull();
      expect(shortlist.rights.republicationAllowed).toBe(false);
      expect(
        researchHash(
          Object.fromEntries(
            Object.entries(shortlist).filter(([key]) => key !== 'contentHash'),
          ),
        ),
      ).toBe(shortlist.contentHash);
    } finally {
      sqlite.cleanup();
    }
  });

  it('serializes concurrent exact retries and rejects competing payloads without partial records', async () => {
    const peer = await persistence.open();
    const value = batch({ key: 'race', at: DAY_ONE, views: 100 });
    try {
      const exact = await Promise.all([
        repository.recordOperation(value),
        peer.recordOperation(value),
      ]);
      expect(exact[0]).toEqual(exact[1]);
      const competed = await Promise.allSettled([
        repository.recordOperation(
          batch({
            key: 'competing',
            at: DAY_TWO,
            views: 120,
            runId: 'run-two',
            snapshotId: 'snapshot-two',
          }),
        ),
        peer.recordOperation(
          batch({
            key: 'competing',
            at: DAY_TWO,
            views: 130,
            runId: 'run-two',
            snapshotId: 'snapshot-two',
          }),
        ),
      ]);
      expect(
        competed.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        competed.find((value) => value.status === 'rejected'),
      ).toMatchObject({ reason: { code: 'IDEMPOTENCY_KEY_REUSED' } });
      expect(
        (
          await database.query(
            'SELECT COUNT(*)::integer AS count FROM research.trend_operations',
          )
        ).rows[0].count,
      ).toBe(2);
      expect(
        (await repository.getCandidateHistory('candidate-1')).snapshots,
      ).toHaveLength(2);
    } finally {
      await peer.close();
    }
  });

  it('rolls back an entire async callback and a conflicting snapshot with the same public SQLite errors', async () => {
    const rejected = new Error('CALLBACK_REJECTED');
    await expect(
      repository.atomic(async () => {
        await repository.recordOperation(
          batch({ key: 'rollback', at: DAY_ONE, views: 10 }),
        );
        throw rejected;
      }),
    ).rejects.toBe(rejected);
    expect(await repository.getRun('run-2026-09-26')).toBeNull();
    expect(await repository.getOperation('rollback')).toBeNull();
    const sqlite = sqliteResearchFixture();
    try {
      for (const store of [sqlite.repository, repository])
        await store.recordOperation(
          batch({ key: 'one', at: DAY_ONE, views: 100 }),
        );
      const invalid = batch({
        key: 'bad',
        at: DAY_TWO,
        views: 999,
        runId: 'run-bad',
      });
      expect(await failureCode(() => repository.recordOperation(invalid))).toBe(
        await failureCode(() => sqlite.repository.recordOperation(invalid)),
      );
      expect(await repository.getRun('run-bad')).toBeNull();
      expect(await repository.getOperation('bad')).toBeNull();
      const badAnalysis = {
        idempotencyKey: 'bad-analysis',
        runId: 'run-2026-09-26',
        topicClusters: [],
        scores: [{ ...score(), candidateId: 'missing-candidate' }],
      };
      expect(
        await failureCode(() => repository.recordAnalysis(badAnalysis)),
      ).toBe(
        await failureCode(() => sqlite.repository.recordAnalysis(badAnalysis)),
      );
      expect(await repository.getOperation('bad-analysis')).toBeNull();
    } finally {
      sqlite.cleanup();
    }
  });

  it('enforces native snapshot immutability and uniqueness without exposing raw SQL failures', async () => {
    await repository.recordOperation(
      batch({ key: 'one', at: DAY_ONE, views: 100 }),
    );
    await expect(
      database.query(
        'UPDATE research.trend_snapshots SET captured_at=captured_at WHERE id=$1',
        ['snapshot-1'],
      ),
    ).rejects.toMatchObject({
      code: 'POSTGRES_QUERY_FAILED',
      sqlState: 'P2001',
    });
    await expect(
      database.query('DELETE FROM research.trend_snapshots WHERE id=$1', [
        'snapshot-1',
      ]),
    ).rejects.toMatchObject({
      code: 'POSTGRES_QUERY_FAILED',
      sqlState: 'P2001',
    });
    await expect(
      database.query(
        'INSERT INTO research.trend_snapshots(id,candidate_id,trend_run_id,captured_at,metrics_json,payload_json) SELECT $1,candidate_id,trend_run_id,captured_at,metrics_json,payload_json FROM research.trend_snapshots WHERE id=$2',
        ['snapshot-copy', 'snapshot-1'],
      ),
    ).rejects.toMatchObject({
      code: 'POSTGRES_QUERY_FAILED',
      sqlState: '23505',
    });
    expect(
      (await repository.getCandidateHistory('candidate-1')).snapshots,
    ).toHaveLength(1);
  });

  it('enforces read-only/closed handles and preserves the shared pool and existing records', async () => {
    const value = batch({ key: 'one', at: DAY_ONE, views: 100 });
    await repository.recordOperation(value);
    const reader = await persistence.open(true);
    expect(await reader.getRun(value.run.id)).toEqual(
      await repository.getRun(value.run.id),
    );
    await expect(
      reader.recordOperation(
        batch({
          key: 'blocked',
          at: DAY_TWO,
          views: 50,
          runId: 'blocked-run',
          snapshotId: 'blocked-snapshot',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RESEARCH_READ_ONLY' });
    await expect(reader.atomic(async () => 1)).rejects.toMatchObject({
      code: 'RESEARCH_READ_ONLY',
    });
    await reader.close();
    await reader.close();
    await expect(reader.getRun(value.run.id)).rejects.toMatchObject({
      code: 'RESEARCH_REPOSITORY_CLOSED',
    });
    expect(await database.healthcheck()).toBe(true);
    expect(await repository.getRun('blocked-run')).toBeNull();
    expect(await repository.getOperation('blocked')).toBeNull();
    const options = { readOnly: true };
    const immutableReader = new PostgresResearchRepository(database, options);
    options.readOnly = false;
    try {
      await expect(
        immutableReader.recordOperation(
          batch({
            key: 'mutable-blocked',
            at: DAY_TWO,
            views: 50,
            runId: 'mutable-blocked-run',
            snapshotId: 'mutable-blocked-snapshot',
          }),
        ),
      ).rejects.toMatchObject({ code: 'RESEARCH_READ_ONLY' });
      await expect(immutableReader.atomic(async () => 1)).rejects.toMatchObject(
        { code: 'RESEARCH_READ_ONLY' },
      );
      expect(await repository.getRun('mutable-blocked-run')).toBeNull();
      expect(await repository.getOperation('mutable-blocked')).toBeNull();
    } finally {
      await immutableReader.close();
    }
  });

  it('preserves HTTP contracts with opt-in Nest PostgreSQL and the synchronous default SQLite module', async () => {
    const sqlite = sqliteResearchFixture();
    const apps: INestApplication[] = [];
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('EXTERNAL_REQUEST_NOT_ALLOWED');
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(DAY_TWO));
    try {
      const sqlModule = await Test.createTestingModule({
        imports: [ResearchModule],
      })
        .overrideProvider(RESEARCH_DATABASE)
        .useValue(sqlite.path)
        .compile();
      const pgModule = await Test.createTestingModule({
        imports: [ResearchModule.postgres(config)],
      }).compile();
      expect(sqlModule.get(RESEARCH_REPOSITORY)).toBeInstanceOf(
        ResearchPersistence,
      );
      expect(pgModule.get(RESEARCH_REPOSITORY)).toBeInstanceOf(
        PostgresResearchPersistence,
      );
      expect(
        sqlModule.get(ResearchService).get('getRun', 'missing'),
      ).toBeNull();
      await assertDisposableDatabase(pgModule.get(PostgresDatabase));
      for (const module of [sqlModule, pgModule]) {
        const app = module.createNestApplication({ logger: false });
        apps.push(app);
        await app.init();
      }
      const expected = await httpContract(apps[0]);
      const actual = await httpContract(apps[1]);
      expect(actual).toEqual(expected);
      expect(
        await pgModule
          .get(RESEARCH_READER)
          .getShortlist(actual.shortlist.artifactId),
      ).toEqual(actual.shortlist);
      expect(
        await pgModule
          .get(RESEARCH_READER)
          .getInsight(actual.insight.artifactId),
      ).toEqual(actual.insight);
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      network.mockRestore();
      for (const app of apps) await app.close();
      sqlite.cleanup();
    }
    expect(await database.healthcheck()).toBe(true);
  });
});

async function httpContract(app: INestApplication) {
  const server = app.getHttpServer();
  const value = batch({ key: 'http-one', at: DAY_ONE, views: 100 });
  const first = (
    await request(server)
      .post('/research/catalog-operations')
      .send(value)
      .expect(201)
  ).body;
  expect(
    (
      await request(server)
        .post('/research/catalog-operations')
        .send(value)
        .expect(201)
    ).body,
  ).toEqual(first);
  const {
    schemaVersion: _schema,
    id: _id,
    createdBy: _by,
    ...proposal
  } = cluster();
  const analysis = (
    await request(server)
      .post('/research/analyses')
      .send({
        runId: value.run.id,
        idempotencyKey: 'http-analysis',
        now: DAY_TWO,
        proposals: [proposal],
      })
      .expect(201)
  ).body;
  const ranking = (
    await request(server)
      .get(`/research/catalogs/${value.run.id}/ranking`)
      .expect(200)
  ).body;
  expect(ranking).toEqual({
    ranked: analysis.ranked,
    top: analysis.top,
    gaps: analysis.gaps,
  });
  const history = (
    await request(server)
      .get('/research/candidates/candidate-1/history')
      .expect(200)
  ).body;
  const failures = [];
  for (const [path, body, status] of [
    [
      '/research/catalog-operations',
      batch({ key: 'http-one', at: DAY_ONE, views: 101 }),
      409,
    ],
    ['/research/catalog-operations', {}, 400],
    [
      '/research/analyses',
      { runId: value.run.id, idempotencyKey: 'empty', proposals: [] },
      400,
    ],
    [
      '/research/analyses',
      {
        runId: value.run.id,
        idempotencyKey: 'null-config',
        proposals: [proposal],
        config: null,
      },
      400,
    ],
    [
      '/research/analyses',
      { runId: 'missing', idempotencyKey: 'missing', proposals: [proposal] },
      404,
    ],
    [
      '/research/analyses',
      {
        runId: value.run.id,
        idempotencyKey: 'duplicate',
        proposals: [proposal, proposal],
      },
      400,
    ],
    ['/research/daily', {}, 404],
  ] as const) {
    const response = await request(server).post(path).send(body).expect(status);
    expect(JSON.stringify(response.body)).not.toMatch(
      /SELECT |INSERT |SQLSTATE|postgresql:|password/i,
    );
    failures.push(response.body);
  }
  const f = researchArtifacts();
  await request(server).post('/research/runs').send(f.daily).expect(201);
  await request(server)
    .post('/research/artifacts')
    .send({ researchDailyRunId: f.daily.id, artifact: f.catalog })
    .expect(201);
  await request(server)
    .post('/research/runs/finish')
    .send({
      id: f.daily.id,
      state: 'COMPLETED_WITH_GAPS',
      completedAt: DAY_TWO,
      durationMs: 1.25,
      trendRunId: value.run.id,
      result: {},
    })
    .expect(201);
  const shortlist = (
    await request(server)
      .post('/research/shortlists')
      .send({ researchInput: f.input, researchTopicCatalog: f.catalog })
      .expect(201)
  ).body;
  expect(
    (
      await request(server)
        .get(`/research/shortlists/${encodeURIComponent(shortlist.artifactId)}`)
        .expect(200)
    ).body,
  ).toEqual(shortlist);
  await request(server)
    .post('/research/reference-runs')
    .send(f.referenceRun)
    .expect(201);
  const insight = (
    await request(server)
      .post('/research/insights')
      .send({ referenceAnalysisRunId: f.referenceRun.id, artifact: f.insight })
      .expect(201)
  ).body;
  expect(
    (
      await request(server)
        .get(`/research/insights/${encodeURIComponent(insight.artifactId)}`)
        .expect(200)
    ).body,
  ).toEqual(insight);
  const daily = (
    await request(server).get(`/research/runs/${f.daily.id}`).expect(200)
  ).body;
  const artifact = (
    await request(server)
      .get(`/research/runs/${f.daily.id}/artifact`)
      .expect(200)
  ).body;
  const missing = (
    await request(server).get('/research/catalogs/missing').expect(404)
  ).body;
  return {
    first,
    analysis,
    ranking,
    history,
    failures,
    shortlist,
    insight,
    daily,
    artifact,
    missing,
  };
}
