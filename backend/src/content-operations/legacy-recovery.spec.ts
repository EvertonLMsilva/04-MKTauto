import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import {
  CampaignOrchestrator,
  recoveredContext,
} from './application/campaign-orchestrator.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';

const bytes = Buffer.from('authorized offline video');
const hash = createHash('sha256').update(bytes).digest('hex');
const script = {
  scriptId: 'legacy_script',
  contentHash: 'a'.repeat(64),
  pipelineRunId: 'legacy_run',
  projectId: 'project_001',
  projectVersion: 1,
  visualDirections: [{ position: 1 }],
};
const asset: any = {
  mediaAssetId: 'media_review',
  assetType: 'VIDEO',
  pipelineRunId: 'legacy_run',
  projectId: 'project_001',
  projectVersion: 1,
  scriptId: script.scriptId,
  scriptContentHash: script.contentHash,
  visualDirectionPosition: 1,
  contentHash: hash,
  mediaReference: 'media:legacy',
  origin: 'PROVIDER_GENERATED',
  supersedesMediaAssetId: 'media_original',
  rights: {
    commercialUseAllowed: true,
    evidence: [
      {
        kind: 'MEDIA_USAGE_RIGHT',
        mediaAuthorization: {
          mediaRef: 'media:legacy',
          contentHash: hash,
          localProcessing: true,
          processing: 'GRANTED',
          commercialUse: 'GRANTED',
          campaignId: 'legacy_campaign',
          purpose: 'HUMAN_QC_REVIEW',
          operationScope: 'legacy_operation',
        },
      },
    ],
  },
};
function fixture() {
  const media: any = {
    get: vi.fn((id) =>
      id === 'media_review'
        ? asset
        : {
            ...asset,
            mediaAssetId: 'media_original',
            supersedesMediaAssetId: null,
          },
    ),
    listScript: () => [asset],
    acquisition: () => ({
      mediaAsset: { ...asset, mediaAssetId: 'media_original' },
    }),
    reviewMediaBytes: vi.fn(async () => bytes),
  };
  const binding: any = {
    resolveRunBriefing: () => ({
      briefingId: 'legacy_brief',
      campaignId: 'legacy_campaign',
      campaignRevision: 1,
    }),
  };
  const workflow = new NativeCampaignWorkflow(
    {
      getCampaign: async () => ({
        campaignId: 'legacy_campaign',
        revision: 1,
        projectId: 'project_001',
      }),
      getBriefing: async () => ({}),
    } as any,
    binding,
    {} as any,
    {} as any,
    {} as any,
    { getScript: () => script } as any,
    {} as any,
    {} as any,
    { getGlobalOperation: () => ({ state: 'COMPLETED' }) } as any,
    {
      get: () => ({
        pipelineRunId: 'legacy_run',
        projectId: 'project_001',
        projectVersion: 1,
        state: 'RUNNING',
        startedAt: '2026-10-17T12:00:00.000Z',
      }),
    } as any,
    {} as any,
    undefined,
    { media } as any,
  );
  return { workflow, media };
}
const input = {
  campaignId: 'legacy_campaign',
  runId: 'legacy_run',
  media: [
    {
      mediaAssetId: 'media_review',
      contentHash: hash,
      referenceId: 'reference_001',
    },
  ],
};
it('verifies existing evidence and never invokes upstream generation', async () => {
  const { workflow, media } = fixture();
  const request = await workflow.recoverLegacy(input);
  expect(request.legacyRecovery).toMatchObject({
    provenance: 'LEGACY_RECOVERY',
    notExecutedByCurrentOrchestrator: [
      'CONTEXT',
      'EDITORIAL',
      'SCENES',
      'VIDEO_GENERATION',
    ],
  });
  expect(request).not.toHaveProperty('researchShortlistId');
  expect(request).not.toHaveProperty('generationRequestId');
  expect(media.reviewMediaBytes).toHaveBeenCalledTimes(2);
});
it.each([
  'hash',
  'campaign',
  'origin',
  'bytes',
  'reference',
  'rights',
  'finance',
])('rejects divergent %s before registering execution', async (kind) => {
  const { workflow, media } = fixture();
  const value = structuredClone(input);
  if (kind === 'hash') value.media[0].contentHash = 'b'.repeat(64);
  if (kind === 'campaign') value.campaignId = 'other_campaign';
  if (kind === 'origin') media.acquisition = () => null;
  if (kind === 'bytes')
    media.reviewMediaBytes = async () => Buffer.from('tampered');
  if (kind === 'reference')
    media.reviewMediaBytes = async (_id, _ref, kind) => {
      if (kind === 'reference') throw new Error('REFERENCE_HASH_MISMATCH');
      return bytes;
    };
  if (kind === 'rights')
    media.get = () => ({
      ...asset,
      rights: { ...asset.rights, commercialUseAllowed: false },
    });
  if (kind === 'finance')
    (workflow as any).finance = {
      getGlobalOperation: () => ({ state: 'UNKNOWN' }),
    };
  await expect(workflow.recoverLegacy(value)).rejects.toThrow();
});
it('recovers atomically, replays after restart, skips upstream stages without STEP_DONE fiction', async () => {
  const { workflow } = fixture();
  const request = await workflow.recoverLegacy(input);
  const db = new DatabaseSync(':memory:');
  provisionSchema(db);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    const store = new CampaignRepository(db);
    const identity = {
      campaignId: 'legacy_campaign',
      campaignRevision: 1,
      runId: 'legacy_run',
      scheduledAt: String(request.scheduledAt),
    };
    const a = store.schedule(identity, request, '2026-10-18T12:00:00.000Z');
    const b = new CampaignRepository(db).schedule(
      identity,
      request,
      '2026-10-18T12:01:00.000Z',
    );
    expect(b.execution_id).toBe(a.execution_id);
    expect(recoveredContext(store.history(a.execution_id)).EDITORIAL).toEqual({
      script,
    });
    const execute = vi.fn(async () => {
      throw Object.assign(new Error(), {
        code: 'COMPLETE_TEMPORAL_QC_REQUIRED',
      });
    });
    const runner = new CampaignOrchestrator(
      store,
      { steps: workflow.steps, execute, reconcile: async () => null },
      () => '2026-10-18T12:02:00.000Z',
    );
    await Promise.all([
      runner.tick(a.execution_id),
      runner.tick(a.execution_id),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBe('MEDIA_QC');
    expect(store.get(a.execution_id).status).toBe('WAITING_INPUT');
    const history = store.history(a.execution_id);
    expect(history[0].event_type).toBe('LEGACY_RECOVERY');
    expect(history.some((h) => h.event_type === 'STEP_DONE')).toBe(false);
  } finally {
    db.close();
  }
});

it('only the recovery entry can register recovery provenance', async () => {
  const { workflow } = fixture();
  const request = await workflow.recoverLegacy(input);
  const admin = new CampaignAdministration(null, workflow);
  await expect(admin.schedule(request)).rejects.toThrow(
    'LEGACY_RECOVERY_ENDPOINT_REQUIRED',
  );
});
it('uses recovered script context to resume only after persisted QC is satisfied', async () => {
  const { workflow, media } = fixture();
  const request = await workflow.recoverLegacy(input);
  const history: any = [
    { event_type: 'LEGACY_RECOVERY', evidence: request },
    {
      event_type: 'PAUSED',
      evidence: { step: 'MEDIA_QC', code: 'COMPLETE_TEMPORAL_QC_REQUIRED' },
    },
  ];
  const execution: any = {
    run_id: 'legacy_run',
    campaign_id: 'legacy_campaign',
  };
  media.temporalReview = () => null;
  expect(await workflow.readyToResume(execution, history)).toBe(false);
  media.temporalReview = () => ({ result: 'PASS' });
  expect(await workflow.readyToResume(execution, history)).toBe(true);
  media.temporalReview = () => ({ result: 'FAIL' });
  expect(await workflow.readyToResume(execution, history)).toBe(true);
});

it('enters real native QC using recovered context without fabricated SCENES', async () => {
  const { workflow, media } = fixture();
  const request = await workflow.recoverLegacy(input);
  media.evaluateTemporalMedia = async () => {
    throw Object.assign(new Error(), { code: 'AUTHENTICATED_HUMAN_REVIEW_REQUIRED' });
  };
  await expect(workflow.execute('MEDIA_QC', { campaign_id: 'legacy_campaign', run_id: 'legacy_run' } as any, request, { EDITORIAL: { script } })).rejects.toThrow('AUTHENTICATED_MEDIA_REVIEW_REQUIRED');
});
