import { createHash } from "node:crypto";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION, validateArtifactLineage } from "./domain/artifact-lineage-contracts.js";
import { ContractValidationError } from "./domain/contracts.js";
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
  if (message.includes("MEDIA_ASSET_SCOPE_MISMATCH")) return failure("MEDIA_ASSET_SCOPE_MISMATCH", "scriptId", "artefatos fora do escopo", { cause: caught });
  if (message.includes("MEDIA_ASSET_REVISION_MISMATCH")) return failure("MEDIA_ASSET_REVISION_MISMATCH", "revision", "revisão inválida", { cause: caught });
  if (typeof caught?.code === "string" && caught.code.startsWith("ERR_SQLITE")) return failure("MEDIA_ASSET_PERSISTENCE_FAILED", "mediaAsset", "não foi possível persistir o ativo", { cause: caught });
  return caught;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function failure(code, field, message, options) { return new MediaAssetRepositoryError(code, field, message, options); }
