import type { AlignmentProvenanceVerifier } from '../application/alignment.port.js';
import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import type { CompositionRender } from '../domain/render.types.js';
import { digest, documentBytes } from './local-evidence-storage.js';

/** Exact local_subtitles document; deliberately not the historical SubtitleTrack contract. */
export interface LocalSubtitleDocument {
  subtitleId: string;
  alignmentId: string;
  evidenceHash: string;
  voiceTrackId: string;
  scriptId: string;
  scriptContentHash: string;
  srtHash: string;
  assHash: string;
}
/** Explicit, read-only access to existing CAS evidence; no ambient roots or verifier bypass. */
export interface LocalSubtitleProof {
  readEvidence(hash: string, extension: 'json' | 'srt' | 'ass'): Buffer;
  readAudio(hash: string): Buffer;
  alignmentVerifier: AlignmentProvenanceVerifier;
}
export interface LocalArtifactScope {
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  createdAt: string;
}
export function localEvidenceLineage(
  id: string,
  type: 'local_alignment' | 'local_subtitles',
  scope: LocalArtifactScope,
  documentHash: string,
  inputs: { inputId: string; contentHash: string }[],
) {
  return validateArtifactLineage({
    schemaVersion: 'artifact-lineage/1.0.0',
    artifactId: id,
    artifactType: type,
    artifactVersion: 1,
    pipelineRunId: scope.pipelineRunId,
    projectId: scope.projectId,
    projectVersion: scope.projectVersion,
    contentIdentity: null,
    hashAlgorithm: 'sha256',
    contentHash: documentHash,
    inputs: inputs.map((v, i) => ({
      position: i + 1,
      kind: 'INTERNAL_ARTIFACT',
      ...v,
    })),
    generationMetadata: {
      provider: 'local',
      model: 'local-flow/1',
      taskType: 'local-evidence',
      promptVersion: 'none',
      configurationHash: documentHash,
      publicConfiguration: null,
    },
    createdAt: scope.createdAt,
  });
}
export function burnedRenderLineage(
  render: CompositionRender,
  source: CompositionRender,
  subtitle: { subtitleId: string; documentHash: string },
) {
  const documentHash = digest(documentBytes(render));
  return validateArtifactLineage({
    schemaVersion: 'artifact-lineage/1.0.0',
    artifactId: render.videoRenderId,
    artifactType: 'video_render',
    artifactVersion: 2,
    pipelineRunId: render.pipelineRunId,
    projectId: render.projectId,
    projectVersion: render.projectVersion,
    contentIdentity: null,
    hashAlgorithm: 'sha256',
    contentHash: render.contentHash,
    inputs: [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: render.compositionPlanId,
        contentHash: render.compositionPlanContentHash,
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
        inputId: subtitle.subtitleId,
        contentHash: subtitle.documentHash,
      },
    ],
    generationMetadata: {
      provider: 'local',
      model: 'local-flow/1',
      taskType: 'subtitle-burn-in',
      promptVersion: 'none',
      configurationHash: documentHash,
      publicConfiguration: null,
    },
    createdAt: render.createdAt,
  });
}
