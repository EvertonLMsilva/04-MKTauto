export class ArtifactLineageService {
  constructor(repository) {
    if (!repository
      || typeof repository.registerArtifact !== "function"
      || typeof repository.getArtifact !== "function"
      || typeof repository.listByPipelineRun !== "function") {
      throw new TypeError("repositório de linhagem de artefatos obrigatório");
    }
    this.repository = repository;
  }

  register(value) {
    return this.repository.registerArtifact(value);
  }

  get(artifactId) {
    return this.repository.getArtifact(artifactId);
  }

  listByPipelineRun(pipelineRunId) {
    return this.repository.listByPipelineRun(pipelineRunId);
  }
}
