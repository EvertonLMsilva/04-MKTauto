export interface AuthorizedLocalAudio {
  voiceTrackId: string;
  contentHash: string;
  durationMilliseconds: number;
}
export interface LocalAudiovisualPort {
  publicationEvidence?(qcId: string): unknown;
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
