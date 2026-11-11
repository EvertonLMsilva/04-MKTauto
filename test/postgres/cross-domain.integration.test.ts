import {
  PostgresDatabase,
  PostgresMigrationRunner,
  postgresMigrationChecksum,
} from '../../src/infrastructure/database/postgres/index.js';
import { CAMPAIGN_POSTGRES_MIGRATION_REGISTRY as migrations } from '../../src/modules/content-operations/infrastructure/postgres-campaign.migrations.js';
import {
  assertDisposableDatabase,
  getTestPostgresConfig,
} from './test-database.js';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PostgresAffiliatePersistence } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.persistence.js';
import { PostgresAffiliateSessionFactory } from '../../src/modules/affiliate/infrastructure/postgres-affiliate.session.js';
import { AffiliateRunContextService } from '../../src/modules/affiliate/application/affiliate-run-context.service.js';
import {
  PostgresOperationsPersistence,
  PostgresCampaignPersistence,
} from '../../src/modules/content-operations/infrastructure/postgres-campaign.persistence.js';
import { PostgresProjectPersistence } from '../../src/modules/project/infrastructure/postgres-project.persistence.js';
import { PostgresContentPersistence } from '../../src/modules/content/infrastructure/postgres-content.persistence.js';
import { ContentModule } from '../../src/modules/content/content.module.js';
import { OperationsModule } from '../../src/modules/operations/operations.module.js';
import { CampaignAdministration } from '../../src/modules/content-operations/application/campaign-administration.js';
import { CampaignOrchestrator } from '../../src/modules/content-operations/application/campaign-orchestrator.js';
import { affiliateHash } from '../../src/modules/affiliate/domain/affiliate-contracts.js';
import { scriptContentHash } from '../../src/modules/content/domain/script-contracts.js';
import { script } from './content-fixture.js';
import {
  project,
  product,
  campaign,
  at,
  sqliteAffiliateFixture,
} from './affiliate-fixture.js';
import { SqliteAffiliateRepository } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate.repository.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/modules/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { SqliteOperationsRepository } from '../../src/modules/content-operations/infrastructure/sqlite-operations.repository.js';

const domains = ['content', 'affiliate', 'campaign'] as const;
const runId = 'run_cross_001';
const bindingInput = { pipelineRunId: runId, briefingId: 'brief_cross_001' };
const identity = {
  generationRequestId: 'generation_cross_001',
  contentHash: 'c'.repeat(64),
};
const start = (snapshot: any, id = runId) => ({
  execution: {
    pipelineRunId: id,
    projectId: 'project_001',
    projectVersion: 1,
    startedAt: at,
  },
  projectSnapshot: snapshot,
});
function editorial(briefing: any, id = runId) {
  const body = {
    schemaVersion: 'affiliate-editorial-selection/1.0.0',
    selectionId: 'editorial_cross_001',
    pipelineRunId: id,
    projectId: 'project_001',
    projectVersion: 1,
    briefingId: briefing.briefingId,
    briefingHash: briefing.contentHash,
    evidenceRefs: ['ev_spec', 'ev_rights'],
    title: 'Conheça este fone',
    editorialAngle: 'Conectividade no cotidiano',
    decision: 'SELECTED',
    actor: { type: 'HUMAN', id: 'operator_001' },
    decidedAt: at,
  };
  return { ...body, contentHash: affiliateHash(body) };
}
function commercial(selection: any, briefing: any) {
  const value = script(selection, {
    schemaVersion: 'script/2.0.0',
    editorialSelectionId: selection.selectionId,
    editorialSelectionContentHash: selection.contentHash,
    cta: briefing.cta,
    createdAt: at,
  });
  for (const key of [
    'ideaSelectionId',
    'ideaSelectionContentHash',
    'ideaCandidateId',
    'ideaContentHash',
  ])
    delete value[key];
  value.contentHash = scriptContentHash(value);
  return value;
}

describe('Cross-domain real PostgreSQL unit of work', () => {
  let db: PostgresDatabase;
  let snapshot: any, briefing: any;
  let contexts: AffiliateRunContextService<true>;
  let affiliate: PostgresAffiliatePersistence;
  let operations: PostgresOperationsPersistence;
  let content: PostgresContentPersistence;
  beforeAll(async () => {
    db = new PostgresDatabase(getTestPostgresConfig());
    await assertDisposableDatabase(db);
  });
  beforeEach(async () => {
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
    const projects = await new PostgresProjectPersistence(db).open();
    snapshot = await projects.create(project(), { createdAt: at });
    await projects.close();
    const catalog = await new PostgresAffiliatePersistence(
      new PostgresAffiliateSessionFactory(db, {
        executions: { getRun: () => null },
        activity: { hasStarted: () => false },
      }),
    ).open();
    await catalog.registerProduct(product(), 'product_cross');
    await catalog.registerCampaign(campaign(), 'campaign_cross', true);
    briefing = await catalog.createBriefing(
      {
        briefingId: bindingInput.briefingId,
        campaignId: 'camp_001',
        campaignRevision: 1,
      },
      'brief_cross',
      true,
    );
    await catalog.close();
    affiliate = new PostgresAffiliatePersistence(
      new PostgresAffiliateSessionFactory(db, undefined, true),
    );
    contexts = new AffiliateRunContextService<true>(affiliate);
    operations = new PostgresOperationsPersistence(db);
    content = PostgresContentPersistence.coordinated(db);
    const ops = await operations.open();
    await ops.startRun(start(snapshot));
    await ops.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await db?.close();
  });
  it('preserves v1-v5 and uses one backend and transaction for explicitly enlisted queries', async () => {
    expect(
      (
        await db.query(
          'SELECT version,checksum FROM platform.schema_migrations ORDER BY version',
        )
      ).rows,
    ).toEqual(
      migrations.map((m) => ({
        version: m.version,
        checksum: postgresMigrationChecksum(m.sql),
      })),
    );
    await db.unitOfWork(['campaign', 'affiliate', 'content'], async () => {
      const identities = [];
      for (const participant of ['campaign', 'affiliate', 'content'] as const)
        identities.push(
          (
            await db.query(
              'SELECT pg_catalog.pg_backend_pid() AS pid, pg_catalog.txid_current()::text AS tx',
              [],
              participant,
            )
          ).rows[0],
        );
      expect(identities[1]).toEqual(identities[0]);
      expect(identities[2]).toEqual(identities[0]);
    });
  });
  it('rejects pool escapes and expanding nested participants, even if the caller catches the error', async () => {
    await expect(
      db.unitOfWork(['affiliate'], async () => {
        await expect(db.query('SELECT 1')).rejects.toMatchObject({
          code: 'POSTGRES_PARTICIPATION_REQUIRED',
        });
      }),
    ).rejects.toMatchObject({ code: 'POSTGRES_UNIT_OF_WORK_ABORTED' });
    await expect(
      db.unitOfWork(['campaign'], async () => {
        await expect(
          db.unitOfWork(['affiliate'], async () => undefined),
        ).rejects.toMatchObject({ code: 'POSTGRES_PARTICIPANT_NOT_ENLISTED' });
      }),
    ).rejects.toMatchObject({ code: 'POSTGRES_UNIT_OF_WORK_ABORTED' });
  });
  it('uses one physical BEGIN/COMMIT and zero pool queries for real repositories', async () => {
    let pool!: Pool;
    const observed = new PostgresDatabase(
      { ...getTestPostgresConfig(), max: 1 },
      (options) => (pool = new Pool(options)),
    );
    try {
      await assertDisposableDatabase(observed);
      const client = await pool.connect();
      const queries = vi.spyOn(client, 'query');
      client.release();
      const connections = vi.spyOn(pool, 'connect');
      const independent = vi.spyOn(pool, 'query');
      await observed.unitOfWork(
        ['campaign', 'content', 'affiliate'],
        async () => {
          const ctx = new AffiliateRunContextService<true>(
            new PostgresAffiliatePersistence(
              new PostgresAffiliateSessionFactory(observed, undefined, true),
            ),
          );
          await ctx.bindRun(bindingInput, 'bind_cross');
          await ctx.prepareScriptGeneration(identity, runId);
          const repo =
            await PostgresContentPersistence.coordinated(observed).open();
          await repo.registerAffiliateEditorialSelection(editorial(briefing));
          await repo.close();
        },
      );
      expect(connections).toHaveBeenCalledTimes(1);
      expect(independent).not.toHaveBeenCalled();
      const sql = queries.mock.calls.map(([arg]) =>
        typeof arg === 'string' ? arg : (arg as any).text,
      );
      expect(sql.filter((text) => text === 'BEGIN')).toHaveLength(1);
      expect(sql.filter((text) => text === 'COMMIT')).toHaveLength(1);
      expect(sql.filter((text) => text === 'ROLLBACK')).toHaveLength(0);
      expect(
        queries.mock.calls
          .filter(
            ([arg]) =>
              typeof arg === 'string' && arg.includes('pg_advisory_xact_lock'),
          )
          .map(([, values]) => values),
      ).toEqual([
        [1296782401, 3],
        [1296782401, 4],
        [1296782401, 5],
      ]);
    } finally {
      vi.restoreAllMocks();
      await observed.close();
    }
  });
  it('commits Campaign claim, Affiliate binding/context and canonical Content script atomically', async () => {
    const result = await db.unitOfWork(domains, async () => {
      const binding = await contexts.bindRun(bindingInput, 'bind_cross');
      await contexts.prepareScriptGeneration(
        identity,
        runId,
        briefing.briefingId,
      );
      const store = await content.open();
      const selection = await store.registerAffiliateEditorialSelection(
        editorial(briefing),
      );
      const value = commercial(selection, briefing);
      expect(await store.registerScript(value)).toEqual(value);
      await store.close();
      const plans = await new PostgresCampaignPersistence(db).open();
      const scheduled = await plans.schedule(
        { campaignId: 'camp_001', campaignRevision: 1, scheduledAt: at, runId },
        {},
        at,
      );
      const claim = await plans.claim(scheduled.execution_id, at, 1000);
      await plans.close();
      return { binding, claim, value };
    });
    expect(result.claim?.status).toBe('RUNNING');
    expect(await contexts.getRunBinding(runId)).toEqual(result.binding);
    const stored = await content.open(true);
    expect(await stored.getScript(result.value.scriptId)).toEqual(result.value);
    await stored.close();
  });
  it('rolls back all participating schemas and receipts after an intermediate failure', async () => {
    const effect = vi.fn();
    await expect(
      db
        .unitOfWork(domains, async () => {
          const ops = await operations.open();
          await ops.startRun(start(snapshot, 'run_rolled_back'));
          await ops.close();
          await contexts.bindRun(
            { ...bindingInput, pipelineRunId: 'run_rolled_back' },
            'bind_rollback',
          );
          await contexts.prepareScriptGeneration(identity, 'run_rolled_back');
          const repo = await content.open();
          await repo.registerAffiliateEditorialSelection(
            editorial(briefing, 'run_rolled_back'),
          );
          await repo.close();
          throw new Error('injected failure');
        })
        .then(effect),
    ).rejects.toThrow('injected failure');
    expect(effect).not.toHaveBeenCalled();
    for (const relation of [
      'affiliate.affiliate_run_bindings',
      'affiliate.affiliate_script_contexts',
      'content.affiliate_editorial_selections',
      'content.artifact_lineage',
    ])
      expect(
        (await db.query(`SELECT count(*) FROM ${relation}`)).rows[0].count,
      ).toBe('0');
    expect(
      (
        await db.query(
          "SELECT count(*) FROM campaign.pipeline_runs WHERE pipeline_run_id='run_rolled_back'",
        )
      ).rows[0].count,
    ).toBe('0');
    expect(
      (
        await db.query(
          "SELECT count(*) FROM affiliate.affiliate_commands WHERE idempotency_key='bind_rollback'",
        )
      ).rows[0].count,
    ).toBe('0');
  });
  it('preserves binding replay, receipt hashes and script reservation identity across restart', async () => {
    const first = await contexts.bindRun(bindingInput, 'bind_cross');
    const rows = (
      await db.query(
        "SELECT result_json::text AS json,result_hash FROM affiliate.affiliate_commands WHERE idempotency_key='bind_cross'",
      )
    ).rows;
    await contexts.prepareScriptGeneration(identity, runId);
    const restarted = new AffiliateRunContextService<true>(
      new PostgresAffiliatePersistence(
        new PostgresAffiliateSessionFactory(db, undefined, true),
      ),
    );
    expect(await restarted.bindRun(bindingInput, 'bind_cross')).toEqual(first);
    expect(await restarted.prepareScriptGeneration(identity, runId)).toEqual(
      briefing,
    );
    expect(
      (
        await db.query(
          "SELECT result_json::text AS json,result_hash FROM affiliate.affiliate_commands WHERE idempotency_key='bind_cross'",
        )
      ).rows,
    ).toEqual(rows);
    await expect(
      restarted.prepareScriptGeneration(
        { ...identity, contentHash: 'd'.repeat(64) },
        runId,
      ),
    ).rejects.toMatchObject({ code: 'AFFILIATE_SCRIPT_CONTEXT_CONFLICT' });
    expect(
      (
        await db.query(
          'SELECT count(*) FROM affiliate.affiliate_script_contexts',
        )
      ).rows[0].count,
    ).toBe('1');
  });
  it('serializes competing bindings and never creates duplicate receipts or bindings', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        contexts.bindRun(bindingInput, 'bind_cross'),
      ),
    );
    for (const result of results) expect(result).toEqual(results[0]);
    expect(
      (await db.query('SELECT count(*) FROM affiliate.affiliate_run_bindings'))
        .rows[0].count,
    ).toBe('1');
    const other = await affiliate.open();
    await other.createBriefing(
      {
        briefingId: 'brief_other',
        campaignId: 'camp_001',
        campaignRevision: 1,
      },
      'brief_other',
      true,
    );
    await other.close();
    await expect(
      contexts.bindRun(
        { ...bindingInput, briefingId: 'brief_other' },
        'bind_other',
      ),
    ).rejects.toMatchObject({ code: 'AFFILIATE_RUN_BINDING_CONFLICT' });
  });
  it('revalidates activity after waiting for a script context reservation and refuses a late binding', async () => {
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generation = db.unitOfWork(domains, async () => {
      await contexts.prepareScriptGeneration(identity, runId);
      entered();
      await gate;
    });
    await ready;
    const bind = contexts.bindRun(bindingInput, 'bind_late');
    release();
    await generation;
    await expect(bind).rejects.toMatchObject({
      code: 'AFFILIATE_RUN_BINDING_TOO_LATE',
    });
    expect(await contexts.getRunBinding(runId)).toBeNull();
    expect(
      (
        await db.query(
          "SELECT count(*) FROM affiliate.affiliate_commands WHERE idempotency_key='bind_late'",
        )
      ).rows[0].count,
    ).toBe('0');
  });
  it('serializes binding before a competing reservation, preserving the chosen briefing hash', async () => {
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const binding = db.unitOfWork(domains, async () => {
      await contexts.bindRun(bindingInput, 'bind_cross');
      entered();
      await gate;
    });
    await ready;
    const reservation = contexts.prepareScriptGeneration(identity, runId);
    release();
    await binding;
    expect(await reservation).toEqual(briefing);
    expect(
      (
        await db.query(
          'SELECT briefing_hash FROM affiliate.affiliate_script_contexts',
        )
      ).rows,
    ).toEqual([{ briefing_hash: briefing.contentHash }]);
  });
  it('rejects missing runs, terminal runs, orphan inserts and forged context hashes', async () => {
    await expect(
      contexts.bindRun(
        { ...bindingInput, pipelineRunId: 'run_missing' },
        'bind_missing',
      ),
    ).rejects.toMatchObject({ code: 'PIPELINE_RUN_NOT_FOUND' });
    await expect(
      contexts.prepareScriptGeneration(identity, 'run_missing'),
    ).rejects.toMatchObject({ code: 'PIPELINE_RUN_NOT_FOUND' });
    const repo = await affiliate.open();
    await expect(
      repo.insertScriptContext({
        generationRequestId: identity.generationRequestId,
        requestHash: identity.contentHash,
        pipelineRunId: runId,
        briefingHash: 'e'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'AFFILIATE_SCRIPT_CONTEXT_CONFLICT' });
    await repo.close();
    const ops = await operations.open();
    await ops.transitionRun({
      pipelineRunId: runId,
      nextState: 'SUCCEEDED',
      completedAt: at,
    });
    await ops.close();
    await expect(
      contexts.bindRun(bindingInput, 'bind_terminal'),
    ).rejects.toMatchObject({ code: 'AFFILIATE_RUN_BINDING_TOO_LATE' });
    expect(
      (
        await db.query(
          'SELECT count(*) FROM affiliate.affiliate_script_contexts',
        )
      ).rows[0].count,
    ).toBe('0');
  });
  it('preserves read-only handles inside a writable unit and rejects work from an ended async context', async () => {
    await expect(
      db.unitOfWork(domains, async () => {
        const repo = await affiliate.open(true);
        try {
          await repo.registerProduct(
            product({ productId: 'prod_readonly' }),
            'readonly',
          );
        } finally {
          await repo.close();
        }
      }),
    ).rejects.toThrow();
    let delayed!: Promise<unknown>, release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await db.unitOfWork(domains, async () => {
      delayed = gate
        .then(() => db.query('SELECT 1', [], 'affiliate'))
        .catch((error) => error);
    });
    release();
    expect(await delayed).toMatchObject({
      code: 'POSTGRES_UNIT_OF_WORK_ENDED',
    });
  });
  it('matches SQLite run binding, script context and receipt JSON without changing native paths', async () => {
    const fixture = sqliteAffiliateFixture();
    try {
      const catalog = new SqliteAffiliateRepository(fixture.path);
      catalog.registerProduct(product(), 'product_cross');
      catalog.registerCampaign(campaign(), 'campaign_cross', true);
      catalog.createBriefing(
        {
          briefingId: bindingInput.briefingId,
          campaignId: 'camp_001',
          campaignRevision: 1,
        },
        'brief_cross',
        true,
      );
      const ops = new SqliteOperationsRepository(fixture.path);
      ops.startRun(start(snapshot));
      ops.close();
      const native = new AffiliateRunContextService(
        new SqliteAffiliateRunContextPersistence(fixture.path),
      );
      expect(await contexts.bindRun(bindingInput, 'bind_cross')).toEqual(
        native.bindRun(bindingInput, 'bind_cross'),
      );
      expect(await contexts.prepareScriptGeneration(identity, runId)).toEqual(
        native.prepareScriptGeneration(identity, runId),
      );
      expect(
        (await db.query('SELECT * FROM affiliate.affiliate_script_contexts'))
          .rows,
      ).toEqual(
        catalog.db.prepare('SELECT * FROM affiliate_script_contexts').all(),
      );
      expect(
        (
          await db.query(
            "SELECT result_json::text AS json,result_hash FROM affiliate.affiliate_commands WHERE idempotency_key='bind_cross'",
          )
        ).rows,
      ).toEqual(
        catalog.db
          .prepare(
            "SELECT result_json AS json,result_hash FROM affiliate_commands WHERE idempotency_key='bind_cross'",
          )
          .all(),
      );
      catalog.close();
    } finally {
      fixture.cleanup();
    }
  });
  it('refuses another pool and refuses upgrading an already locked isolated session', async () => {
    const other = new PostgresDatabase(getTestPostgresConfig());
    try {
      await expect(
        db.unitOfWork(domains, async () => {
          await expect(
            other.query('SELECT 1', [], 'affiliate'),
          ).rejects.toMatchObject({ code: 'POSTGRES_DIFFERENT_DATABASE' });
        }),
      ).rejects.toMatchObject({ code: 'POSTGRES_UNIT_OF_WORK_ABORTED' });
    } finally {
      await other.close();
    }
    const plans = await new PostgresCampaignPersistence(db).open();
    try {
      await expect(
        plans.readSnapshot(async () =>
          contexts.bindRun(bindingInput, 'bind_upgrade'),
        ),
      ).rejects.toMatchObject({ code: 'POSTGRES_UNIT_OF_WORK_REQUIRES_ROOT' });
      expect(await contexts.getRunBinding(runId)).toBeNull();
    } finally {
      await plans.close();
    }
  });
  it('rolls back a swallowed participant failure and never opens an implicit second transaction', async () => {
    await expect(
      db.unitOfWork(domains, async () => {
        await contexts.bindRun(bindingInput, 'bind_swallowed');
        await expect(
          db.transaction(async () => undefined),
        ).rejects.toMatchObject({ code: 'POSTGRES_PARTICIPATION_REQUIRED' });
      }),
    ).rejects.toMatchObject({ code: 'POSTGRES_UNIT_OF_WORK_ABORTED' });
    expect(await contexts.getRunBinding(runId)).toBeNull();
    await expect(
      db.unitOfWork(domains, async () => {
        await contexts.bindRun(bindingInput, 'bind_failed');
        await expect(
          db.transaction(async () => {
            throw new Error('domain rejection');
          }, 'content'),
        ).rejects.toThrow('domain rejection');
      }),
    ).rejects.toMatchObject({ code: 'POSTGRES_UNIT_OF_WORK_ABORTED' });
    expect(await contexts.getRunBinding(runId)).toBeNull();
  });
  it('sanitizes a participating driver failure before exposing it to the caller', async () => {
    await expect(
      db.unitOfWork(domains, async () => {
        await contexts.bindRun(bindingInput, 'bind_driver_failure');
        await expect(
          db.transaction(async (client) => {
            await client.query(
              "SELECT missing_cross_domain_function('synthetic_private_value')",
            );
          }, 'content'),
        ).rejects.toMatchObject({
          code: 'POSTGRES_TRANSACTION_FAILED',
          sqlState: '42883',
          message: 'POSTGRES_TRANSACTION_FAILED',
        });
      }),
    ).rejects.toMatchObject({ code: 'POSTGRES_UNIT_OF_WORK_ABORTED' });
    expect(await contexts.getRunBinding(runId)).toBeNull();
  });
  it('competes with a real Campaign SCRIPT attempt under the same domain lock', async () => {
    const ops = await operations.open();
    try {
      await ops.stages.startAttempt(
        {
          schemaVersion: 'stage-recovery/1.0.0',
          pipelineRunId: runId,
          stage: 'SCRIPT',
          requestHash: identity.contentHash,
          inputs: [],
          policyVersions: { script: 'fixture/1' },
          providerConfigHash: null,
        },
        { trigger: 'INITIAL', startedAt: at },
      );
      await expect(
        contexts.bindRun(bindingInput, 'bind_activity'),
      ).rejects.toMatchObject({ code: 'AFFILIATE_RUN_BINDING_TOO_LATE' });
      expect(await contexts.getRunBinding(runId)).toBeNull();
    } finally {
      await ops.close();
    }
  });
  it('rejects competing reservation identities and rolls back a losing transaction completely', async () => {
    const results = await Promise.allSettled([
      contexts.prepareScriptGeneration(identity, runId),
      contexts.prepareScriptGeneration(
        { ...identity, contentHash: 'd'.repeat(64) },
        runId,
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'AFFILIATE_SCRIPT_CONTEXT_CONFLICT' },
    });
    expect(
      (
        await db.query(
          'SELECT count(*) FROM affiliate.affiliate_script_contexts',
        )
      ).rows[0].count,
    ).toBe('1');
  });
  it('rolls back Content script/lineage and Campaign claim/audit with the binding and reservation', async () => {
    await expect(
      db.unitOfWork(domains, async () => {
        await contexts.bindRun(bindingInput, 'bind_all_rollback');
        await contexts.prepareScriptGeneration(identity, runId);
        const store = await content.open();
        const selected = await store.registerAffiliateEditorialSelection(
          editorial(briefing),
        );
        await store.registerScript(commercial(selected, briefing));
        await store.close();
        const plans = await new PostgresCampaignPersistence(db).open();
        const execution = await plans.schedule(
          {
            campaignId: 'camp_001',
            campaignRevision: 1,
            scheduledAt: at,
            runId,
          },
          {},
          at,
        );
        await plans.claim(execution.execution_id, at, 1000);
        await plans.close();
        throw new Error('after final participant write');
      }),
    ).rejects.toThrow('after final participant write');
    for (const relation of [
      'content.scripts',
      'content.artifact_lineage',
      'content.artifact_lineage_inputs',
      'campaign.campaign_executions',
      'campaign.campaign_execution_events',
      'affiliate.affiliate_run_bindings',
      'affiliate.affiliate_script_contexts',
    ])
      expect(
        (await db.query(`SELECT count(*) FROM ${relation}`)).rows[0].count,
      ).toBe('0');
    expect(
      (
        await db.query(
          "SELECT count(*) FROM affiliate.affiliate_commands WHERE idempotency_key='bind_all_rollback'",
        )
      ).rows[0].count,
    ).toBe('0');
  });
  it('executes a local workflow only after the coordinated binding and durable Campaign claim/audit', async () => {
    const observer = new PostgresDatabase(getTestPostgresConfig());
    const plans = await new PostgresCampaignPersistence(db).open();
    try {
      const execution = await db.unitOfWork(domains, async () => {
        await contexts.bindRun(bindingInput, 'bind_before_effect');
        await contexts.prepareScriptGeneration(identity, runId);
        return plans.schedule(
          {
            campaignId: 'camp_001',
            campaignRevision: 1,
            scheduledAt: at,
            runId,
          },
          {},
          at,
        );
      });
      const effect = vi.fn(async () => {
        expect(
          (
            await observer.query(
              'SELECT count(*) FROM affiliate.affiliate_run_bindings',
            )
          ).rows[0].count,
        ).toBe('1');
        expect(
          (
            await observer.query(
              'SELECT count(*) FROM affiliate.affiliate_script_contexts',
            )
          ).rows[0].count,
        ).toBe('1');
        expect(
          (
            await observer.query(
              'SELECT status,claim_token FROM campaign.campaign_executions',
            )
          ).rows[0],
        ).toMatchObject({ status: 'RUNNING', claim_token: expect.any(String) });
        expect(
          (
            await observer.query(
              "SELECT count(*) FROM campaign.campaign_execution_events WHERE event_type='STEP_STARTED'",
            )
          ).rows[0].count,
        ).toBe('1');
        return { fixture: true };
      });
      await new CampaignOrchestrator(
        plans,
        { steps: ['FIXTURE'], execute: effect, reconcile: async () => null },
        () => at,
      ).tick(execution.execution_id);
      expect(effect).toHaveBeenCalledTimes(1);
    } finally {
      await plans.close();
      await observer.close();
    }
  });
  it('integrates real Nest HTTP bindings and manual Content while preserving commercial guards', async () => {
    const compiled = await Test.createTestingModule({
      imports: [
        OperationsModule.postgres(getTestPostgresConfig(), {
          coordinateAffiliate: true,
        }),
        ContentModule.postgres(getTestPostgresConfig(), undefined, {
          coordinateCampaignAffiliate: true,
        }),
      ],
    }).compile();
    const app = compiled.createNestApplication();
    await app.init();
    try {
      const result = await request(app.getHttpServer())
        .post('/affiliate/run-bindings')
        .send({ ...bindingInput, idempotencyKey: 'bind_http' })
        .expect(201);
      expect(result.body.briefingHash).toBe(briefing.contentHash);
      const selected = editorial(briefing);
      await request(app.getHttpServer())
        .post('/content/affiliate-selections')
        .send(selected)
        .expect(201);
      const value = commercial(selected, briefing);
      await request(app.getHttpServer())
        .post('/content/scripts')
        .send(value)
        .expect(201);
      expect(
        (
          await request(app.getHttpServer())
            .get(`/content/scripts/${value.scriptId}`)
            .expect(200)
        ).body,
      ).toEqual(value);
      await request(app.getHttpServer())
        .post('/content/editorial-generations')
        .send({})
        .expect(409)
        .expect((r) =>
          expect(r.body.code).toBe('CONTENT_CROSS_DOMAIN_TRANSACTION_REQUIRED'),
        );
      const admin = app.get(CampaignAdministration);
      await expect(
        admin.startControlledFake({}, 'operator_001'),
      ).rejects.toMatchObject({ code: 'CAMPAIGN_CROSS_DOMAIN_REQUIRED' });
    } finally {
      await app.close();
    }
  });
});
