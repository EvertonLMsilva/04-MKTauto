import { AI_CALL_TELEMETRY_CONTRACT_VERSION, validateAiCallObservation, validateAiCallTelemetry } from "./domain/ai-call-telemetry-contracts.js";
import { validateGenerationMetadata } from "./domain/artifact-lineage-contracts.js";
import { ContractValidationError } from "./domain/contracts.js";
import { COST_EVENT_CONTRACT_VERSION, validateCostEvent } from "./domain/cost-event-contracts.js";
import {
  validateScriptGenerationOutput,
  validateScriptGenerationRequest,
} from "./domain/script-generation-contracts.js";
import { SCRIPT_CONTRACT_VERSION, scriptContentHash, validateScript } from "./domain/script-contracts.js";

export class ScriptGenerationError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "ScriptGenerationError";
    this.code = code;
    this.field = field;
  }
}

export class ScriptGenerationService {
  constructor(repository, generator, { now = () => new Date().toISOString() } = {}) {
    const methods = ["getScriptGeneration", "getAiCallTelemetryByLogicalCall", "getSelection", "getIdea", "getRun", "registerGeneratedScript", "registerFailedAiCall"];
    if (!repository || methods.some((method) => typeof repository[method] !== "function")) throw new TypeError("repositório de geração de roteiro obrigatório");
    if (!generator || typeof generator.generate !== "function") throw new TypeError("ScriptGenerator obrigatório");
    if (typeof now !== "function") throw new TypeError("relógio obrigatório");
    this.repository = repository;
    this.generator = generator;
    this.now = now;
  }

  async generate(value, { signal } = {}) {
    let request;
    try { request = validateScriptGenerationRequest(value); }
    catch (caught) { throw mapError(caught); }

    const priorTelemetry = this.repository.getAiCallTelemetryByLogicalCall(request.generationRequestId);
    if (priorTelemetry) {
      if (priorTelemetry.requestHash !== request.contentHash) throw failure("GENERATION_REQUEST_ID_REUSED", "generationRequestId", "identidade já usada com conteúdo divergente");
      if (priorTelemetry.outcome === "FAILURE") throw failure(priorTelemetry.failureCode, "provider", "falha sanitizada registrada");
      const completed = this.repository.getScriptGeneration(request.generationRequestId);
      if (!completed) throw failure("INVALID_PERSISTED_SCRIPT_GENERATION", "generationRequestId", "geração persistida incompleta");
      return completed.script;
    }
    const prior = this.repository.getScriptGeneration(request.generationRequestId);
    if (prior) {
      if (prior.requestHash !== request.contentHash) throw failure("GENERATION_REQUEST_ID_REUSED", "generationRequestId", "identidade já usada com conteúdo divergente");
      return prior.script;
    }
    if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");

    const selection = this.repository.getSelection(request.ideaSelectionId);
    if (!selection) throw failure("IDEA_SELECTION_NOT_FOUND", "ideaSelectionId", "seleção não encontrada");
    if (selection.decision !== "SELECTED") throw failure("IDEA_SELECTION_NOT_SELECTED", "ideaSelectionId", "seleção não está aprovada");
    const run = this.repository.getRun(selection.pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    verifyScope(selection, run, "GENERATION_RUN_SCOPE_MISMATCH");
    const idea = this.repository.getIdea(selection.ideaCandidateId);
    if (!idea) throw failure("IDEA_CANDIDATE_NOT_FOUND", "ideaCandidateId", "ideia não encontrada");
    verifyIdea(selection, idea);

    let generated;
    try {
      generated = await this.generator.generate(deepFreeze({ selection, idea, projectSnapshot: run.projectSnapshot }), { signal });
    } catch (caught) {
      const mapped = mapProviderError(caught);
      this.#persistFailure(request, selection, caught?.telemetry, mapped.code);
      throw mapped;
    }

    try {
      if (!generated || typeof generated !== "object" || Array.isArray(generated)) throw failure("PROVIDER_INVALID_RESPONSE", "response", "resposta inválida");
      const output = validateScriptGenerationOutput(generated.output);
      const generationMetadata = validateGenerationMetadata(generated.generationMetadata);
      const observation = validateAiCallObservation(generated.telemetry);
      verifyObservationMetadata(observation, generationMetadata);
      verifyDuration(output.estimatedDurationSeconds, run.projectSnapshot.channel);
      const script = buildScript(request, selection, run.projectSnapshot, output);
      const telemetry = buildTelemetry(request, selection, observation, {
        artifactId: script.scriptId, outcome: "SUCCESS", failureCode: null,
        recordedAt: this.now(),
      });
      const costEvent = buildCostEvent(telemetry, selection.ideaSelectionId);
      return this.repository.registerGeneratedScript({ request, script, generationMetadata, telemetry, costEvent });
    } catch (caught) {
      const mapped = mapError(caught);
      this.#persistFailure(request, selection, generated?.telemetry, mapped.code);
      throw mapped;
    }
  }

  #persistFailure(request, selection, observationValue, failureCode) {
    if (observationValue === null || observationValue === undefined) return;
    let observation;
    try { observation = validateAiCallObservation(observationValue); }
    catch { return; }
    const telemetry = buildTelemetry(request, selection, observation, {
      artifactId: null, outcome: "FAILURE", failureCode, recordedAt: this.now(),
    });
    const costEvent = buildCostEvent(telemetry, selection.ideaSelectionId);
    this.repository.registerFailedAiCall({ request, telemetry, costEvent });
  }
}

function buildTelemetry(request, selection, observation, terminal) {
  return validateAiCallTelemetry({
    schemaVersion: AI_CALL_TELEMETRY_CONTRACT_VERSION,
    aiCallId: `ai_call:${request.generationRequestId}`,
    logicalCallId: request.generationRequestId,
    requestHash: request.contentHash,
    pipelineRunId: selection.pipelineRunId,
    projectId: selection.projectId,
    projectVersion: selection.projectVersion,
    costEventId: observation.costAmount === null ? null : `cost:ai_call:${request.generationRequestId}`,
    ...observation,
    ...terminal,
  });
}

function buildCostEvent(telemetry, ideaSelectionId) {
  if (telemetry.costEventId === null) return null;
  return validateCostEvent({
    schemaVersion: COST_EVENT_CONTRACT_VERSION,
    costEventId: telemetry.costEventId,
    category: "ai_cost",
    pipelineRunId: telemetry.pipelineRunId,
    projectId: telemetry.projectId,
    projectVersion: telemetry.projectVersion,
    contentIdentity: `script:${ideaSelectionId}`,
    artifactId: telemetry.artifactId,
    amount: telemetry.costAmount,
    currency: telemetry.currency,
    occurredAt: telemetry.occurredAt,
    origin: `ai_telemetry:${telemetry.costOrigin}`,
    attributionRuleVersion: AI_CALL_TELEMETRY_CONTRACT_VERSION,
    recordedAt: telemetry.recordedAt,
  });
}

function verifyObservationMetadata(observation, metadata) {
  for (const field of ["provider", "model", "taskType", "promptVersion"]) {
    if (observation[field] !== metadata[field]) throw failure("PROVIDER_TELEMETRY_MISMATCH", field, "telemetria diverge dos metadados de geração");
  }
}

function buildScript(request, selection, snapshot, output) {
  const script = {
    schemaVersion: SCRIPT_CONTRACT_VERSION,
    scriptId: `script:${request.generationRequestId}`,
    pipelineRunId: selection.pipelineRunId,
    projectId: selection.projectId,
    projectVersion: selection.projectVersion,
    ideaSelectionId: selection.ideaSelectionId,
    ideaSelectionContentHash: selection.contentHash,
    ideaCandidateId: selection.ideaCandidateId,
    ideaContentHash: selection.ideaContentHash,
    language: snapshot.project.audience.language,
    contentFormat: snapshot.channel.format,
    hook: output.hook,
    narrativeBlocks: output.narrativeBlocks,
    fullNarration: [output.hook, ...output.narrativeBlocks.map(({ narration }) => narration), output.cta].filter((part) => part !== null).join("\n\n"),
    visualDirections: output.visualDirections,
    cta: output.cta,
    estimatedDurationSeconds: output.estimatedDurationSeconds,
    sensitiveClaims: output.sensitiveClaims,
    reviewFlags: output.reviewFlags,
    origin: "EXTERNAL_CONSUMER",
    createdAt: request.requestedAt,
    revision: 1,
    supersedesScriptId: null,
    contentHash: "0".repeat(64),
  };
  script.contentHash = scriptContentHash(script);
  return validateScript(script);
}

function verifyScope(selection, run, code) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) if (selection[field] !== run[field]) throw failure(code, field, "escopo divergente");
  const snapshot = run.projectSnapshot;
  if (!snapshot || snapshot.project.id !== run.projectId || snapshot.project.version !== run.projectVersion) throw failure(code, "projectSnapshot", "snapshot divergente");
}

function verifyIdea(selection, idea) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion", "ideaCandidateId"]) if (selection[field] !== idea[field]) throw failure("GENERATION_IDEA_SCOPE_MISMATCH", field, "ideia fora do escopo");
  if (selection.ideaContentHash !== idea.contentHash) throw failure("IDEA_CONTENT_HASH_MISMATCH", "ideaContentHash", "hash da ideia divergente");
}

function verifyDuration(duration, channel) {
  if (duration < channel.minDurationSeconds || duration > channel.maxDurationSeconds) throw failure("SCRIPT_DURATION_OUT_OF_RANGE", "estimatedDurationSeconds", "duração fora dos limites do projeto");
}

function mapProviderError(caught) {
  if (caught instanceof ScriptGenerationError) return caught;
  if (typeof caught?.code === "string" && /^PROVIDER_|^OPENAI_CONFIGURATION_/.test(caught.code)) {
    return failure(caught.code, caught.field ?? "provider", "falha sanitizada do provider", { cause: caught });
  }
  return failure("PROVIDER_FAILED", "provider", "não foi possível gerar o roteiro", { cause: caught });
}

function mapError(caught) {
  if (caught instanceof ScriptGenerationError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "conteúdo inválido", { cause: caught });
  if (typeof caught?.code === "string" && typeof caught?.field === "string") return failure(caught.code, caught.field, "operação não concluída", { cause: caught });
  return failure("SCRIPT_GENERATION_FAILED", "script", "não foi possível concluir a geração", { cause: caught });
}

function failure(code, field, message, options) { return new ScriptGenerationError(code, field, message, options); }
function deepFreeze(value) { const clone = structuredClone(value); freeze(clone); return clone; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
