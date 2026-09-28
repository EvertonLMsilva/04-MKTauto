export class CostLedgerService {
  constructor(repository) {
    if (!repository
      || typeof repository.registerCostEvent !== "function"
      || typeof repository.getCostEvent !== "function"
      || typeof repository.listCostEventsByPipelineRun !== "function"
      || typeof repository.getCostLedgerByPipelineRun !== "function") {
      throw new TypeError("repositório de custos obrigatório");
    }
    this.repository = repository;
  }

  register(value) {
    return this.repository.registerCostEvent(value);
  }

  get(costEventId) {
    return this.repository.getCostEvent(costEventId);
  }

  listByPipelineRun(pipelineRunId) {
    return this.repository.listCostEventsByPipelineRun(pipelineRunId);
  }

  getLedgerByPipelineRun(pipelineRunId) {
    return this.repository.getCostLedgerByPipelineRun(pipelineRunId);
  }
}
