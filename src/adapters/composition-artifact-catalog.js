export class CompositionArtifactCatalog {
  constructor({ voiceRepository, mediaRepository }) {
    if (!voiceRepository || typeof voiceRepository.getVoiceTrack !== "function") throw new TypeError("repositório de voz obrigatório");
    if (!mediaRepository || typeof mediaRepository.getMediaAsset !== "function") throw new TypeError("repositório de mídia obrigatório");
    this.voiceRepository = voiceRepository; this.mediaRepository = mediaRepository;
  }
  getVoiceTrack(id) { return this.voiceRepository.getVoiceTrack(id); }
  getMediaAsset(id) { return this.mediaRepository.getMediaAsset(id); }
}
