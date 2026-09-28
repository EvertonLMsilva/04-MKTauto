export class CompositionPlanService {
  constructor(repository) {
    const methods = [
      "registerCompositionPlan", "getCompositionPlan",
      "listCompositionPlansByPipelineRun", "listCompositionPlansByScript",
    ];
    if (!repository || methods.some((method) => typeof repository[method] !== "function")) {
      throw new TypeError("repositório de CompositionPlan obrigatório");
    }
    this.repository = repository;
  }

  register(value) { return this.repository.registerCompositionPlan(value); }
  get(compositionPlanId) { return this.repository.getCompositionPlan(compositionPlanId); }
  listByPipelineRun(pipelineRunId) { return this.repository.listCompositionPlansByPipelineRun(pipelineRunId); }
  listByScript(scriptId) { return this.repository.listCompositionPlansByScript(scriptId); }
}
