import type { LocalAudiovisualPort } from './local-flow.port.js';
export class LocalFlowService {
  constructor(private readonly runtime: LocalAudiovisualPort) {}
  audioBytes(
    runId: string,
    scriptId: string,
    scriptHash: string,
    voiceId: string,
  ) {
    if (!this.runtime.audioBytes)
      throw Object.assign(new Error('LOCAL_MEDIA_UNAVAILABLE'), {
        code: 'LOCAL_MEDIA_UNAVAILABLE',
      });
    return this.runtime.audioBytes(runId, scriptId, scriptHash, voiceId);
  }
  ingestTts(
    scope: Parameters<NonNullable<LocalAudiovisualPort['ingestTts']>>[0],
    id: string,
    durationMs: number,
  ) {
    if (!this.runtime.ingestTts)
      throw Object.assign(new Error('LOCAL_MEDIA_UNAVAILABLE'), {
        code: 'LOCAL_MEDIA_UNAVAILABLE',
      });
    return this.runtime.ingestTts(scope, id, durationMs);
  }
  automaticAudioReady() {
    return this.runtime.automaticAudioReady?.() ?? false;
  }
  automaticAudio(
    scope: Parameters<NonNullable<LocalAudiovisualPort['automaticAudio']>>[0],
    durationMs: number,
  ) {
    if (!this.runtime.automaticAudio)
      throw Object.assign(new Error('LOCAL_TTS_CONFIGURATION_REQUIRED'), {
        code: 'LOCAL_TTS_CONFIGURATION_REQUIRED',
      });
    return this.runtime.automaticAudio(scope, durationMs);
  }
  publicationEvidence(qcId: string) {
    if (!this.runtime.publicationEvidence)
      throw Object.assign(new Error('PUBLICATION_EVIDENCE_REQUIRED'), {
        code: 'PUBLICATION_EVIDENCE_REQUIRED',
      });
    return this.runtime.publicationEvidence(qcId);
  }
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
    source?: 'RECORDING',
  ) {
    return (
      this.runtime.authorizedAudio?.(
        runId,
        scriptId,
        scriptHash,
        voiceTrackId,
        source,
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
