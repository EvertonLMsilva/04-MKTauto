import { createHash } from 'node:crypto';
import {
  validateAlignment,
  serializeSubtitles,
  SUBTITLE_PRESENTATION_POLICY,
} from './alignment-contracts.js';
import {
  validateSubtitleTrack,
  subtitleTrackContentHash,
  type SubtitleTrack,
} from './subtitle-track-contracts.js';
import { validateVideoRender } from './video-render-contracts.js';
import { adaptationHash } from './media-hash.js';
import { validateCompositionPlan } from './composition-plan-contracts.js';
export function subtitleBindingFail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
/** V1 controls cue invariants. No frame rounding, word grouping or time repair. */
export function deriveCanonicalSubtitle(
  value: {
    subtitleTrackId: string;
    createdAt: string;
    revision: number;
    supersedesSubtitleTrackId: string | null;
  },
  raw: unknown,
  script: any,
  voice: any,
): SubtitleTrack {
  const evidence = validateAlignment(raw),
    i = evidence.input;
  if (!script || !voice) subtitleBindingFail('SUBTITLE_SOURCE_MISSING');
  if (
    i.scriptId !== script.scriptId ||
    i.scriptVersion !== script.revision ||
    i.audioAssetId !== voice.voiceTrackId ||
    i.audioSha256 !== voice.contentHash ||
    voice.scriptId !== script.scriptId ||
    voice.scriptContentHash !== script.contentHash
  )
    subtitleBindingFail('SUBTITLE_SOURCE_BINDING_MISMATCH');
  for (const key of [
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'language',
  ])
    if (script[key] !== voice[key])
      subtitleBindingFail('SUBTITLE_SOURCE_SCOPE_MISMATCH');
  if (i.durationMs !== voice.durationMilliseconds)
    subtitleBindingFail('SUBTITLE_SOURCE_DURATION_MISMATCH');
  // Adapted synthetic narration is not silently treated as the original Script.
  if (i.canonicalText !== script.fullNarration)
    subtitleBindingFail('SUBTITLE_CANONICAL_TEXT_MISMATCH');
  const track: SubtitleTrack = {
    schemaVersion: 'subtitle-track/1.0.0',
    ...value,
    pipelineRunId: script.pipelineRunId,
    projectId: script.projectId,
    projectVersion: script.projectVersion,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    voiceTrackId: voice.voiceTrackId,
    voiceTrackContentHash: voice.contentHash,
    language: script.language,
    timeUnit: 'MILLISECONDS',
    durationMilliseconds: voice.durationMilliseconds,
    stylePolicyVersion: 'subtitle-style-policy/1.0.0',
    cues: evidence.output.segments.map((s, index) => ({
      position: index + 1,
      text: s.text,
      startMilliseconds: s.startMs,
      endMilliseconds: s.endMs,
    })),
    contentHash: '',
  };
  track.contentHash = subtitleTrackContentHash(track);
  return validateSubtitleTrack(track);
}
export interface LocalSubtitleBindingDocument {
  subtitleId: string;
  alignmentId: string;
  evidenceHash: string;
  voiceTrackId: string;
  scriptId: string;
  scriptContentHash: string;
  srtHash: string;
  assHash: string;
}
/** This proves this artifact pair only; it does not equate the two policies. */
export function verifyCanonicalLocalBinding(input: {
  track: unknown;
  evidence: unknown;
  local: LocalSubtitleBindingDocument;
  localArtifact: any;
  srt: Buffer;
  ass: Buffer;
  render?: unknown;
  renderPlan?: unknown;
  renderArtifact?: any;
  renderBytes?: Buffer;
  sourceRender?: unknown;
}) {
  const track = validateSubtitleTrack(input.track),
    evidence = validateAlignment(input.evidence),
    doc = input.local;
  const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  if (
    track.scriptId !== evidence.input.scriptId ||
    track.voiceTrackId !== evidence.input.audioAssetId ||
    track.voiceTrackContentHash !== evidence.input.audioSha256 ||
    track.durationMilliseconds !== evidence.input.durationMs ||
    adaptationHash(track.cues) !==
      adaptationHash(
        evidence.output.segments.map((s, index) => ({
          position: index + 1,
          text: s.text,
          startMilliseconds: s.startMs,
          endMilliseconds: s.endMs,
        })),
      )
  )
    subtitleBindingFail('SUBTITLE_ALIGNMENT_BINDING_MISMATCH');
  if (
    !doc ||
    doc.alignmentId !== evidence.output.alignmentId ||
    doc.evidenceHash !== evidence.output.evidenceHash ||
    doc.voiceTrackId !== track.voiceTrackId ||
    doc.scriptId !== track.scriptId ||
    doc.scriptContentHash !== track.scriptContentHash ||
    doc.srtHash !== hash(input.srt) ||
    doc.assHash !== hash(input.ass)
  )
    subtitleBindingFail('LOCAL_SUBTITLE_BINDING_MISMATCH');
  const artifact = input.localArtifact;
  if (
    !artifact ||
    artifact.artifactId !== doc.subtitleId ||
    artifact.artifactType !== 'local_subtitles' ||
    artifact.contentHash !== adaptationHash(doc) ||
    artifact.pipelineRunId !== track.pipelineRunId ||
    artifact.projectId !== track.projectId ||
    artifact.projectVersion !== track.projectVersion
  )
    subtitleBindingFail('LOCAL_SUBTITLE_LINEAGE_MISMATCH');
  const expectedInputs = [
    {
      position: 1,
      kind: 'INTERNAL_ARTIFACT',
      inputId: doc.alignmentId,
      contentHash: adaptationHash(evidence),
    },
    {
      position: 2,
      kind: 'INTERNAL_ARTIFACT',
      inputId: track.scriptId,
      contentHash: track.scriptContentHash,
    },
    {
      position: 3,
      kind: 'INTERNAL_ARTIFACT',
      inputId: track.voiceTrackId,
      contentHash: track.voiceTrackContentHash,
    },
  ];
  if (adaptationHash(artifact.inputs) !== adaptationHash(expectedInputs))
    subtitleBindingFail('LOCAL_SUBTITLE_LINEAGE_MISMATCH');
  let plain: ReturnType<typeof serializeSubtitles>,
    local: ReturnType<typeof serializeSubtitles>;
  try {
    plain = serializeSubtitles(evidence.output.segments);
    local = serializeSubtitles(evidence.output.segments, {
      frameRate: 30,
      durationMs: track.durationMilliseconds,
    });
  } catch {
    return subtitleBindingFail('BLOCKED_POLICY_EQUIVALENCE');
  }
  if (
    plain.srt !== local.srt ||
    plain.ass !== local.ass ||
    !input.srt.equals(Buffer.from(plain.srt)) ||
    !input.ass.equals(Buffer.from(plain.ass))
  )
    subtitleBindingFail('BLOCKED_POLICY_EQUIVALENCE');
  let renderId: string | null = null;
  if (input.render !== undefined) {
    const render = validateVideoRender(input.render),
      lineage = input.renderArtifact;
    const plan = validateCompositionPlan(input.renderPlan);
    const source = validateVideoRender(input.sourceRender);
    if (
      source.schemaVersion !== 'video-render/1.0.0' ||
      source.revision !== 1 ||
      source.videoRenderId !== render.supersedesVideoRenderId ||
      source.compositionPlanId !== plan.compositionPlanId ||
      source.compositionPlanContentHash !== plan.contentHash ||
      source.pipelineRunId !== track.pipelineRunId ||
      source.projectId !== track.projectId ||
      source.projectVersion !== track.projectVersion ||
      source.durationMilliseconds !== render.durationMilliseconds ||
      source.widthPixels !== render.widthPixels ||
      source.heightPixels !== render.heightPixels ||
      source.containerFormat !== render.containerFormat ||
      source.outputAspectRatio !== render.outputAspectRatio ||
      plan.pipelineRunId !== track.pipelineRunId ||
      plan.projectId !== track.projectId ||
      plan.projectVersion !== track.projectVersion ||
      plan.durationMilliseconds !== track.durationMilliseconds ||
      plan.compositionPlanId !== render.compositionPlanId ||
      plan.contentHash !== render.compositionPlanContentHash ||
      plan.scriptId !== track.scriptId ||
      plan.scriptContentHash !== track.scriptContentHash ||
      plan.voiceTrackId !== track.voiceTrackId ||
      plan.voiceTrackContentHash !== track.voiceTrackContentHash
    )
      subtitleBindingFail('SUBTITLE_RENDER_BINDING_MISMATCH');
    if (
      render.schemaVersion !== 'video-render/1.0.0' ||
      render.revision !== 2 ||
      render.pipelineRunId !== track.pipelineRunId ||
      render.projectId !== track.projectId ||
      render.projectVersion !== track.projectVersion ||
      render.durationMilliseconds !== track.durationMilliseconds ||
      !lineage ||
      lineage.artifactId !== render.videoRenderId ||
      lineage.artifactType !== 'video_render' ||
      lineage.contentHash !== render.contentHash ||
      lineage.pipelineRunId !== track.pipelineRunId ||
      lineage.projectId !== track.projectId ||
      lineage.projectVersion !== track.projectVersion ||
      lineage.artifactVersion !== 2 ||
      lineage.generationMetadata?.taskType !== 'subtitle-burn-in' ||
      lineage.generationMetadata?.provider !== 'local' ||
      lineage.generationMetadata?.model !== 'local-flow/1' ||
      lineage.generationMetadata?.configurationHash !==
        adaptationHash(render) ||
      adaptationHash(lineage.inputs) !==
        adaptationHash([
          {
            position: 1,
            kind: 'INTERNAL_ARTIFACT',
            inputId: plan.compositionPlanId,
            contentHash: plan.contentHash,
          },
          {
            position: 2,
            kind: 'INTERNAL_ARTIFACT',
            inputId: source.videoRenderId,
            contentHash: source.contentHash,
          },
          {
            position: 3,
            kind: 'INTERNAL_ARTIFACT',
            inputId: doc.subtitleId,
            contentHash: artifact.contentHash,
          },
        ]) ||
      !input.renderBytes ||
      hash(input.renderBytes) !== render.contentHash
    )
      subtitleBindingFail('SUBTITLE_RENDER_BINDING_MISMATCH');
    renderId = render.videoRenderId;
  }
  return {
    schemaVersion: 'subtitle-track-local-binding/1.0.0' as const,
    subtitleTrackId: track.subtitleTrackId,
    subtitleTrackContentHash: track.contentHash,
    alignmentId: doc.alignmentId,
    localSubtitleId: doc.subtitleId,
    srtHash: doc.srtHash,
    assHash: doc.assHash,
    canonicalStylePolicy: track.stylePolicyVersion,
    localPresentationPolicy: SUBTITLE_PRESENTATION_POLICY,
    policyEquivalence: 'NOT_ASSUMED' as const,
    scope: 'EXACT_ARTIFACT_BYTES' as const,
    renderId,
    renderBinding: renderId
      ? 'VERIFIED_PRODUCER_RECEIPT_AND_HASH'
      : 'BLOCKED_RENDER_EVIDENCE_REQUIRED',
  };
}
