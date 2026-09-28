export class IdeaService {
  constructor(repository) {
    if (!repository
      || typeof repository.registerBatch !== "function"
      || typeof repository.getIdeaWithScore !== "function"
      || typeof repository.listIdeasByPipelineRun !== "function") {
      throw new TypeError("repositório de ideias obrigatório");
    }
    this.repository = repository;
  }

  registerBatch(value) { return this.repository.registerBatch(value); }
  get(ideaCandidateId) { return this.repository.getIdeaWithScore(ideaCandidateId); }
  listByPipelineRun(pipelineRunId) { return this.repository.listIdeasByPipelineRun(pipelineRunId); }
}
