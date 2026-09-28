import { ContractValidationError } from "./domain/contracts.js";
import {
  validateVoiceGenerationRequest,
  validateVoiceProviderOutput,
} from "./domain/voice-generation-contracts.js";
import { VOICE_TRACK_CONTRACT_VERSION, validateVoiceTrack } from "./domain/voice-track-contracts.js";

export class VoiceGenerationError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "VoiceGenerationError";
    this.code = code;
    this.field = field;
  }
}

export class VoiceGenerationService {
  constructor(repository, provider) {
    const methods = ["getVoiceGeneration", "getScript", "getRun", "registerGeneratedVoiceTrack"];
    if (!repository || methods.some((method) => typeof repository[method] !== "function")) throw new TypeError("repositório de geração de voz obrigatório");
    if (!provider || typeof provider.synthesize !== "function") throw new TypeError("VoiceProvider obrigatório");
    this.repository = repository;
    this.provider = provider;
  }

  async generate(value, { signal } = {}) {
    let request;
    try { request = validateVoiceGenerationRequest(value); }
    catch (caught) { throw mapError(caught); }

    const prior = this.repository.getVoiceGeneration(request.generationRequestId);
    if (prior) {
      if (prior.requestHash !== request.contentHash) throw failure("GENERATION_REQUEST_ID_REUSED", "generationRequestId", "identidade já usada com conteúdo divergente");
      return prior.voiceTrack;
    }
    if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");

    const script = this.repository.getScript(request.scriptId);
    if (!script) throw failure("SCRIPT_NOT_FOUND", "scriptId", "roteiro não encontrado");
    if (script.contentHash !== request.scriptContentHash) throw failure("SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash", "hash do roteiro divergente");
    const run = this.repository.getRun(script.pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    verifyScope(script, run);
    const input = buildProviderInput(request, script, run.projectSnapshot);

    let rawOutput;
    try { rawOutput = await this.provider.synthesize(input, { signal }); }
    catch (caught) { throw mapProviderError(caught); }

    try {
      const output = validateVoiceProviderOutput(rawOutput);
      verifyOutputDuration(output.durationMilliseconds, input.durationLimits);
      const voiceTrack = buildVoiceTrack(request, script, run, output);
      return this.repository.registerGeneratedVoiceTrack({ request, voiceTrack });
    } catch (caught) {
      throw mapError(caught);
    }
  }
}

function buildProviderInput(request, script, snapshot) {
  if (typeof script.fullNarration !== "string" || script.fullNarration.length === 0) throw failure("INVALID_SCRIPT_NARRATION", "fullNarration", "narração persistida inválida");
  const language = snapshot?.project?.audience?.language;
  const voiceStyle = snapshot?.channel?.voiceStyle;
  const minimumSeconds = snapshot?.channel?.minDurationSeconds;
  const maximumSeconds = snapshot?.channel?.maxDurationSeconds;
  if (script.language !== language) throw failure("VOICE_GENERATION_LANGUAGE_MISMATCH", "language", "idioma diverge do snapshot");
  if (!Number.isSafeInteger(minimumSeconds) || !Number.isSafeInteger(maximumSeconds)
    || minimumSeconds < 1 || maximumSeconds < minimumSeconds) {
    throw failure("INVALID_VOICE_DURATION_LIMITS", "durationLimits", "limites do snapshot inválidos");
  }
  return deepFreeze({
    narration: script.fullNarration,
    language,
    voiceStyle,
    durationLimits: { minimumSeconds, maximumSeconds },
    logicalCallId: request.generationRequestId,
  });
}

function verifyOutputDuration(durationMilliseconds, limits) {
  if (durationMilliseconds < limits.minimumSeconds * 1000
    || durationMilliseconds > limits.maximumSeconds * 1000) {
    throw failure("VOICE_DURATION_OUT_OF_RANGE", "durationMilliseconds", "duração medida fora dos limites do projeto");
  }
}

function buildVoiceTrack(request, script, run, output) {
  return validateVoiceTrack({
    schemaVersion: VOICE_TRACK_CONTRACT_VERSION,
    voiceTrackId: `voice_track:${request.generationRequestId}`,
    pipelineRunId: run.pipelineRunId,
    projectId: run.projectId,
    projectVersion: run.projectVersion,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    language: run.projectSnapshot.project.audience.language,
    voiceStyle: run.projectSnapshot.channel.voiceStyle,
    durationMilliseconds: output.durationMilliseconds,
    audioFormat: output.audioFormat,
    contentHash: output.contentHash,
    storageReference: output.storageReference,
    origin: output.origin,
    provider: output.provider,
    rights: output.rights,
    createdAt: request.requestedAt,
    revision: 1,
    supersedesVoiceTrackId: null,
  });
}

function verifyScope(script, run) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) {
    if (script[field] !== run[field]) throw failure("VOICE_GENERATION_RUN_SCOPE_MISMATCH", field, "roteiro fora do escopo da execução");
  }
  const snapshot = run.projectSnapshot;
  if (!snapshot || snapshot.project?.id !== run.projectId || snapshot.project?.version !== run.projectVersion) {
    throw failure("VOICE_GENERATION_RUN_SCOPE_MISMATCH", "projectSnapshot", "snapshot divergente");
  }
}

function mapProviderError(caught) {
  if (caught instanceof VoiceGenerationError) return caught;
  if (typeof caught?.code === "string" && /^PROVIDER_/.test(caught.code)) return failure(caught.code, caught.field ?? "provider", "falha sanitizada do provider", { cause: caught });
  return failure("PROVIDER_FAILED", "provider", "não foi possível gerar a faixa de voz", { cause: caught });
}

function mapError(caught) {
  if (caught instanceof VoiceGenerationError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "conteúdo inválido", { cause: caught });
  if (typeof caught?.code === "string" && typeof caught?.field === "string") return failure(caught.code, caught.field, "operação não concluída", { cause: caught });
  return failure("VOICE_GENERATION_FAILED", "voiceTrack", "não foi possível concluir a geração", { cause: caught });
}

function failure(code, field, message, options) { return new VoiceGenerationError(code, field, message, options); }
function deepFreeze(value) { const clone = structuredClone(value); freeze(clone); return clone; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
