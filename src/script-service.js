export class ScriptService {
  constructor(repository) {
    if (!repository
      || typeof repository.registerScript !== "function"
      || typeof repository.getScript !== "function"
      || typeof repository.listScriptsByPipelineRun !== "function"
      || typeof repository.listScriptsBySelection !== "function") {
      throw new TypeError("repositório de roteiro obrigatório");
    }
    this.repository = repository;
  }

  register(value) { return this.repository.registerScript(value); }
  get(scriptId) { return this.repository.getScript(scriptId); }
  listByPipelineRun(pipelineRunId) { return this.repository.listScriptsByPipelineRun(pipelineRunId); }
  listBySelection(ideaSelectionId) { return this.repository.listScriptsBySelection(ideaSelectionId); }
}
