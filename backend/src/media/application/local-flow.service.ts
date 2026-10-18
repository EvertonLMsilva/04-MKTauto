import type { LocalAudiovisualPort } from './local-flow.port.js';
export class LocalFlowService {
  constructor(private readonly runtime: LocalAudiovisualPort) {}
  ingestRecording(
    scope: Parameters<NonNullable<LocalAudiovisualPort['ingestRecording']>>[0],
    input: Parameters<NonNullable<LocalAudiovisualPort['ingestRecording']>>[1],
    actorId: string,
  ) {
    if (!this.runtime.ingestRecording)
      throw Object.assign(new Error('LOCAL_MEDIA_UNAVAILABLE'), {
        code: 'LOCAL_MEDIA_UNAVAILABLE',
      });
    return this.runtime.ingestRecording(scope, input, actorId);
  }
  authorizedAudio(
    runId: string,
    scriptId: string,
    scriptHash: string,
    voiceTrackId?: string,
  ) {
    return (
      this.runtime.authorizedAudio?.(
        runId,
        scriptId,
        scriptHash,
        voiceTrackId,
      ) ?? null
    );
  }
  ingest(value: unknown) {
    return this.runtime.ingest(value);
  }
  acceptAlignment(value: unknown) {
    return this.runtime.acceptAlignment(value);
  }
  alignAudio(id: string) {
    return this.runtime.alignAudio(id);
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
