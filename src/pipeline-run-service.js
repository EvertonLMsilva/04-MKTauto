import { resolvePipelineHandoff } from "./project-pipeline-handoff.js";

export class PipelineRunService {
  constructor(repository) {
    if (!repository
      || typeof repository.get !== "function"
      || typeof repository.startRun !== "function"
      || typeof repository.getRun !== "function"
      || typeof repository.transitionRun !== "function") {
      throw new TypeError("repositório de PipelineRun obrigatório");
    }
    this.repository = repository;
  }

  start(value) {
    return this.repository.startRun(resolvePipelineHandoff(this.repository, value));
  }

  resume(value) {
    return this.start(value);
  }

  get(pipelineRunId) {
    return this.repository.getRun(pipelineRunId);
  }

  succeed(pipelineRunId, { completedAt } = {}) {
    return this.repository.transitionRun({ pipelineRunId, nextState: "SUCCEEDED", completedAt });
  }

  fail(pipelineRunId, { completedAt, error } = {}) {
    return this.repository.transitionRun({ pipelineRunId, nextState: "FAILED", completedAt, error });
  }
}
