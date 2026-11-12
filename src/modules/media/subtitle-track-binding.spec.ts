import {
  deriveCanonicalSubtitle,
  verifyCanonicalLocalBinding,
} from './domain/subtitle-track-binding.js';
import {
  alignmentHash,
  serializeSubtitles,
} from './domain/alignment-contracts.js';
import { createHash } from 'node:crypto';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import { adaptationHash } from './domain/media-hash.js';
import { subtitleTrackContentHash } from './domain/subtitle-track-contracts.js';
function fixture() {
  const script = {
    scriptId: 'script_001',
    pipelineRunId: 'run_001',
    projectId: 'project_001',
    projectVersion: 1,
    language: 'pt-BR',
    contentHash: 'a'.repeat(64),
    revision: 1,
    fullNarration: 'Olá. Mundo.',
  };
  const voice = {
    ...script,
    voiceTrackId: 'voice_001',
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    contentHash: 'b'.repeat(64),
    durationMilliseconds: 1000,
  };
  const evidence: any = {
    input: {
      audioAssetId: voice.voiceTrackId,
      audioSha256: voice.contentHash,
      scriptId: script.scriptId,
      scriptVersion: 1,
      scriptTextSha256: alignmentHash(script.fullNarration),
      durationMs: 1000,
      canonicalText: script.fullNarration,
    },
    parameters: { fixture: true },
    provenance: 'FORCED_ALIGNMENT',
    output: {
      alignmentId: 'alignment_001',
      provider: 'explicit-test-vector',
      modelVersion: 'test/1',
      audioSha256: voice.contentHash,
      scriptTextSha256: alignmentHash(script.fullNarration),
      segments: [
        {
          startMs: 0,
          endMs: 400,
          text: 'Olá.',
          textStartOffset: 0,
          textEndOffset: 4,
        },
        {
          startMs: 500,
          endMs: 1000,
          text: 'Mundo.',
          textStartOffset: 5,
          textEndOffset: 11,
        },
      ],
      evidenceHash: '',
      status: 'VERIFIED',
    },
  };
  evidence.output.evidenceHash = alignmentHash(evidence);
  const request = {
    subtitleTrackId: 'subtitle_001',
    createdAt: '2026-11-12T00:00:00Z',
    revision: 1,
    supersedesSubtitleTrackId: null,
  };
  const track = deriveCanonicalSubtitle(request, evidence, script, voice),
    files = serializeSubtitles(evidence.output.segments, {
      frameRate: 30,
      durationMs: 1000,
    });
  const srt = Buffer.from(files.srt),
    ass = Buffer.from(files.ass);
  const hash = (b: Buffer) => alignmentHash(b.toString('utf8'));
  const local = {
    subtitleId: 'local_subtitles_001',
    alignmentId: evidence.output.alignmentId,
    evidenceHash: evidence.output.evidenceHash,
    voiceTrackId: voice.voiceTrackId,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    srtHash: hash(srt),
    assHash: hash(ass),
  };
  const localArtifact = {
    artifactId: local.subtitleId,
    artifactType: 'local_subtitles',
    pipelineRunId: track.pipelineRunId,
    projectId: track.projectId,
    projectVersion: track.projectVersion,
    contentHash: adaptationHash(local),
    inputs: [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: local.alignmentId,
        contentHash: adaptationHash(evidence),
      },
      {
        position: 2,
        kind: 'INTERNAL_ARTIFACT',
        inputId: script.scriptId,
        contentHash: script.contentHash,
      },
      {
        position: 3,
        kind: 'INTERNAL_ARTIFACT',
        inputId: voice.voiceTrackId,
        contentHash: voice.contentHash,
      },
    ],
  };
  return {
    script,
    voice,
    evidence,
    request,
    track,
    local,
    localArtifact,
    srt,
    ass,
  };
}
it('derives exact cues and proves only this artifact-byte intersection, not policy equivalence', () => {
  const f = fixture();
  expect(f.track.cues[0].startMilliseconds).toBe(0);
  expect(verifyCanonicalLocalBinding(f)).toMatchObject({
    scope: 'EXACT_ARTIFACT_BYTES',
    policyEquivalence: 'NOT_ASSUMED',
    canonicalStylePolicy: 'subtitle-style-policy/1.0.0',
    localPresentationPolicy: 'frame-coverage/1',
    renderId: null,
  });
});
it('never snaps acoustic onset to zero', () => {
  const f = fixture();
  f.evidence.output.segments[0].startMs = 100;
  f.evidence.output.evidenceHash = alignmentHash(f.evidence);
  expect(() =>
    deriveCanonicalSubtitle(f.request, f.evidence, f.script, f.voice),
  ).toThrow('FIRST_CUE_MUST_START_AT_ZERO');
  expect(f.evidence.output.segments[0].startMs).toBe(100);
});
it.each(['script', 'voice', 'language', 'duration', 'revision'])(
  'blocks %s divergence',
  (kind) => {
    const f = fixture();
    if (kind === 'script') f.script.contentHash = 'f'.repeat(64);
    if (kind === 'voice') f.voice.contentHash = 'f'.repeat(64);
    if (kind === 'language') f.voice.language = 'en-US';
    if (kind === 'duration') f.voice.durationMilliseconds = 999;
    if (kind === 'revision') f.script.revision = 2;
    expect(() =>
      deriveCanonicalSubtitle(f.request, f.evidence, f.script, f.voice),
    ).toThrow();
  },
);
it('rejects invalid alignment, altered local bytes, wrong run and unrelated render', () => {
  const f = fixture();
  expect(() =>
    verifyCanonicalLocalBinding({ ...f, srt: Buffer.from('changed') }),
  ).toThrow('LOCAL_SUBTITLE_BINDING_MISMATCH');
  f.localArtifact.pipelineRunId = 'other_run';
  expect(() => verifyCanonicalLocalBinding(f)).toThrow(
    'LOCAL_SUBTITLE_LINEAGE_MISMATCH',
  );
  f.evidence.output.segments[0].text = 'not original';
  expect(() =>
    deriveCanonicalSubtitle(f.request, f.evidence, f.script, f.voice),
  ).toThrow();
});
it('blocks incompatible frame grouping/precision instead of claiming V1 display equivalence', () => {
  const f = fixture();
  f.evidence.output.segments[0].endMs = 5;
  f.evidence.output.evidenceHash = alignmentHash(f.evidence);
  f.track = structuredClone(f.track);
  f.track.cues[0].endMilliseconds = 5;
  f.track.contentHash = subtitleTrackContentHash(f.track);
  f.local.evidenceHash = f.evidence.output.evidenceHash;
  const files = serializeSubtitles(f.evidence.output.segments, {
    frameRate: 30,
    durationMs: 1000,
  });
  f.srt = Buffer.from(files.srt);
  f.ass = Buffer.from(files.ass);
  f.local.srtHash = alignmentHash(files.srt);
  f.local.assHash = alignmentHash(files.ass);
  f.localArtifact.contentHash = adaptationHash(f.local);
  f.localArtifact.inputs[0].contentHash = adaptationHash(f.evidence);
  expect(() => verifyCanonicalLocalBinding(f)).toThrow(
    'BLOCKED_POLICY_EQUIVALENCE',
  );
});

function withRender() {
  const f = fixture();
  const plan: any = {
    schemaVersion: 'composition-plan/1.0.0',
    compositionPlanId: 'plan_001',
    pipelineRunId: f.track.pipelineRunId,
    projectId: f.track.projectId,
    projectVersion: 1,
    scriptId: f.track.scriptId,
    scriptContentHash: f.track.scriptContentHash,
    voiceTrackId: f.track.voiceTrackId,
    voiceTrackContentHash: f.track.voiceTrackContentHash,
    outputAspectRatio: '9:16',
    timelineUnit: 'MILLISECOND',
    continuityMode: 'CONTIGUOUS',
    durationMilliseconds: 1000,
    segments: [
      {
        position: 1,
        visualDirectionPosition: 1,
        mediaAssetId: 'asset_001',
        mediaAssetContentHash: 'c'.repeat(64),
        startMilliseconds: 0,
        endMilliseconds: 1000,
      },
    ],
    createdAt: f.track.createdAt,
    revision: 1,
    supersedesCompositionPlanId: null,
    contentHash: '',
  };
  plan.contentHash = compositionPlanContentHash(plan);
  // Receipt/hash test vector only: these bytes are not a physically rendered MP4.
  const renderBytes = Buffer.from('explicit receipt binding test vector');
  const sourceRender = {
    schemaVersion: 'video-render/1.0.0',
    videoRenderId: 'render_001',
    pipelineRunId: f.track.pipelineRunId,
    projectId: f.track.projectId,
    projectVersion: 1,
    compositionPlanId: plan.compositionPlanId,
    compositionPlanContentHash: plan.contentHash,
    outputAspectRatio: '9:16',
    durationMilliseconds: 1000,
    containerFormat: 'mp4',
    widthPixels: 1080,
    heightPixels: 1920,
    contentHash: 'd'.repeat(64),
    logicalReference: 'render:source_001',
    createdAt: f.track.createdAt,
    revision: 1,
    supersedesVideoRenderId: null,
  };
  const render = {
    ...sourceRender,
    videoRenderId: 'render_002',
    revision: 2,
    supersedesVideoRenderId: sourceRender.videoRenderId,
    contentHash: createHash('sha256').update(renderBytes).digest('hex'),
  };
  const renderArtifact = {
    artifactId: render.videoRenderId,
    artifactType: 'video_render',
    artifactVersion: 2,
    pipelineRunId: f.track.pipelineRunId,
    projectId: f.track.projectId,
    projectVersion: 1,
    contentHash: render.contentHash,
    generationMetadata: {
      provider: 'local',
      model: 'local-flow/1',
      taskType: 'subtitle-burn-in',
      configurationHash: adaptationHash(render),
    },
    inputs: [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: plan.compositionPlanId,
        contentHash: plan.contentHash,
      },
      {
        position: 2,
        kind: 'INTERNAL_ARTIFACT',
        inputId: sourceRender.videoRenderId,
        contentHash: sourceRender.contentHash,
      },
      {
        position: 3,
        kind: 'INTERNAL_ARTIFACT',
        inputId: f.local.subtitleId,
        contentHash: f.localArtifact.contentHash,
      },
    ],
  };
  return {
    ...f,
    render,
    renderPlan: plan,
    renderArtifact,
    renderBytes,
    sourceRender,
  };
}
it('checks the exact burn-in receipt, source revision, composition and physical hash without claiming QC', () => {
  expect(verifyCanonicalLocalBinding(withRender()).renderBinding).toBe(
    'VERIFIED_PRODUCER_RECEIPT_AND_HASH',
  );
});
it.each([
  'other_subtitle',
  'other_source',
  'other_run',
  'wrong_bytes',
  'not_burn_in',
  'stale_receipt',
  'wrong_script',
  'wrong_dimensions',
])('rejects improper render association: %s', (kind) => {
  const f = withRender();
  if (kind === 'other_subtitle')
    f.renderArtifact.inputs[2].inputId = 'unrelated_subtitle';
  if (kind === 'other_source')
    f.renderArtifact.inputs[1].contentHash = 'f'.repeat(64);
  if (kind === 'other_run') f.renderArtifact.pipelineRunId = 'other_run';
  if (kind === 'wrong_bytes') f.renderBytes = Buffer.from('tampered');
  if (kind === 'not_burn_in')
    f.renderArtifact.generationMetadata.taskType = 'local-evidence';
  if (kind === 'stale_receipt')
    f.renderArtifact.generationMetadata.configurationHash = 'f'.repeat(64);
  if (kind === 'wrong_dimensions') {
    f.render.widthPixels = 720;
    f.render.heightPixels = 1280;
    f.renderArtifact.generationMetadata.configurationHash = adaptationHash(
      f.render,
    );
  }
  if (kind === 'wrong_script') {
    f.renderPlan.scriptContentHash = 'f'.repeat(64);
    f.renderPlan.contentHash = compositionPlanContentHash(f.renderPlan);
  }
  expect(() => verifyCanonicalLocalBinding(f)).toThrow(
    'SUBTITLE_RENDER_BINDING_MISMATCH',
  );
});
