import { DatabaseSync } from 'node:sqlite';
import { CampaignError } from './domain/campaign.js';
import {
  compositionScope,
  compositionGrant,
} from './domain/composition-authorization.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import {
  p4ReportHash,
  temporalReportId,
} from '../media/domain/p4-qc-contracts.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import {
  CampaignOrchestrator,
  type CampaignWorkflow,
} from './application/campaign-orchestrator.js';
const at = '2026-10-15T12:00:00.000Z';
describe('campaign orchestration', () => {
  let db: DatabaseSync, r: CampaignRepository, service: CampaignOrchestrator;
  let workflow: CampaignWorkflow;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    provisionSchema(db);
    db.exec('PRAGMA foreign_keys=OFF');
    r = new CampaignRepository(db);
    workflow = {
      steps: ['EDITORIAL', 'MEDIA', 'HANDOFF'],
      execute: vi.fn(async (step) => ({ step })),
      reconcile: vi.fn(async () => null),
    };
    service = new CampaignOrchestrator(r, workflow, () => at);
  });
  afterEach(() => db.close());
  const schedule = (input: Record<string, unknown> = {}) =>
    r.schedule(
      {
        campaignId: 'campaign_001',
        campaignRevision: 1,
        scheduledAt: at,
        runId: 'run_001',
      },
      input,
      at,
    );
  it('executes concurrent ticks once and replays persisted checkpoints', async () => {
    const e = schedule();
    await Promise.all([service.tick(), service.tick()]);
    expect(r.get(e.execution_id).status).toBe('SUCCEEDED');
    expect(workflow.execute).toHaveBeenCalledTimes(3);
    await new CampaignOrchestrator(r, workflow, () => at).tick();
    expect(workflow.execute).toHaveBeenCalledTimes(3);
  });
  it('advances only the selected execution without claiming other queued campaigns', async () => {
    const first = schedule();
    const other = r.schedule(
      {
        campaignId: 'campaign_002',
        campaignRevision: 1,
        scheduledAt: at,
        runId: 'run_002',
      },
      {},
      at,
    );
    await service.tick(first.execution_id);
    expect(r.get(first.execution_id).status).toBe('SUCCEEDED');
    expect(r.get(other.execution_id).status).toBe('SCHEDULED');
    expect(workflow.execute).toHaveBeenCalledTimes(3);
  });
  it('automatically resumes a verified review after restart without replaying completed work', async () => {
    const e = schedule();
    let ready = false;
    workflow.readyToResume = vi.fn(async () => ready);
    vi.mocked(workflow.execute).mockImplementation(async (step) => {
      if (step === 'MEDIA' && !ready)
        throw Object.assign(new Error('AUTHENTICATED_MEDIA_REVIEW_REQUIRED'), {
          code: 'AUTHENTICATED_MEDIA_REVIEW_REQUIRED',
        });
      return { step };
    });
    await service.tick();
    await service.tick();
    expect(r.get(e.execution_id).status).toBe('WAITING_INPUT');
    expect(workflow.execute).toHaveBeenCalledTimes(2);
    ready = true;
    await Promise.all([
      new CampaignOrchestrator(r, workflow, () => at).tick(),
      new CampaignOrchestrator(r, workflow, () => at).tick(),
    ]);
    expect(r.get(e.execution_id).status).toBe('SUCCEEDED');
    expect(
      vi.mocked(workflow.execute).mock.calls.filter(([s]) => s === 'EDITORIAL'),
    ).toHaveLength(1);
    expect(
      vi.mocked(workflow.execute).mock.calls.filter(([s]) => s === 'HANDOFF'),
    ).toHaveLength(1);
  });
  it('reconciles an interrupted local stage automatically only with verified evidence', async () => {
    const e = schedule({
      mode: 'LOCAL_VALIDATION',
      videoProduction: { mode: 'ASSISTED_LOCAL' },
    });
    const claimed = r.claim(e.execution_id, at, 1000)!;
    r.ownedEvent(e.execution_id, claimed.claim_token!, at, 'STEP_STARTED', {
      step: 'MEDIA_QC',
    });
    const later = () => '2026-10-15T12:00:02.000Z';
    const restarted = new CampaignOrchestrator(r, workflow, later);
    await restarted.tick();
    expect(r.get(e.execution_id).status).toBe('WAITING_RECONCILIATION');
    vi.mocked(workflow.reconcile).mockResolvedValue({
      verified: true,
      reason: 'LOCAL_REPLAY_SAFE',
    });
    await restarted.tick();
    expect(r.get(e.execution_id).status).toBe('SUCCEEDED');
  });
  it.each([
    { mode: 'PRODUCTION' },
    {
      mode: 'LOCAL_VALIDATION',
      videoProduction: { mode: 'ASSISTED_LOCAL' },
      publication: { accountId: '123456' },
    },
  ])(
    'never automatically recovers a production/publication execution: %j',
    async (input) => {
      const e = schedule(input);
      const claimed = r.claim(e.execution_id, at, 1000)!;
      r.ownedEvent(e.execution_id, claimed.claim_token!, at, 'STEP_STARTED', {
        step: 'AUDIO',
      });
      vi.mocked(workflow.reconcile).mockResolvedValue({ verified: true });
      await new CampaignOrchestrator(
        r,
        workflow,
        () => '2026-10-15T12:00:02.000Z',
      ).tick();
      expect(r.get(e.execution_id).status).toBe('WAITING_RECONCILIATION');
      expect(workflow.reconcile).not.toHaveBeenCalled();
    },
  );
  it.each([
    'EDITORIAL_PROVIDER_UNAVAILABLE',
    'AUDIO_REQUIRED',
    'ALIGNMENT_CONFIGURATION_REQUIRED',
    'GLOBAL_DAILY_BUDGET_EXCEEDED',
    'GLOBAL_MONTHLY_BUDGET_EXCEEDED',
    'GLOBAL_PRICE_UNPROVEN',
  ])('waits for %s', async (code) => {
    const e = schedule();
    vi.mocked(workflow.execute).mockRejectedValue(
      Object.assign(new Error(code), { code }),
    );
    await service.tick();
    expect(r.get(e.execution_id).status).toBe('WAITING_INPUT');
  });
  it.each(['FINANCE_UNKNOWN', 'EXTERNAL_EFFECT_UNCERTAIN'])(
    'never retries %s',
    async (code) => {
      const e = schedule();
      vi.mocked(workflow.execute).mockRejectedValue(
        Object.assign(new Error(code), { code, transient: true }),
      );
      await service.tick();
      expect(r.get(e.execution_id).status).toBe('WAITING_RECONCILIATION');
      expect(workflow.execute).toHaveBeenCalledTimes(1);
      await expect(service.resume(e.execution_id)).rejects.toThrow(
        'RECONCILIATION_REQUIRED',
      );
    },
  );
  it('retries known safe transient failure at most 3 times, including resumes', async () => {
    const e = schedule();
    vi.mocked(workflow.execute).mockRejectedValue(
      Object.assign(new Error('UNAVAILABLE'), {
        code: 'LOCAL_TEMPORARY',
        retrySafe: true,
        transient: true,
      }),
    );
    await service.tick();
    expect(workflow.execute).toHaveBeenCalledTimes(3);
    expect(r.get(e.execution_id).status).toBe('FAILED');
    await service.resume(e.execution_id);
    await service.tick();
    expect(workflow.execute).toHaveBeenCalledTimes(3);
  });
  it('preserves completed stages through waiting and restart', async () => {
    const e = schedule();
    vi.mocked(workflow.execute).mockImplementation(async (step) => {
      if (step === 'MEDIA')
        throw Object.assign(new Error('AUDIO_REQUIRED'), {
          code: 'AUDIO_REQUIRED',
        });
      return { step };
    });
    await service.tick();
    expect(r.get(e.execution_id).status).toBe('WAITING_INPUT');
    vi.mocked(workflow.execute).mockImplementation(async (step) => ({ step }));
    await service.resume(e.execution_id);
    await new CampaignOrchestrator(r, workflow, () => at).tick();
    expect(r.get(e.execution_id).status).toBe('SUCCEEDED');
    expect(
      vi
        .mocked(workflow.execute)
        .mock.calls.filter((c) => c[0] === 'EDITORIAL'),
    ).toHaveLength(1);
  });
  it('does not dispatch further stages after cancellation during an effect', async () => {
    const e = schedule();
    vi.mocked(workflow.execute).mockImplementation(async () => {
      r.cancel(e.execution_id, at);
      return {};
    });
    await service.tick();
    expect(r.get(e.execution_id).status).toBe('CANCELLED');
    expect(workflow.execute).toHaveBeenCalledTimes(1);
  });
  it('QC failure is terminal and never produces handoff', async () => {
    const e = schedule();
    vi.mocked(workflow.execute).mockRejectedValue(
      Object.assign(new Error('QC_FAILED'), { code: 'QC_FAILED' }),
    );
    await service.tick();
    expect(r.get(e.execution_id).status).toBe('FAILED');
  });
  it('requires adapter verification before resuming an expired claim', async () => {
    const e = schedule();
    r.claim(e.execution_id, at, 1000);
    r.recover('2026-10-15T12:00:02.000Z');
    await expect(service.resume(e.execution_id)).rejects.toThrow(
      'RECONCILIATION_REQUIRED',
    );
    vi.mocked(workflow.reconcile).mockResolvedValue({ verified: true });
    await service.resume(e.execution_id);
    expect(r.get(e.execution_id).status).toBe('SCHEDULED');
  });
});

describe('offline automatic finalization', () => {
  const hash = 'a'.repeat(64);
  function setup() {
    const script = {
      scriptId: 'script_001',
      contentHash: hash,
      pipelineRunId: 'run_001',
      projectId: 'project_001',
      projectVersion: 1,
      visualDirections: [{ position: 1 }],
    };
    const asset: any = {
      schemaVersion: 'media-asset/2.0.0',
      mediaAssetId: 'media_001',
      contentHash: hash,
      mediaReference: `media:sha256_${hash}`,
      assetType: 'VIDEO',
      pipelineRunId: 'run_001',
      projectId: 'project_001',
      projectVersion: 1,
      scriptId: 'script_001',
      scriptContentHash: hash,
      visualDirectionPosition: 1,
      technicalProperties: {
        durationMilliseconds: 10000,
        mimeType: 'video/mp4',
      },
      rights: {
        commercialUseAllowed: true,
        evidence: [
          {
            kind: 'MEDIA_USAGE_RIGHT',
            mediaAuthorization: {
              mediaRef: `media:sha256_${hash}`,
              contentHash: hash,
              localProcessing: true,
              processing: 'GRANTED',
              commercialUse: 'GRANTED',
            },
          },
        ],
      },
    };
    const identity = {
      mediaAssetId: asset.mediaAssetId,
      mediaReference: asset.mediaReference,
      contentHash: hash,
      scriptContentHash: hash,
      visualDirectionPosition: 1,
    };
    const report = (decision: string | null) => {
      const status =
        decision === 'APPROVED'
          ? 'PASS'
          : decision === 'REJECTED'
            ? 'FAIL'
            : 'NOT_VALIDATED';
      const evidence = {
        ...identity,
        motion: status,
        continuity: status,
        fidelity: status,
        motionBasis: decision === 'APPROVED' ? 'SUBJECT_MOTION' : 'UNKNOWN',
        provenance: {
          reference: 'fixture:qc',
          contentHash: hash,
          validator: decision
            ? 'authenticated-human-qc'
            : 'offline-temporal-ffmpeg',
          version: '1',
          parameters: decision
            ? { humanReview: { decision } }
            : { offline: true },
        },
      };
      delete (evidence as any).mediaAssetId;
      delete (evidence as any).scriptContentHash;
      delete (evidence as any).visualDirectionPosition;
      const value = {
        schemaVersion: 'temporal-quality-control/1.0.0',
        identity,
        evidence,
        result: status,
        qualityControlReportId: temporalReportId(identity, evidence as any),
        contentHash: '',
      };
      value.contentHash = p4ReportHash(value);
      return value;
    };
    const media = {
      get: vi.fn(() => asset),
      listScript: vi.fn(() => [asset]),
      evaluateTemporalMedia: vi.fn(async () => report('APPROVED')),
      temporalReview: vi.fn(() => null as ReturnType<typeof report> | null),
      acquisition: vi.fn(() => ({ requestHash: hash, mediaAsset: asset })),
      registerCompositionPlan: vi.fn((p) => p),
      getCompositionPlan: vi.fn(),
      getVideoRender: vi.fn(),
      verifyMedia: vi.fn(),
      compositionReceipt: vi.fn(),
    };
    const local = {
      automaticAudioReady: vi.fn(() => false),
      automaticAudio: vi.fn(async () => {
        throw new CampaignError('LOCAL_TTS_CONFIGURATION_REQUIRED');
      }),
      authorizedAudio: vi.fn(() => ({
        voiceTrackId: 'voice_001',
        contentHash: hash,
        durationMilliseconds: 10000,
      })),
      compose: vi.fn(async (_request: unknown) => ({
        videoRenderId: 'render_001',
      })),
      alignAudio: vi.fn(async () => ({
        input: { scriptId: script.scriptId, audioAssetId: 'voice_001' },
        output: { alignmentId: 'align_001' },
      })),
      subtitles: vi.fn(() => ({ subtitleId: 'subtitle_001' })),
      burn: vi.fn(async () => ({
        videoRenderId: 'final_001',
        contentHash: hash,
        containerFormat: 'mp4',
      })),
      qc: vi.fn(async () => ({ reportId: 'qc_001', result: 'PASS' })),
      preview: vi.fn(async () => ({
        ready: true,
        url: '/media/local/previews/final_001/file',
      })),
    };
    const finance = {
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
    };
    const workflow = new NativeCampaignWorkflow(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { getScript: () => script } as any,
      local as unknown as LocalFlowService,
      media as any,
      finance as any,
      {} as any,
      { approvals: () => [] } as any,
      undefined,
      { media, preparations: {} as any, generation: {} as any },
    );
    const execution = {
      execution_id: 'execution_001',
      run_id: 'run_001',
      campaign_id: 'campaign_001',
      scheduled_at: at,
      status: 'RUNNING',
    } as any;
    const request = {
      campaignId: 'campaign_001',
      runId: 'run_001',
      mode: 'LOCAL_VALIDATION',
      generationRequestId: 'generation_001',
      videoProduction: { mode: 'ASSISTED_LOCAL' },
    };
    const done: Record<string, any> = {
      EDITORIAL: { script },
      SCENES: {
        scenes: [{ position: 1, sceneMediaType: 'GENERATED_VIDEO' }],
        contentHash: hash,
      },
    };
    asset.origin = 'PROVIDER_GENERATED';
    return {
      workflow,
      execution,
      request,
      done,
      media,
      local,
      asset,
      report,
      finance,
    };
  }
  it('generates local speech only after QC and preserves automatic downstream steps', async () => {
    const f = setup();
    f.local.authorizedAudio.mockReturnValue(null as any);
    f.local.automaticAudio.mockResolvedValue({
      voiceTrackId: 'voice_001',
      contentHash: hash,
      durationMilliseconds: 10000,
    } as never);
    await expect(
      f.workflow.execute('AUDIO', f.execution, f.request, f.done),
    ).rejects.toThrow('AUTHENTICATED_MEDIA_REVIEW_REQUIRED');
    expect(f.local.automaticAudio).not.toHaveBeenCalled();
    f.media.temporalReview.mockReturnValue(f.report('APPROVED'));
    f.done.MEDIA_QC = await f.workflow.execute(
      'MEDIA_QC',
      f.execution,
      f.request,
      f.done,
    );
    f.done.AUDIO = await f.workflow.execute(
      'AUDIO',
      f.execution,
      f.request,
      f.done,
    );
    expect(f.local.automaticAudio).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineRunId: 'run_001' }),
      10000,
    );
    // The persisted authorized audio is used by the existing composition gate.
    f.local.authorizedAudio.mockReturnValue({
      voiceTrackId: 'voice_001',
      contentHash: hash,
      durationMilliseconds: 10000,
    });
    f.done.ALIGNMENT = await f.workflow.execute(
      'ALIGNMENT',
      f.execution,
      f.request,
      f.done,
    );
    f.done.SUBTITLES = await f.workflow.execute(
      'SUBTITLES',
      f.execution,
      f.request,
      f.done,
    );
    await f.workflow.execute('COMPOSITION', f.execution, f.request, f.done);
    expect(f.local.alignAudio).toHaveBeenCalledWith('voice_001');
    expect(f.local.subtitles).toHaveBeenCalled();
    expect(f.local.compose).toHaveBeenCalled();
  });
  it('manual selection and Finance exhaustion cannot dispatch local synthesis', async () => {
    const f = setup();
    f.local.authorizedAudio.mockReturnValue(null as any);
    await expect(
      f.workflow.execute(
        'AUDIO',
        f.execution,
        { ...f.request, audioMode: 'RECORDING' },
        f.done,
      ),
    ).rejects.toThrow('AUDIO_REQUIRED');
    f.finance.getGlobalUsage = () => ({
      dailyUsd: '1',
      monthlyUsd: '1',
      policy: {
        time_zone: 'America/Sao_Paulo',
        daily_usd: '1',
        monthly_usd: '20',
      },
    });
    await expect(
      f.workflow.execute('AUDIO', f.execution, f.request, f.done),
    ).rejects.toThrow('GLOBAL_DAILY_BUDGET_EXCEEDED');
    expect(f.local.automaticAudio).not.toHaveBeenCalled();
  });
  it('discovers persisted media, audio and generates a deterministic V2 request', async () => {
    const f = setup();
    f.done.MEDIA_QC = await f.workflow.execute(
      'MEDIA_QC',
      f.execution,
      f.request,
      f.done,
    );
    f.done.AUDIO = await f.workflow.execute(
      'AUDIO',
      f.execution,
      f.request,
      f.done,
    );
    await f.workflow.execute('ALIGNMENT', f.execution, f.request, f.done);
    await f.workflow.execute('COMPOSITION', f.execution, f.request, f.done);
    await f.workflow.execute('COMPOSITION', f.execution, f.request, f.done);
    expect(f.media.registerCompositionPlan.mock.calls[0][0]).toMatchObject({
      schemaVersion: 'composition-plan/2.0.0',
      voiceTrackId: 'voice_001',
      voiceTrackContentHash: hash,
    });
    expect(f.local.compose.mock.calls[0]).toEqual(
      f.local.compose.mock.calls[1],
    );
  });
  it.each([null, 'REJECTED'])('distinguishes review %s', async (decision) => {
    const f = setup();
    f.media.evaluateTemporalMedia.mockResolvedValue(f.report(decision));
    await expect(
      f.workflow.execute('MEDIA_QC', f.execution, f.request, f.done),
    ).rejects.toThrow(
      decision ? 'MEDIA_REVIEW_REJECTED' : 'COMPLETE_TEMPORAL_QC_REQUIRED',
    );
    expect(f.local.compose).not.toHaveBeenCalled();
  });
  it('waits for missing audio and never substitutes TTS', async () => {
    const f = setup();
    f.local.authorizedAudio.mockReturnValue(null as any);
    await expect(
      f.workflow.execute(
        'AUDIO',
        f.execution,
        { ...f.request, audioMode: 'RECORDING' },
        f.done,
      ),
    ).rejects.toThrow('AUDIO_REQUIRED');
  });
  it('does not expand review-only campaign rights into composition', async () => {
    const f = setup();
    Object.assign(f.asset.rights.evidence[0].mediaAuthorization, {
      campaignId: 'campaign_001',
      purpose: 'HUMAN_QC_REVIEW',
      operationScope: 'operation_001',
    });
    f.done.MEDIA_QC = { reports: [f.report('APPROVED')] };
    f.done.AUDIO = { voiceTrackId: 'voice_001' };
    await expect(
      f.workflow.execute('COMPOSITION', f.execution, f.request, f.done),
    ).rejects.toThrow('COMPOSITION_RIGHTS_REQUIRED');
    expect(f.local.compose).not.toHaveBeenCalled();
  });
  it('composes review-scoped media only after explicit exact-scope authorization', async () => {
    const f = setup();
    Object.assign(f.asset.rights.evidence[0].mediaAuthorization, {
      campaignId: 'campaign_001',
      purpose: 'HUMAN_QC_REVIEW',
    });
    f.done.MEDIA_QC = { reports: [f.report('APPROVED')] };
    f.done.AUDIO = { voiceTrackId: 'voice_001' };
    f.done.ALIGNMENT = { verified: true };
    f.done.SUBTITLES = { subtitleId: 'subtitle_001' };
    const p = compositionScope(f.execution, f.done);
    f.done.COMPOSITION_AUTHORIZATION = compositionGrant(
      f.execution,
      f.done,
      {
        scopeHash: p.scopeHash,
        acceptsCompositionRights: true,
        audioIntelligible: true,
        sourceRef: 'fixture/license',
        statement:
          'Explicit fixture authorization for local commercial composition.',
      },
      'operator_001',
      new Date().toISOString(),
    );
    await f.workflow.execute('COMPOSITION', f.execution, f.request, f.done);
    expect(f.local.compose).toHaveBeenCalledTimes(1);
  });
  it('accepts campaign-scoped rights only for the matching review operation', async () => {
    const f = setup();
    Object.assign(f.asset.rights.evidence[0].mediaAuthorization, {
      campaignId: 'campaign_001',
      purpose: 'HUMAN_QC_REVIEW',
      operationScope: 'operation_001',
    });
    expect(
      await f.workflow.execute('MEDIA_QC', f.execution, f.request, f.done),
    ).toHaveProperty('reports');
    expect(f.media.acquisition).toHaveBeenCalledWith('operation_001');
    f.asset.rights.evidence[0].mediaAuthorization.campaignId = 'other_campaign';
    await expect(
      f.workflow.execute('MEDIA_QC', f.execution, f.request, f.done),
    ).rejects.toThrow('CAMPAIGN_MEDIA_RIGHTS_MISMATCH');
    f.asset.rights.evidence[0].mediaAuthorization.campaignId = 'campaign_001';
    f.media.acquisition.mockReturnValue({
      requestHash: hash,
      mediaAsset: { ...f.asset, contentHash: 'b'.repeat(64) },
    });
    await expect(
      f.workflow.execute('MEDIA_QC', f.execution, f.request, f.done),
    ).rejects.toThrow('MEDIA_PROCESSING_RIGHTS_REQUIRED');
  });
  it('continues through final MP4 and preview, then stops at independent HANDOFF approval', async () => {
    const f = setup();
    f.media.getVideoRender.mockReturnValue({
      videoRenderId: 'final_001',
      contentHash: hash,
    } as any);
    f.media.verifyMedia.mockReturnValue(hash as any);
    const db = new DatabaseSync(':memory:');
    provisionSchema(db);
    db.exec('PRAGMA foreign_keys=OFF');
    const repository = new CampaignRepository(db);
    try {
      const execution = repository.schedule(
        {
          campaignId: 'campaign_001',
          campaignRevision: 1,
          scheduledAt: at,
          runId: 'run_001',
        },
        f.request,
        at,
      );
      const execute = f.workflow.execute.bind(f.workflow);
      vi.spyOn(f.workflow, 'execute').mockImplementation(
        async (step, e, r, done) => {
          if (step === 'CONTEXT' || step === 'VIDEO_GENERATION') return {};
          if (step === 'EDITORIAL') return f.done.EDITORIAL;
          if (step === 'SCENES') return f.done.SCENES;
          return execute(step, e, r, done);
        },
      );
      const runner = new CampaignOrchestrator(repository, f.workflow, () => at);
      await runner.tick();
      expect(repository.get(execution.execution_id).status).toBe(
        'WAITING_INPUT',
      );
      expect(
        repository.history(execution.execution_id).at(-1)?.evidence.code,
      ).toBe('EXACT_HUMAN_APPROVAL_REQUIRED');
      const preview = repository
        .history(execution.execution_id)
        .find(
          (h) => h.event_type === 'STEP_DONE' && h.evidence.step === 'PREVIEW',
        );
      expect(preview?.evidence.result).toMatchObject({
        ready: true,
        url: '/media/local/previews/final_001/file',
      });
      await new CampaignOrchestrator(repository, f.workflow, () => at).tick();
      expect(f.local.compose).toHaveBeenCalledTimes(1);
      expect(f.local.burn).toHaveBeenCalledTimes(1);
      expect(
        repository
          .history(execution.execution_id)
          .some((h) => h.evidence.step === 'PUBLICATION'),
      ).toBe(false);
    } finally {
      db.close();
    }
  });
  it('does not resume pending review or missing audio and does not poll paid effects', async () => {
    const f = setup();
    const history = (step: string, code: string) =>
      [
        { sequence: 1, evidence: f.request, event_type: 'SCHEDULED' },
        {
          sequence: 2,
          event_type: 'STEP_DONE',
          evidence: { step: 'EDITORIAL', result: f.done.EDITORIAL },
        },
        { sequence: 3, event_type: 'PAUSED', evidence: { step, code } },
      ] as any;
    expect(
      await f.workflow.readyToResume(
        f.execution,
        history('MEDIA_QC', 'COMPLETE_TEMPORAL_QC_REQUIRED'),
      ),
    ).toBe(false);
    f.local.authorizedAudio.mockReturnValue(null as any);
    expect(
      await f.workflow.readyToResume(
        f.execution,
        history('AUDIO', 'AUDIO_REQUIRED'),
      ),
    ).toBe(false);
    expect(
      await f.workflow.readyToResume(
        f.execution,
        history('PUBLICATION', 'SOCIAL_PROCESSING_REQUIRED'),
      ),
    ).toBe(false);
    expect(f.media.evaluateTemporalMedia).not.toHaveBeenCalled();
    f.media.temporalReview.mockReturnValue(f.report('APPROVED'));
    expect(
      await f.workflow.readyToResume(
        f.execution,
        history('MEDIA_QC', 'COMPLETE_TEMPORAL_QC_REQUIRED'),
      ),
    ).toBe(true);
    f.media.temporalReview.mockImplementation(() => {
      throw Object.assign(new Error('stale'), {
        code: 'HUMAN_APPROVAL_REVIEW_STALE',
      });
    });
    expect(
      await f.workflow.readyToResume(
        f.execution,
        history('MEDIA_QC', 'COMPLETE_TEMPORAL_QC_REQUIRED'),
      ),
    ).toBe(false);
  });
  it('recovers interrupted automatic composition using the same identity, rejecting a divergent receipt', async () => {
    const f = setup();
    f.done.MEDIA_QC = { reports: [f.report('APPROVED')] };
    f.done.AUDIO = { voiceTrackId: 'voice_001' };
    const history = [
      { sequence: 1, event_type: 'SCHEDULED', evidence: f.request },
      ...Object.entries(f.done).map(([step, result], index) => ({
        sequence: index + 2,
        event_type: 'STEP_DONE',
        evidence: { step, result },
      })),
      {
        sequence: 10,
        event_type: 'STEP_STARTED',
        evidence: { step: 'COMPOSITION' },
      },
    ] as any;
    expect(await f.workflow.reconcile(f.execution, history)).toEqual({
      verified: true,
      reason: 'LOCAL_COMPOSITION_REPLAY_SAFE',
    });
    expect(f.local.compose).not.toHaveBeenCalled();
    f.media.compositionReceipt.mockReturnValue({ requestHash: 'wrong' } as any);
    expect(await f.workflow.reconcile(f.execution, history)).toBeNull();
  });
  it.each([
    'CAMPAIGN_SCENE_MEDIA_MISMATCH',
    'MEDIA_SELECTION_REQUIRED',
    'AUDIO_VIDEO_DURATION_REQUIRED',
  ])('blocks invalid automatic inputs: %s', async (code) => {
    const f = setup();
    if (code === 'CAMPAIGN_SCENE_MEDIA_MISMATCH')
      f.asset.pipelineRunId = 'other_run';
    if (code === 'MEDIA_SELECTION_REQUIRED')
      f.media.listScript.mockReturnValue([
        f.asset,
        { ...f.asset, mediaAssetId: 'media_other' },
      ]);
    if (code === 'AUDIO_VIDEO_DURATION_REQUIRED') {
      f.done.MEDIA_QC = { reports: [f.report('APPROVED')] };
      f.done.AUDIO = { voiceTrackId: 'voice_001' };
      f.local.authorizedAudio.mockReturnValue({
        voiceTrackId: 'voice_001',
        contentHash: hash,
        durationMilliseconds: 20000,
      });
    }
    const request =
      code === 'CAMPAIGN_SCENE_MEDIA_MISMATCH'
        ? { ...f.request, sceneMediaAssetIds: ['media_001'] }
        : f.request;
    await expect(
      f.workflow.execute(
        code === 'AUDIO_VIDEO_DURATION_REQUIRED' ? 'COMPOSITION' : 'MEDIA_QC',
        f.execution,
        request,
        f.done,
      ),
    ).rejects.toThrow(code);
    expect(f.local.compose).not.toHaveBeenCalled();
  });
});
