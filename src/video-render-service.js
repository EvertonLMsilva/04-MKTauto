export class VideoRenderService {
  constructor(repository) {
    const methods = [
      "registerVideoRender", "getVideoRender",
      "listVideoRendersByPipelineRun", "listVideoRendersByCompositionPlan",
    ];
    if (!repository || methods.some((method) => typeof repository[method] !== "function")) {
      throw new TypeError("repositório de VideoRender obrigatório");
    }
    this.repository = repository;
  }

  register(value) { return this.repository.registerVideoRender(value); }
  get(videoRenderId) { return this.repository.getVideoRender(videoRenderId); }
  listByPipelineRun(pipelineRunId) { return this.repository.listVideoRendersByPipelineRun(pipelineRunId); }
  listByCompositionPlan(compositionPlanId) { return this.repository.listVideoRendersByCompositionPlan(compositionPlanId); }
}
