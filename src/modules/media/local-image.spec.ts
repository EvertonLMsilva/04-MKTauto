import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import { LocalEvidenceStorage } from './infrastructure/local-evidence-storage.js';
import { validateMediaAsset } from './domain/media-asset-contracts.js';
import {
  campaignRequest,
  NativeCampaignWorkflow,
} from '../content-operations/application/native-campaign-workflow.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);

test('image preparation verifies physical bytes, rights and script before registering stable identities', () => {
  const root = mkdtempSync(join(tmpdir(), 'mkt-image-'));
  try {
    const hash = new LocalEvidenceStorage(root).put(png(), 'png');
    const source: any = {
      contentHash: hash,
      mediaReference: `media:sha256_${hash}`,
      origin: 'OPERATOR_OWNED',
      provider: null,
      rights: {
        usageBasis: 'OWNED',
        commercialUseAllowed: true,
        evidence: [
          {
            id: 'image_right',
            kind: 'MEDIA_USAGE_RIGHT',
            sourceRef: 'test:authorization',
            recordedAt: '2026-10-18T00:00:00Z',
            mediaAuthorization: {
              mediaRef: `media:sha256_${hash}`,
              contentHash: hash,
              commercialUse: 'GRANTED',
              processing: 'GRANTED',
              localProcessing: true,
              externalProviders: [],
            },
          },
        ],
      },
    };
    const script = {
      scriptId: 'script_001',
      pipelineRunId: 'run_001',
      projectId: 'project_001',
      projectVersion: 1,
      contentHash: 'a'.repeat(64),
      visualDirections: [{ position: 1 }],
    };
    const register = vi.fn(validateMediaAsset);
    const runtime = new LocalFlowRuntime(
      () => ({ getScript: () => script, close: () => {} }) as any,
      { register } as any,
      { FFMPEG_MEDIA_ROOT: root },
    );
    const scope = {
      pipelineRunId: 'run_001',
      scriptId: 'script_001',
      scriptContentHash: script.contentHash,
      createdAt: '2026-10-18T00:00:00Z',
    };
    const first = runtime.prepareImage(scope, source);
    expect(first.assetType).toBe('IMAGE');
    expect(runtime.prepareImage(scope, source)).toEqual(first);
    expect(() =>
      runtime.prepareImage(
        { ...scope, scriptContentHash: 'b'.repeat(64) },
        source,
      ),
    ).toThrow('LOCAL_SCRIPT_BINDING_INVALID');
    source.rights.evidence[0].mediaAuthorization.processing = 'UNKNOWN';
    expect(() => runtime.prepareImage(scope, source)).toThrow();
    expect(register).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('image fallback is explicit, local only and cannot request publication or substitute a plan', () => {
  const r = {
    campaignId: 'camp_001',
    campaignRevision: 1,
    scheduledAt: '2026-10-18T00:00:00Z',
    runId: 'run_001',
    briefingId: 'brief_001',
    generationRequestId: 'gen_001',
    researchShortlistId: null,
    mode: 'LOCAL_VALIDATION',
    videoProduction: { mode: 'LOCAL_IMAGES' },
    localImage: {},
  };
  expect(campaignRequest(r).researchShortlistId).toBeNull();
  for (const changes of [
    { mode: 'PRODUCTION' },
    { publication: {} },
    { composition: {} },
    { localImage: undefined },
  ])
    expect(() => campaignRequest({ ...r, ...changes })).toThrow();
});

test('image composition keeps static and video motion policies separate and verifies QC identities', async () => {
  const plan = {
    schemaVersion: 'composition-plan/2.0.0',
    pipelineRunId: 'run_001',
    scriptId: 'script_001',
    voiceTrackId: 'voice_001',
    segments: [
      {
        mediaAssetId: 'image_001',
        mediaAssetContentHash: 'a'.repeat(64),
        mediaType: 'IMAGE',
        movementRequirement: 'STATIC_ALLOWED',
      },
    ],
  };
  const compose = vi.fn(async () => ({ videoRenderId: 'render_001' }));
  const workflow = new NativeCampaignWorkflow(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { compose } as any,
    { getCompositionPlan: () => plan } as any,
    {
      getGlobalOperation: () => null,
      getGlobalUsage: () => ({
        policy: {
          daily_usd: '1',
          monthly_usd: '20',
          time_zone: 'America/Sao_Paulo',
        },
        dailyUsd: '0',
        monthlyUsd: '0',
      }),
    } as any,
    {} as any,
    {} as any,
  );
  const done = {
    EDITORIAL: { script: { scriptId: 'script_001' } },
    AUDIO: { voiceTrackId: 'voice_001' },
    MEDIA_QC: {
      reports: [
        {
          identity: { mediaAssetId: 'image_001', contentHash: 'a'.repeat(64) },
        },
      ],
    },
  };
  const r = {
    videoProduction: { mode: 'LOCAL_IMAGES' },
    composition: { compositionPlanId: 'plan_001' },
  };
  await expect(
    workflow.execute('COMPOSITION', { run_id: 'run_001' } as any, r, done),
  ).resolves.toHaveProperty('videoRenderId');
  await expect(
    workflow.execute(
      'COMPOSITION',
      { run_id: 'run_001' } as any,
      { ...r, videoProduction: { mode: 'ASSISTED_LOCAL' } },
      done,
    ),
  ).rejects.toThrow('MOTION_COMPOSITION_V2_REQUIRED');
  plan.segments[0].mediaType = 'VIDEO';
  await expect(
    workflow.execute('COMPOSITION', { run_id: 'run_001' } as any, r, done),
  ).rejects.toThrow('MOTION_COMPOSITION_V2_REQUIRED');
  expect(compose).toHaveBeenCalledTimes(1);
});

test('local package QC is independent from Instagram publication captions and retains the validated script', async () => {
  const captions = {
    ensure: vi.fn(async () => {
      throw Error('SOCIAL_CAPTION_UNGROUNDED');
    }),
    history: () => [],
  };
  const workflow = new NativeCampaignWorkflow(
    {
      getBriefing: async () => ({
        cta: 'Confira.',
        affiliateUrl: 'https://example.invalid/item',
      }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { qc: async () => ({ result: 'PASS' }) } as any,
    {} as any,
    {
      getGlobalOperation: () => null,
      getGlobalUsage: () => ({
        policy: {
          daily_usd: '1',
          monthly_usd: '20',
          time_zone: 'America/Sao_Paulo',
        },
        dailyUsd: '0',
        monthlyUsd: '0',
      }),
    } as any,
    {} as any,
    {} as any,
    undefined,
    undefined,
    captions as any,
  );
  const done = {
    EDITORIAL: {
      script: {
        fullNarration:
          'Organizadores. Publicidade · Cena ilustrativa. Confira.',
      },
    },
    BURN: { videoRenderId: 'render_001' },
  };
  const r = { localImage: {}, videoProduction: { mode: 'LOCAL_IMAGES' } };
  expect(await workflow.execute('QC', {} as any, r, done)).toEqual({
    result: 'PASS',
  });
  expect(captions.ensure).not.toHaveBeenCalled();
  const result = await workflow.result(
    { execution_id: 'execution_001' } as any,
    r,
    done,
  );
  expect(result.caption.text).toBe(done.EDITORIAL.script.fullNarration);
  expect(result.publication).toBe('NOT_REQUESTED');
});
