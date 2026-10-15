import { localFixture } from '../../test/support/local-flow-fixture.js';
import { readFileSync } from 'node:fs';
import {
  NativeCampaignWorkflow,
  document,
} from './application/native-campaign-workflow.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { LocalRenderIntegrity } from '../media/infrastructure/local-render-integrity.js';
import { compositionPlanContentHash } from '../media/domain/composition-plan-contracts.js';
import { videoCompositionRequestHash } from '../media/domain/video-composition-contracts.js';
import { alignmentHash } from '../media/domain/alignment-contracts.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import { CampaignOrchestrator } from './application/campaign-orchestrator.js';
import { CampaignAdministration } from './application/campaign-administration.js';

test('authorized local media produces QC/preview and exact human approved handoff, with no publication', async () => {
  const f = await localFixture();
  let admin: CampaignAdministration | undefined;
  try {
    // Existing physical-media fixture contains deliberately isolated legacy FK stubs.
    // Provisioning integrity is tested separately against native schema fixtures.
    f.repository.db.exec(
      readFileSync(
        new URL(
          '../../../src/db/migrations/041_campaign_orchestration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    f.repository.db
      .prepare(
        'INSERT INTO schema_migrations(version,name,applied_at) VALUES(41,?,?)',
      )
      .run('041_campaign_orchestration', new Date().toISOString());
    f.repository.db.exec('PRAGMA user_version=41');
    const voice = {
      ...f.voice,
      audioFormat: 'wav',
      voiceTrackId: 'local_campaign_voice',
      contentHash: f.plan.voiceTrackContentHash,
      storageReference: `object:voice/sha256/${f.plan.voiceTrackContentHash}`,
      revision: 3,
      supersedesVoiceTrackId: 'voice_native_002',
      origin: 'AUTHORIZED_RECORDING',
      provider: null,
      rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
    };
    await f.flow.ingest({
      voiceTrack: voice,
      authorization: {
        actorId: 'operator_001',
        statement: 'Owned recording authorized for commercial use.',
      },
    });
    const plan = {
      ...f.plan,
      compositionPlanId: 'plan_campaign_002',
      voiceTrackId: voice.voiceTrackId,
      revision: f.plan.revision + 1,
      supersedesCompositionPlanId: f.plan.compositionPlanId,
    };
    plan.contentHash = compositionPlanContentHash(plan);
    f.media.registerCompositionPlan(plan);
    const composition = {
      ...f.request('campaign_compose'),
      compositionPlanId: plan.compositionPlanId,
      compositionPlanContentHash: plan.contentHash,
    };
    composition.contentHash = videoCompositionRequestHash(composition);
    const alignment = structuredClone(f.evidence);
    alignment.input.audioAssetId = voice.voiceTrackId;
    alignment.output.alignmentId = 'alignment_campaign_001';
    alignment.output.evidenceHash = alignmentHash(alignment);
    type Args = ConstructorParameters<typeof NativeCampaignWorkflow>;
    const affiliate = {
      getCampaign: async () => ({
        campaignId: 'campaign_001',
        revision: 1,
        projectId: f.script.projectId,
      }),
      getBriefing: async () => ({
        campaignId: 'campaign_001',
        campaignRevision: 1,
      }),
    } as unknown as Args[0];
    const binding = {
      bindRun: () => ({}),
      resolveRunBriefing: () => ({}),
    } as unknown as Args[1];
    const research = {
      getShortlist: () => ({}),
      getInsight: () => null,
    } as unknown as Args[2];
    const editorial = {
      generate: vi.fn(async () => ({
        script: f.script,
        cost: {
          amount: null,
          currency: null,
          availability: 'UNAVAILABLE' as const,
        },
      })),
    };
    const media = {
      compositionReceipt: (id: string) => f.media.compositionReceipt(id),
      getCompositionPlan: (id: string) => f.media.getCompositionPlan(id),
      getVideoRender: (id: string) => f.media.getVideoRender(id),
      verifyMedia: (ref: string) =>
        new LocalRenderIntegrity(f.renderRoot).verifyMedia(ref),
    };
    const finance = {
      getGlobalOperation: () => null,
      getGlobalUsage: () => ({
        dailyUsd: '0',
        monthlyUsd: '0',
        policy: {
          singleton: 1,
          daily_usd: '1',
          monthly_usd: '20',
          time_zone: 'America/Sao_Paulo',
        },
      }),
    };
    const workflow = new NativeCampaignWorkflow(
      affiliate,
      binding,
      research,
      editorial,
      new FakeEditorialProvider(),
      { getScript: () => f.script },
      new LocalFlowService(f.flow),
      media,
      finance,
      {
        start: async () => f.repository.getRun(f.script.pipelineRunId)!,
        get: () => f.repository.getRun(f.script.pipelineRunId)!,
      },
      { approvals: () => [] },
    );
    const r = new CampaignRepository(f.repository.db);
    f.repository.db.exec('PRAGMA foreign_keys=OFF');
    const now = new Date().toISOString();
    const input = {
      campaignId: 'campaign_001',
      campaignRevision: 1,
      scheduledAt: now,
      runId: f.script.pipelineRunId,
    };
    const e = r.schedule(
      input,
      {
        ...input,
        mode: 'LOCAL_VALIDATION',
        briefingId: 'brief_001',
        researchShortlistId: 'shortlist_001',
        generationRequestId: 'campaign_script_001',
        voiceTrackId: voice.voiceTrackId,
        alignment,
        composition,
      },
      now,
    );
    const runner = new CampaignOrchestrator(r, workflow);
    await runner.tick();
    expect(r.get(e.execution_id).status).toBe('WAITING_INPUT');
    expect(JSON.stringify(r.history(e.execution_id))).toContain(
      'EXACT_HUMAN_APPROVAL_REQUIRED',
    );
    for (const step of ['COMPOSITION', 'BURN']) {
      const history = r.history(e.execution_id),
        started = history.find(
          (h) => h.event_type === 'STEP_STARTED' && h.evidence.step === step,
        )!;
      const proof = await workflow.reconcile(
        r.get(e.execution_id),
        history.filter((h) => h.sequence <= started.sequence),
      );
      expect(proof?.step).toBe(step);
      expect(document(proof?.result).pipelineRunId).toBe(e.run_id);
    }
    const completed: Record<string, unknown> = {};
    for (const h of r.history(e.execution_id))
      if (h.event_type === 'STEP_DONE')
        completed[String(h.evidence.step)] = h.evidence.result;
    expect(document(completed.QC).result).toBe('PASS');
    expect(document(completed.PREVIEW).ready).toBe(true);
    const evidence = await workflow.approvalEvidence(
      r.get(e.execution_id),
      completed,
    );
    admin = new CampaignAdministration(f.path, workflow);
    const identity = {
      projectId: evidence.render.projectId,
      projectVersion: evidence.render.projectVersion,
      pipelineRunId: evidence.render.pipelineRunId,
      videoRenderId: evidence.render.videoRenderId,
      videoRenderRevision: evidence.render.revision,
      videoRenderContentHash: evidence.render.contentHash,
      qualityControlReportId: evidence.qc.qualityControlReportId,
      qualityControlReportContentHash: evidence.qc.contentHash,
      decision: 'APPROVED',
      actor: 'operator_001',
      justification: null,
    };
    await expect(
      admin.approve(e.execution_id, {
        ...identity,
        videoRenderContentHash: '0'.repeat(64),
      }),
    ).rejects.toThrow('HUMAN_APPROVAL_VIDEO_BINDING_MISMATCH');
    await admin.approve(e.execution_id, identity);
    await admin.resume(e.execution_id);
    await admin.tick();
    expect(r.get(e.execution_id).status).toBe('SUCCEEDED');
    const final = r
      .history(e.execution_id)
      .find((h) => h.event_type === 'COMPLETED')!;
    expect(document(final.evidence.handoff).publication).toBe('MANUAL_HANDOFF');
    expect(document(document(final.evidence.handoff).cost).status).toBe(
      'UNKNOWN',
    );
    expect(editorial.generate).toHaveBeenCalledTimes(1);
  } finally {
    await admin?.onModuleDestroy();
    f.close();
  }
});
