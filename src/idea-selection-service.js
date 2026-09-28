export class IdeaSelectionService {
  constructor(repository) {
    if (!repository
      || typeof repository.registerSelection !== "function"
      || typeof repository.getSelection !== "function"
      || typeof repository.listSelectionsByPipelineRun !== "function"
      || typeof repository.listSelectionsByBatch !== "function") {
      throw new TypeError("repositório de seleção de ideia obrigatório");
    }
    this.repository = repository;
  }

  select(value) { return this.repository.registerSelection(value); }
  get(ideaSelectionId) { return this.repository.getSelection(ideaSelectionId); }
  listByPipelineRun(pipelineRunId) { return this.repository.listSelectionsByPipelineRun(pipelineRunId); }
  listByBatch(ideaBatchId) { return this.repository.listSelectionsByBatch(ideaBatchId); }
}
