import type { MediaAsset } from '../domain/media.types.js';
import type { LocalMediaReadiness } from './local-media-readiness.js';
export type LocalImageSource = Pick<
  MediaAsset,
  'mediaReference' | 'contentHash' | 'origin' | 'provider' | 'rights'
>;
// Opaque server capability: JSON/client input cannot manufacture a verifier.
const processingVerifiers = new WeakMap<
  object,
  (scope: LocalMediaScope, source: LocalImageSource) => string
>();
export interface VerifiedLocalProcessing {
  readonly kind: 'VERIFIED_LOCAL_PROCESSING';
}
export function verifiedLocalProcessing(
  verify: (scope: LocalMediaScope, source: LocalImageSource) => string,
): VerifiedLocalProcessing {
  const token = Object.freeze({ kind: 'VERIFIED_LOCAL_PROCESSING' as const });
  processingVerifiers.set(token, verify);
  return token;
}
export function localProcessingScope(
  scope: LocalMediaScope,
  source: LocalImageSource,
): string | undefined {
  if (scope.processingAuthorization === undefined) return undefined;
  const verify = processingVerifiers.get(scope.processingAuthorization);
  if (!verify) throw new Error('ONE_SHOT_MEDIA_BINDING_REQUIRED');
  return verify(scope, source);
}
export interface LocalMediaScope {
  processingAuthorization?: VerifiedLocalProcessing;
  campaignId?: string;
  pipelineRunId: string;
  scriptId: string;
  scriptContentHash: string;
  createdAt: string;
}
export interface AuthorizedLocalAudio {
  voiceTrackId: string;
  contentHash: string;
  durationMilliseconds: number;
}
export interface LocalAudiovisualPort {
  prepareImage?(scope: LocalMediaScope, source: LocalImageSource): MediaAsset;
  audioBytes?(
    runId: string,
    scriptId: string,
    scriptHash: string,
    voiceId: string,
  ): Buffer;
  ingestTts?(
    scope: {
      pipelineRunId: string;
      scriptId: string;
      scriptContentHash: string;
      createdAt: string;
    },
    operationId: string,
    durationMs: number,
  ): Promise<AuthorizedLocalAudio>;
  automaticAudioReady?(): boolean;
  readiness?(): LocalMediaReadiness;
  automaticAudio?(
    scope: {
      pipelineRunId: string;
      scriptId: string;
      scriptContentHash: string;
      createdAt: string;
    },
    durationMs: number,
  ): Promise<AuthorizedLocalAudio>;
  publicationEvidence?(qcId: string, inspectOnly?: boolean): unknown;
  ingestRecording?(
    scope: {
      pipelineRunId: string;
      scriptId: string;
      scriptContentHash: string;
      createdAt: string;
    },
    input: {
      audioBase64: string;
      usageBasis: string;
      commercialUseAllowed: boolean;
      statement: string;
    },
    actorId: string,
  ): Promise<unknown>;
  authorizedAudio?(
    runId: string,
    scriptId: string,
    scriptHash: string,
    voiceTrackId?: string,
    source?: 'RECORDING',
  ): AuthorizedLocalAudio | null;
  ingest(value: unknown): Promise<unknown>;
  acceptAlignment(value: unknown): Promise<unknown>;
  alignAudio(id: string): Promise<unknown>;
  subtitles(alignmentId: string): unknown;
  compose(value: unknown): Promise<unknown>;
  burn(videoId: string, subtitleId: string): Promise<unknown>;
  qc(videoId: string, includeHandoffEvidence?: boolean): Promise<unknown>;
  qcHandoffEvidence?(
    videoId: string,
    reportId?: string,
  ): import('./local-qc-handoff.js').LocalQcHandoffEvidence | null;
  ensureQcHandoffEvidence?(
    videoId: string,
  ): Promise<import('./local-qc-handoff.js').LocalQcHandoffEvidence | null>;
  preview(videoId: string): Promise<unknown>;
  previewBytes(videoId: string): Promise<Buffer>;
}
