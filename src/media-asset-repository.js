import { createHash } from "node:crypto";
import { validateAiCallTelemetry } from "./domain/ai-call-telemetry-contracts.js";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION, validateArtifactLineage } from "./domain/artifact-lineage-contracts.js";
import { ContractValidationError } from "./domain/contracts.js";
import { validateCostEvent } from "./domain/cost-event-contracts.js";
import {
  MEDIA_ACQUISITION_REQUEST_VERSION,
  mediaAcquisitionRequestHash,
  validateMediaAcquisitionRequest,
} from "./domain/media-acquisition-contracts.js";
import { mediaAssetIdentityHash, validateMediaAsset } from "./domain/media-asset-contracts.js";
import { ScriptRepository } from "./script-repository.js";

export class MediaAssetRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "MediaAssetRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class MediaAssetRepository extends ScriptRepository {
  registerMediaAsset(value) {
    let asset;
    try { asset = validateMediaAsset(value); }
    catch (caught) { throw mapError(caught); }
    return this.#transaction(() => this.#registerValidated(asset));
  }

  registerAcquiredMediaAsset({ request: requestValue, mediaAsset: assetValue, telemetry: telemetryValue = null, costEvent: costEventValue = null }) {
    let request;
    let asset;
    let telemetry;
    let costEvent;
    try {
      request = validateMediaAcquisitionRequest(requestValue);
      asset = validateMediaAsset(assetValue);
      telemetry = telemetryValue === null ? null : validateAiCallTelemetry(telemetryValue);
      costEvent = costEventValue === null ? null : validateCostEvent(costEventValue);
    } catch (caught) { throw mapError(caught); }
    return this.#transaction(() => {
      const prior = this.db.prepare(`SELECT request_hash, media_asset_id
        FROM media_acquisition_requests WHERE media_acquisition_request_id = ?`)
        .get(request.mediaAcquisitionRequestId);
      if (prior) {
        if (prior.request_hash !== request.contentHash) throw failure("MEDIA_ACQUISITION_REQUEST_ID_REUSED", "mediaAcquisitionRequestId", "identidade já usada com conteúdo divergente");
        return this.getMediaAsset(prior.media_asset_id);
      }
      verifyAcquisitionBinding(request, asset);
      verifyTelemetryBinding(request, asset, telemetry, costEvent);
      const created = this.#registerValidated(asset);
      this.db.prepare(`INSERT INTO media_acquisition_requests
        (media_acquisition_request_id, schema_version, request_hash, script_id,
         script_content_hash, visual_direction_position, asset_type, media_asset_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        request.mediaAcquisitionRequestId, request.schemaVersion, request.contentHash,
        request.scriptId, request.scriptContentHash, request.visualDirectionPosition,
        request.assetType, created.mediaAssetId, request.requestedAt,
      );
      this.#insertCostEvent(costEvent);
      this.#insertTelemetry(telemetry);
      return created;
    });
  }

  getMediaAcquisition(mediaAcquisitionRequestId) {
    requireIdentifier(mediaAcquisitionRequestId, "mediaAcquisitionRequestId", 180);
    const row = this.db.prepare(`SELECT * FROM media_acquisition_requests
      WHERE media_acquisition_request_id = ?`).get(mediaAcquisitionRequestId);
    if (!row) return null;
    try {
      const mediaAsset = this.getMediaAsset(row.media_asset_id);
      if (!mediaAsset || row.schema_version !== MEDIA_ACQUISITION_REQUEST_VERSION) throw new Error("aquisição incompleta");
      const expectedHash = mediaAcquisitionRequestHash({
        schemaVersion: row.schema_version,
        mediaAcquisitionRequestId: row.media_acquisition_request_id,
        scriptId: row.script_id,
        scriptContentHash: row.script_content_hash,
        visualDirectionPosition: row.visual_direction_position,
        assetType: row.asset_type,
        requestedAt: row.created_at,
        contentHash: row.request_hash,
      });
      if (expectedHash !== row.request_hash
        || mediaAsset.mediaAssetId !== `media_asset:${row.media_acquisition_request_id}`
        || mediaAsset.scriptId !== row.script_id
        || mediaAsset.scriptContentHash !== row.script_content_hash
        || mediaAsset.visualDirectionPosition !== row.visual_direction_position
        || mediaAsset.assetType !== row.asset_type
        || mediaAsset.createdAt !== row.created_at) throw new Error("vínculo inválido");
      return deepFreeze({ requestHash: row.request_hash, mediaAsset });
    } catch (caught) {
      if (caught instanceof MediaAssetRepositoryError) throw caught;
      throw failure("INVALID_PERSISTED_MEDIA_ACQUISITION", "mediaAcquisitionRequestId", "aquisição persistida inválida", { cause: caught });
    }
  }

  getMediaAsset(mediaAssetId) {
    requireIdentifier(mediaAssetId, "mediaAssetId", 200);
    const row = this.db.prepare("SELECT * FROM media_assets WHERE media_asset_id = ?").get(mediaAssetId);
    if (!row) return null;
    try {
      const asset = validateMediaAsset(JSON.parse(row.payload_json));
      verifyPersistedColumns(asset, row);
      if (mediaAssetIdentityHash(asset) !== row.identity_hash) throw new Error("identidade divergente");
      const run = this.getRun(asset.pipelineRunId);
      const script = this.getScript(asset.scriptId);
      if (!run || !script) throw new Error("escopo ausente");
      verifyScope(run, asset, "MEDIA_ASSET_RUN_SCOPE_MISMATCH");
      verifyScript(asset, script);
      const lineage = this.getArtifact(asset.mediaAssetId);
      if (!lineage || lineage.artifactType !== "media_asset" || lineage.contentHash !== asset.contentHash) throw new Error("linhagem divergente");
      return asset;
    } catch (caught) {
      if (caught instanceof MediaAssetRepositoryError) throw caught;
      throw failure("INVALID_PERSISTED_MEDIA_ASSET", "mediaAssetId", "ativo persistido inválido", { cause: caught });
    }
  }

  listMediaAssetsByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    return this.db.prepare(`SELECT media_asset_id FROM media_assets WHERE pipeline_run_id = ?
      ORDER BY created_at, script_id, visual_direction_position, asset_type, revision, media_asset_id`).all(pipelineRunId)
      .map(({ media_asset_id: id }) => this.getMediaAsset(id));
  }

  listMediaAssetsByScript(scriptId) {
    requireIdentifier(scriptId, "scriptId", 200);
    return this.db.prepare(`SELECT media_asset_id FROM media_assets WHERE script_id = ?
      ORDER BY visual_direction_position, asset_type, revision, media_asset_id`).all(scriptId)
      .map(({ media_asset_id: id }) => this.getMediaAsset(id));
  }

  listMediaAssetsByVisualDirection(scriptId, visualDirectionPosition) {
    requireIdentifier(scriptId, "scriptId", 200);
    requirePositiveInteger(visualDirectionPosition, "visualDirectionPosition", "INVALID_VISUAL_DIRECTION_POSITION");
    return this.db.prepare(`SELECT media_asset_id FROM media_assets
      WHERE script_id = ? AND visual_direction_position = ?
      ORDER BY asset_type, revision, media_asset_id`).all(scriptId, visualDirectionPosition)
      .map(({ media_asset_id: id }) => this.getMediaAsset(id));
  }

  #registerValidated(asset) {
    const identityHash = mediaAssetIdentityHash(asset);
    const prior = this.db.prepare("SELECT identity_hash FROM media_assets WHERE media_asset_id = ?").get(asset.mediaAssetId);
    if (prior) {
      if (prior.identity_hash !== identityHash) throw failure("MEDIA_ASSET_ID_REUSED", "mediaAssetId", "ID já usado com ativo incompatível");
      return this.getMediaAsset(asset.mediaAssetId);
    }
    const logicalPrior = this.db.prepare(`SELECT media_asset_id FROM media_assets
      WHERE script_id = ? AND visual_direction_position = ? AND asset_type = ? AND revision = ?`)
      .get(asset.scriptId, asset.visualDirectionPosition, asset.assetType, asset.revision);
    if (logicalPrior) throw failure("MEDIA_ASSET_REVISION_CONFLICT", "revision", "revisão já registrada para a direção visual");

    const run = this.getRun(asset.pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    verifyScope(run, asset, "MEDIA_ASSET_RUN_SCOPE_MISMATCH");
    const script = this.getScript(asset.scriptId);
    if (!script) throw failure("SCRIPT_NOT_FOUND", "scriptId", "roteiro não encontrado");
    verifyScript(asset, script);
    const previous = this.#validateRevision(asset);
    this.#insertLineage(asset, previous);
    const technical = asset.technicalProperties;
    this.db.prepare(`INSERT INTO media_assets
      (media_asset_id, schema_version, identity_hash, pipeline_run_id, project_id,
       project_version, script_id, script_content_hash, visual_direction_position,
       asset_type, media_format, width_pixels, height_pixels, duration_milliseconds,
       content_hash, media_reference, origin, provider, usage_basis,
       commercial_use_allowed, created_at, revision, supersedes_media_asset_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(
      asset.mediaAssetId, asset.schemaVersion, identityHash, asset.pipelineRunId,
      asset.projectId, asset.projectVersion, asset.scriptId, asset.scriptContentHash,
      asset.visualDirectionPosition, asset.assetType, technical.format,
      technical.widthPixels, technical.heightPixels, technical.durationMilliseconds,
      asset.contentHash, asset.mediaReference, asset.origin, asset.provider,
      asset.rights.usageBasis, asset.createdAt, asset.revision,
      asset.supersedesMediaAssetId, JSON.stringify(asset),
    );
    return this.getMediaAsset(asset.mediaAssetId);
  }

  #validateRevision(asset) {
    if (asset.revision === 1) return null;
    const previous = this.getMediaAsset(asset.supersedesMediaAssetId);
    if (!previous) throw failure("SUPERSEDED_MEDIA_ASSET_NOT_FOUND", "supersedesMediaAssetId", "ativo anterior não encontrado");
    for (const field of ["pipelineRunId", "projectId", "projectVersion", "scriptId", "visualDirectionPosition", "assetType"]) {
      if (previous[field] !== asset[field]) throw failure("MEDIA_ASSET_SUPERSESSION_SCOPE_MISMATCH", field, "ativo anterior fora do escopo");
    }
    if (previous.revision + 1 !== asset.revision) throw failure("MEDIA_ASSET_REVISION_MISMATCH", "revision", "revisão não é sucessora imediata");
    return previous;
  }

  #insertLineage(asset, previous) {
    const inputs = [{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: asset.scriptId, contentHash: asset.scriptContentHash }];
    if (previous) inputs.push({ position: 2, kind: "INTERNAL_ARTIFACT", inputId: previous.mediaAssetId, contentHash: previous.contentHash });
    const artifact = validateArtifactLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: asset.mediaAssetId,
      artifactType: "media_asset",
      artifactVersion: asset.revision,
      pipelineRunId: asset.pipelineRunId,
      projectId: asset.projectId,
      projectVersion: asset.projectVersion,
      contentIdentity: `media-asset:${asset.scriptId}:${asset.visualDirectionPosition}:${asset.assetType.toLowerCase()}`,
      hashAlgorithm: "sha256",
      contentHash: asset.contentHash,
      inputs,
      generationMetadata: null,
      createdAt: asset.createdAt,
    });
    this.db.prepare(`INSERT INTO artifact_lineage
      (artifact_id, schema_version, artifact_type, artifact_version, identity_hash,
       pipeline_run_id, project_id, project_version, content_identity, hash_algorithm,
       content_hash, generation_metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`).run(
      artifact.artifactId, artifact.schemaVersion, artifact.artifactType,
      artifact.artifactVersion, sha256(JSON.stringify(artifact)), artifact.pipelineRunId,
      artifact.projectId, artifact.projectVersion, artifact.contentIdentity,
      artifact.hashAlgorithm, artifact.contentHash, artifact.createdAt,
    );
    const insert = this.db.prepare(`INSERT INTO artifact_lineage_inputs
      (artifact_id, position, kind, input_id, content_hash) VALUES (?, ?, ?, ?, ?)`);
    for (const input of artifact.inputs) insert.run(artifact.artifactId, input.position, input.kind, input.inputId, input.contentHash);
  }

  #insertCostEvent(event) {
    if (event === null) return;
    this.db.prepare(`INSERT INTO cost_events
      (cost_event_id, schema_version, identity_hash, category, pipeline_run_id,
       project_id, project_version, content_identity, artifact_id, amount, currency,
       occurred_at, origin, attribution_rule_version, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      event.costEventId, event.schemaVersion, sha256(JSON.stringify(event)), event.category,
      event.pipelineRunId, event.projectId, event.projectVersion, event.contentIdentity,
      event.artifactId, event.amount, event.currency, event.occurredAt, event.origin,
      event.attributionRuleVersion, event.recordedAt,
    );
  }

  #insertTelemetry(value) {
    if (value === null) return;
    this.db.prepare(`INSERT INTO ai_call_telemetry
      (ai_call_id, logical_call_id, schema_version, identity_hash, request_hash,
       pipeline_run_id, project_id, project_version, artifact_id, cost_event_id,
       provider, model, task_type, prompt_version, input_tokens, output_tokens,
       cached_input_tokens, usage_origin, cost_amount, currency, cost_origin,
       latency_ms, occurred_at, fallback, input_hash, output_hash, outcome,
       failure_code, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      value.aiCallId, value.logicalCallId, value.schemaVersion, sha256(JSON.stringify(value)),
      value.requestHash, value.pipelineRunId, value.projectId, value.projectVersion,
      value.artifactId, value.costEventId, value.provider, value.model, value.taskType,
      value.promptVersion, value.inputTokens, value.outputTokens, value.cachedInputTokens,
      value.usageOrigin, value.costAmount, value.currency, value.costOrigin,
      value.latencyMs, value.occurredAt, value.fallback === null ? null : Number(value.fallback),
      value.inputHash, value.outputHash, value.outcome, value.failureCode, value.recordedAt,
    );
  }

  #transaction(operation) {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (caught) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapError(caught);
    }
  }
}

function verifyScript(asset, script) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) {
    if (script[field] !== asset[field]) throw failure("MEDIA_ASSET_SCRIPT_SCOPE_MISMATCH", field, "roteiro fora do escopo");
  }
  if (script.contentHash !== asset.scriptContentHash) throw failure("SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash", "hash do roteiro divergente");
  if (!script.visualDirections.some(({ position }) => position === asset.visualDirectionPosition)) {
    throw failure("VISUAL_DIRECTION_NOT_FOUND", "visualDirectionPosition", "direção visual não pertence ao roteiro");
  }
}

function verifyAcquisitionBinding(request, asset) {
  for (const field of ["scriptId", "scriptContentHash", "visualDirectionPosition", "assetType"]) {
    if (request[field] !== asset[field]) throw failure("MEDIA_ACQUISITION_SCOPE_MISMATCH", field, "solicitação diverge do ativo");
  }
  if (request.requestedAt !== asset.createdAt) throw failure("MEDIA_ACQUISITION_SCOPE_MISMATCH", "requestedAt", "solicitação diverge do ativo");
  if (asset.mediaAssetId !== `media_asset:${request.mediaAcquisitionRequestId}`) throw failure("MEDIA_ACQUISITION_SCOPE_MISMATCH", "mediaAssetId", "solicitação diverge do ativo");
  if (asset.revision !== 1 || asset.supersedesMediaAssetId !== null) throw failure("MEDIA_ACQUISITION_SCOPE_MISMATCH", "revision", "aquisição inicial inválida");
}

function verifyTelemetryBinding(request, asset, telemetry, costEvent) {
  if (telemetry === null) {
    if (costEvent !== null) throw failure("MEDIA_ACQUISITION_COST_MISMATCH", "costEvent", "custo sem telemetria");
    return;
  }
  const expected = {
    aiCallId: `ai_call:${request.mediaAcquisitionRequestId}`,
    logicalCallId: request.mediaAcquisitionRequestId,
    requestHash: request.contentHash,
    pipelineRunId: asset.pipelineRunId,
    projectId: asset.projectId,
    projectVersion: asset.projectVersion,
    artifactId: asset.mediaAssetId,
    outcome: "SUCCESS",
  };
  for (const [field, value] of Object.entries(expected)) if (telemetry[field] !== value) throw failure("MEDIA_ACQUISITION_TELEMETRY_MISMATCH", field, "telemetria diverge da aquisição");
  if (telemetry.provider !== asset.provider) throw failure("MEDIA_ACQUISITION_TELEMETRY_MISMATCH", "provider", "telemetria diverge do provider do ativo");
  if (telemetry.outputHash !== asset.contentHash) throw failure("MEDIA_ACQUISITION_TELEMETRY_MISMATCH", "outputHash", "telemetria diverge do conteúdo físico");
  if (telemetry.costEventId === null) {
    if (costEvent !== null) throw failure("MEDIA_ACQUISITION_COST_MISMATCH", "costEvent", "custo ausente na telemetria");
    return;
  }
  if (costEvent === null) throw failure("MEDIA_ACQUISITION_COST_MISMATCH", "costEvent", "evento de custo obrigatório");
  const costExpected = {
    costEventId: telemetry.costEventId, category: "media_cost",
    pipelineRunId: asset.pipelineRunId, projectId: asset.projectId,
    projectVersion: asset.projectVersion,
    contentIdentity: `media-asset:${asset.scriptId}:${asset.visualDirectionPosition}:${asset.assetType.toLowerCase()}`,
    artifactId: asset.mediaAssetId, amount: telemetry.costAmount,
    currency: telemetry.currency, occurredAt: telemetry.occurredAt,
    origin: `ai_telemetry:${telemetry.costOrigin}`,
    attributionRuleVersion: telemetry.schemaVersion, recordedAt: telemetry.recordedAt,
  };
  for (const [field, value] of Object.entries(costExpected)) if (costEvent[field] !== value) throw failure("MEDIA_ACQUISITION_COST_MISMATCH", field, "custo diverge da telemetria");
}

function verifyScope(stored, expected, code) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) if (stored[field] !== expected[field]) throw failure(code, field, "escopo divergente");
}

function verifyPersistedColumns(asset, row) {
  const technical = asset.technicalProperties;
  const expected = {
    media_asset_id: asset.mediaAssetId, schema_version: asset.schemaVersion,
    pipeline_run_id: asset.pipelineRunId, project_id: asset.projectId,
    project_version: asset.projectVersion, script_id: asset.scriptId,
    script_content_hash: asset.scriptContentHash,
    visual_direction_position: asset.visualDirectionPosition, asset_type: asset.assetType,
    media_format: technical.format, width_pixels: technical.widthPixels,
    height_pixels: technical.heightPixels, duration_milliseconds: technical.durationMilliseconds,
    content_hash: asset.contentHash, media_reference: asset.mediaReference,
    origin: asset.origin, provider: asset.provider, usage_basis: asset.rights.usageBasis,
    commercial_use_allowed: Number(asset.rights.commercialUseAllowed),
    created_at: asset.createdAt, revision: asset.revision,
    supersedes_media_asset_id: asset.supersedesMediaAssetId,
  };
  for (const [field, value] of Object.entries(expected)) if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
}

function requireIdentifier(value, field, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); }
function requirePositiveInteger(value, field, code) { if (!Number.isSafeInteger(value) || value < 1) throw failure(code, field, "inteiro positivo obrigatório"); }
function mapError(caught) {
  if (caught instanceof MediaAssetRepositoryError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "contrato de ativo de mídia inválido", { cause: caught });
  const message = String(caught?.message);
  if (message.includes("media_assets.script_id, media_assets.visual_direction_position, media_assets.asset_type, media_assets.revision")) return failure("MEDIA_ASSET_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("media_assets.supersedes_media_asset_id")) return failure("MEDIA_ASSET_ALREADY_SUPERSEDED", "supersedesMediaAssetId", "ativo já substituído", { cause: caught });
  if (message.includes("artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version")) return failure("MEDIA_ASSET_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("artifact_lineage.artifact_id")) return failure("MEDIA_ASSET_ID_REUSED", "mediaAssetId", "ID já registrado", { cause: caught });
  if (message.includes("IMMUTABLE_MEDIA_ASSET")) return failure("IMMUTABLE_MEDIA_ASSET", "mediaAssetId", "ativo imutável", { cause: caught });
  if (message.includes("IMMUTABLE_MEDIA_ACQUISITION_REQUEST")) return failure("IMMUTABLE_MEDIA_ACQUISITION_REQUEST", "mediaAcquisitionRequestId", "solicitação imutável", { cause: caught });
  if (message.includes("MEDIA_ACQUISITION_SCOPE_MISMATCH")) return failure("MEDIA_ACQUISITION_SCOPE_MISMATCH", "mediaAcquisitionRequestId", "solicitação fora do escopo", { cause: caught });
  if (message.includes("MEDIA_ASSET_SCOPE_MISMATCH")) return failure("MEDIA_ASSET_SCOPE_MISMATCH", "scriptId", "artefatos fora do escopo", { cause: caught });
  if (message.includes("MEDIA_ASSET_REVISION_MISMATCH")) return failure("MEDIA_ASSET_REVISION_MISMATCH", "revision", "revisão inválida", { cause: caught });
  if (typeof caught?.code === "string" && caught.code.startsWith("ERR_SQLITE")) return failure("MEDIA_ASSET_PERSISTENCE_FAILED", "mediaAsset", "não foi possível persistir o ativo", { cause: caught });
  return caught;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function failure(code, field, message, options) { return new MediaAssetRepositoryError(code, field, message, options); }
function deepFreeze(value) { const clone = structuredClone(value); freeze(clone); return clone; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
