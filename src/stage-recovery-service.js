import { createHash } from "node:crypto";
import { PIPELINE_STAGES, STAGE_ATTEMPT_TRIGGERS, isTransientStageFailure, stageExecutionIdentityHash, validateStageExecutionRequest } from "./domain/stage-recovery-contracts.js";

export class StageRecoveryError extends Error {
  constructor(code, field, message, options) { super(`${code}: ${message}`, options); this.name = "StageRecoveryError"; this.code = code; this.field = field; }
}

export class StageRecoveryService {
  constructor(repository, { now = () => new Date().toISOString(), sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), maxAutomaticAttempts = 3, backoffMilliseconds = 100 } = {}) {
    if (!repository || ["findSucceeded", "getLatestAttempt", "listAttempts", "startAttempt", "succeed", "fail"].some((method) => typeof repository[method] !== "function")) throw new TypeError("repositório de recuperação obrigatório");
    if (!Number.isSafeInteger(maxAutomaticAttempts) || maxAutomaticAttempts < 1 || maxAutomaticAttempts > 3) throw new TypeError("limite automático deve estar entre 1 e 3");
    Object.assign(this, { repository, now, sleep, maxAutomaticAttempts, backoffMilliseconds });
  }

  async execute(value, operation, { trigger = "INITIAL" } = {}) {
    const request = validateStageExecutionRequest(value); requireTrigger(trigger); requireOperation(operation);
    const cached = this.repository.findSucceeded(request);
    if (cached) return Object.freeze({ ...cached.result, reused: true, attempt: cached.attempt });
    return this.#attempt(request, operation, trigger);
  }

  async retry(value, operation) {
    const request = validateStageExecutionRequest(value); requireOperation(operation);
    const cached = this.repository.findSucceeded(request);
    if (cached) return Object.freeze({ ...cached.result, reused: true, attempt: cached.attempt });
    const latest = this.repository.getLatestAttempt(request.pipelineRunId, request.stage);
    if (!latest || latest.state !== "FAILED" || latest.identityHash !== stageExecutionIdentityHash(request)) throw failure("STAGE_RETRY_NOT_ALLOWED", "stage", "somente a falha exata pode receber retry manual");
    return this.#attempt(request, operation, "MANUAL");
  }

  async recoverInterrupted(value, operation) {
    const request = validateStageExecutionRequest(value); requireOperation(operation);
    const cached = this.repository.findSucceeded(request);
    if (cached) return Object.freeze({ ...cached.result, reused: true, attempt: cached.attempt });
    const latest = this.repository.getLatestAttempt(request.pipelineRunId, request.stage);
    if (!latest || latest.state !== "RUNNING" || latest.identityHash !== stageExecutionIdentityHash(request)) throw failure("STAGE_RECOVERY_NOT_ALLOWED", "stage", "somente a tentativa interrompida exata pode ser recuperada");
    this.repository.fail(latest.id, { completedAt: this.now(), error: Object.assign(new Error("interrupted"), { code: "STAGE_INTERRUPTED", field: "stage", transient: true }) });
    return this.#attempt(request, operation, "MANUAL");
  }

  getStatuses(pipelineRunId) {
    const attempts = this.repository.listAttempts(pipelineRunId); const latest = new Map();
    for (const attempt of attempts) latest.set(attempt.stage, attempt);
    const statuses = new Map();
    for (const stage of PIPELINE_STAGES) {
      const attempt = latest.get(stage);
      if (!attempt) { statuses.set(stage, status(stage, "PENDING", null)); continue; }
      let state = attempt.state;
      if (state === "SUCCEEDED") {
        for (const input of attempt.inputs) {
          const dependency = latest.get(input.stage);
          if (!dependency || dependency.state !== "SUCCEEDED" || dependency.artifactId !== input.artifactId || dependency.artifactContentHash !== input.contentHash) { state = "PENDING"; break; }
        }
      }
      statuses.set(stage, status(stage, state, attempt));
    }
    return Object.freeze(PIPELINE_STAGES.map((stage) => statuses.get(stage)));
  }

  async #attempt(request, operation, trigger) {
    let kind = trigger;
    for (let automaticIndex = 0; automaticIndex < this.maxAutomaticAttempts; automaticIndex += 1) {
      const started = this.repository.startAttempt(request, { trigger: kind, startedAt: this.now() });
      try {
        const produced = normalizeProduced(await operation(Object.freeze({ attempt: started.attempt, trigger: kind })));
        const completed = this.repository.succeed(started.id, { completedAt: this.now(), artifactId: produced.artifactId, artifactContentHash: produced.contentHash, result: produced });
        return Object.freeze({ ...completed.result, reused: false, attempt: completed.attempt });
      } catch (caught) {
        const completed = this.repository.fail(started.id, { completedAt: this.now(), error: caught });
        if (!isTransientStageFailure(caught) || automaticIndex + 1 >= this.maxAutomaticAttempts) throw caught;
        await this.sleep(this.backoffMilliseconds * (2 ** automaticIndex)); kind = "AUTOMATIC";
      }
    }
    throw failure("STAGE_RETRY_EXHAUSTED", "stage", "limite de tentativas excedido");
  }
}

export function aggregateStageResult(stage, values) {
  if (!Array.isArray(values) || values.length === 0) throw failure("STAGE_RESULT_REQUIRED", "result", "resultado obrigatório");
  const normalized = values.map(({ artifactId, contentHash }) => ({ artifactId, contentHash }));
  const contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return Object.freeze({ artifactId: `${stage.toLowerCase()}:set:${contentHash.slice(0, 24)}`, contentHash, value: values });
}

function normalizeProduced(value) { if (!value || typeof value !== "object") throw failure("INVALID_STAGE_RESULT", "result", "resultado inválido"); const artifactId = identifier(value.artifactId); const contentHash = hash(value.contentHash); return Object.freeze({ artifactId, contentHash, value: value.value ?? null }); }
function status(stage, state, attempt) { return Object.freeze({ stage, state, attempt: attempt?.attempt ?? 0, failure: attempt?.failure ?? null, artifactId: state === "SUCCEEDED" ? attempt.artifactId : null, artifactContentHash: state === "SUCCEEDED" ? attempt.artifactContentHash : null }); }
function requireTrigger(value) { if (!STAGE_ATTEMPT_TRIGGERS.includes(value)) throw failure("INVALID_STAGE_TRIGGER", "trigger", "origem inválida"); }
function requireOperation(value) { if (typeof value !== "function") throw new TypeError("operação obrigatória"); }
function identifier(value) { if (typeof value !== "string" || value.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9_:.\/-]{1,}$/.test(value)) throw failure("INVALID_STAGE_RESULT", "artifactId", "identificador inválido"); return value; }
function hash(value) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw failure("INVALID_STAGE_RESULT", "contentHash", "hash inválido"); return value; }
function failure(code, field, message, options) { return new StageRecoveryError(code, field, message, options); }
