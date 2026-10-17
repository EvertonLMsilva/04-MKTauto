import { provisionQcReviewer } from '../publishing/application/local-qc-identity.js';
import { validateTemporalReport } from '../media/domain/p4-qc-contracts.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { MediaService } from '../media/application/media.service.js';
import { VideoGenerationService } from '../media/application/video-generation.service.js';
import { FakeVideoGenerationProvider } from '../media/infrastructure/fake-video-generation.provider.js';
import { LocalEvidenceStorage } from '../media/infrastructure/local-evidence-storage.js';
import { runProcess } from '../media/infrastructure/ffmpeg-process.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import { CampaignOrchestrator } from './application/campaign-orchestrator.js';
import { CampaignError } from './domain/campaign.js';
import { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import {
  p2EditorialFixture,
  p2FinancialProof,
} from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignOrchestrationModule } from './campaign-orchestration.module.js';
import {
  CampaignAdministration,
  CAMPAIGN_DATABASE,
} from './application/campaign-administration.js';
import { CONTENT_DATABASE } from '../content/infrastructure/content.persistence.js';
import { AFFILIATE_DATABASE } from '../affiliate/infrastructure/affiliate-database.config.js';
import { PROJECT_DATABASE } from '../project/infrastructure/project-database.config.js';
import { RESEARCH_DATABASE } from '../research/infrastructure/research-database.config.js';
import { CONTENT_OPERATIONS_DATABASE } from './application/ports/operations.port.js';
import { FINANCE_DATABASE } from '../finance/finance.module.js';
import { MEDIA_DATABASE } from '../media/infrastructure/media.persistence.js';
import { PUBLISHING_DATABASE } from '../publishing/infrastructure/publishing.persistence.js';
import { EDITORIAL_PROVIDER } from '../content/application/editorial-provider.port.js';
import {
  FakeEditorialProvider,
  UnavailableEditorialProvider,
} from '../content/infrastructure/fake-editorial.provider.js';
import { FinanceService } from '../finance/application/finance.service.js';

describe('P4 native HTTP and Content/Research/Affiliate/Finance integration', () => {
  let f: ReturnType<typeof p2EditorialFixture>,
    app: INestApplication,
    service: CampaignAdministration;
  const provider = new FakeEditorialProvider();
  let body: Record<string, unknown>;
  beforeEach(async () => {
    f = p2EditorialFixture();
    const db = new DatabaseSync(f.database);
    provisionSchema(db);
    db.close();
    const catalog = new SqliteAffiliatePersistence(f.database).open();
    try {
      catalog.registerCampaign(
        {
          ...catalog.getCampaign('camp_001', 1)!,
          revision: 2,
          affiliateUrl: 'https://s.shopee.com.br/offline',
        },
        'campaign_shopee',
        true,
      );
      catalog.associateCampaignSource(
        {
          schemaVersion: 'affiliate-campaign-source/1.0.0',
          sourceId: 'p76_shopee',
          revision: 1,
          source: 'SHOPEE_AFFILIATE_API',
          offer: {
            offerId: 'fixture-offer',
            productId: 'fixture-product',
            shopId: null,
            provenance: {
              source: 'FAKE',
              fixtureVersion: 'p76/offline/1',
              observedAt: null,
            },
          },
          campaignId: 'camp_001',
          campaignRevision: 2,
          productId: 'prod_001',
          productRevision: 1,
          briefingId: 'brief_shopee',
          affiliateUrl: 'https://s.shopee.com.br/offline',
        },
        'source_shopee',
        ['authorized-image-001'],
      );
    } finally {
      catalog.close();
    }
    const binary = (name: string) =>
      execFileSync(
        process.platform === 'win32' ? 'where.exe' : 'which',
        [name],
        { encoding: 'utf8', windowsHide: true },
      )
        .trim()
        .split(/\r?\n/)[0];
    vi.stubEnv('TEMPORAL_QC_MODE', 'offline');
    vi.stubEnv('FFMPEG_PATH', binary('ffmpeg'));
    vi.stubEnv('FFPROBE_PATH', binary('ffprobe'));
    vi.stubEnv('FFMPEG_MEDIA_ROOT', join(dirname(f.database), 'media'));
    vi.stubEnv(
      'LOCAL_MEDIA_EVIDENCE_ROOT',
      join(dirname(f.database), 'evidence'),
    );
    let builder = Test.createTestingModule({
      imports: [CampaignOrchestrationModule],
    });
    for (const token of [
      CAMPAIGN_DATABASE,
      CONTENT_DATABASE,
      AFFILIATE_DATABASE,
      PROJECT_DATABASE,
      RESEARCH_DATABASE,
      CONTENT_OPERATIONS_DATABASE,
      FINANCE_DATABASE,
      MEDIA_DATABASE,
      PUBLISHING_DATABASE,
    ])
      builder = builder.overrideProvider(token).useValue(f.database);
    const module = await builder
      .overrideProvider(EDITORIAL_PROVIDER)
      .useValue(provider)
      .compile();
    app = module.createNestApplication();
    await app.init();
    service = module.get(CampaignAdministration);
    body = {
      campaignId: 'camp_001',
      campaignRevision: 2,
      scheduledAt: '2026-10-14T12:00:00Z',
      runId: 'run_001',
      briefingId: 'brief_shopee',
      researchShortlistId: f.shortlist.artifactId,
      generationRequestId: 'p4_editorial_001',
      mode: 'LOCAL_VALIDATION',
    };
  });
  afterEach(async () => {
    await app.close();
    f.cleanup();
    vi.unstubAllEnvs();
  });
  const base = '/content-operations/campaign-executions';
  it('schedules, replays, persists real native editorial checkpoints and waits for audio', async () => {
    const first = await request(app.getHttpServer())
      .post(base)
      .send(body)
      .expect(201);
    const id = first.body.execution_id;
    await request(app.getHttpServer())
      .post(base)
      .send(body)
      .expect(201)
      .expect((r) => expect(r.body.execution_id).toBe(id));
    await Promise.all([service.tick(), service.tick()]);
    await request(app.getHttpServer())
      .get(`${base}/${id}`)
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('WAITING_INPUT'));
    const history = await request(app.getHttpServer())
      .get(`${base}/${id}/history`)
      .expect(200);
    expect(
      history.body.some(
        (h: { event_type: string; evidence: { step: string } }) =>
          h.event_type === 'STEP_DONE' && h.evidence.step === 'EDITORIAL',
      ),
    ).toBe(true);
    const db = new DatabaseSync(f.database, { readOnly: true });
    try {
      expect(
        db
          .prepare(
            "SELECT COUNT(*) n FROM scripts WHERE script_id='script:p4_editorial_001'",
          )
          .get()?.n,
      ).toBe(1);
      expect(db.prepare('SELECT COUNT(*) n FROM cost_events').get()?.n).toBe(0);
    } finally {
      db.close();
    }
    await request(app.getHttpServer()).post(`${base}/${id}/resume`).expect(201);
    await service.tick();
    expect(
      service
        .history(id)
        .filter(
          (h) =>
            h.event_type === 'STEP_DONE' && h.evidence.step === 'EDITORIAL',
        ),
    ).toHaveLength(1);
    await request(app.getHttpServer()).post(`${base}/${id}/cancel`).expect(201);
    await request(app.getHttpServer()).post(`${base}/${id}/resume`).expect(409);
    await request(app.getHttpServer())
      .get(`${base}/missing_execution`)
      .expect(404);
    await request(app.getHttpServer())
      .post(base)
      .send({ ...body, runId: 'different_run' })
      .expect(409);
    await request(app.getHttpServer())
      .post(base)
      .send({ ...body, paid: true })
      .expect(400);
  });
  it('runs native editorial, motion scene preparation and simulation, then waits for real media without spending', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('NETWORK_FORBIDDEN'));
    try {
      const input = { ...body, videoProduction: { mode: 'OFFLINE' } };
      const e = await service.schedule(input);
      expect((await service.schedule(input)).execution_id).toBe(e.execution_id);
      await service.tick();
      expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
      const history = service.history(e.execution_id);
      const scenes = history.find(
        (h) => h.event_type === 'STEP_DONE' && h.evidence.step === 'SCENES',
      )!.evidence.result as any;
      expect(scenes.shopeeSource.offer.provenance.source).toBe('FAKE');
      expect(scenes.commercial.productId).toBe('prod_001');
      expect(scenes.review.status).toBe('REQUIRED');
      expect(scenes.scenes.length).toBeGreaterThan(0);
      expect(
        scenes.scenes.every(
          (s: any) =>
            s.sceneMediaType === 'GENERATED_VIDEO' &&
            s.movementRequirement === 'REAL_MOTION_REQUIRED',
        ),
      ).toBe(true);
      expect(JSON.stringify(history)).toContain('REAL_VIDEO_MEDIA_REQUIRED');
      expect(JSON.stringify(history)).toContain('NOT_MATERIALIZED');
      expect(history.some((h) => h.evidence.step === 'AUDIO')).toBe(false);
      for (const step of ['SCENES', 'VIDEO_GENERATION', 'MEDIA_QC']) {
        const started = history.find(
          (event) =>
            event.event_type === 'STEP_STARTED' && event.evidence.step === step,
        )!;
        expect(
          await app.get(NativeCampaignWorkflow).reconcile(
            service.get(e.execution_id),
            history.filter((event) => event.sequence <= started.sequence),
          ),
        ).toEqual({
          verified: true,
          reason: 'OFFLINE_VIDEO_STAGE_REPLAY_SAFE',
        });
      }
      expect(network).not.toHaveBeenCalled();
      const db = new DatabaseSync(f.database, { readOnly: true });
      try {
        expect(db.prepare('SELECT COUNT(*) n FROM cost_events').get()?.n).toBe(
          0,
        );
      } finally {
        db.close();
      }
      await service.resume(e.execution_id);
      await service.tick();
      expect(
        service
          .history(e.execution_id)
          .filter(
            (h) =>
              h.event_type === 'STEP_DONE' &&
              h.evidence.step === 'VIDEO_GENERATION',
          ),
      ).toHaveLength(1);
      expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
    } finally {
      network.mockRestore();
    }
  });
  it('selects authorized recorded fixtures without fake generation and preserves the complete QC gate', async () => {
    const e = await service.schedule({
      ...body,
      videoProduction: { mode: 'ASSISTED_LOCAL' },
    });
    await service.tick();
    const editorial = service
      .history(e.execution_id)
      .find(
        (h) => h.event_type === 'STEP_DONE' && h.evidence.step === 'EDITORIAL',
      )!.evidence.result as any;
    const script = editorial.script;
    const scenes = {
      pipelineRunId: script.pipelineRunId,
      projectId: script.projectId,
      projectVersion: script.projectVersion,
      script,
      scenes: script.visualDirections,
    };
    expect(JSON.stringify(service.history(e.execution_id))).toContain(
      'REAL_VIDEO_MEDIA_REQUIRED',
    );
    expect(
      service
        .history(e.execution_id)
        .some((h) => h.evidence.step === 'VIDEO_GENERATION'),
    ).toBe(false);
    const file = join(dirname(f.database), 'technical-fixture.mp4');
    await runProcess(
      process.env.FFMPEG_PATH!,
      [
        '-v',
        'error',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=64x64:r=8:d=2',
        '-an',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        file,
      ],
      { timeoutMs: 15000, maxLogBytes: 8192 },
    );
    const hash = new LocalEvidenceStorage(process.env.FFMPEG_MEDIA_ROOT!).put(
      readFileSync(file),
      'mp4',
    );
    const ref = 'media:sha256_' + hash;
    const media = app.get(MediaService);
    const ids = scenes.scenes.map((scene: any) => {
      const id = 'technical_fixture_' + scene.position;
      media.register({
        schemaVersion: 'media-asset/1.0.0',
        mediaAssetId: id,
        pipelineRunId: scenes.pipelineRunId,
        projectId: scenes.projectId,
        projectVersion: scenes.projectVersion,
        scriptId: scenes.script.scriptId,
        scriptContentHash: scenes.script.contentHash,
        visualDirectionPosition: scene.position,
        assetType: 'VIDEO',
        technicalProperties: {
          format: 'mp4',
          widthPixels: 64,
          heightPixels: 64,
          durationMilliseconds: 2000,
        },
        contentHash: hash,
        mediaReference: ref,
        origin: 'OPERATOR_OWNED',
        provider: null,
        rights: {
          usageBasis: 'OWNED',
          commercialUseAllowed: true,
          evidence: [
            {
              id: 'fixture_rights_' + scene.position,
              kind: 'MEDIA_USAGE_RIGHT',
              sourceRef: 'fixture:locally-generated-test-pattern',
              recordedAt: '2026-10-14T12:00:00Z',
              mediaAuthorization: {
                mediaRef: ref,
                contentHash: hash,
                commercialUse: 'GRANTED',
                processing: 'GRANTED',
                localProcessing: true,
                externalProviders: [],
              },
            },
          ],
        },
        createdAt: '2026-10-14T12:00:00Z',
        revision: 1,
        supersedesMediaAssetId: null,
      });
      return id;
    });
    const realGet = media.get.bind(media);
    const denied = vi.spyOn(media, 'get').mockImplementation((id: string) => {
      const asset = realGet(id)!;
      return {
        ...asset,
        rights: {
          ...asset.rights,
          evidence: asset.rights.evidence!.map((item) => ({
            ...item,
            mediaAuthorization: {
              ...item.mediaAuthorization!,
              localProcessing: false,
            },
          })),
        },
      };
    });
    try {
      await service.resume(e.execution_id, { sceneMediaAssetIds: ids });
      await service.tick();
      expect(JSON.stringify(service.history(e.execution_id))).toContain(
        'MEDIA_PROCESSING_RIGHTS_REQUIRED',
      );
    } finally {
      denied.mockRestore();
    }
    await service.resume(e.execution_id, { sceneMediaAssetIds: ids });
    await service.tick();
    expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
    expect(JSON.stringify(service.history(e.execution_id))).toContain(
      'COMPLETE_TEMPORAL_QC_REQUIRED',
    );
    const preparation = service
      .history(e.execution_id)
      .find(
        (h) => h.event_type === 'STEP_DONE' && h.evidence.step === 'SCENES',
      )!.evidence.result as any;
    expect(
      preparation.scenes.every(
        (scene: any) =>
          scene.sceneMediaType === 'RECORDED_VIDEO' &&
          scene.movementRequirement === 'REAL_MOTION_REQUIRED',
      ),
    ).toBe(true);
    const generation = service
      .history(e.execution_id)
      .find(
        (h) =>
          h.event_type === 'STEP_DONE' &&
          h.evidence.step === 'VIDEO_GENERATION',
      )!.evidence.result as any;
    expect(generation.generation).toBe('NOT_REQUESTED');
    expect(generation.materialization).toBe('EXISTING_AUTHORIZED_MEDIA');
    const asset = media.get(ids[0])!;
    const report = validateTemporalReport(
      await media.evaluateTemporalMedia(ids[0]),
      {
        mediaAssetId: asset.mediaAssetId,
        mediaReference: asset.mediaReference,
        contentHash: asset.contentHash,
        scriptContentHash: asset.scriptContentHash,
        visualDirectionPosition: asset.visualDirectionPosition,
      },
    );
    expect(report.identity.contentHash).toBe(hash);
    expect(report.evidence.fidelity).toBe('NOT_VALIDATED');
    expect(report.evidence.motion).toBe('NOT_VALIDATED');
    expect(report.evidence.continuity).toBe('NOT_VALIDATED');
    expect(report.result).toBe('NOT_VALIDATED');
    expect(report.evidence.provenance?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      service
        .history(e.execution_id)
        .some((h) =>
          ['AUDIO', 'COMPOSITION', 'BURN', 'PUBLICATION'].includes(
            String(h.evidence.step),
          ),
        ),
    ).toBe(false);
    await service.resume(e.execution_id, { sceneMediaAssetIds: ids });
    await service.tick();
    expect(await media.evaluateTemporalMedia(ids[0])).toEqual(report);
    const staleReview = vi
      .spyOn(media, 'evaluateTemporalMedia')
      .mockRejectedValueOnce(
        Object.assign(new Error('HUMAN_APPROVAL_REVIEW_INVALID'), {
          code: 'HUMAN_APPROVAL_REVIEW_INVALID',
        }),
      );
    try {
      await service.resume(e.execution_id, { sceneMediaAssetIds: ids });
      await service.tick();
      expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
      expect(JSON.stringify(service.history(e.execution_id))).toContain(
        'AUTHENTICATED_MEDIA_REVIEW_REQUIRED',
      );
    } finally {
      staleReview.mockRestore();
    }
    const configFile = join(dirname(f.database), 'qc-identities.json'),
      secretFile = join(dirname(f.database), 'individual-reviewer');
    await provisionQcReviewer(configFile, 'qc_operator_test', secretFile);
    vi.stubEnv('QC_IDENTITIES_FILE', configFile);
    const credential = readFileSync(secretFile, 'utf8');
    const png = join(dirname(f.database), 'technical-reference.png');
    await runProcess(
      process.env.FFMPEG_PATH!,
      ['-v', 'error', '-nostdin', '-i', file, '-frames:v', '1', png],
      { timeoutMs: 15000, maxLogBytes: 8192 },
    );
    const refHash = new LocalEvidenceStorage(
      process.env.FFMPEG_MEDIA_ROOT!,
    ).put(readFileSync(png), 'png');
    const referenceRights = structuredClone(asset.rights);
    referenceRights.evidence![0].id = 'reference_fixture_right';
    referenceRights.evidence![0].mediaAuthorization = {
      mediaRef: 'media:sha256_' + refHash,
      contentHash: refHash,
      commercialUse: 'GRANTED',
      processing: 'GRANTED',
      localProcessing: true,
      externalProviders: ['fal_ai'],
    };
    const reference = media.register({
      ...asset,
      mediaAssetId: 'assisted_reference',
      revision: 1,
      supersedesMediaAssetId: null,
      assetType: 'IMAGE',
      technicalProperties: {
        format: 'png',
        widthPixels: 64,
        heightPixels: 64,
        durationMilliseconds: null,
      },
      contentHash: refHash,
      mediaReference: 'media:sha256_' + refHash,
      rights: referenceRights,
    });
    for (const id of ids) {
      const video = media.get(id)!,
        auto: any = await media.evaluateTemporalMedia(id);
      const criterion = {
        startSeconds: 0,
        endSeconds: 2,
        observation:
          'Isolated contract attestation for owned technical frames, without a commercial claim.',
      };
      const reviewed = await request(app.getHttpServer())
        .post('/media/assets/' + id + '/temporal-reviews')
        .set('Authorization', 'Bearer ' + credential)
        .send({
          schemaVersion: 'human-temporal-review-request/1.0.0',
          mediaAssetId: id,
          mediaContentHash: video.contentHash,
          mediaRevision: video.revision,
          automaticReportHash: auto.contentHash,
          referenceImage: {
            mediaAssetId: reference.mediaAssetId,
            contentHash: refHash,
            revision: reference.revision,
          },
          decision: 'APPROVED',
          criteria: {
            motion: criterion,
            continuity: criterion,
            fidelity: criterion,
          },
        })
        .expect(201);
      expect(
        reviewed.body.evidence.provenance.parameters.humanReview.actor,
      ).toBe('qc_operator_test');
    }
    await service.resume(e.execution_id);
    await service.tick();
    expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
    const finalHistory = service.history(e.execution_id);
    expect(
      finalHistory.some(
        (h) => h.event_type === 'STEP_DONE' && h.evidence.step === 'MEDIA_QC',
      ),
    ).toBe(true);
    expect(JSON.stringify(finalHistory)).toContain('AUDIO_REQUIRED');
    expect(finalHistory.some((h) => h.evidence.step === 'COMPOSITION')).toBe(
      false,
    );
  }, 30000);
  it('recovers an explicitly resumed failed simulation without materialization', async () => {
    const generation = app.get(VideoGenerationService);
    const failing = new VideoGenerationService(
      new FakeVideoGenerationProvider('FAIL_ONCE'),
    );
    const spies = [
      vi
        .spyOn(generation, 'submit')
        .mockImplementation(failing.submit.bind(failing)),
      vi
        .spyOn(generation, 'poll')
        .mockImplementation(failing.poll.bind(failing)),
      vi
        .spyOn(generation, 'recover')
        .mockImplementation(failing.recover.bind(failing)),
    ];
    try {
      const e = await service.schedule({
        ...body,
        videoProduction: { mode: 'OFFLINE' },
      });
      await service.tick();
      expect(JSON.stringify(service.history(e.execution_id))).toContain(
        'VIDEO_SIMULATION_RECOVERY_REQUIRED',
      );
      // One scene may fail once per resume; completed fake operations replay unchanged.
      for (
        let i = 0;
        i < 30 &&
        !JSON.stringify(service.history(e.execution_id)).includes(
          'REAL_VIDEO_MEDIA_REQUIRED',
        );
        i++
      ) {
        await service.resume(e.execution_id);
        await service.tick();
      }
      expect(JSON.stringify(service.history(e.execution_id))).toContain(
        'REAL_VIDEO_MEDIA_REQUIRED',
      );
      expect(spies[2]).toHaveBeenCalled();
      expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
  it('rejects invalid scene identities before scheduling any production effect', async () => {
    await expect(
      service.schedule({ ...body, sceneMediaAssetIds: ['asset_001'] }),
    ).rejects.toThrow('INVALID_SCENE_MEDIA');
    await expect(
      service.schedule({
        ...body,
        videoProduction: { mode: 'OFFLINE' },
        sceneMediaAssetIds: ['asset_001', 'asset_001'],
      }),
    ).rejects.toThrow('INVALID_SCENE_MEDIA');
  });
  it('rejects LIVE or production simulation without calling providers', async () => {
    await expect(
      service.schedule({ ...body, videoProduction: { mode: 'LIVE' } }),
    ).rejects.toThrow('OFFLINE_VIDEO_PRODUCTION_REQUIRED');
    await expect(
      service.schedule({
        ...body,
        mode: 'PRODUCTION',
        videoProduction: { mode: 'OFFLINE' },
      }),
    ).rejects.toThrow('OFFLINE_VIDEO_PRODUCTION_REQUIRED');
  });
  it('blocks fake editorial in production', async () => {
    const e = await service.schedule({ ...body, mode: 'PRODUCTION' });
    await service.tick();
    expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
    expect(JSON.stringify(service.history(e.execution_id))).toContain(
      'EDITORIAL_REAL_PROVIDER_REQUIRED',
    );
  });
  it('persists unavailable provider without fabricated completion', async () => {
    const spy = vi
      .spyOn(provider, 'ideas')
      .mockImplementation(() => new UnavailableEditorialProvider().ideas());
    try {
      const e = await service.schedule(body);
      await service.tick();
      expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
      expect(JSON.stringify(service.history(e.execution_id))).toContain(
        'EDITORIAL_PROVIDER_UNAVAILABLE',
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('preserves UNKNOWN and never dispatches paid editorial', async () => {
    const finance = app.get(FinanceService),
      proof = { ...p2FinancialProof(), operationId: 'p4_editorial_001' };
    finance.reserveGlobal(proof, new Date().toISOString());
    finance.dispatchGlobal(proof.operationId);
    finance.unknownGlobal(proof.operationId);
    const spy = vi.spyOn(provider, 'ideas');
    try {
      const e = await service.schedule(body);
      await service.tick();
      expect(service.get(e.execution_id).status).toBe('WAITING_RECONCILIATION');
      expect(spy).not.toHaveBeenCalled();
      expect(finance.getGlobalOperation(proof.operationId)?.state).toBe(
        'UNKNOWN',
      );
      await expect(service.resume(e.execution_id)).rejects.toThrow(
        'RECONCILIATION_REQUIRED',
      );
      finance.settleGlobal(proof.operationId, {
        actualCostUsd: '0.6',
        evidenceReference: 'fixture:verified-billing',
      });
      await service.resume(e.execution_id);
      await service.tick();
      expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
      expect(finance.getGlobalOperation(proof.operationId)?.state).toBe(
        'COMPLETED',
      );
    } finally {
      spy.mockRestore();
    }
  });
  it.each(['DAILY', 'MONTHLY'])(
    'respects actual Finance %s commitments without calling providers',
    async (period) => {
      const finance = app.get(FinanceService);
      if (period === 'MONTHLY')
        finance.configureGlobal({
          dailyUsd: '1',
          monthlyUsd: '0.6',
          timeZone: 'America/Sao_Paulo',
        });
      finance.reserveGlobal(
        {
          ...p2FinancialProof(),
          operationId: 'budget_commitment',
          maximumAmount: period === 'DAILY' ? '1' : '0.6',
        },
        new Date().toISOString(),
      );
      const spy = vi.spyOn(provider, 'ideas');
      try {
        const e = await service.schedule(body);
        await service.tick();
        expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
        expect(JSON.stringify(service.history(e.execution_id))).toContain(
          `GLOBAL_${period}_BUDGET_EXCEEDED`,
        );
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('reconciles a crash after the native editorial effect and before its campaign checkpoint', async () => {
    const e = await service.schedule(body),
      db = new DatabaseSync(f.database),
      r = new CampaignRepository(db);
    let now = new Date().toISOString();
    const workflow = app.get(NativeCampaignWorkflow),
      runner = new CampaignOrchestrator(r, workflow, () => now, 1000);
    const write = r.ownedEvent.bind(r),
      scriptSpy = vi.spyOn(provider, 'script');
    const checkpointSpy = vi
      .spyOn(r, 'ownedEvent')
      .mockImplementation((...args) => {
        if (args[3] === 'STEP_DONE' && args[4].step === 'EDITORIAL')
          throw new CampaignError('CLAIM_LOST');
        return write(...args);
      });
    try {
      await runner.tick();
      expect(r.get(e.execution_id).status).toBe('RUNNING');
      checkpointSpy.mockRestore();
      now = new Date(Date.parse(now) + 2000).toISOString();
      r.recover(now);
      await runner.resume(e.execution_id);
      await runner.tick();
      expect(r.get(e.execution_id).status).toBe('WAITING_INPUT');
      expect(scriptSpy).toHaveBeenCalledTimes(1);
      expect(
        r
          .history(e.execution_id)
          .filter(
            (h) =>
              h.event_type === 'STEP_DONE' && h.evidence.step === 'EDITORIAL',
          ),
      ).toHaveLength(1);
    } finally {
      checkpointSpy.mockRestore();
      scriptSpy.mockRestore();
      db.close();
    }
  });

  it('accepts missing input references on resume and protects completed stages', async () => {
    const e = await service.schedule(body);
    await service.tick();
    await request(app.getHttpServer())
      .post(`${base}/${e.execution_id}/resume`)
      .send({ generationRequestId: 'another_script' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`${base}/${e.execution_id}/resume`)
      .send({ voiceTrackId: 'authorized_audio_pending' })
      .expect(201);
    await service.tick();
    expect(service.get(e.execution_id).status).toBe('WAITING_INPUT');
    expect(JSON.stringify(service.history(e.execution_id))).toContain(
      'LOCAL_AUDIO_NOT_FOUND',
    );
    await request(app.getHttpServer())
      .post(`${base}/${e.execution_id}/resume`)
      .send({ voiceTrackId: 'replacement_voice' })
      .expect(409);
  });
});
