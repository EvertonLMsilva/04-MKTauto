import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
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
} from '../publishing/application/local-qc-identity.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import {
  NativeCampaignWorkflow,
  document,
} from './application/native-campaign-workflow.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import { CampaignError } from './domain/campaign.js';

// Real HTTP, Affiliate/Content/Finance/Publishing services and disposable SQLite.
// Media synthesis/render/QC are deterministic offline doubles, not physical production.
test('FIXED daily HTTP flow recovers persisted approval after restart and persists one draft package per day', async () => {
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
  let clock = '2026-11-07T12:00:00.000Z';
  let app: any,
    admin: CampaignAdministration,
    operations: OperationsService,
    publishing: PublishingService,
    workflow: NativeCampaignWorkflow;
  const local = {
    prepareImage: vi.fn((scope: any) => {
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
    await start();
    const input = {
      campaignId: 'camp_001',
      campaignRevision: 1,
      projectVersion: 1,
      requestId: 'daily_fixed_001',
      requestedAt: '2026-11-07T11:00:00Z',
      selectionMode: 'FIXED',
      localImage: { mediaReference: 'authorized-image-001' },
      recurrence: {
        enabled: true,
        time: '09:00',
        timeZone: 'America/Sao_Paulo',
      },
    };
    const first = (
      await request(app.getHttpServer())
        .post(`${prefix}/local`)
        .send(input)
        .expect(201)
    ).body;
    await admin!.tick();
    expect(admin!.get(first.execution_id).finalization.pending?.code).toBe(
      'EXACT_HUMAN_APPROVAL_REQUIRED',
    );
    expect((await admin!.result(first.execution_id)).package).toBeNull();
    // Simulate a crash between durable approval and resume; the client supplies no IDs/hashes.
    vi.spyOn(admin!, 'resume').mockRejectedValueOnce(
      new Error('SIMULATED_RESTART'),
    );
    await expect(
      operations!.finalDecision(
        first.execution_id,
        { decision: 'APPROVED', justification: null },
        principal,
      ),
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
    expect(result.package.identity.pipelineRunId).toBe(first.run_id);
    expect(result.package.commercialApprovalRequired).toBe(true);
    expect(publishing!.package(result.package.contentHash)).toEqual(
      result.package,
    );
    expect(publishing!.packageReview(result.package.contentHash)).toBeNull();
    expect(generated).toHaveBeenCalledTimes(1);
    expect(local.compose).toHaveBeenCalledTimes(1);
    const repo = new CampaignRepository(f.base.db);
    clock = '2026-11-08T12:00:00.000Z';
    await admin!.tick();
    const next = admin!
      .list()
      .find((e) => e.execution_id !== first.execution_id)!;
    expect(next.finalization.pending?.code).toBe(
      'EXACT_HUMAN_APPROVAL_REQUIRED',
    );
    await operations!.finalDecision(
      next.execution_id,
      { decision: 'APPROVED', justification: null },
      principal,
    );
    // Crash after package persistence but before HANDOFF's STEP_DONE; replay must reuse it.
    const execute = workflow!.execute.bind(workflow!);
    let interruptedPackage: any;
    vi.spyOn(workflow!, 'execute').mockImplementationOnce(async (...args) => {
      const handoff = (await execute(...args)) as any;
      interruptedPackage = handoff.package;
      throw new CampaignError('PACKAGE_CONNECTION_INTERRUPTED');
    });
    await admin!.tick();
    expect(admin!.get(next.execution_id).status).toBe('WAITING_RECONCILIATION');
    expect(publishing!.package(interruptedPackage.contentHash)).toEqual(
      interruptedPackage,
    );
    expect((await admin!.result(next.execution_id)).package).toBeNull();
    await app.close();
    await start();
    await admin!.tick();
    expect((await admin!.result(next.execution_id)).package).toEqual(
      interruptedPackage,
    );
    expect(
      document((await admin!.result(first.execution_id)).package).contentHash,
    ).toBe(result.package.contentHash);
    expect(admin!.list()).toHaveLength(2);
    expect(generated).toHaveBeenCalledTimes(2);
    expect(local.compose).toHaveBeenCalledTimes(2);
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
      operations!.finalDecision(
        third.execution_id,
        { decision: 'APPROVED', justification: null },
        principal,
      ),
    ).rejects.toThrow('HUMAN_APPROVAL_QC_BINDING_MISMATCH');
    render.contentHash = expectedHash;
    await operations!.finalDecision(
      third.execution_id,
      { decision: 'REJECTED', justification: 'Rejeitado pelo operador.' },
      principal,
    );
    await admin!.tick();
    expect(admin!.get(third.execution_id).status).toBe('CANCELLED');
    expect((await admin!.result(third.execution_id)).package).toBeNull();
    expect(generated).toHaveBeenCalledTimes(3);
    expect(repo.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(external.execute).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await app?.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    f.cleanup();
  }
}, 30000);
