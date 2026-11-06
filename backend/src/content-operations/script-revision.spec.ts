import {
  completedContext,
  executionRequest,
} from './application/campaign-orchestrator.js';
import { visualScriptMatches } from '../content/domain/script-visual-lineage.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';
import { adaptLocalNarration } from '../media/infrastructure/local-piper-tts.js';

const original: any = {
  scriptId: 'script_old',
  contentHash: 'a'.repeat(64),
  revision: 1,
  supersedesScriptId: null,
  pipelineRunId: 'run_001',
  projectId: 'project_001',
  projectVersion: 1,
  language: 'pt-BR',
  visualDirections: [
    { position: 1, blockPosition: 1, description: 'Produto real' },
  ],
  sensitiveClaims: [],
  reviewFlags: [],
  fullNarration: 'Roteiro anterior',
};
const revised = {
  ...original,
  scriptId: 'script_new',
  contentHash: 'b'.repeat(64),
  revision: 2,
  supersedesScriptId: original.scriptId,
  fullNarration:
    'Conheça este travesseiro: formato anatômico, superfície texturizada e detalhes em destaque.',
};
const event = (event_type: string, evidence: any) =>
  ({ event_type, evidence }) as any;
test('the authorized eleven-word narration fits the initial natural-rate gate without rewriting', () => {
  expect(adaptLocalNarration(revised.fullNarration, 5184)).toBe(
    revised.fullNarration,
  );
  expect(() => adaptLocalNarration(revised.fullNarration, 3000)).toThrow(
    'NARRATION_DURATION_REQUIRED',
  );
});
test('script revision invalidates only narration dependents and exact final approval, preserving visual QC and Finance history', () => {
  const h = [
    event('SCHEDULED', {
      voiceTrackId: 'old',
      audio: {},
      alignment: {},
      composition: {},
      publication: {},
    }),
    event('STEP_DONE', { step: 'EDITORIAL', result: { script: original } }),
    ...[
      'CONTEXT',
      'SCENES',
      'VIDEO_GENERATION',
      'MEDIA_QC',
      'FINANCE',
      'AUDIO',
      'ALIGNMENT',
      'SUBTITLES',
      'COMPOSITION',
      'BURN',
      'QC',
      'PREVIEW',
      'HANDOFF',
    ].map((step) => event('STEP_DONE', { step, result: { original: step } })),
    event('HUMAN_APPROVAL', { decision: 'APPROVED' }),
    event('SCRIPT_REVISED', { script: revised }),
  ];
  const snapshot = JSON.stringify(h);
  expect(completedContext(h)).toEqual({
    EDITORIAL: { script: revised },
    CONTEXT: { original: 'CONTEXT' },
    SCENES: { original: 'SCENES' },
    VIDEO_GENERATION: { original: 'VIDEO_GENERATION' },
    MEDIA_QC: { original: 'MEDIA_QC' },
    FINANCE: { original: 'FINANCE' },
  });
  expect(executionRequest(h)).toEqual({ scriptId: revised.scriptId });
  expect(JSON.stringify(h)).toBe(snapshot);
  expect(
    completedContext([
      ...h,
      event('STEP_DONE', { step: 'AUDIO', result: { current: true } }),
    ]).AUDIO,
  ).toEqual({ current: true });
});
test('legacy recovery uses the revised script after restart without losing its immutable original snapshot', () => {
  const h = [
    event('LEGACY_RECOVERY', { legacyRecovery: { script: original } }),
    event('SCRIPT_REVISED', { script: revised }),
  ];
  expect((completedContext(h).EDITORIAL as any).script).toEqual(revised);
  expect((h[0].evidence.legacyRecovery as any).script).toEqual(original);
});
test('visual reuse requires a contiguous registered revision chain with unchanged visual scope and review obligations', () => {
  const load = (id: string) => (id === original.scriptId ? original : null);
  expect(
    visualScriptMatches(revised, original.scriptId, original.contentHash, load),
  ).toBe(true);
  for (const patch of [
    { visualDirections: [] },
    { pipelineRunId: 'other' },
    { projectVersion: 2 },
    { sensitiveClaims: [{ summary: 'new' }] },
    { reviewFlags: ['HUMAN_REVIEW_REQUIRED'] },
    { revision: 3 },
    { supersedesScriptId: 'missing' },
  ])
    expect(
      visualScriptMatches(
        { ...revised, ...patch },
        original.scriptId,
        original.contentHash,
        load,
      ),
    ).toBe(false);
  expect(
    visualScriptMatches(revised, original.scriptId, 'c'.repeat(64), load),
  ).toBe(false);
  expect(
    visualScriptMatches(
      original,
      revised.scriptId,
      revised.contentHash,
      () => revised,
    ),
  ).toBe(false);
});

test('official revision is audited, fenced, idempotent after restart and resumes only narration-dependent steps', async () => {
  const root = mkdtempSync(join(tmpdir(), 'audio-revision-')),
    path = join(root, 'test.sqlite');
  const db = new DatabaseSync(path);
  provisionSchema(db);
  db.exec('PRAGMA foreign_keys=OFF');
  const r = new CampaignRepository(db),
    at = '2026-10-18T12:00:00Z';
  const e = r.schedule(
    {
      campaignId: 'campaign_001',
      campaignRevision: 1,
      runId: 'run_001',
      scheduledAt: at,
    },
    { mode: 'LOCAL_VALIDATION', videoProduction: { mode: 'ASSISTED_LOCAL' } },
    at,
  );
  const claim = r.claim(e.execution_id, at, 60000)!;
  for (const [step, result] of Object.entries({
    EDITORIAL: { script: original },
    MEDIA_QC: { result: 'PASS' },
    AUDIO: { old: true },
    COMPOSITION: { old: true },
    QC: { old: true },
  }))
    r.ownedEvent(e.execution_id, claim.claim_token!, at, 'STEP_DONE', {
      step,
      result,
    });
  r.ownedEvent(
    e.execution_id,
    claim.claim_token!,
    at,
    'PAUSED',
    { step: 'HANDOFF', code: 'EXACT_HUMAN_APPROVAL_REQUIRED' },
    'WAITING_INPUT',
  );
  const scripts: Record<string, any> = {
    [original.scriptId]: original,
    [revised.scriptId]: revised,
    other_run: {
      ...revised,
      scriptId: 'other_run',
      pipelineRunId: 'run_other',
    },
    wrong_parent: {
      ...revised,
      scriptId: 'wrong_parent',
      supersedesScriptId: 'other',
    },
    wrong_version: { ...revised, scriptId: 'wrong_version', revision: 3 },
    changed_visuals: {
      ...revised,
      scriptId: 'changed_visuals',
      visualDirections: [],
    },
  };
  const native = new NativeCampaignWorkflow(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {
      getScript: (id: string) => scripts[id] ?? null,
      listScripts: () => Object.values(scripts),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const execute = vi.fn(async (step: string) => {
    if (step === 'HANDOFF')
      throw Object.assign(new Error('EXACT_HUMAN_APPROVAL_REQUIRED'), {
        code: 'EXACT_HUMAN_APPROVAL_REQUIRED',
      });
    return { current: step };
  });
  const flow = {
    scriptRevisions: native.scriptRevisions.bind(native),
    revisedScript: native.revisedScript.bind(native),
    steps: [
      'EDITORIAL',
      'MEDIA_QC',
      'AUDIO',
      'ALIGNMENT',
      'SUBTITLES',
      'COMPOSITION',
      'BURN',
      'QC',
      'PREVIEW',
      'HANDOFF',
    ],
    execute,
    reconcile: vi.fn(),
    readyToResume: vi.fn(async () => false),
  } as any;
  let admin = new CampaignAdministration(path, flow);
  const input = {
    scriptId: revised.scriptId,
    previousScriptContentHash: original.contentHash,
    reason: 'Autorização de revisão restrita à campanha de teste.',
  };
  try {
    expect(admin.scriptRevisions(e.execution_id)).toEqual([revised]);
    for (const scriptId of ['audio inlegivel', 'x', 'script/invalid']) {
      expect(() =>
        admin.reviseScript(
          e.execution_id,
          { ...input, scriptId },
          'operator_001',
        ),
      ).toThrow('INVALID_SCRIPT_REVISION_IDENTIFIER');
    }
    for (const patch of [
      { previousScriptContentHash: 'c'.repeat(64) },
      { scriptId: 'missing' },
      { reason: 'curta' },
      { actorId: 'browser_actor' },
    ]) {
      expect(() =>
        admin.reviseScript(
          e.execution_id,
          { ...input, ...patch },
          'operator_001',
        ),
      ).toThrow();
    }
    expect(
      r
        .history(e.execution_id)
        .filter((h) => h.event_type === 'SCRIPT_REVISED'),
    ).toHaveLength(0);
    admin.reviseScript(e.execution_id, input, 'operator_001');
    expect(admin.scriptRevisions(e.execution_id)).toEqual([]);
    expect(admin.finalizationContext(e.execution_id).completed).toEqual({
      EDITORIAL: { script: revised },
      MEDIA_QC: { result: 'PASS' },
    });
    await admin.onModuleDestroy();
    admin = new CampaignAdministration(path, flow);
    admin.reviseScript(e.execution_id, input, 'operator_001');
    expect(
      r
        .history(e.execution_id)
        .filter((h) => h.event_type === 'SCRIPT_REVISED'),
    ).toHaveLength(1);
    expect(
      r.history(e.execution_id).filter((h) => h.event_type === 'STEP_DONE'),
    ).toHaveLength(5);
    await admin.resume(e.execution_id);
    await admin.advanceFinalization(e.execution_id);
    expect(execute.mock.calls.map(([step]) => step)).toEqual([
      'AUDIO',
      'ALIGNMENT',
      'SUBTITLES',
      'COMPOSITION',
      'BURN',
      'QC',
      'PREVIEW',
      'HANDOFF',
    ]);
    expect(admin.get(e.execution_id).status).toBe('WAITING_INPUT');
    expect(
      admin.finalizationContext(e.execution_id).completed.APPROVAL,
    ).toBeUndefined();
    expect(() =>
      admin.reviseScript(
        e.execution_id,
        { ...input, scriptId: original.scriptId },
        'operator_001',
      ),
    ).toThrow('SCRIPT_REVISION_STALE');
    const running = r.claim(e.execution_id, at, 60000);
    expect(running).toBeNull();
    const state = r.get(e.execution_id);
    r.administrativeEvent(e.execution_id, state.version, at, 'STEP_DONE', {
      step: 'HANDOFF',
      result: { exact: true },
    });
    expect(() =>
      admin.reviseScript(
        e.execution_id,
        { ...input, scriptId: original.scriptId },
        'operator_001',
      ),
    ).toThrow('SCRIPT_REVISION_STATE_CONFLICT');
  } finally {
    await admin.onModuleDestroy();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
