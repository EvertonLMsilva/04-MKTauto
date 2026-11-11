import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { CampaignRepository } from '../../src/modules/content-operations/infrastructure/campaign.repository.js';
import { CampaignOrchestrator } from '../../src/modules/content-operations/application/campaign-orchestrator.js';
import { StageRecoveryService } from '../../src/modules/content-operations/application/stage-recovery.service.js';
import {
  CampaignAdministration,
  CampaignAdministrationRuntime,
} from '../../src/modules/content-operations/application/campaign-administration.js';
import { OperationsModule } from '../../src/modules/operations/operations.module.js';
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});
const start = (snapshot: any, id = 'run_pg_001') => ({
  execution: {
    pipelineRunId: id,
    projectId: 'project_001',
    projectVersion: 1,
    startedAt: at,
  },
  projectSnapshot: snapshot,
});
const stageRequest = (id = 'run_pg_001') => ({
  schemaVersion: 'stage-recovery/1.0.0',
  pipelineRunId: id,
  stage: 'RESEARCH',
  requestHash: 'a'.repeat(64),
  inputs: [],
  policyVersions: { research: 'policy/1' },
  providerConfigHash: null,
});
const schedule = {
  campaignId: 'camp_001',
  campaignRevision: 1,
  scheduledAt: at,
  runId: 'run_pg_001',
};
const produced = {
  artifactId: 'research:fixture',
  contentHash: 'b'.repeat(64),
  value: { price: '12345678901234567890.123456789012345678' },
};
import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { CAMPAIGN_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/content-operations/infrastructure/postgres-campaign.migrations.js';
import {
  PostgresOperationsPersistence,
  PostgresCampaignPersistence,
} from '../../src/modules/content-operations/infrastructure/postgres-campaign.persistence.js';
import { PostgresProjectPersistence } from '../../src/modules/project/infrastructure/postgres-project.persistence.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';
import {
  project,
  product,
  campaign,
  at,
  sqliteAffiliateFixture,
} from './affiliate-fixture.js';
import { PostgresAffiliateSessionFactory } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.session.js';
import { PostgresAffiliatePersistence } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.persistence.js';
import { SqliteAffiliateRepository } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate.repository.js';
import { OperationsPersistence } from '../../src/modules/content-operations/infrastructure/operations.persistence.js';

describe('Campaign/Operations PostgreSQL real', () => {
  let db: PostgresDatabase,
    ops: PostgresOperationsPersistence,
    plans: PostgresCampaignPersistence,
    snapshot: any,
    fixture: ReturnType<typeof sqliteAffiliateFixture>;
  beforeAll(async () => {
    db = new PostgresDatabase(getTestPostgresConfig());
    await assertDisposableDatabase(db);
  });
  beforeEach(async () => {
    vi.mocked(randomUUID).mockReset();
    await assertDisposableDatabase(db);
    for (const schema of [
      'campaign',
      'affiliate',
      'content',
      'research',
      'project',
      'platform',
    ])
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await new PostgresMigrationRunner(db).migrate(migrations);
    const projects = new PostgresProjectPersistence(db),
      repo = await projects.open();
    snapshot = await repo.create(project(), { createdAt: at });
    await repo.close();
    const catalog = await new PostgresAffiliatePersistence(
      new PostgresAffiliateSessionFactory(db, {
        executions: { getRun: () => null },
        activity: { hasStarted: () => false },
      }),
    ).open();
    await catalog.registerProduct(product(), 'product_one');
    await catalog.registerCampaign(campaign(), 'campaign_one', true);
    await catalog.close();
    fixture = sqliteAffiliateFixture();
    const native = new SqliteAffiliateRepository(fixture.path);
    native.registerProduct(product(), 'product_one');
    native.registerCampaign(campaign(), 'campaign_one', true);
    native.close();
    ops = new PostgresOperationsPersistence(db);
    plans = new PostgresCampaignPersistence(db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fixture?.cleanup();
  });
  afterAll(async () => {
    await db.close();
  });
  it('extends v1-v4 with v5, reexecutes and verifies exact checksums', async () => {
    expect(migrations.map((m) => m.version)).toEqual([1, 2, 3, 4, 5]);
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
      currentVersion: 5,
    });
  });
  it('matches SQLite pipeline identity, transitions, history and recovery', async () => {
    const pg = await ops.open(),
      native = new OperationsPersistence(fixture.path).open();
    const input = {
      execution: {
        pipelineRunId: 'run_pg_001',
        projectId: 'project_001',
        projectVersion: 1,
        startedAt: at,
      },
      projectSnapshot: snapshot,
    };
    expect(await pg.startRun(input)).toEqual(native.startRun(input));
    expect(await pg.startRun(input)).toEqual(native.startRun(input));
    const failure = {
      pipelineRunId: input.execution.pipelineRunId,
      nextState: 'FAILED',
      completedAt: '2026-10-11T13:00:00.000Z',
      error: { code: 'FIXTURE_INTERRUPTED', field: 'stage' },
    };
    expect(await pg.transitionRun(failure)).toEqual(
      native.transitionRun(failure),
    );
    expect(
      await pg.resumeRun({
        pipelineRunId: input.execution.pipelineRunId,
        resumedAt: '2026-10-11T14:00:00.000Z',
      }),
    ).toEqual(
      native.resumeRun({
        pipelineRunId: input.execution.pipelineRunId,
        resumedAt: '2026-10-11T14:00:00.000Z',
      }),
    );
    await pg.close();
    native.close();
  });
  it('rejects v5 checksum drift and rolls back DDL and ledger together', async () => {
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations.slice(0, 4),
        { ...migrations[4], sql: migrations[4].sql + '\n-- drift' },
      ]),
    ).rejects.toThrow();
    await expect(
      new PostgresMigrationRunner(db).migrate([
        ...migrations,
        {
          version: 6,
          name: '006_failed_fixture',
          sql: 'CREATE TABLE campaign.rollback_probe(id integer); SELECT missing_fixture();',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          "SELECT pg_catalog.to_regclass('campaign.rollback_probe') AS relation",
        )
      ).rows[0].relation,
    ).toBeNull();
    expect(
      (await db.query('SELECT count(*) FROM platform.schema_migrations'))
        .rows[0].count,
    ).toBe('5');
  });
  it('serializes pipeline creation and rejects competing terminal transitions', async () => {
    const a = await ops.open(),
      b = await ops.open();
    expect(
      await Promise.all([
        a.startRun(start(snapshot)),
        b.startRun(start(snapshot)),
      ]),
    ).toEqual([await a.getRun('run_pg_001'), await a.getRun('run_pg_001')]);
    const results = await Promise.allSettled([
      a.transitionRun({
        pipelineRunId: 'run_pg_001',
        nextState: 'FAILED',
        completedAt: at,
      }),
      b.transitionRun({
        pipelineRunId: 'run_pg_001',
        nextState: 'SUCCEEDED',
        completedAt: at,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'INVALID_PIPELINE_RUN_TRANSITION' },
    });
    expect(
      (await db.query('SELECT count(*) FROM campaign.pipeline_run_transitions'))
        .rows[0].count,
    ).toBe('2');
    await a.close();
    await b.close();
  });
  it('rolls back failed transition history without changing pipeline state', async () => {
    const pg = await ops.open();
    await pg.startRun(start(snapshot));
    await db.query(
      "CREATE FUNCTION campaign.reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.next_state='FAILED' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_history BEFORE INSERT ON campaign.pipeline_run_transitions FOR EACH ROW EXECUTE FUNCTION campaign.reject_history()",
    );
    await expect(
      pg.transitionRun({
        pipelineRunId: 'run_pg_001',
        nextState: 'FAILED',
        completedAt: at,
      }),
    ).rejects.toThrow();
    expect((await pg.getRun('run_pg_001'))?.state).toBe('RUNNING');
    expect((await pg.getRun('run_pg_001'))?.transitions).toHaveLength(1);
    await pg.close();
  });
  it('preserves stage identity, hashes, artifact JSON, replay and checkpoint HTTP shape', async () => {
    const pg = await ops.open(),
      native = new OperationsPersistence(fixture.path).open();
    await pg.startRun(start(snapshot));
    native.startRun(start(snapshot));
    const clock = () => at,
      svc = new StageRecoveryService<true>(pg.stages, {
        now: clock,
        sleep: async () => {},
      }),
      old = new StageRecoveryService(native.stages, {
        now: clock,
        sleep: async () => {},
      });
    const effect = vi.fn(async () => produced);
    expect(await svc.execute(stageRequest(), effect)).toEqual(
      await old.execute(stageRequest(), () => produced),
    );
    expect(await svc.execute(stageRequest(), effect)).toEqual(
      await old.execute(stageRequest(), () => produced),
    );
    expect(effect).toHaveBeenCalledTimes(1);
    expect(await svc.getStatuses('run_pg_001')).toEqual(
      old.getStatuses('run_pg_001'),
    );
    expect(await pg.stages.listAttempts('run_pg_001')).toEqual(
      native.stages.listAttempts('run_pg_001'),
    );
    await pg.close();
    native.close();
  });
  it('records a stage claim before work, excludes competing workers and recovers after restart', async () => {
    const a = await ops.open(),
      b = await ops.open();
    await a.startRun(start(snapshot));
    const outcomes = await Promise.allSettled([
      a.stages.startAttempt(stageRequest(), {
        trigger: 'INITIAL',
        startedAt: at,
      }),
      b.stages.startAttempt(stageRequest(), {
        trigger: 'INITIAL',
        startedAt: at,
      }),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'STAGE_ALREADY_RUNNING' },
    });
    await a.close();
    await b.close();
    const restarted = await ops.open();
    const service = new StageRecoveryService<true>(restarted.stages, {
      now: () => at,
      sleep: async () => {},
    });
    const result = await service.recoverInterrupted(
      stageRequest(),
      async () => {
        expect(
          (
            await db.query(
              'SELECT state FROM campaign.pipeline_stage_attempts ORDER BY id',
            )
          ).rows,
        ).toEqual([{ state: 'FAILED' }, { state: 'RUNNING' }]);
        return produced;
      },
    );
    expect(result.attempt).toBe(2);
    expect(
      (await restarted.stages.listAttempts('run_pg_001')).map((r) => r.state),
    ).toEqual(['FAILED', 'SUCCEEDED']);
    await restarted.close();
  });
  it('does not execute a stage effect when its initial commit fails', async () => {
    const pg = await ops.open();
    await pg.startRun(start(snapshot));
    await db.query(
      "CREATE FUNCTION campaign.reject_stage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER reject_stage BEFORE INSERT ON campaign.pipeline_stage_attempts FOR EACH ROW EXECUTE FUNCTION campaign.reject_stage()",
    );
    const effect = vi.fn(async () => produced),
      svc = new StageRecoveryService<true>(pg.stages, { now: () => at });
    await expect(svc.execute(stageRequest(), effect)).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
    expect(await pg.stages.listAttempts('run_pg_001')).toEqual([]);
    await pg.close();
  });
  it('matches campaign states, history, cursors, UUIDs, replay and reconciliation with SQLite', async () => {
    vi.mocked(randomUUID).mockReturnValue(
      '11111111-1111-4111-8111-111111111111',
    );
    const pg = await plans.open(),
      nativeDb = new DatabaseSync(fixture.path),
      native = new CampaignRepository(nativeDb);
    const exercise = async (repo: any) => {
      const e = await repo.schedule(schedule, { mode: 'LOCAL_VALIDATION' }, at);
      const replay = await repo.schedule(
        schedule,
        { mode: 'LOCAL_VALIDATION' },
        at,
      );
      expect(replay).toEqual(e);
      const claim = await repo.claim(e.execution_id, at, 1000);
      await repo.heartbeat(e.execution_id, claim.claim_token, at, 1000);
      await repo.ownedEvent(
        e.execution_id,
        claim.claim_token,
        at,
        'STEP_STARTED',
        { step: 'FIXTURE' },
      );
      await repo.recover('2026-10-11T12:00:02.000Z', e.execution_id);
      await expect(
        Promise.resolve().then(() => repo.resume(e.execution_id, at, 3)),
      ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      const resumed = await repo.resume(
        e.execution_id,
        '2026-10-11T12:00:03.000Z',
        3,
        { verified: true },
      );
      const view = await repo.operationalHistory(e.execution_id);
      return { e, resumed, view, cursor: await repo.checkpoint() };
    };
    expect(await exercise(pg)).toEqual(await exercise(native));
    await pg.close();
    nativeDb.close();
  });
  it('reserves one campaign/date under contention and prevents duplicate run ownership', async () => {
    const a = await plans.open(),
      b = await plans.open();
    const pair = await Promise.all([
      a.schedule(schedule, {}, at),
      b.schedule(schedule, {}, at),
    ]);
    expect(pair[0]).toEqual(pair[1]);
    const claims = await Promise.all([
      a.claim(pair[0].execution_id, at, 1000),
      b.claim(pair[0].execution_id, at, 1000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(
      b.schedule({ ...schedule, runId: 'run_changed' }, {}, at),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_DAY_CONFLICT' });
    await expect(
      b.schedule({ ...schedule, scheduledAt: '2026-10-12T12:00:00Z' }, {}, at),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_RUN_CONFLICT' });
    expect(
      (await db.query('SELECT count(*) FROM campaign.campaign_executions'))
        .rows[0].count,
    ).toBe('1');
    await a.close();
    await b.close();
  });
  it('rolls back a failed execution/event reservation and preserves rollback-safe cursors', async () => {
    await db.query(
      "CREATE FUNCTION campaign.reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER reject_event BEFORE INSERT ON campaign.campaign_execution_events FOR EACH ROW EXECUTE FUNCTION campaign.reject_event()",
    );
    const repo = await plans.open();
    await expect(repo.schedule(schedule, {}, at)).rejects.toThrow();
    expect(
      (await db.query('SELECT count(*) FROM campaign.campaign_executions'))
        .rows[0].count,
    ).toBe('0');
    await db.query(
      'DROP TRIGGER reject_event ON campaign.campaign_execution_events',
    );
    const e = await repo.schedule(schedule, {}, at);
    expect((await repo.operationalHistory(e.execution_id))[0].cursor).toBe(1);
    await repo.close();
  });
  it('commits claims and step audit before invoking a controlled workflow and replays without work', async () => {
    const repo = await plans.open();
    const e = await repo.schedule(schedule, {}, at);
    const effect = vi.fn(async () => {
      expect(
        (
          await db.query(
            'SELECT event_type FROM campaign.campaign_execution_events ORDER BY event_cursor',
          )
        ).rows.map((r) => r.event_type),
      ).toEqual(['SCHEDULED', 'CLAIMED', 'STEP_STARTED']);
      return { artifact: 'fixture' };
    });
    const workflow = {
      steps: ['FIXTURE'],
      execute: effect,
      reconcile: async () => null,
    };
    await Promise.all([
      new CampaignOrchestrator(repo, workflow, () => at).tick(),
      new CampaignOrchestrator(repo, workflow, () => at).tick(),
    ]);
    expect((await repo.get(e.execution_id)).status).toBe('SUCCEEDED');
    expect(effect).toHaveBeenCalledTimes(1);
    await new CampaignOrchestrator(repo, workflow, () => at).tick();
    expect(effect).toHaveBeenCalledTimes(1);
    await repo.close();
  });
  it('never starts a workflow effect if the step audit transaction fails', async () => {
    const repo = await plans.open();
    await repo.schedule(schedule, {}, at);
    await db.query(
      "CREATE FUNCTION campaign.reject_start() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='STEP_STARTED' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_start BEFORE INSERT ON campaign.campaign_execution_events FOR EACH ROW EXECUTE FUNCTION campaign.reject_start()",
    );
    const effect = vi.fn(async () => ({ ok: true }));
    await expect(
      new CampaignOrchestrator(
        repo,
        { steps: ['FIXTURE'], execute: effect, reconcile: async () => null },
        () => at,
      ).tick(),
    ).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
    await repo.close();
  });
  it('retains cross-domain gates without evaluating external callbacks', async () => {
    const repo = await plans.open(),
      callback = vi.fn(() => true),
      e = await repo.schedule(schedule, {}, at);
    await expect(
      repo.claimNotification(
        {
          executionId: e.execution_id,
          key: 'notify_001',
          kind: 'fixture',
          sourceIdentity: 'fixture',
          destinationId: 'fixture',
          messageHash: 'a'.repeat(64),
        },
        callback,
        at,
      ),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_CROSS_DOMAIN_REQUIRED' });
    await expect(
      repo.scheduleCatalog({}, at, () => {
        callback();
        return {};
      }),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_CROSS_DOMAIN_REQUIRED' });
    await expect(
      repo.reviseComposition(e.execution_id, 1, at, {}),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_CROSS_DOMAIN_REQUIRED' });
    expect(callback).not.toHaveBeenCalled();
    expect(
      (await repo.history(e.execution_id)).map((r) => r.event_type),
    ).toEqual(['SCHEDULED']);
    await repo.close();
  });
  it('supports HTTP opt-in without opening native modules, scheduling or external providers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at));
    const network = vi.fn(() => {
      throw new Error('No business network permitted');
    });
    vi.stubGlobal('fetch', network);
    const workflow = {
      steps: ['FIXTURE'],
      validate: async () => {},
      execute: vi.fn(async () => ({ fixture: true })),
      reconcile: async () => null,
    };
    const module = await Test.createTestingModule({
        imports: [
          OperationsModule.postgres(getTestPostgresConfig(), { workflow }),
        ],
      }).compile(),
      app = module.createNestApplication();
    await app.init();
    try {
      const body = {
        schemaVersion: 'pipeline-handoff/1.0.0',
        pipelineRunId: 'run_http_001',
        projectId: 'project_001',
        projectVersion: 1,
        startedAt: at,
      };
      await request(app.getHttpServer())
        .post('/content-operations/runs')
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .get('/content-operations/runs/run_http_001/checkpoints')
        .expect(200);
      await request(app.getHttpServer())
        .get('/content-operations/runs/run_missing')
        .expect(404);
      const input = {
        ...schedule,
        runId: 'run_http_campaign',
        mode: 'LOCAL_VALIDATION',
        run: body,
        briefingId: 'brief_fixture',
        researchShortlistId: null,
        generationRequestId: 'generation_fixture',
      };
      const result = await request(app.getHttpServer())
        .post('/content-operations/campaign-executions')
        .send(input)
        .expect(201);
      await request(app.getHttpServer())
        .get(
          '/content-operations/campaign-executions/' + result.body.execution_id,
        )
        .expect(200);
      expect(workflow.execute).not.toHaveBeenCalled();
      await app
        .get<CampaignAdministrationRuntime<true>>(CampaignAdministration)
        .tick();
      expect(workflow.execute).toHaveBeenCalledTimes(1);
      await request(app.getHttpServer())
        .get(
          '/content-operations/campaign-executions/' +
            result.body.execution_id +
            '/history',
        )
        .expect(200);
      await request(app.getHttpServer())
        .post('/content-operations/campaign-executions/local')
        .send({})
        .expect(409);
      expect(network).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('protects immutable history, foreign keys, read-only and closed handles', async () => {
    const pg = await ops.open();
    await pg.startRun(start(snapshot));
    await expect(
      db.query('DELETE FROM campaign.pipeline_run_transitions'),
    ).rejects.toMatchObject({ sqlState: 'P5001' });
    await expect(
      db.query(
        "INSERT INTO campaign.pipeline_run_recoveries(pipeline_run_id,previous_state,next_state,changed_at) VALUES('missing_run','FAILED','RUNNING',$1)",
        [at],
      ),
    ).rejects.toMatchObject({ sqlState: '23503' });
    const ro = await ops.open(true);
    expect((await ro.getRun('run_pg_001'))?.pipelineRunId).toBe('run_pg_001');
    await expect(
      ro.startRun(start(snapshot, 'run_readonly')),
    ).rejects.toThrow();
    await ro.close();
    await pg.close();
    await expect(pg.getRun('run_pg_001')).rejects.toMatchObject({
      code: 'CAMPAIGN_HANDLE_CLOSED',
    });
    const repo = await plans.open(),
      e = await repo.schedule(schedule, {}, at),
      claim = await repo.claim(e.execution_id, at, 1000);
    await repo.recover('2026-10-11T12:00:02.000Z');
    await expect(
      repo.ownedEvent(
        e.execution_id,
        claim!.claim_token!,
        '2026-10-11T12:00:02.000Z',
        'STEP_DONE',
        {},
      ),
    ).rejects.toMatchObject({ code: 'CLAIM_LOST' });
    await expect(
      repo.resume(e.execution_id, at, 2, { verified: true }),
    ).rejects.toMatchObject({ code: 'EXECUTION_VERSION_CONFLICT' });
    await repo.close();
  });
  it('rejects missing provisioning without creating schemas or rewriting migrations', async () => {
    await db.query('DROP SCHEMA campaign CASCADE');
    await db.query('DELETE FROM platform.schema_migrations WHERE version=5');
    await expect(ops.open()).rejects.toMatchObject({
      code: 'CAMPAIGN_SCHEMA_VERSION_UNSUPPORTED',
    });
    expect(
      (
        await db.query(
          "SELECT pg_catalog.to_regnamespace('campaign') AS schema",
        )
      ).rows[0].schema,
    ).toBeNull();
  });

  it('preserves fixed recurrence history, command replay and campaign/date reservation', async () => {
    const pg = await plans.open(),
      nativeDb = new DatabaseSync(fixture.path),
      native = new CampaignRepository(nativeDb),
      seed = {
        ...schedule,
        run: { projectVersion: 1 },
        selectionMode: 'FIXED',
      };
    vi.mocked(randomUUID).mockReturnValue(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(await pg.configureRecurrence(seed, true, 'config_one', at)).toEqual(
      native.configureRecurrence(seed, true, 'config_one', at),
    );
    expect(await pg.recurrences()).toEqual(native.recurrences());
    const next = {
        ...seed,
        runId: 'run_next',
        scheduledAt: '2026-10-12T12:00:00.000Z',
      },
      config = (await pg.recurrences())[0].config;
    vi.mocked(randomUUID).mockReturnValue(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(await pg.scheduleRecurring(config, next, at)).toEqual(
      native.scheduleRecurring(config, next, at),
    );
    expect(
      await pg.configureRecurrence(seed, false, 'config_disable', at),
    ).toEqual(native.configureRecurrence(seed, false, 'config_disable', at));
    expect(await pg.recurrences()).toEqual([]);
    expect(await pg.configureRecurrence(seed, true, 'config_one', at)).toEqual(
      native.configureRecurrence(seed, true, 'config_one', at),
    );
    await pg.close();
    nativeDb.close();
  });
  it('keeps execution and history in one snapshot while another worker advances the claim', async () => {
    const reader = await plans.open(true),
      writer = await plans.open(),
      scheduled = await writer.schedule(schedule, {}, at);
    const view = await reader.readSnapshot(async (repo) => {
      const execution = await repo.get(scheduled.execution_id);
      await writer.claim(scheduled.execution_id, at, 1000);
      return { execution, history: await repo.history(scheduled.execution_id) };
    });
    expect(view.execution.status).toBe('SCHEDULED');
    expect(view.history.map((event) => event.event_type)).toEqual([
      'SCHEDULED',
    ]);
    expect((await writer.get(scheduled.execution_id)).status).toBe('RUNNING');
    await reader.close();
    await writer.close();
  });
});
