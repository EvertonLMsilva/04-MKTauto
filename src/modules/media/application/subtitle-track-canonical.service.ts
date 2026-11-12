import type { SubtitleTrackRepository } from '../infrastructure/subtitle-track.repository.js';
import type { LocalEvidenceStorage } from '../infrastructure/local-evidence-storage.js';
import type { AlignmentProvenanceVerifier } from './alignment.port.js';
import { validateAlignment } from '../domain/alignment-contracts.js';
import {
  deriveCanonicalSubtitle,
  subtitleBindingFail,
  verifyCanonicalLocalBinding,
  type LocalSubtitleBindingDocument,
} from '../domain/subtitle-track-binding.js';
import { createHash } from 'node:crypto';
import { adaptationHash } from '../domain/media-hash.js';
import { inspectMvpWav } from '../infrastructure/physical-media-inspection.js';
/**
 * Internal V1 materialization boundary; does not generate alignment or media.
 * Supply the existing LocalFlowRuntime.audioBytes and an independently trusted
 * AlignmentProvenanceVerifier. A self-declared VERIFIED status is insufficient.
 * CORE must read both getSubtitleTrack and getSubtitleSource, then require
 * bindLocal with an explicit render and its hash-checked bytes before using a
 * subtitle in per-render QC. A track alone grants neither QC nor human approval.
 */
export class SubtitleTrackCanonicalService {
  constructor(
    private readonly repository: SubtitleTrackRepository,
    private readonly files: LocalEvidenceStorage,
    private readonly source: {
      readAuthorizedAudio(
        runId: string,
        scriptId: string,
        scriptHash: string,
        voiceId: string,
      ): Buffer;
      provenance: AlignmentProvenanceVerifier;
    },
  ) {}
  async materialize(input: {
    subtitleTrackId: string;
    alignmentId: string;
    createdAt: string;
    revision: number;
    supersedesSubtitleTrackId: string | null;
  }) {
    const evidence = await this.verifiedAlignment(input.alignmentId);
    const script = this.repository.getScript(evidence.input.scriptId),
      voice = this.repository.getVoiceTrack(evidence.input.audioAssetId);
    const track = deriveCanonicalSubtitle(
      {
        subtitleTrackId: input.subtitleTrackId,
        createdAt: input.createdAt,
        revision: input.revision,
        supersedesSubtitleTrackId: input.supersedesSubtitleTrackId,
      },
      evidence,
      script,
      voice,
    );
    return this.repository.registerMaterializedSubtitle(
      track,
      input.alignmentId,
      evidence.output.evidenceHash,
      this.files,
    );
  }
  private async verifiedAlignment(id: string) {
    const evidence = validateAlignment(
      this.repository.document(id, 'local_alignment', this.files),
    );
    if (evidence.output.alignmentId !== id)
      subtitleBindingFail('SUBTITLE_ALIGNMENT_BINDING_MISMATCH');
    const script = this.repository.getScript(evidence.input.scriptId);
    if (!script) subtitleBindingFail('SCRIPT_NOT_FOUND');
    const artifact = this.repository.getArtifact(id);
    const inputs = [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: evidence.input.audioAssetId,
        contentHash: evidence.input.audioSha256,
      },
      {
        position: 2,
        kind: 'INTERNAL_ARTIFACT',
        inputId: script.scriptId,
        contentHash: script.contentHash,
      },
    ];
    if (
      !artifact ||
      artifact.pipelineRunId !== script.pipelineRunId ||
      artifact.projectId !== script.projectId ||
      artifact.projectVersion !== script.projectVersion ||
      adaptationHash(artifact.inputs) !== adaptationHash(inputs)
    )
      subtitleBindingFail('SUBTITLE_SOURCE_SCOPE_MISMATCH');
    const audio = this.source.readAuthorizedAudio(
      script.pipelineRunId,
      script.scriptId,
      script.contentHash,
      evidence.input.audioAssetId,
    );
    if (
      createHash('sha256').update(audio).digest('hex') !==
      evidence.input.audioSha256
    )
      subtitleBindingFail('SUBTITLE_AUDIO_HASH_MISMATCH');
    if (inspectMvpWav(audio).durationMilliseconds !== evidence.input.durationMs)
      subtitleBindingFail('SUBTITLE_SOURCE_DURATION_MISMATCH');
    if (!(await this.source.provenance.verify(evidence, audio)))
      subtitleBindingFail('ALIGNMENT_PROVENANCE_UNVERIFIED');
    return evidence;
  }
  async bindLocal(input: {
    subtitleTrackId: string;
    localSubtitleId: string;
    renderId?: string;
    readRender?: (hash: string) => Buffer;
  }) {
    const track = this.repository.getSubtitleTrack(input.subtitleTrackId);
    if (!track) subtitleBindingFail('SUBTITLE_TRACK_NOT_FOUND');
    const receipt = this.repository.getSubtitleSource(
      input.subtitleTrackId,
      this.files,
    );
    const evidence = await this.verifiedAlignment(receipt.alignmentId);
    if (evidence.output.evidenceHash !== receipt.alignmentEvidenceHash)
      subtitleBindingFail('SUBTITLE_SOURCE_BINDING_MISMATCH');
    const doc = this.repository.document<LocalSubtitleBindingDocument>(
      input.localSubtitleId,
      'local_subtitles',
      this.files,
    );
    const render = input.renderId
      ? this.repository.getVideoRender(input.renderId)
      : undefined;
    if (input.renderId && !render)
      subtitleBindingFail('SUBTITLE_RENDER_BINDING_MISMATCH');
    return verifyCanonicalLocalBinding({
      track,
      evidence,
      local: doc,
      localArtifact: this.repository.getArtifact(input.localSubtitleId),
      srt: this.files.read(doc.srtHash, 'srt'),
      ass: this.files.read(doc.assHash, 'ass'),
      ...(render
        ? {
            render,
            sourceRender: render.supersedesVideoRenderId
              ? this.repository.getVideoRender(render.supersedesVideoRenderId)
              : null,
            renderPlan: this.repository.getCompositionPlan(
              (render as any).compositionPlanId,
            ),
            renderArtifact: this.repository.getArtifact(render.videoRenderId),
            renderBytes: input.readRender?.(render.contentHash),
          }
        : {}),
    });
  }
}
