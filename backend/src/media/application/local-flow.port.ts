export interface LocalAudiovisualPort {
  ingest(value: unknown): Promise<unknown>;
  acceptAlignment(value: unknown): Promise<unknown>;
  subtitles(alignmentId: string): unknown;
  compose(value: unknown): Promise<unknown>;
  burn(videoId: string, subtitleId: string): Promise<unknown>;
  qc(videoId: string): Promise<unknown>;
  preview(videoId: string): Promise<unknown>;
  previewBytes(videoId: string): Promise<Buffer>;
}
