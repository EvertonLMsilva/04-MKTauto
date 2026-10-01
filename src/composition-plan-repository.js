import { createHash } from "node:crypto";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION, validateArtifactLineage } from "./domain/artifact-lineage-contracts.js";
import {
  COMPOSITION_PLAN_CONTRACT_VERSION,
  COMPOSITION_PLAN_V2_CONTRACT_VERSION,
  compositionPlanIdentityHash,
  validateCompositionPlan,
} from "./domain/composition-plan-contracts.js";
import { ContractValidationError } from "./domain/contracts.js";
import { validateMediaAsset } from "./domain/media-asset-contracts.js";
import { validateVoiceTrack, voiceTrackIdentityHash } from "./domain/voice-track-contracts.js";
import { MediaAssetRepository } from "./media-asset-repository.js";

export class CompositionPlanRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "CompositionPlanRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class CompositionPlanRepository extends MediaAssetRepository {
  registerCompositionPlan(value) {
    let plan;
    try { plan = validateCompositionPlan(value); }
    catch (caught) { throw mapError(caught); }
    return this.#transaction(() => this.#registerValidated(plan));
  }

  getCompositionPlan(compositionPlanId) {
    requireIdentifier(compositionPlanId, "compositionPlanId", 200);
    const row = this.db.prepare("SELECT * FROM composition_plans WHERE composition_plan_id = ?").get(compositionPlanId);
    if (!row) return null;
    try {
      const detail = this.db.prepare("SELECT * FROM composition_plan_v2_details WHERE composition_plan_id = ?").get(compositionPlanId);
      const plan = validateCompositionPlan(JSON.parse(detail?.payload_json ?? row.payload_json));
      verifyPersistedColumns(plan, row, Boolean(detail));
      if (compositionPlanIdentityHash(plan) !== (detail?.identity_hash ?? row.identity_hash)) throw new Error("identidade divergente");
      const storedSegments = detail
        ? this.db.prepare("SELECT * FROM composition_plan_v2_segments WHERE composition_plan_id = ? ORDER BY position").all(compositionPlanId).map(v2SegmentFromRow)
        : this.db.prepare(`SELECT position, visual_direction_position, media_asset_id, media_asset_content_hash,
          start_milliseconds, end_milliseconds FROM composition_plan_segments WHERE composition_plan_id = ? ORDER BY position`).all(compositionPlanId).map(segmentFromRow);
      if (JSON.stringify(storedSegments) !== JSON.stringify(plan.segments)) throw new Error("segmentos divergentes");
      const related = this.#relatedArtifacts(plan);
      this.#verifyRelated(plan, related);
      const lineage = this.getArtifact(plan.compositionPlanId);
      if (!lineage || lineage.artifactType !== "composition_plan" || lineage.contentHash !== plan.contentHash
        || JSON.stringify(lineage.inputs) !== JSON.stringify(lineageInputs(plan))) throw new Error("linhagem divergente");
      return plan;
    } catch (caught) {
      if (caught instanceof CompositionPlanRepositoryError) throw caught;
      throw failure("INVALID_PERSISTED_COMPOSITION_PLAN", "compositionPlanId", "plano persistido inválido", { cause: caught });
    }
  }

  listCompositionPlansByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    return this.db.prepare(`SELECT composition_plan_id FROM composition_plans
      WHERE pipeline_run_id = ? ORDER BY created_at, script_id, revision, composition_plan_id`).all(pipelineRunId)
      .map(({ composition_plan_id: id }) => this.getCompositionPlan(id));
  }

  listCompositionPlansByScript(scriptId) {
    requireIdentifier(scriptId, "scriptId", 200);
    return this.db.prepare(`SELECT composition_plan_id FROM composition_plans
      WHERE script_id = ? ORDER BY revision, composition_plan_id`).all(scriptId)
      .map(({ composition_plan_id: id }) => this.getCompositionPlan(id));
  }

  #registerValidated(plan) {
    const identityHash = compositionPlanIdentityHash(plan);
    const prior = this.db.prepare("SELECT identity_hash FROM composition_plans WHERE composition_plan_id = ?").get(plan.compositionPlanId);
    if (prior) {
      if (prior.identity_hash !== identityHash) throw failure("COMPOSITION_PLAN_ID_REUSED", "compositionPlanId", "ID já usado com plano incompatível");
      return this.getCompositionPlan(plan.compositionPlanId);
    }
    const logicalPrior = this.db.prepare("SELECT composition_plan_id FROM composition_plans WHERE script_id = ? AND revision = ?")
      .get(plan.scriptId, plan.revision);
    if (logicalPrior) throw failure("COMPOSITION_PLAN_REVISION_CONFLICT", "revision", "revisão já registrada para o roteiro");

    const related = this.#relatedArtifacts(plan);
    this.#verifyRelated(plan, related);
    this.#validateRevision(plan);
    this.#insertLineage(plan);
    this.db.prepare(`INSERT INTO composition_plans
      (composition_plan_id, schema_version, identity_hash, pipeline_run_id, project_id,
       project_version, script_id, script_content_hash, voice_track_id,
       voice_track_content_hash, output_aspect_ratio, timeline_unit, continuity_mode,
       duration_milliseconds, content_hash, created_at, revision,
       supersedes_composition_plan_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      plan.compositionPlanId, plan.schemaVersion === COMPOSITION_PLAN_V2_CONTRACT_VERSION ? COMPOSITION_PLAN_CONTRACT_VERSION : plan.schemaVersion, identityHash, plan.pipelineRunId,
      plan.projectId, plan.projectVersion, plan.scriptId, plan.scriptContentHash,
      plan.voiceTrackId, plan.voiceTrackContentHash, plan.outputAspectRatio,
      plan.timelineUnit, plan.continuityMode, plan.durationMilliseconds,
      plan.contentHash, plan.createdAt, plan.revision, plan.supersedesCompositionPlanId,
      JSON.stringify(plan.schemaVersion === COMPOSITION_PLAN_V2_CONTRACT_VERSION ? v1StorageProjection(plan) : plan),
    );
    if (plan.schemaVersion === COMPOSITION_PLAN_V2_CONTRACT_VERSION) {
      this.db.prepare(`INSERT INTO composition_plan_v2_details
        (composition_plan_id, schema_version, production_profile, composition_policy_version, identity_hash, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)`).run(plan.compositionPlanId, plan.schemaVersion, plan.productionProfile, plan.compositionPolicyVersion, identityHash, JSON.stringify(plan));
      const insertV2 = this.db.prepare(`INSERT INTO composition_plan_v2_segments
        (composition_plan_id, position, visual_direction_position, media_asset_id, media_asset_content_hash,
         media_type, start_milliseconds, end_milliseconds, source_start_milliseconds, playback_mode,
         original_audio_muted, framing_strategy, transition_policy_version, transition_type, transition_duration_milliseconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const segment of plan.segments) insertV2.run(plan.compositionPlanId, segment.position, segment.visualDirectionPosition,
        segment.mediaAssetId, segment.mediaAssetContentHash, segment.mediaType, segment.startMilliseconds, segment.endMilliseconds,
        segment.sourceStartMilliseconds, segment.playbackMode, 1, segment.framingStrategy, segment.transition.policyVersion,
        segment.transition.type, segment.transition.durationMilliseconds);
      return this.getCompositionPlan(plan.compositionPlanId);
    }
    const insert = this.db.prepare(`INSERT INTO composition_plan_segments
      (composition_plan_id, position, visual_direction_position, media_asset_id,
       media_asset_content_hash, start_milliseconds, end_milliseconds)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const segment of plan.segments) insert.run(
      plan.compositionPlanId, segment.position, segment.visualDirectionPosition,
      segment.mediaAssetId, segment.mediaAssetContentHash,
      segment.startMilliseconds, segment.endMilliseconds,
    );
    return this.getCompositionPlan(plan.compositionPlanId);
  }

  #relatedArtifacts(plan) {
    const run = this.getRun(plan.pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    const script = this.getScript(plan.scriptId);
    if (!script) throw failure("SCRIPT_NOT_FOUND", "scriptId", "roteiro não encontrado");
    const voice = this.#getVoiceTrack(plan.voiceTrackId);
    if (!voice) throw failure("VOICE_TRACK_NOT_FOUND", "voiceTrackId", "faixa de voz não encontrada");
    const assets = plan.segments.map((segment, index) => {
      const stored = this.getMediaAsset(segment.mediaAssetId);
      if (!stored) throw failure("MEDIA_ASSET_NOT_FOUND", `segments.${index}.mediaAssetId`, "ativo não encontrado");
      try { return validateMediaAsset(stored); }
      catch (caught) { throw mapError(caught); }
    });
    return { run, script, voice, assets };
  }

  #verifyRelated(plan, { run, script, voice, assets }) {
    verifyScope(run, plan, "COMPOSITION_PLAN_RUN_SCOPE_MISMATCH");
    verifyScope(script, plan, "COMPOSITION_PLAN_SCRIPT_SCOPE_MISMATCH");
    if (script.contentHash !== plan.scriptContentHash) throw failure("SCRIPT_CONTENT_HASH_MISMATCH", "scriptContentHash", "hash do roteiro divergente");
    if (run.projectSnapshot.channel.aspectRatio !== plan.outputAspectRatio) throw failure("OUTPUT_ASPECT_RATIO_MISMATCH", "outputAspectRatio", "proporção diverge do snapshot");
    if (plan.schemaVersion === COMPOSITION_PLAN_V2_CONTRACT_VERSION && run.projectSnapshot.channel.productionProfile !== "MIXED_MEDIA_V2") throw failure("PRODUCTION_PROFILE_MISMATCH", "productionProfile", "perfil diverge do snapshot");
    verifyScope(voice, plan, "VOICE_TRACK_SCOPE_MISMATCH");
    if (voice.scriptId !== plan.scriptId || voice.scriptContentHash !== plan.scriptContentHash) throw failure("VOICE_TRACK_SCRIPT_MISMATCH", "voiceTrackId", "faixa diverge do roteiro");
    if (voice.contentHash !== plan.voiceTrackContentHash) throw failure("VOICE_TRACK_CONTENT_HASH_MISMATCH", "voiceTrackContentHash", "hash da faixa divergente");
    if (voice.durationMilliseconds !== plan.durationMilliseconds) throw failure("VOICE_TRACK_DURATION_MISMATCH", "durationMilliseconds", "duração diverge da faixa real");
    if (voice.rights.commercialUseAllowed !== true) throw failure("COMMERCIAL_USE_REQUIRED", "voiceTrackId", "uso comercial da voz não autorizado");

    const expectedDirections = script.visualDirections.map(({ position }) => position);
    const actualDirections = plan.segments.map(({ visualDirectionPosition }) => visualDirectionPosition);
    if (JSON.stringify(expectedDirections) !== JSON.stringify(actualDirections)) throw failure("VISUAL_DIRECTION_COVERAGE_MISMATCH", "segments", "direções visuais não possuem cobertura exata");
    plan.segments.forEach((segment, index) => {
      const asset = assets[index];
      verifyScope(asset, plan, "MEDIA_ASSET_SCOPE_MISMATCH");
      if (asset.scriptId !== plan.scriptId || asset.scriptContentHash !== plan.scriptContentHash) throw failure("MEDIA_ASSET_SCRIPT_MISMATCH", `segments.${index}.mediaAssetId`, "ativo diverge do roteiro");
      if (asset.visualDirectionPosition !== segment.visualDirectionPosition) throw failure("MEDIA_ASSET_DIRECTION_MISMATCH", `segments.${index}.visualDirectionPosition`, "ativo diverge da direção");
      if (asset.contentHash !== segment.mediaAssetContentHash) throw failure("MEDIA_ASSET_CONTENT_HASH_MISMATCH", `segments.${index}.mediaAssetContentHash`, "hash do ativo divergente");
      if (plan.schemaVersion === COMPOSITION_PLAN_V2_CONTRACT_VERSION && asset.assetType !== segment.mediaType) throw failure("MEDIA_ASSET_TYPE_MISMATCH", `segments.${index}.mediaType`, "tipo de mídia divergente");
      if (asset.rights.commercialUseAllowed !== true) throw failure("COMMERCIAL_USE_REQUIRED", "rights.commercialUseAllowed", "uso comercial do ativo não autorizado");
      const segmentDuration = segment.endMilliseconds - segment.startMilliseconds;
      if (asset.assetType === "VIDEO") {
        const duration = asset.technicalProperties.durationMilliseconds;
        if (plan.schemaVersion === COMPOSITION_PLAN_V2_CONTRACT_VERSION) {
          if (segment.sourceStartMilliseconds >= duration) throw failure("MEDIA_TRIM_START_OUT_OF_RANGE", `segments.${index}.sourceStartMilliseconds`, "início fora do clipe");
          if (segment.playbackMode === "TRIM" && segment.sourceStartMilliseconds + segmentDuration > duration) throw failure("MEDIA_DURATION_INSUFFICIENT", `segments.${index}`, "vídeo menor que o trim solicitado");
        } else if (duration < segmentDuration) throw failure("MEDIA_DURATION_INSUFFICIENT", `segments.${index}`, "vídeo menor que o trecho solicitado");
      }
    });
  }

  #validateRevision(plan) {
    if (plan.revision === 1) return null;
    const previous = this.getCompositionPlan(plan.supersedesCompositionPlanId);
    if (!previous) throw failure("SUPERSEDED_COMPOSITION_PLAN_NOT_FOUND", "supersedesCompositionPlanId", "plano anterior não encontrado");
    for (const field of ["pipelineRunId", "projectId", "projectVersion", "scriptId", "outputAspectRatio", "timelineUnit", "continuityMode"]) {
      if (previous[field] !== plan[field]) throw failure("COMPOSITION_PLAN_SUPERSESSION_SCOPE_MISMATCH", field, "plano anterior fora do escopo");
    }
    if (previous.revision + 1 !== plan.revision) throw failure("COMPOSITION_PLAN_REVISION_MISMATCH", "revision", "revisão não é sucessora imediata");
    return previous;
  }

  #getVoiceTrack(voiceTrackId) {
    requireIdentifier(voiceTrackId, "voiceTrackId", 200);
    const row = this.db.prepare("SELECT * FROM voice_tracks WHERE voice_track_id = ?").get(voiceTrackId);
    if (!row) return null;
    try {
      const voice = validateVoiceTrack(JSON.parse(row.payload_json));
      if (voiceTrackIdentityHash(voice) !== row.identity_hash) throw new Error("identidade divergente");
      const expected = {
        voice_track_id: voice.voiceTrackId, schema_version: voice.schemaVersion,
        pipeline_run_id: voice.pipelineRunId, project_id: voice.projectId,
        project_version: voice.projectVersion, script_id: voice.scriptId,
        script_content_hash: voice.scriptContentHash, duration_milliseconds: voice.durationMilliseconds,
        content_hash: voice.contentHash, commercial_use_allowed: Number(voice.rights.commercialUseAllowed),
      };
      for (const [field, value] of Object.entries(expected)) if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
      const lineage = this.getArtifact(voice.voiceTrackId);
      if (!lineage || lineage.artifactType !== "voice_track" || lineage.contentHash !== voice.contentHash) throw new Error("linhagem divergente");
      return voice;
    } catch (caught) {
      throw failure("INVALID_PERSISTED_VOICE_TRACK", "voiceTrackId", "faixa persistida inválida", { cause: caught });
    }
  }

  #insertLineage(plan) {
    const artifact = validateArtifactLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: plan.compositionPlanId, artifactType: "composition_plan",
      artifactVersion: plan.revision, pipelineRunId: plan.pipelineRunId,
      projectId: plan.projectId, projectVersion: plan.projectVersion,
      contentIdentity: `composition-plan:${plan.scriptId}`, hashAlgorithm: "sha256",
      contentHash: plan.contentHash, inputs: lineageInputs(plan),
      generationMetadata: null, createdAt: plan.createdAt,
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

function lineageInputs(plan) {
  return [
    { position: 1, kind: "INTERNAL_ARTIFACT", inputId: plan.scriptId, contentHash: plan.scriptContentHash },
    { position: 2, kind: "INTERNAL_ARTIFACT", inputId: plan.voiceTrackId, contentHash: plan.voiceTrackContentHash },
    ...plan.segments.map((segment, index) => ({
      position: index + 3, kind: "INTERNAL_ARTIFACT",
      inputId: segment.mediaAssetId, contentHash: segment.mediaAssetContentHash,
    })),
  ];
}

function segmentFromRow(row) { return {
  position: row.position, visualDirectionPosition: row.visual_direction_position,
  mediaAssetId: row.media_asset_id, mediaAssetContentHash: row.media_asset_content_hash,
  startMilliseconds: row.start_milliseconds, endMilliseconds: row.end_milliseconds,
}; }

function v2SegmentFromRow(row) { return {
  position: row.position, visualDirectionPosition: row.visual_direction_position,
  mediaAssetId: row.media_asset_id, mediaAssetContentHash: row.media_asset_content_hash,
  startMilliseconds: row.start_milliseconds, endMilliseconds: row.end_milliseconds,
  mediaType: row.media_type, sourceStartMilliseconds: row.source_start_milliseconds,
  playbackMode: row.playback_mode, originalAudioMuted: Boolean(row.original_audio_muted),
  framingStrategy: row.framing_strategy,
  transition: { policyVersion: row.transition_policy_version, type: row.transition_type, durationMilliseconds: row.transition_duration_milliseconds },
}; }

function verifyScope(stored, expected, code) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) {
    if (stored[field] !== expected[field]) throw failure(code, field, "escopo divergente");
  }
}

function verifyPersistedColumns(plan, row, isV2 = false) {
  const expected = {
    composition_plan_id: plan.compositionPlanId, schema_version: isV2 ? COMPOSITION_PLAN_CONTRACT_VERSION : plan.schemaVersion,
    pipeline_run_id: plan.pipelineRunId, project_id: plan.projectId,
    project_version: plan.projectVersion, script_id: plan.scriptId,
    script_content_hash: plan.scriptContentHash, voice_track_id: plan.voiceTrackId,
    voice_track_content_hash: plan.voiceTrackContentHash,
    output_aspect_ratio: plan.outputAspectRatio, timeline_unit: plan.timelineUnit,
    continuity_mode: plan.continuityMode, duration_milliseconds: plan.durationMilliseconds,
    content_hash: plan.contentHash, created_at: plan.createdAt, revision: plan.revision,
    supersedes_composition_plan_id: plan.supersedesCompositionPlanId,
  };
  for (const [field, value] of Object.entries(expected)) if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
}

function v1StorageProjection(plan) {
  const { productionProfile: _profile, compositionPolicyVersion: _policy, ...base } = plan;
  return { ...base, schemaVersion: COMPOSITION_PLAN_CONTRACT_VERSION, segments: plan.segments.map(({ mediaType: _type, sourceStartMilliseconds: _source, playbackMode: _mode, originalAudioMuted: _muted, framingStrategy: _framing, transition: _transition, ...segment }) => segment) };
}

function requireIdentifier(value, field, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); }
function mapError(caught) {
  if (caught instanceof CompositionPlanRepositoryError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "contrato de plano inválido", { cause: caught });
  if (caught?.name?.endsWith("RepositoryError") && caught.code) return failure(caught.code, caught.field, "artefato relacionado inválido", { cause: caught });
  const message = String(caught?.message);
  if (message.includes("composition_plans.script_id, composition_plans.revision")) return failure("COMPOSITION_PLAN_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("composition_plans.supersedes_composition_plan_id")) return failure("COMPOSITION_PLAN_ALREADY_SUPERSEDED", "supersedesCompositionPlanId", "plano já substituído", { cause: caught });
  if (message.includes("artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version")) return failure("COMPOSITION_PLAN_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("artifact_lineage.artifact_id")) return failure("COMPOSITION_PLAN_ID_REUSED", "compositionPlanId", "ID já registrado", { cause: caught });
  if (message.includes("IMMUTABLE_COMPOSITION_PLAN")) return failure("IMMUTABLE_COMPOSITION_PLAN", "compositionPlanId", "plano imutável", { cause: caught });
  if (message.includes("COMPOSITION_PLAN_SCOPE_MISMATCH") || message.includes("COMPOSITION_SEGMENT_SCOPE_MISMATCH")) return failure("COMPOSITION_PLAN_SCOPE_MISMATCH", "compositionPlan", "artefatos fora do escopo", { cause: caught });
  if (message.includes("COMPOSITION_PLAN_REVISION_MISMATCH")) return failure("COMPOSITION_PLAN_REVISION_MISMATCH", "revision", "revisão inválida", { cause: caught });
  if (typeof caught?.code === "string" && caught.code.startsWith("ERR_SQLITE")) return failure("COMPOSITION_PLAN_PERSISTENCE_FAILED", "compositionPlan", "não foi possível persistir o plano", { cause: caught });
  return caught;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function failure(code, field, message, options) { return new CompositionPlanRepositoryError(code, field, message, options); }
