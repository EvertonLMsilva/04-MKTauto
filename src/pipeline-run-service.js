import { resolvePipelineHandoff } from "./project-pipeline-handoff.js";

export class PipelineRunService {
  constructor(repository, { now = () => new Date().toISOString() } = {}) {
    if (!repository
      || typeof repository.get !== "function"
      || typeof repository.startRun !== "function"
      || typeof repository.getRun !== "function"
      || typeof repository.transitionRun !== "function"
      || typeof repository.resumeRun !== "function") {
      throw new TypeError("repositório de PipelineRun obrigatório");
    }
    this.repository = repository;
    this.now = now;
  }

  start(value) {
    return this.repository.startRun(resolvePipelineHandoff(this.repository, value));
  }

  resume(value) {
    const run = this.start(value);
    return run.state === "FAILED" ? this.repository.resumeRun({ pipelineRunId: run.pipelineRunId, resumedAt: this.now() }) : run;
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
