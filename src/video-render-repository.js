import { createHash } from "node:crypto";
import { ARTIFACT_LINEAGE_CONTRACT_VERSION, validateArtifactLineage } from "./domain/artifact-lineage-contracts.js";
import { ContractValidationError } from "./domain/contracts.js";
import { validateVideoRender, videoRenderIdentityHash } from "./domain/video-render-contracts.js";
import { CompositionPlanRepository } from "./composition-plan-repository.js";

export class VideoRenderRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "VideoRenderRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class VideoRenderRepository extends CompositionPlanRepository {
  registerVideoRender(value) {
    let render;
    try { render = validateVideoRender(value); }
    catch (caught) { throw mapError(caught); }
    return this.#transaction(() => this.#registerValidated(render));
  }

  getVideoRender(videoRenderId) {
    requireIdentifier(videoRenderId, "videoRenderId", 200);
    const row = this.db.prepare("SELECT * FROM video_renders WHERE video_render_id = ?").get(videoRenderId);
    if (!row) return null;
    try {
      const render = validateVideoRender(JSON.parse(row.payload_json));
      verifyPersistedColumns(render, row);
      if (videoRenderIdentityHash(render) !== row.identity_hash) throw new Error("identidade divergente");
      const related = this.#relatedArtifacts(render);
      this.#verifyRelated(render, related);
      const lineage = this.getArtifact(render.videoRenderId);
      if (!lineage || lineage.artifactType !== "video_render" || lineage.contentHash !== render.contentHash
        || JSON.stringify(lineage.inputs) !== JSON.stringify(lineageInputs(render))) throw new Error("linhagem divergente");
      return render;
    } catch (caught) {
      if (caught instanceof VideoRenderRepositoryError) throw caught;
      throw failure("INVALID_PERSISTED_VIDEO_RENDER", "videoRenderId", "render persistido inválido", { cause: caught });
    }
  }

  listVideoRendersByPipelineRun(pipelineRunId) {
    requireIdentifier(pipelineRunId, "pipelineRunId");
    return this.db.prepare(`SELECT video_render_id FROM video_renders
      WHERE pipeline_run_id = ? ORDER BY created_at, composition_plan_id, revision, video_render_id`).all(pipelineRunId)
      .map(({ video_render_id: id }) => this.getVideoRender(id));
  }

  listVideoRendersByCompositionPlan(compositionPlanId) {
    requireIdentifier(compositionPlanId, "compositionPlanId", 200);
    return this.db.prepare(`SELECT video_render_id FROM video_renders
      WHERE composition_plan_id = ? ORDER BY revision, video_render_id`).all(compositionPlanId)
      .map(({ video_render_id: id }) => this.getVideoRender(id));
  }

  #registerValidated(render) {
    const identityHash = videoRenderIdentityHash(render);
    const prior = this.db.prepare("SELECT identity_hash FROM video_renders WHERE video_render_id = ?").get(render.videoRenderId);
    if (prior) {
      if (prior.identity_hash !== identityHash) throw failure("VIDEO_RENDER_ID_REUSED", "videoRenderId", "ID já usado com render incompatível");
      return this.getVideoRender(render.videoRenderId);
    }
    const logicalPrior = this.db.prepare("SELECT video_render_id FROM video_renders WHERE composition_plan_id = ? AND revision = ?")
      .get(render.compositionPlanId, render.revision);
    if (logicalPrior) throw failure("VIDEO_RENDER_REVISION_CONFLICT", "revision", "revisão já registrada para o plano");

    const related = this.#relatedArtifacts(render);
    this.#verifyRelated(render, related);
    this.#validateRevision(render);
    this.#insertLineage(render);
    this.db.prepare(`INSERT INTO video_renders
      (video_render_id, schema_version, identity_hash, pipeline_run_id, project_id,
       project_version, composition_plan_id, composition_plan_content_hash,
       output_aspect_ratio, duration_milliseconds, container_format, width_pixels,
       height_pixels, content_hash, logical_reference, created_at, revision,
       supersedes_video_render_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      render.videoRenderId, render.schemaVersion, identityHash, render.pipelineRunId,
      render.projectId, render.projectVersion, render.compositionPlanId,
      render.compositionPlanContentHash, render.outputAspectRatio,
      render.durationMilliseconds, render.containerFormat, render.widthPixels,
      render.heightPixels, render.contentHash, render.logicalReference,
      render.createdAt, render.revision, render.supersedesVideoRenderId,
      JSON.stringify(render),
    );
    return this.getVideoRender(render.videoRenderId);
  }

  #relatedArtifacts(render) {
    const run = this.getRun(render.pipelineRunId);
    if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    const plan = this.getCompositionPlan(render.compositionPlanId);
    if (!plan) throw failure("COMPOSITION_PLAN_NOT_FOUND", "compositionPlanId", "plano não encontrado");
    return { run, plan };
  }

  #verifyRelated(render, { run, plan }) {
    verifyScope(run, render, "VIDEO_RENDER_RUN_SCOPE_MISMATCH");
    verifyScope(plan, render, "VIDEO_RENDER_PLAN_SCOPE_MISMATCH");
    if (plan.contentHash !== render.compositionPlanContentHash) throw failure("COMPOSITION_PLAN_CONTENT_HASH_MISMATCH", "compositionPlanContentHash", "hash do plano divergente");
    if (run.projectSnapshot.channel.aspectRatio !== render.outputAspectRatio) throw failure("OUTPUT_ASPECT_RATIO_MISMATCH", "outputAspectRatio", "proporção diverge do snapshot");
    if (plan.outputAspectRatio !== render.outputAspectRatio) throw failure("OUTPUT_ASPECT_RATIO_MISMATCH", "outputAspectRatio", "proporção diverge do plano");
    if (plan.durationMilliseconds !== render.durationMilliseconds) throw failure("VIDEO_RENDER_DURATION_MISMATCH", "durationMilliseconds", "medida do render diverge do plano");
  }

  #validateRevision(render) {
    if (render.revision === 1) return null;
    const previous = this.getVideoRender(render.supersedesVideoRenderId);
    if (!previous) throw failure("SUPERSEDED_VIDEO_RENDER_NOT_FOUND", "supersedesVideoRenderId", "render anterior não encontrado");
    for (const field of ["pipelineRunId", "projectId", "projectVersion", "compositionPlanId", "outputAspectRatio"]) {
      if (previous[field] !== render[field]) throw failure("VIDEO_RENDER_SUPERSESSION_SCOPE_MISMATCH", field, "render anterior fora do escopo");
    }
    if (previous.revision + 1 !== render.revision) throw failure("VIDEO_RENDER_REVISION_MISMATCH", "revision", "revisão não é sucessora imediata");
    return previous;
  }

  #insertLineage(render) {
    const artifact = validateArtifactLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: render.videoRenderId, artifactType: "video_render",
      artifactVersion: render.revision, pipelineRunId: render.pipelineRunId,
      projectId: render.projectId, projectVersion: render.projectVersion,
      contentIdentity: `video-render:${render.compositionPlanId}`, hashAlgorithm: "sha256",
      contentHash: render.contentHash, inputs: lineageInputs(render),
      generationMetadata: null, createdAt: render.createdAt,
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
    const input = artifact.inputs[0];
    this.db.prepare(`INSERT INTO artifact_lineage_inputs
      (artifact_id, position, kind, input_id, content_hash) VALUES (?, ?, ?, ?, ?)`)
      .run(artifact.artifactId, input.position, input.kind, input.inputId, input.contentHash);
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

function lineageInputs(render) {
  return [{
    position: 1, kind: "INTERNAL_ARTIFACT",
    inputId: render.compositionPlanId, contentHash: render.compositionPlanContentHash,
  }];
}

function verifyScope(stored, expected, code) {
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) {
    if (stored[field] !== expected[field]) throw failure(code, field, "escopo divergente");
  }
}

function verifyPersistedColumns(render, row) {
  const expected = {
    video_render_id: render.videoRenderId, schema_version: render.schemaVersion,
    pipeline_run_id: render.pipelineRunId, project_id: render.projectId,
    project_version: render.projectVersion, composition_plan_id: render.compositionPlanId,
    composition_plan_content_hash: render.compositionPlanContentHash,
    output_aspect_ratio: render.outputAspectRatio,
    duration_milliseconds: render.durationMilliseconds,
    container_format: render.containerFormat, width_pixels: render.widthPixels,
    height_pixels: render.heightPixels, content_hash: render.contentHash,
    logical_reference: render.logicalReference, created_at: render.createdAt,
    revision: render.revision, supersedes_video_render_id: render.supersedesVideoRenderId,
  };
  for (const [field, value] of Object.entries(expected)) if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
}

function requireIdentifier(value, field, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); }
function mapError(caught) {
  if (caught instanceof VideoRenderRepositoryError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "contrato de render inválido", { cause: caught });
  if (caught?.name?.endsWith("RepositoryError") && caught.code) return failure(caught.code, caught.field, "artefato relacionado inválido", { cause: caught });
  const message = String(caught?.message);
  if (message.includes("video_renders.composition_plan_id, video_renders.revision")) return failure("VIDEO_RENDER_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("video_renders.supersedes_video_render_id")) return failure("VIDEO_RENDER_ALREADY_SUPERSEDED", "supersedesVideoRenderId", "render já substituído", { cause: caught });
  if (message.includes("artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version")) return failure("VIDEO_RENDER_REVISION_CONFLICT", "revision", "revisão já registrada", { cause: caught });
  if (message.includes("artifact_lineage.artifact_id")) return failure("VIDEO_RENDER_ID_REUSED", "videoRenderId", "ID já registrado", { cause: caught });
  if (message.includes("IMMUTABLE_VIDEO_RENDER")) return failure("IMMUTABLE_VIDEO_RENDER", "videoRenderId", "render imutável", { cause: caught });
  if (message.includes("VIDEO_RENDER_SCOPE_MISMATCH")) return failure("VIDEO_RENDER_SCOPE_MISMATCH", "videoRender", "artefatos fora do escopo", { cause: caught });
  if (message.includes("VIDEO_RENDER_REVISION_MISMATCH")) return failure("VIDEO_RENDER_REVISION_MISMATCH", "revision", "revisão inválida", { cause: caught });
  if (typeof caught?.code === "string" && caught.code.startsWith("ERR_SQLITE")) return failure("VIDEO_RENDER_PERSISTENCE_FAILED", "videoRender", "não foi possível persistir o render", { cause: caught });
  return caught;
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function failure(code, field, message, options) { return new VideoRenderRepositoryError(code, field, message, options); }
