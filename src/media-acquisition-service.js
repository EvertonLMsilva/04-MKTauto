import { ContractValidationError } from "./domain/contracts.js";
import {
  validateMediaAcquisitionRequest,
  validateMediaProviderOutput,
} from "./domain/media-acquisition-contracts.js";
import { MEDIA_ASSET_CONTRACT_VERSION, validateMediaAsset } from "./domain/media-asset-contracts.js";

export class MediaAcquisitionError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "MediaAcquisitionError";
    this.code = code;
    this.field = field;
  }
}

export class MediaAcquisitionService {
  constructor(repository, provider) {
    const methods = ["getMediaAcquisition", "getScript", "getRun", "registerAcquiredMediaAsset"];
    if (!repository || methods.some((method) => typeof repository[method] !== "function")) throw new TypeError("repositório de aquisição de mídia obrigatório");
    if (!provider || typeof provider.provide !== "function") throw new TypeError("MediaProvider obrigatório");
    this.repository = repository;
    this.provider = provider;
  }

  async acquire(value, { signal } = {}) {
    let request;
    try { request = validateMediaAcquisitionRequest(value); }
    catch (caught) { throw mapError(caught); }

    const prior = this.repository.getMediaAcquisition(request.mediaAcquisitionRequestId);
    if (prior) {
      if (prior.requestHash !== request.contentHash) throw failure("MEDIA_ACQUISITION_REQUEST_ID_REUSED", "mediaAcquisitionRequestId", "identidade já usada com conteúdo divergente");
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
    const input = buildProviderInput(request, direction, run);

    let rawOutput;
    try { rawOutput = await this.provider.provide(input, { signal }); }
    catch (caught) { throw mapProviderError(caught); }

    try {
      const output = validateMediaProviderOutput(rawOutput);
      if (output.assetType !== request.assetType) throw failure("MEDIA_ASSET_TYPE_MISMATCH", "assetType", "tipo retornado diverge do solicitado");
      const mediaAsset = buildMediaAsset(request, script, run, output);
      return this.repository.registerAcquiredMediaAsset({ request, mediaAsset });
    } catch (caught) { throw mapError(caught); }
  }
}

function buildProviderInput(request, direction, run) {
  const snapshot = run.projectSnapshot;
  return deepFreeze({
    logicalCallId: request.mediaAcquisitionRequestId,
    assetType: request.assetType,
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
    },
  });
}

function buildMediaAsset(request, script, run, output) {
  return validateMediaAsset({
    schemaVersion: MEDIA_ASSET_CONTRACT_VERSION,
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
  const publicCodes = new Set(["PROVIDER_CANCELLED", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED"]);
  if (publicCodes.has(caught?.code)) return failure(caught.code, "provider", "falha sanitizada do provider", { cause: caught });
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
