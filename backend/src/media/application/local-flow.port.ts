export interface AuthorizedLocalAudio {
  voiceTrackId: string;
  contentHash: string;
  durationMilliseconds: number;
}
export interface LocalAudiovisualPort {
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
