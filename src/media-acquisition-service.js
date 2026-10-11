import { ContractValidationError } from "./domain/contracts.js";
import { AI_CALL_TELEMETRY_CONTRACT_VERSION, validateAiCallTelemetry } from "./domain/ai-call-telemetry-contracts.js";
import { COST_EVENT_CONTRACT_VERSION, validateCostEvent } from "./domain/cost-event-contracts.js";
import {
  validateMediaAcquisitionRequest,
  validateMediaProviderOutput,
} from "./domain/media-acquisition-contracts.js";
import { MEDIA_ASSET_CONTRACT_VERSION, MEDIA_ASSET_V2_CONTRACT_VERSION, validateMediaAsset } from "./domain/media-asset-contracts.js";

export class MediaAcquisitionError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "MediaAcquisitionError";
    this.code = code;
    this.field = field;
  }
}

export class MediaAcquisitionService {
  constructor(repository, provider, { now = () => new Date().toISOString() } = {}) {
    const methods = ["getMediaAcquisition", "getScript", "getRun", "registerAcquiredMediaAsset"];
    if (!repository || methods.some((method) => typeof repository[method] !== "function")) throw new TypeError("repositório de aquisição de mídia obrigatório");
    if (!provider || typeof provider.provide !== "function") throw new TypeError("MediaProvider obrigatório");
    if (typeof now !== "function") throw new TypeError("relógio obrigatório");
    this.repository = repository;
    this.provider = provider;
    this.now = now;
  }

  async acquire(value, { signal } = {}) {
    let request;
    try { request = validateMediaAcquisitionRequest(value); }
    catch (caught) { throw mapError(caught); }

    const prior = this.repository.getMediaAcquisition(request.mediaAcquisitionRequestId);
    if (prior) {
      if (prior.requestHash !== request.contentHash) throw failure("MEDIA_ACQUISITION_REQUEST_ID_REUSED", "mediaAcquisitionRequestId", "identidade já usada com conteúdo divergente");
      if (typeof this.provider.validateReuse === 'function') await this.provider.validateReuse(prior.mediaAsset, request, { signal });
      return prior.mediaAsset;
    }
    if (signal?.aborted) throw failure("PROVIDER_CANCELLED", "signal", "operação cancelada");

    const script = this.repository.getScript(request.scriptId);
    if (!script) throw failure("SCRIPT_NOT_FOUND", "scriptId", "roteiro não encontrado");
    if (script.contentHash !== request.scriptContentHash) throw failure("SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash", "hash do roteiro divergente");
    const run = this.repository.getRun(script.pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    verifyScope(script, run);
    const direction = script.visualDirections.find(({ position }) => position === request.visualDirectionPosition);
    if (!direction) throw failure("VISUAL_DIRECTION_NOT_FOUND", "visualDirectionPosition", "direção visual não pertence ao roteiro");
    const input = buildProviderInput(request, direction, run, this.repository);

    let rawOutput;
    try { rawOutput = await this.provider.provide(input, { signal, acquisitionRequest: request }); }
    catch (caught) { throw mapProviderError(caught); }

    try {
      const output = validateMediaProviderOutput(rawOutput);
      if (output.assetType !== request.assetType) throw failure("MEDIA_ASSET_TYPE_MISMATCH", "assetType", "tipo retornado diverge do solicitado");
      if (output.telemetry !== undefined && output.telemetry.provider !== output.provider) throw failure("PROVIDER_TELEMETRY_MISMATCH", "provider", "telemetria diverge do provider");
      if (output.telemetry !== undefined && output.telemetry.outputHash !== output.contentHash) throw failure("PROVIDER_TELEMETRY_MISMATCH", "outputHash", "telemetria diverge do conteúdo físico");
      if (typeof this.provider.findReusableAsset === 'function') {
        const reusable = this.provider.findReusableAsset(request, output);
        if (reusable) return validateMediaAsset(reusable);
      }
      const mediaAsset = buildMediaAsset(request, script, run, output);
      const telemetry = buildTelemetry(request, mediaAsset, output.telemetry, this.now());
      const costEvent = buildCostEvent(mediaAsset, telemetry);
      return this.repository.registerAcquiredMediaAsset({ request, mediaAsset, telemetry, costEvent });
    } catch (caught) { throw mapError(caught); }
  }
}

function buildTelemetry(request, asset, observation, recordedAt) {
  if (observation === undefined) return null;
  return validateAiCallTelemetry({
    schemaVersion: AI_CALL_TELEMETRY_CONTRACT_VERSION,
    aiCallId: `ai_call:${request.mediaAcquisitionRequestId}`,
    logicalCallId: request.mediaAcquisitionRequestId,
    requestHash: request.contentHash,
    pipelineRunId: asset.pipelineRunId,
    projectId: asset.projectId,
    projectVersion: asset.projectVersion,
    artifactId: asset.mediaAssetId,
    costEventId: observation.costAmount === null ? null : `cost:ai_call:${request.mediaAcquisitionRequestId}`,
    ...observation,
    outcome: "SUCCESS", failureCode: null, recordedAt,
  });
}

function buildCostEvent(asset, telemetry) {
  if (telemetry?.costEventId === null || telemetry === null) return null;
  return validateCostEvent({
    schemaVersion: COST_EVENT_CONTRACT_VERSION,
    costEventId: telemetry.costEventId,
    category: "media_cost",
    pipelineRunId: asset.pipelineRunId,
    projectId: asset.projectId,
    projectVersion: asset.projectVersion,
    contentIdentity: `media-asset:${asset.scriptId}:${asset.visualDirectionPosition}:${asset.assetType.toLowerCase()}`,
    artifactId: asset.mediaAssetId,
    amount: telemetry.costAmount,
    currency: telemetry.currency,
    occurredAt: telemetry.occurredAt,
    origin: `ai_telemetry:${telemetry.costOrigin}`,
    attributionRuleVersion: AI_CALL_TELEMETRY_CONTRACT_VERSION,
    recordedAt: telemetry.recordedAt,
  });
}

function buildProviderInput(request, direction, run, repository) {
  const snapshot = run.projectSnapshot;
  const used = typeof repository.listMediaAssetsByPipelineRun === "function"
    ? repository.listMediaAssetsByPipelineRun(run.pipelineRunId).map((asset) => asset.source?.externalAssetId).filter(Boolean)
    : [];
  return deepFreeze({
    logicalCallId: request.mediaAcquisitionRequestId,
    assetType: request.assetType,
    ...(request.assetType === "VIDEO" ? { excludedExternalAssetIds: [...new Set(used)].sort() } : {}),
    visualDirection: {
      position: direction.position,
      blockPosition: direction.blockPosition,
      description: direction.description,
    },
    projectContext: {
      projectId: run.projectId,
      projectVersion: run.projectVersion,
      language: snapshot.project.audience.language,
      audienceProfile: snapshot.project.audience.profile,
      niche: snapshot.project.niche,
      contentFormat: snapshot.channel.format,
      aspectRatio: snapshot.channel.aspectRatio,
      visualStyle: snapshot.channel.visualStyle,
      ...(request.assetType === "VIDEO" ? {
        productionProfile: snapshot.channel.productionProfile ?? "STATIC_IMAGE_V1",
        minDurationSeconds: snapshot.channel.minDurationSeconds ?? 25,
        maxDurationSeconds: snapshot.channel.maxDurationSeconds ?? 45,
      } : {}),
    },
  });
}

function buildMediaAsset(request, script, run, output) {
  return validateMediaAsset({
    schemaVersion: output.source === undefined ? MEDIA_ASSET_CONTRACT_VERSION : MEDIA_ASSET_V2_CONTRACT_VERSION,
    mediaAssetId: `media_asset:${request.mediaAcquisitionRequestId}`,
    pipelineRunId: run.pipelineRunId,
    projectId: run.projectId,
    projectVersion: run.projectVersion,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    visualDirectionPosition: request.visualDirectionPosition,
    assetType: output.assetType,
    technicalProperties: output.technicalProperties,
    contentHash: output.contentHash,
    mediaReference: output.mediaReference,
    origin: output.origin,
    provider: output.provider,
    rights: output.rights,
    ...(output.source === undefined ? {} : { source: output.source }),
    createdAt: request.requestedAt,
    revision: 1,
    supersedesMediaAssetId: null,
  });
}

function verifyScope(script, run) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) {
    if (script[field] !== run[field]) throw failure("MEDIA_ACQUISITION_RUN_SCOPE_MISMATCH", field, "roteiro fora do escopo da execução");
  }
  const snapshot = run.projectSnapshot;
  if (!snapshot || snapshot.project?.id !== run.projectId || snapshot.project?.version !== run.projectVersion) {
    throw failure("MEDIA_ACQUISITION_RUN_SCOPE_MISMATCH", "projectSnapshot", "snapshot divergente");
  }
}

function mapProviderError(caught) {
  if (caught instanceof MediaAcquisitionError) return caught;
  if (typeof caught?.code === "string" && /^PROVIDER_[A-Z0-9_]+$/.test(caught.code)) {
    const field = typeof caught.field === "string" && caught.field.length > 0 ? caught.field : "provider";
    return failure(caught.code, field, "falha sanitizada do provider", { cause: caught });
  }
  return failure("PROVIDER_FAILED", "provider", "não foi possível obter o ativo de mídia", { cause: caught });
}

function mapError(caught) {
  if (caught instanceof MediaAcquisitionError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "conteúdo inválido", { cause: caught });
  if (typeof caught?.code === "string" && typeof caught?.field === "string") return failure(caught.code, caught.field, "operação não concluída", { cause: caught });
  return failure("MEDIA_ACQUISITION_FAILED", "mediaAsset", "não foi possível concluir a aquisição", { cause: caught });
}

function failure(code, field, message, options) { return new MediaAcquisitionError(code, field, message, options); }
function deepFreeze(value) { const clone = structuredClone(value); freeze(clone); return clone; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
