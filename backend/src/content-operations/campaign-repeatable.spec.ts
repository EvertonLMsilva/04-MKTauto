import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import {
  CampaignOrchestrator,
  executionRequest,
} from './application/campaign-orchestrator.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import { CampaignOrchestrationModule } from './campaign-orchestration.module.js';
import { PublishingPersistence } from '../publishing/infrastructure/publishing.persistence.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { EDITORIAL_PROVIDER } from '../content/application/editorial-provider.port.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { Test } from '@nestjs/testing';
import { validateConfiguration } from '../bootstrap.js';
import {
  NativeCampaignWorkflow,
  campaignRequest,
} from './application/native-campaign-workflow.js';

const hash = 'a'.repeat(64);
const accountId = '17841447654430033';

// Real SQLite/history and NativeCampaignWorkflow; production and Instagram are offline doubles.
function recurringFixture() {
  const f = p2EditorialFixture({ productionProfile: 'MIXED_MEDIA_V2' });
  provisionSchema(f.base.db);
  let at = '2026-11-07T12:00:00.000Z';
  let eligible = true;
  const briefs = new Map<string, any>();
  const affiliate = {
    getCampaign: vi.fn(async () =>
      eligible
        ? {
            campaignId: 'camp_001',
            revision: 1,
            projectId: 'project_001',
          }
        : null,
    ),
    getBriefing: vi.fn(async (id: string) => briefs.get(id) ?? null),
    createBriefing: vi.fn(async (input: any) => {
      const brief = {
        campaignId: 'camp_001',
        campaignRevision: 1,
        mediaRefs: ['authorized-image-001'],
      };
      briefs.set(input.briefingId, brief);
      return brief;
    }),
  };
  const instagram = {
    configuration: () => ({ mode: 'live' }),
    execute: vi.fn(),
  };
  const workflow = new NativeCampaignWorkflow(
    affiliate as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {
      getVideoRender: () => ({ contentHash: hash, revision: 1 }),
      verifyMedia: () => hash,
    } as any,
    {
      getGlobalOperation: () => null,
      getGlobalUsage: () => ({
        dailyUsd: '0',
        monthlyUsd: '0',
        policy: {
          time_zone: 'America/Sao_Paulo',
          daily_usd: '1',
          monthly_usd: '20',
        },
      }),
    } as any,
    {} as any,
    { approvals: () => [] } as any,
    instagram as any,
  );
  const original = workflow.execute.bind(workflow);
  const produce = vi
    .spyOn(workflow, 'execute')
    .mockImplementation(async (step, e, r, done) => {
      if (step === 'HANDOFF' || step === 'PUBLICATION')
        return original(step, e, r, done);
      if (step === 'EDITORIAL') return { script: {} };
      if (step === 'BURN') return { videoRenderId: `render:${e.execution_id}` };
      if (step === 'QC')
        return { result: 'PASS', reportId: `qc:${e.execution_id}` };
      return {};
    });
  const open = (automatic = false) =>
    new CampaignAdministration(f.database, workflow, automatic, () => at);
  let admin = open();
  const input = {
    campaignId: 'camp_001',
    campaignRevision: 1,
    projectVersion: 1,
    requestId: 'recurrence_enable_001',
    requestedAt: at,
    localImage: { mediaReference: 'authorized-image-001' },
  };
  return {
    f,
    input,
    workflow,
    produce,
    instagram,
    get admin() {
      return admin;
    },
    setTime(value: string) {
      at = value;
    },
    ineligible() {
      eligible = false;
    },
    async restart(automatic = false) {
      await admin.onModuleDestroy();
      admin = open(automatic);
      if (automatic) admin.onModuleInit();
    },
    async close() {
      await admin.onModuleDestroy();
      f.cleanup();
    },
  };
}

test('historical and explicitly disabled local requests stay single-shot', async () => {
  const f = recurringFixture();
  try {
    const first = await f.admin.startLocal(f.input);
    expect(await f.admin.startLocal(f.input)).toEqual(first);
    await f.admin.startLocal({ ...f.input, recurrence: { enabled: false } });
    f.setTime('2026-11-09T12:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(1);
    expect(f.admin.get(first.execution_id).status).toBe('WAITING_INPUT');
  } finally {
    await f.close();
  }
});

test('daily recurrence runs at the inherited Sao Paulo time and never carries approvals or publication', async () => {
  const f = recurringFixture();
  try {
    const first = await f.admin.startLocal({
      ...f.input,
      recurrence: { enabled: true },
    });
    await f.admin.tick();
    f.setTime('2026-11-08T11:59:59.999Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(1);
    f.setTime('2026-11-08T12:00:00.000Z');
    await f.admin.tick();
    await f.admin.tick();
    const executions = f.admin.list();
    expect(executions).toHaveLength(2);
    const next = executions.find((e) => e.execution_id !== first.execution_id)!;
    expect(next.scheduled_at).toBe('2026-11-08T12:00:00.000Z');
    const r = executionRequest(f.admin.history(next.execution_id));
    expect(r.campaignRevision).toBe(1);
    expect(r.localImage).toEqual(f.input.localImage);
    expect(r.publication).toBeUndefined();
    expect(r.runId).not.toBe(
      executionRequest(f.admin.history(first.execution_id)).runId,
    );
    for (const e of executions) {
      expect(e.status).toBe('WAITING_INPUT');
      expect(e.finalization.pending?.code).toBe(
        'EXACT_HUMAN_APPROVAL_REQUIRED',
      );
      expect(
        f.admin
          .history(e.execution_id)
          .some((h) => h.event_type === 'HUMAN_APPROVAL'),
      ).toBe(false);
    }
    expect(f.instagram.execute).not.toHaveBeenCalled();
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await f.close();
  }
});

test('explicit disable survives restart; replay of an old enable does not reactivate', async () => {
  const f = recurringFixture();
  try {
    const enabled = { ...f.input, recurrence: { enabled: true } };
    await f.admin.startLocal(enabled);
    await f.admin.startLocal({
      ...f.input,
      requestId: 'recurrence_disable_001',
      recurrence: { enabled: false },
    });
    await f.restart();
    await f.admin.startLocal(enabled);
    f.setTime('2026-11-08T12:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(1);
    const events = f.admin
      .history(f.admin.list()[0].execution_id)
      .filter((e) => e.event_type === 'CAMPAIGN_RECURRENCE_CONFIGURED');
    expect(events.map((e) => e.evidence.enabled)).toEqual([true, false]);
  } finally {
    await f.close();
  }
});

test('restart, concurrent ticks and an existing campaign/date never duplicate production', async () => {
  const f = recurringFixture();
  try {
    await f.admin.startLocal({ ...f.input, recurrence: { enabled: true } });
    await f.admin.startLocal({
      ...f.input,
      requestId: 'manual_day_002',
      requestedAt: '2026-11-08T12:00:00.000Z',
    });
    await f.restart();
    f.setTime('2026-11-08T12:00:00.000Z');
    await Promise.all([f.admin.tick(), f.admin.tick()]);
    expect(f.admin.list()).toHaveLength(2);
    await f.restart();
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(2);
    f.setTime('2026-11-09T12:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(3);
  } finally {
    await f.close();
  }
});

test('local midnight, month rollover and downtime do not backfill past dates', async () => {
  const f = recurringFixture();
  try {
    await f.admin.startLocal({
      ...f.input,
      requestedAt: '2026-11-30T03:00:00.000Z',
      recurrence: { enabled: true },
    });
    f.setTime('2026-12-01T02:59:59.999Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(1);
    f.setTime('2026-12-01T03:00:00.000Z');
    await f.admin.tick();
    expect(
      f.admin
        .list()
        .map((e) => e.production_date)
        .sort(),
    ).toEqual(['2026-11-30', '2026-12-01']);
    await f.restart();
    f.setTime('2027-01-01T03:00:00.000Z');
    await f.admin.tick();
    expect(
      f.admin
        .list()
        .map((e) => e.production_date)
        .sort(),
    ).toEqual(['2026-11-30', '2026-12-01', '2027-01-01']);
  } finally {
    await f.close();
  }
});

test('an ineligible campaign creates no recurring execution and malformed recurrence is rejected', async () => {
  const f = recurringFixture();
  try {
    for (const recurrence of [
      null,
      {},
      { enabled: 'true' },
      { enabled: true, extra: 1 },
    ])
      await expect(
        f.admin.startLocal({ ...f.input, recurrence }),
      ).rejects.toThrow('INVALID_CAMPAIGN_RECURRENCE');
    await f.admin.startLocal({ ...f.input, recurrence: { enabled: true } });
    f.ineligible();
    f.setTime('2026-11-08T12:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(1);
    await f.admin.startLocal({
      ...f.input,
      requestId: 'stop_ineligible_001',
      recurrence: { enabled: false },
    });
    expect(new CampaignRepository(f.f.base.db).recurrences()).toEqual([]);
  } finally {
    await f.close();
  }
});

test('an unchanged historical request never opts into recurrence after restart', async () => {
  const f = recurringFixture();
  try {
    await f.admin.startLocal(f.input);
    await f.restart();
    f.setTime('2026-11-08T12:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(1);
    expect(new CampaignRepository(f.f.base.db).recurrences(true)).toEqual([]);
  } finally {
    await f.close();
  }
});

test('the existing scheduler automatically materializes recurrence after reopening the database', async () => {
  const f = recurringFixture();
  try {
    await f.admin.startLocal({ ...f.input, recurrence: { enabled: true } });
    f.setTime('2026-11-08T12:00:00.000Z');
    await f.restart(true);
    await vi.waitFor(() => {
      expect(f.admin.list()).toHaveLength(2);
      expect(f.admin.list().every((e) => e.status === 'WAITING_INPUT')).toBe(
        true,
      );
    });
    expect(f.instagram.execute).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

test('configuration commands are idempotent, immutable and can explicitly reactivate the same campaign', async () => {
  const f = recurringFixture();
  try {
    await f.admin.startLocal({ ...f.input, recurrence: { enabled: true } });
    await expect(
      f.admin.startLocal({ ...f.input, recurrence: { enabled: false } }),
    ).rejects.toThrow('CAMPAIGN_RECURRENCE_CONFLICT');
    const stop = {
      ...f.input,
      requestId: 'stop_command_001',
      recurrence: { enabled: false },
    };
    await f.admin.startLocal(stop);
    await f.admin.startLocal(stop);
    await f.admin.startLocal({
      ...f.input,
      requestId: 'enable_again_001',
      recurrence: { enabled: true },
    });
    expect(f.admin.list()).toHaveLength(1);
    const store = new CampaignRepository(f.f.base.db);
    expect(store.recurrences()[0].config.revision).toBe(3);
    expect(() =>
      f.f.base.db
        .prepare(
          "UPDATE campaign_execution_events SET evidence_json='{}' WHERE event_type='CAMPAIGN_RECURRENCE_CONFIGURED'",
        )
        .run(),
    ).toThrow('IMMUTABLE_CAMPAIGN_EVENT');
    await f.restart();
    f.setTime('2026-11-08T12:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test('disabling while the scheduler prepares an occurrence prevents its insertion', async () => {
  const f = recurringFixture();
  try {
    await f.admin.startLocal({ ...f.input, recurrence: { enabled: true } });
    const original = f.workflow.recurringRequest.bind(f.workflow);
    vi.spyOn(f.workflow, 'recurringRequest').mockImplementationOnce(
      async (seed, at) => {
        const request = await original(seed, at);
        await f.admin.startLocal({
          ...f.input,
          requestId: 'stop_during_tick_001',
          recurrence: { enabled: false },
        });
        return request;
      },
    );
    f.setTime('2026-11-08T12:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(1);
    expect(new CampaignRepository(f.f.base.db).recurrences()).toEqual([]);
  } finally {
    await f.close();
  }
});
const execution = {
  execution_id: 'execution_001',
  campaign_id: 'campaign_001',
  run_id: 'run_001',
  status: 'WAITING_RECONCILIATION',
} as any;
const request = {
  campaignId: 'campaign_001',
  campaignRevision: 1,
  scheduledAt: '2026-11-07T12:00:00.000Z',
  runId: 'run_001',
  briefingId: 'brief_001',
  generationRequestId: 'editorial_001',
  researchShortlistId: null,
  mode: 'LOCAL_VALIDATION',
  videoProduction: { mode: 'LOCAL_IMAGES' },
  localImage: { mediaReference: 'fixture:image' },
};

function native(instagram: any) {
  return new NativeCampaignWorkflow(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    instagram,
  );
}

test('a local-image execution accepts an explicit package only for its publication stage', () => {
  expect(
    campaignRequest({
      ...request,
      publication: { packageHash: hash, accountId },
    }).publication,
  ).toEqual({ packageHash: hash, accountId });
  expect(() =>
    campaignRequest({
      ...request,
      videoProduction: { mode: 'ASSISTED_LOCAL' },
      localImage: undefined,
      publication: { packageHash: hash, accountId },
    }),
  ).toThrow('OFFLINE_VIDEO_PRODUCTION_REQUIRED');
});

test('LIVE waits for an explicit approved package; fake keeps the manual handoff', async () => {
  const live = native({
    configuration: () => ({ mode: 'live' }),
    execute: vi.fn(),
    reconcile: vi.fn(),
    status: vi.fn(),
  });
  await expect(
    live.execute('PUBLICATION', execution, request, {}),
  ).rejects.toThrow('SOCIAL_PUBLICATION_REQUEST_REQUIRED');
  const fake = native({
    configuration: () => ({ mode: 'fake' }),
    execute: vi.fn(),
    reconcile: vi.fn(),
    status: vi.fn(),
  });
  expect(await fake.execute('PUBLICATION', execution, request, {})).toEqual({
    publication: 'MANUAL_HANDOFF',
  });
});

test('verified upload status releases the same operation but a publish uncertainty never does', async () => {
  const instagram = {
    configuration: () => ({ mode: 'live' }),
    execute: vi.fn(),
    reconcile: vi.fn(async () => null),
    status: vi.fn(async () => ({
      operation: {
        operationId: 'social_publication:fixture',
        state: 'UNCERTAIN',
        executionMode: 'live',
        publicationFlowVersion: 2,
        uncertainStage: 'UPLOAD',
        providerStatus: 'FINISHED',
        uploadStage: 'UPLOADING',
        packageHash: hash,
        accountId,
        mediaHash: hash,
        containerId: '18061553567588482',
        mediaId: null,
      },
    })),
  };
  const workflow = native(instagram);
  const history = [
    {
      sequence: 1,
      event_type: 'SCHEDULED',
      evidence: { ...request, publication: { packageHash: hash, accountId } },
    },
    {
      sequence: 2,
      event_type: 'STEP_DONE',
      evidence: {
        step: 'HANDOFF',
        result: { videoRenderId: 'render_001', contentHash: hash },
      },
    },
    {
      sequence: 3,
      event_type: 'STEP_STARTED',
      evidence: { step: 'PUBLICATION' },
    },
  ] as any;
  expect(await workflow.reconcile(execution, history)).toMatchObject({
    verified: true,
    operationId: 'social_publication:fixture',
    containerId: '18061553567588482',
    providerStatus: 'FINISHED',
  });
  instagram.status.mockResolvedValueOnce({
    operation: {
      ...(await instagram.status()).operation,
      uncertainStage: 'PUBLISH',
    },
  });
  expect(await workflow.reconcile(execution, history)).toBeNull();
  instagram.status.mockResolvedValueOnce({
    operation: {
      ...(await instagram.status()).operation,
      executionMode: 'fake',
    },
  });
  expect(await workflow.reconcile(execution, history)).toBeNull();
});

test('a recovered upload reuses the operation; uncertain publication never submits again', async () => {
  const result = {
    operationId: 'social_publication:fixture',
    mediaId: '18115549916268744',
  };
  const instagram = {
    configuration: () => ({ mode: 'live' }),
    execute: vi.fn(async () => result),
    reconcile: vi.fn(async () => ({
      verified: true,
      reason: 'SOCIAL_PERSISTED_INTENT_VERIFIED',
    })),
    status: vi
      .fn()
      .mockResolvedValueOnce({
        operation: { state: 'UNCERTAIN', uncertainStage: 'UPLOAD' },
      })
      .mockResolvedValueOnce({
        operation: { state: 'READY', requiresReconciliation: false },
      }),
  };
  const workflow = native(instagram);
  const publication = { packageHash: hash, accountId };
  expect(
    await workflow.execute(
      'PUBLICATION',
      execution,
      { ...request, publication },
      { HANDOFF: { contentHash: hash } },
    ),
  ).toBe(result);
  expect(instagram.execute).toHaveBeenCalledTimes(1);
  instagram.status.mockReset().mockResolvedValue({
    operation: { state: 'UNCERTAIN', uncertainStage: 'PUBLISH' },
  });
  instagram.reconcile.mockResolvedValueOnce(null as any);
  await expect(
    workflow.execute(
      'PUBLICATION',
      execution,
      { ...request, publication },
      { HANDOFF: { contentHash: hash } },
    ),
  ).rejects.toThrow('SOCIAL_RECONCILIATION_REQUIRED');
  expect(instagram.execute).toHaveBeenCalledTimes(1);
});

test('two days and two campaigns keep distinct masters with foreign keys on; restart reuses completed work', async () => {
  const db = new DatabaseSync(':memory:');
  provisionSchema(db);
  db.exec('PRAGMA foreign_keys=ON');
  const at = '2026-11-07T12:00:00.000Z';
  db.prepare('INSERT INTO projects VALUES(?,1,NULL,?,?)').run(
    'project_001',
    at,
    at,
  );
  db.prepare('INSERT INTO affiliate_product_revisions VALUES(?,?,?,?)').run(
    'product_001',
    1,
    hash,
    '{}',
  );
  for (const campaignId of ['campaign_001', 'campaign_002'])
    db.prepare(
      'INSERT INTO affiliate_campaign_revisions VALUES(?,?,?,?,?,?,?)',
    ).run(campaignId, 1, 'project_001', 'product_001', 1, hash, '{}');
  try {
    const repo = new CampaignRepository(db);
    const schedule = (campaignId: string, runId: string, scheduledAt: string) =>
      repo.schedule(
        { campaignId, campaignRevision: 1, runId, scheduledAt },
        { campaignId, runId },
        at,
      );
    const first = schedule('campaign_001', 'run_day_1', at);
    const replay = schedule('campaign_001', 'run_day_1', at);
    const second = schedule(
      'campaign_001',
      'run_day_2',
      '2026-11-08T12:00:00.000Z',
    );
    const other = schedule('campaign_002', 'run_other_1', at);
    expect(replay.execution_id).toBe(first.execution_id);
    expect(
      new Set([first.execution_id, second.execution_id, other.execution_id])
        .size,
    ).toBe(3);
    expect(() => schedule('campaign_001', 'run_conflict', at)).toThrow(
      'CAMPAIGN_DAY_CONFLICT',
    );
    const build = vi.fn(async () => ({ ready: true }));
    const workflow = {
      steps: ['BUILD', 'PUBLICATION'],
      execute: vi.fn(
        async (
          step: string,
          _execution: unknown,
          r: Record<string, unknown>,
        ) => {
          if (step === 'BUILD') return build();
          if (r.publication)
            return { operationId: 'social_publication:fixture' };
          throw Object.assign(
            new Error('SOCIAL_PUBLICATION_REQUEST_REQUIRED'),
            { code: 'SOCIAL_PUBLICATION_REQUEST_REQUIRED' },
          );
        },
      ),
      reconcile: vi.fn(async () => null),
    };
    await new CampaignOrchestrator(
      repo,
      workflow,
      () => '2026-11-08T12:00:00.000Z',
    ).tick();
    expect(build).toHaveBeenCalledTimes(3);
    expect(
      [first, second, other].map((e) => repo.get(e.execution_id).status),
    ).toEqual(['WAITING_INPUT', 'WAITING_INPUT', 'WAITING_INPUT']);
    await new CampaignOrchestrator(
      repo,
      workflow,
      () => '2026-11-08T12:00:00.000Z',
    ).tick();
    expect(build).toHaveBeenCalledTimes(3);
    repo.administrativeEvent(
      first.execution_id,
      repo.get(first.execution_id).version,
      at,
      'INPUT_SUPPLIED',
      { publication: { packageHash: hash, accountId } },
    );
    repo.resume(first.execution_id, at, repo.get(first.execution_id).version);
    await new CampaignOrchestrator(
      repo,
      workflow,
      () => '2026-11-08T12:00:00.000Z',
    ).tick(first.execution_id);
    expect(repo.get(first.execution_id).status).toBe('SUCCEEDED');
    expect(repo.get(second.execution_id).status).toBe('WAITING_INPUT');
    expect(build).toHaveBeenCalledTimes(3);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    db.close();
  }
});

test('official Nest context schedules into the same LIVE database used by Publishing', async () => {
  const fixture = p2EditorialFixture({ productionProfile: 'MIXED_MEDIA_V2' });
  provisionSchema(fixture.base.db, 41);
  fixture.base.db.exec(
    "CREATE TABLE social_publication_context (singleton INTEGER PRIMARY KEY CHECK(singleton=1), execution_mode TEXT NOT NULL CHECK(execution_mode IN ('fake','live')), database_id TEXT NOT NULL)",
  );
  fixture.base.db
    .prepare('INSERT INTO social_publication_context VALUES(1,?,?)')
    .run('live', 'fixture_live_db');
  provisionSchema(fixture.base.db, 42);
  for (const [key, value] of Object.entries({
    PROJECT_API_DATABASE: fixture.database,
    SOCIAL_HISTORY_DATABASE: fixture.database,
    CAMPAIGN_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_PUBLICATION_MODE: 'live',
    INSTAGRAM_LIVE_POSTS_ENABLED: 'false',
    INSTAGRAM_ACCOUNT_ID: accountId,
    INSTAGRAM_FACEBOOK_PAGE_ID: '12345678901',
    INSTAGRAM_META_APP_ID: '12345678901',
    INSTAGRAM_API_VERSION: 'v23.0',
    INSTAGRAM_ACCESS_TOKEN: 'fixture_token',
    INSTAGRAM_APP_ACCESS_TOKEN: 'fixture_app_token',
  }))
    vi.stubEnv(key, value);
  expect(validateConfiguration({ ...process.env, PORT: '0' }).port).toBe(0);
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('EXTERNAL_TRANSPORT_NOT_ALLOWED'));
  const local = {
    prepareImage: vi.fn(() => ({
      mediaAssetId: 'image_fixture',
      contentHash: hash,
    })),
    automaticAudio: vi.fn(async () => {
      throw Object.assign(new Error('LOCAL_TTS_CONFIGURATION_REQUIRED'), {
        code: 'LOCAL_TTS_CONFIGURATION_REQUIRED',
      });
    }),
    authorizedAudio: () => null,
    automaticAudioReady: () => false,
  };
  const module = await Test.createTestingModule({
    imports: [CampaignOrchestrationModule],
  })
    .overrideProvider(EDITORIAL_PROVIDER)
    .useValue(new FakeEditorialProvider())
    .overrideProvider(LocalFlowService)
    .useValue(local)
    .compile();
  const app = module.createNestApplication();
  await app.init();
  try {
    const daily = {
      campaignId: 'camp_001',
      campaignRevision: 1,
      projectVersion: 1,
      requestId: 'daily_fixture_001',
      requestedAt: '2026-11-07T12:00:00Z',
      localImage: { mediaReference: 'authorized-image-001' },
    };
    const scheduled = await app.get(CampaignAdministration).startLocal(daily);
    const nextDay = await app.get(CampaignAdministration).startLocal({
      ...daily,
      requestId: 'daily_fixture_002',
      requestedAt: '2026-11-08T12:00:00Z',
    });
    const replay = await app.get(CampaignAdministration).startLocal(daily);
    expect(replay.execution_id).toBe(scheduled.execution_id);
    expect(nextDay.execution_id).not.toBe(scheduled.execution_id);
    const repository = new CampaignRepository(fixture.base.db);
    const started = repository.claim(
      scheduled.execution_id,
      '2026-11-07T12:00:01.000Z',
      60000,
    )!;
    repository.ownedEvent(
      scheduled.execution_id,
      started.claim_token!,
      '2026-11-07T12:00:01.000Z',
      'STEP_DONE',
      {
        step: 'HANDOFF',
        result: { videoRenderId: 'fixture_render', contentHash: hash },
      },
    );
    repository.ownedEvent(
      scheduled.execution_id,
      started.claim_token!,
      '2026-11-07T12:00:01.000Z',
      'PAUSED',
      {
        step: 'PUBLICATION',
        code: 'SOCIAL_PUBLICATION_REQUEST_REQUIRED',
      },
      'WAITING_INPUT',
    );
    await app.get(CampaignAdministration).resume(scheduled.execution_id, {
      publication: { packageHash: hash, accountId },
    });
    expect(
      executionRequest(repository.history(scheduled.execution_id)).publication,
    ).toEqual({ packageHash: hash, accountId });
    expect(repository.get(scheduled.execution_id).status).toBe('SCHEDULED');
    const session = app.get(PublishingPersistence).openInstagram('live');
    try {
      expect(session.social.mode).toBe('live');
      expect(session.manual.repository.db).toBe(session.social.db);
      expect(
        session.reservations.forExecution(scheduled.execution_id),
      ).toBeNull();
    } finally {
      session.close();
    }
    expect(
      fixture.base.db
        .prepare(
          'SELECT execution_id FROM campaign_executions WHERE execution_id=?',
        )
        .get(scheduled.execution_id),
    ).toBeTruthy();
    expect(
      fixture.base.db
        .prepare('SELECT count(*) AS n FROM campaign_executions')
        .get()?.n,
    ).toBe(2);
    expect(fixture.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual(
      [],
    );
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await app.close();
    fetch.mockRestore();
    vi.unstubAllEnvs();
    fixture.cleanup();
  }
});
