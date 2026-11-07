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
