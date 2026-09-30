export class SubtitleTrackService {
  constructor(repository) {
    if (!repository
      || typeof repository.registerSubtitleTrack !== "function"
      || typeof repository.getSubtitleTrack !== "function"
      || typeof repository.listSubtitleTracksByPipelineRun !== "function"
      || typeof repository.listSubtitleTracksByScript !== "function"
      || typeof repository.listSubtitleTracksByVoiceTrack !== "function") {
      throw new TypeError("repositório de legenda obrigatório");
    }
    this.repository = repository;
  }

  register(value) { return this.repository.registerSubtitleTrack(value); }
  get(subtitleTrackId) { return this.repository.getSubtitleTrack(subtitleTrackId); }
  listByPipelineRun(pipelineRunId) { return this.repository.listSubtitleTracksByPipelineRun(pipelineRunId); }
  listByScript(scriptId) { return this.repository.listSubtitleTracksByScript(scriptId); }
  listByVoiceTrack(voiceTrackId) { return this.repository.listSubtitleTracksByVoiceTrack(voiceTrackId); }
}
