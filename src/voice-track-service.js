export class VoiceTrackService {
  constructor(repository) {
    if (!repository
      || typeof repository.registerVoiceTrack !== "function"
      || typeof repository.getVoiceTrack !== "function"
      || typeof repository.listVoiceTracksByPipelineRun !== "function"
      || typeof repository.listVoiceTracksByScript !== "function") {
      throw new TypeError("repositório de faixa de voz obrigatório");
    }
    this.repository = repository;
  }

  register(value) { return this.repository.registerVoiceTrack(value); }
  get(voiceTrackId) { return this.repository.getVoiceTrack(voiceTrackId); }
  listByPipelineRun(pipelineRunId) { return this.repository.listVoiceTracksByPipelineRun(pipelineRunId); }
  listByScript(scriptId) { return this.repository.listVoiceTracksByScript(scriptId); }
}
