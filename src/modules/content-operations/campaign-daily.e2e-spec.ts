import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { OperationsModule } from '../operations/operations.module.js';
import { OperationsService } from '../operations/operations.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { MediaService } from '../media/application/media.service.js';
import { EDITORIAL_PROVIDER } from '../content/application/editorial-provider.port.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';
import { PublishingService } from '../publishing/application/publishing.service.js';
import { InstagramPublicationService } from '../publishing/application/instagram-publication.service.js';
import {
  operationalQcIdentity,
  provisionQcReviewer,
  serverApprovalRequest,
} from '../publishing/application/local-qc-identity.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import {
  NativeCampaignWorkflow,
  document,
} from './application/native-campaign-workflow.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import { CampaignError } from './domain/campaign.js';
import { FinanceService } from '../finance/application/finance.service.js';

// Real HTTP, Affiliate/Content/Finance/Publishing services and disposable SQLite.
// Media synthesis/render/QC are deterministic offline doubles, not physical production.
async function dailyFixture(mode: 'LEGACY' | 'CONTROLLED_FAKE') {
  const f = p2EditorialFixture({ productionProfile: 'MIXED_MEDIA_V2' });
  provisionSchema(f.base.db);
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('EXTERNAL_TRANSPORT_BLOCKED'));
  const provider = new FakeEditorialProvider();
  const generated = vi.spyOn(provider, 'script');
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const plans = new Map<string, any>(),
    renders = new Map<string, any>(),
    reports = new Map<string, any>(),
    voices = new Map<string, any>();
  const images = new Map<string, any>();
  const compositionReceipts = new Map<string, any>();
  const budgetQueries: (string | undefined)[] = [];
  const running = new Set<string>();
  let clock = '2026-11-07T12:00:00.000Z';
  let app: any,
    admin: CampaignAdministration,
    operations: OperationsService,
    publishing: PublishingService,
    workflow: NativeCampaignWorkflow;
  const local = {
    prepareImage: vi.fn((scope: any) => {
      const status = f.base.db
        .prepare('SELECT status FROM campaign_executions WHERE run_id=?')
        .get(scope.pipelineRunId)?.status;
      // Reconciliation verifies the same local inputs before claiming the run.
      expect(['RUNNING', 'WAITING_RECONCILIATION']).toContain(status);
      if (status === 'RUNNING') running.add(scope.pipelineRunId);
      const image = {
        mediaAssetId: `image:${scope.pipelineRunId}`,
        contentHash: hash(scope.pipelineRunId),
        visualDirectionPosition: 1,
        rights: { commercialUseAllowed: true },
      };
      images.set(image.mediaAssetId, image);
      return image;
    }),
    automaticAudio: vi.fn(async (scope: any, durationMilliseconds: number) => {
      const voice = {
        ...scope,
        voiceTrackId: `voice:${scope.scriptId}`,
        contentHash: hash(scope.scriptId),
        durationMilliseconds,
      };
      voices.set(voice.voiceTrackId, voice);
      return voice;
    }),
    authorizedAudio: (_run: string, script: string) =>
      voices.get(`voice:${script}`) ?? null,
    alignAudio: async (id: string) => ({
      input: { scriptId: voices.get(id).scriptId, audioAssetId: id },
      output: { alignmentId: id },
    }),
    subtitles: async (id: string) => ({ subtitleId: id }),
    compose: vi.fn(async (input: any) => {
      const plan = plans.get(input.compositionPlanId);
      const render = {
        ...plan,
        videoRenderId: `render:${plan.pipelineRunId}`,
        revision: 1,
        contentHash: hash(plan.pipelineRunId),
        logicalReference: `render:${plan.pipelineRunId}`,
        origin: { rights: { commercialUseAuthorized: true } },
      };
      renders.set(render.videoRenderId, render);
      compositionReceipts.set(input.videoCompositionRequestId, {
        requestHash: input.contentHash,
        videoRender: render,
      });
      return render;
    }),
    burn: async (id: string) => renders.get(id),
    qc: async (id: string) => {
      const render = renders.get(id);
      const report = {
        reportId: `qc:${render.pipelineRunId}`,
        videoRenderId: id,
        videoRenderContentHash: render.contentHash,
        result: 'PASS',
        approvalBlocked: false,
        findings: [
          'COMMERCIAL_RIGHTS',
          'PROCESSING_RIGHTS',
          'NARRATION_RIGHTS',
        ].map((code) => ({ code, status: 'PASS' })),
      };
      reports.set(report.reportId, report);
      return report;
    },
    preview: async () => ({ ready: true, url: 'offline-preview' }),
  };
  const media = {
    registerCompositionPlan: (plan: any) => {
      plans.set(plan.compositionPlanId, plan);
      return plan;
    },
    getCompositionPlan: (id: string) => plans.get(id),
    get: (id: string) => images.get(id),
    getVideoRender: (id: string) => renders.get(id),
    compositionReceipt: (id: string) => compositionReceipts.get(id) ?? null,
    verifyMedia: (id: string) => renders.get(id)?.contentHash,
    report: (id: string) => {
      const q = reports.get(id),
        render = renders.get(q.videoRenderId);
      return {
        ...q,
        qualityControlReportId: id,
        contentHash: hash(JSON.stringify(q)),
        pipelineRunId: render.pipelineRunId,
        projectId: render.projectId,
        projectVersion: render.projectVersion,
      };
    },
  };
  const external = {
    configuration: () => ({ mode: 'fake', accountId: '123456789' }),
    execute: vi.fn(async () => {
      throw new Error('PUBLICATION_FORBIDDEN');
    }),
    status: async () => null,
  };
  const start = async () => {
    const module = await Test.createTestingModule({
      imports: [OperationsModule],
    })
      .overrideProvider(EDITORIAL_PROVIDER)
      .useValue(provider)
      .overrideProvider(LocalFlowService)
      .useValue(local)
      .overrideProvider(MediaService)
      .useValue(media)
      .overrideProvider(InstagramPublicationService)
      .useValue(external)
      .compile();
    admin = module.get(CampaignAdministration);
    vi.spyOn(admin as any, 'now').mockImplementation(() => clock);
    operations = module.get(OperationsService);
    publishing = module.get(PublishingService);
    workflow = module.get(NativeCampaignWorkflow);
    const finance = module.get(FinanceService),
      usage = finance.getGlobalUsage.bind(finance);
    vi.spyOn(finance, 'getGlobalUsage').mockImplementation((at) => {
      budgetQueries.push(at);
      return usage(at);
    });
    app = module.createNestApplication();
    await app.init();
  };
  const prefix = '/content-operations/campaign-executions';
  for (const [key, value] of Object.entries({
    PROJECT_API_DATABASE: f.database,
    SOCIAL_HISTORY_DATABASE: f.database,
    CAMPAIGN_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_PUBLICATION_MODE: 'fake',
    INSTAGRAM_LIVE_POSTS_ENABLED: 'false',
    INSTAGRAM_ACCOUNT_ID: '123456789',
    INSTAGRAM_API_VERSION: 'v25.0',
    QC_FAKE_COMMANDS_ENABLED: 'true',
    QC_FAKE_COMMAND_OPERATORS: 'daily_operator',
  }))
    vi.stubEnv(key, value);
  const identityFile = join(dirname(f.database), 'daily-reviewers.json'),
    secretFile = join(dirname(f.database), 'daily-reviewer');
  try {
    await provisionQcReviewer(identityFile, 'daily_operator', secretFile);
    vi.stubEnv('QC_IDENTITIES_FILE', identityFile);
    const principal = await operationalQcIdentity.authenticate(
      `Bearer ${readFileSync(secretFile, 'utf8').trim()}`,
      '127.0.0.1',
    );
    // Synthetic decisions exist only in disposable fixtures. Controlled runs use
    // their dedicated resume contract; the legacy operator endpoint stays fenced.
    const fixtureDecision = async (
      id: string,
      decision: 'APPROVED' | 'REJECTED',
      justification: string | null = null,
    ) => {
      if (mode === 'LEGACY')
        return operations!.finalDecision(
          id,
          { decision, justification },
          principal,
        );
      const { render, qc } = await admin!.finalReviewContext(id);
      const approval = await admin!.approve(
        id,
        serverApprovalRequest(
          {
            projectId: render.projectId,
            projectVersion: render.projectVersion,
            pipelineRunId: render.pipelineRunId,
            videoRenderId: render.videoRenderId,
            videoRenderRevision: render.revision,
            videoRenderContentHash: render.contentHash,
            qualityControlReportId: qc.qualityControlReportId,
            qualityControlReportContentHash: qc.contentHash,
            decision,
            justification,
          },
          principal,
        ),
      );
      if (decision === 'REJECTED') admin!.cancel(id);
      else await admin!.resumeControlledFake(id, admin!.get(id).version);
      return approval;
    };
    await start();
    const input = {
      campaignId: 'camp_001',
      campaignRevision: 1,
      projectVersion: 1,
      requestId: 'daily_fixed_001',
      requestedAt: '2026-11-07T11:00:00Z',
      ...(mode === 'LEGACY' ? { selectionMode: 'FIXED' } : {}),
      localImage: {
        mediaReference: 'authorized-image-001',
        contentHash: hash('isolated-owned-image-fixture'),
        origin: 'OPERATOR_OWNED',
        provider: null,
        rights: {
          usageBasis: 'OWNED',
          commercialUseAllowed: true,
          evidence: [
            {
              id: 'daily_fixture_rights',
              kind: 'MEDIA_USAGE_RIGHT',
              sourceRef: 'fixture:daily-isolated-owned-image',
              recordedAt: '2026-11-07T11:00:00Z',
              mediaAuthorization: {
                mediaRef: 'authorized-image-001',
                contentHash: hash('isolated-owned-image-fixture'),
                commercialUse: 'GRANTED',
                processing: 'GRANTED',
                localProcessing: true,
                externalProviders: [],
              },
            },
          ],
        },
      },
      recurrence: {
        enabled: true,
        time: '09:00',
        timeZone: 'America/Sao_Paulo',
      },
    };
    let first;
    if (mode === 'CONTROLLED_FAKE') {
      const browser = request.agent(app.getHttpServer()),
        [operatorId, secret] = readFileSync(secretFile, 'utf8')
          .trim()
          .split('.');
      const session = await browser
        .post('/operations/session')
        .set('Host', 'localhost:3000')
        .set('Origin', 'http://localhost:3000')
        .send({ operatorId, secret })
        .expect(201);
      const submit = () =>
        browser
          .post('/operations/campaign-commands/recurrences/fake')
          .set('Host', 'localhost:3000')
          .set('Origin', 'http://localhost:3000')
          .set('x-qc-csrf', session.body.csrfToken)
          .send({ mode: 'FAKE', confirmation: true, request: input })
          .expect(201);
      const [accepted, replay] = await Promise.all([submit(), submit()]);
      expect(replay.body).toEqual(accepted.body);
      first = admin!.get(accepted.body.execution.executionId);
    } else {
      first = (
        await request(app.getHttpServer())
          .post(`${prefix}/local`)
          .send(input)
          .expect(201)
      ).body;
    }
    expect(admin!.get(first.execution_id).status).toBe('SCHEDULED');
    await admin!.tick();
    expect(admin!.get(first.execution_id).status).toBe('WAITING_INPUT');
    expect(running.has(first.run_id)).toBe(true);
    expect(budgetQueries.length).toBeGreaterThan(0);
    expect(admin!.get(first.execution_id).finalization.pending?.code).toBe(
      'EXACT_HUMAN_APPROVAL_REQUIRED',
    );
    expect((await admin!.result(first.execution_id)).package).toBeNull();
    // Synthetic approval belongs only to this isolated fixture, never to an operational run.
    // Simulate a crash between durable approval and resume; the client supplies no IDs/hashes.
    const resume =
      mode === 'LEGACY'
        ? vi.spyOn(admin!, 'resume')
        : vi.spyOn(admin!, 'resumeControlledFake');
    resume.mockRejectedValueOnce(new Error('SIMULATED_RESTART'));
    await expect(
      fixtureDecision(first.execution_id, 'APPROVED'),
    ).rejects.toThrow('SIMULATED_RESTART');
    expect(
      admin!
        .history(first.execution_id)
        .filter((h) => h.event_type === 'HUMAN_APPROVAL'),
    ).toHaveLength(1);
    await app.close();
    await start();
    await Promise.all([admin!.tick(), admin!.tick()]);
    const result = (
      await request(app.getHttpServer())
        .get(`${prefix}/${first.execution_id}/result`)
        .expect(200)
    ).body;
    if (mode === 'LEGACY') {
      expect(result.package.identity.pipelineRunId).toBe(first.run_id);
      expect(result.package.commercialApprovalRequired).toBe(true);
      expect(publishing!.package(result.package.contentHash)).toEqual(
        result.package,
      );
      expect(publishing!.packageReview(result.package.contentHash)).toBeNull();
    } else {
      // Controlled FAKE deliberately skips social package coordination as well as publication.
      expect(result.package).toBeNull();
      expect(result.publication).toBe('DISABLED_BY_FAKE_POLICY');
    }
    expect(admin!.get(first.execution_id).status).toBe('SUCCEEDED');
    expect(generated).toHaveBeenCalledTimes(1);
    expect(local.compose).toHaveBeenCalledTimes(1);
    const repo = new CampaignRepository(f.base.db);
    const d1Policy =
      mode === 'CONTROLLED_FAKE'
        ? admin!.controlledFake(first.execution_id).policy
        : null;
    const d1BudgetChecks = budgetQueries.length;
    clock = '2026-11-08T12:00:00.000Z';
    const composeExecute = workflow!.execute.bind(workflow!);
    let interruptedRender: any;
    vi.spyOn(workflow!, 'execute').mockImplementation(async (...args) => {
      const result = await composeExecute(...args);
      if (args[0] === 'COMPOSITION' && !interruptedRender) {
        interruptedRender = result;
        throw new CampaignError('RENDER_CONNECTION_INTERRUPTED');
      }
      return result;
    });
    await admin!.tick();
    let next = admin!
      .list()
      .find((e) => e.execution_id !== first.execution_id)!;
    expect(next.status).toBe('WAITING_RECONCILIATION');
    expect(renders.get(interruptedRender.videoRenderId)).toEqual(
      interruptedRender,
    );
    expect(
      admin!.finalizationContext(next.execution_id).completed.COMPOSITION,
    ).toBeUndefined();
    await app.close();
    await start();
    await admin!.tick();
    next = admin!.get(next.execution_id);
    expect(
      admin!.finalizationContext(next.execution_id).completed.COMPOSITION,
    ).toEqual(interruptedRender);
    expect(local.compose).toHaveBeenCalledTimes(2);
    expect(next.finalization.pending?.code).toBe(
      'EXACT_HUMAN_APPROVAL_REQUIRED',
    );
    expect(next.status).toBe('WAITING_INPUT');
    expect(next.campaign_id).toBe(first.campaign_id);
    expect(first.production_date).toBe('2026-11-07');
    expect(next.production_date).toBe('2026-11-08');
    expect(next.run_id).not.toBe(first.run_id);
    expect(running.has(next.run_id)).toBe(true);
    expect(budgetQueries.length).toBeGreaterThan(d1BudgetChecks);
    expect(
      admin!
        .history(next.execution_id)
        .some((event) => event.event_type === 'HUMAN_APPROVAL'),
    ).toBe(false);
    expect(publishing!.approvals(next.run_id)).toEqual([]);
    expect((await admin!.result(next.execution_id)).package).toBeNull();
    if (d1Policy) {
      const d2Policy = admin!.controlledFake(next.execution_id).policy;
      for (const [execution, policy] of [
        [first, d1Policy],
        [next, d2Policy],
      ] as const) {
        expect(policy).toMatchObject({
          mode: 'FAKE',
          providers: 'LOCAL_ONLY',
          publication: 'DISABLED',
          campaignId: execution.campaign_id,
          runId: execution.run_id,
        });
        expect(
          admin!.history(execution.execution_id)[0].evidence
            .fakeExecutionPolicy,
        ).toEqual(policy);
      }
      expect(d2Policy.commandId).not.toBe(d1Policy.commandId);
    }
    expect(
      f.base.db
        .prepare(
          'SELECT campaign_id, production_date, COUNT(*) AS n FROM campaign_executions GROUP BY campaign_id, production_date ORDER BY production_date',
        )
        .all(),
    ).toEqual([
      { campaign_id: first.campaign_id, production_date: '2026-11-07', n: 1 },
      { campaign_id: first.campaign_id, production_date: '2026-11-08', n: 1 },
    ]);
    await fixtureDecision(next.execution_id, 'APPROVED');
    // Crash after local handoff (and legacy draft persistence) but before STEP_DONE.
    const execute = workflow!.execute.bind(workflow!);
    let interruptedHandoff: any;
    vi.spyOn(workflow!, 'execute').mockImplementationOnce(async (...args) => {
      interruptedHandoff = await execute(...args);
      throw new CampaignError('PACKAGE_CONNECTION_INTERRUPTED');
    });
    await admin!.tick();
    expect(admin!.get(next.execution_id).status).toBe('WAITING_RECONCILIATION');
    if (mode === 'LEGACY')
      expect(
        publishing!.package(interruptedHandoff.package.contentHash),
      ).toEqual(interruptedHandoff.package);
    else expect(interruptedHandoff).not.toHaveProperty('package');
    expect((await admin!.result(next.execution_id)).package).toBeNull();
    await app.close();
    await start();
    await Promise.all([admin!.tick(), admin!.tick()]);
    expect(admin!.get(next.execution_id).status).toBe('SUCCEEDED');
    expect(
      admin!.finalizationContext(next.execution_id).completed.HANDOFF,
    ).toEqual(interruptedHandoff);
    expect((await admin!.result(next.execution_id)).package).toEqual(
      interruptedHandoff.package ?? null,
    );
    expect((await admin!.result(first.execution_id)).package).toEqual(
      result.package,
    );
    expect(admin!.list()).toHaveLength(2);
    expect(generated).toHaveBeenCalledTimes(2);
    expect(local.compose).toHaveBeenCalledTimes(2);
    for (const execution of [first, next]) {
      const history = admin!.history(execution.execution_id);
      for (const step of ['EDITORIAL', 'COMPOSITION', 'HANDOFF'])
        expect(
          history.filter(
            (event) =>
              event.event_type === 'STEP_DONE' && event.evidence.step === step,
          ),
        ).toHaveLength(1);
      const dailyResult = await admin!.result(execution.execution_id);
      expect(document(dailyResult.script).pipelineRunId).toBe(execution.run_id);
      if (d1Policy)
        expect(dailyResult.publication).toBe('DISABLED_BY_FAKE_POLICY');
    }
    clock = '2026-11-09T12:00:00.000Z';
    await admin!.tick();
    const third = admin!
      .list()
      .find((e) => e.production_date === '2026-11-09')!;
    const context = admin!.finalizationContext(third.execution_id);
    const render = renders.get((context.completed.BURN as any).videoRenderId);
    const expectedHash = render.contentHash;
    render.contentHash = hash('changed-render');
    await expect(
      fixtureDecision(third.execution_id, 'APPROVED'),
    ).rejects.toThrow('HUMAN_APPROVAL_QC_BINDING_MISMATCH');
    render.contentHash = expectedHash;
    await fixtureDecision(
      third.execution_id,
      'REJECTED',
      'Rejeitado pelo operador.',
    );
    await admin!.tick();
    expect(admin!.get(third.execution_id).status).toBe('CANCELLED');
    expect((await admin!.result(third.execution_id)).package).toBeNull();
    expect(generated).toHaveBeenCalledTimes(3);
    // QC failure is a persisted terminal fact; no approval or package is invented.
    const qc = local.qc;
    local.qc = async (id: string) => ({ ...(await qc(id)), result: 'FAIL' });
    clock = '2026-11-10T12:00:00.000Z';
    await admin!.tick();
    const failed = admin!
      .list()
      .find((e) => e.production_date === '2026-11-10')!;
    expect(failed.status).toBe('FAILED');
    expect(failed.finalization.pending?.code).toBe('QC_FAILED');
    expect((await admin!.result(failed.execution_id)).package).toBeNull();
    expect(
      admin!
        .history(failed.execution_id)
        .some((event) => event.event_type === 'HUMAN_APPROVAL'),
    ).toBe(false);
    await admin!.tick();
    expect(generated).toHaveBeenCalledTimes(4);
    for (const table of [
      'global_paid_operations',
      'instagram_publication_reservations',
      'multi_network_publication_reservations',
      'social_publication_operations',
    ])
      expect(
        f.base.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
        table,
      ).toBe(0);
    expect(repo.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(external.execute).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await app?.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    f.cleanup();
  }
}

test.each(['LEGACY', 'CONTROLLED_FAKE'] as const)(
  '%s daily HTTP fixture preserves gates and recovers renders and applicable drafts across restart',
  dailyFixture,
  30000,
);
