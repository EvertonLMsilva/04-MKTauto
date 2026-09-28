export class MediaAssetService {
  constructor(repository) {
    if (!repository
      || typeof repository.registerMediaAsset !== "function"
      || typeof repository.getMediaAsset !== "function"
      || typeof repository.listMediaAssetsByPipelineRun !== "function"
      || typeof repository.listMediaAssetsByScript !== "function"
      || typeof repository.listMediaAssetsByVisualDirection !== "function") {
      throw new TypeError("repositório de ativo de mídia obrigatório");
    }
    this.repository = repository;
  }

  register(value) { return this.repository.registerMediaAsset(value); }
  get(mediaAssetId) { return this.repository.getMediaAsset(mediaAssetId); }
  listByPipelineRun(pipelineRunId) { return this.repository.listMediaAssetsByPipelineRun(pipelineRunId); }
  listByScript(scriptId) { return this.repository.listMediaAssetsByScript(scriptId); }
  listByVisualDirection(scriptId, visualDirectionPosition) {
    return this.repository.listMediaAssetsByVisualDirection(scriptId, visualDirectionPosition);
  }
}
