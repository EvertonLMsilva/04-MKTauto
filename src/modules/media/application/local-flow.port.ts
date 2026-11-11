import type { MediaAsset } from '../domain/media.types.js';
export type LocalImageSource = Pick<
  MediaAsset,
  'mediaReference' | 'contentHash' | 'origin' | 'provider' | 'rights'
>;
export interface LocalMediaScope {
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
  qc(videoId: string): Promise<unknown>;
  preview(videoId: string): Promise<unknown>;
  previewBytes(videoId: string): Promise<Buffer>;
}
