import type { LocalAudiovisualPort } from './local-flow.port.js';
export class LocalFlowService {
  constructor(private readonly runtime: LocalAudiovisualPort) {}
  ingest(value: unknown) {
    return this.runtime.ingest(value);
  }
  acceptAlignment(value: unknown) {
    return this.runtime.acceptAlignment(value);
  }
  subtitles(id: string) {
    return this.runtime.subtitles(id);
  }
  compose(value: unknown) {
    return this.runtime.compose(value);
  }
  burn(videoId: string, subtitleId: string) {
    return this.runtime.burn(videoId, subtitleId);
  }
  qc(videoId: string) {
    return this.runtime.qc(videoId);
  }
  preview(videoId: string) {
    return this.runtime.preview(videoId);
  }
  previewBytes(videoId: string) {
    return this.runtime.previewBytes(videoId);
  }
}
