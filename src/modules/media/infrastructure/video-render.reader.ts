import { createHash } from 'node:crypto';
import {
  ARTIFACT_LINEAGE_CONTRACT_VERSION,
  validateArtifactLineage,
} from '../../content/domain/artifact-lineage-contracts.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import {
  VIDEO_COMPOSITION_REQUEST_VERSION,
  validateVideoCompositionRequest,
  videoCompositionRequestHash,
} from '../domain/video-composition-contracts.js';
import {
  validateVideoRender,
  videoRenderIdentityHash,
} from '../domain/video-render-contracts.js';
import { CompositionPlanRepository } from './composition-plan.reader.js';
import {
  getP4,
  verifyP4Lineage,
  verifyStoredP4Lineage,
} from './render-lineage.js';
import type { VideoRender } from '../domain/render.types.js';
export class VideoRenderRepositoryError extends Error {
  [key: string]: any;
  constructor(code: any, field: any, message: any, options?: any) {
    super(`${code}: ${message}`, options);
    this.name = 'VideoRenderRepositoryError';
    this.code = code;
    this.field = field;
  }
}
export class VideoRenderRepository extends CompositionPlanRepository {
  [key: string]: any;
  declare db: any;
  getVideoRender(videoRenderId: string): VideoRender | null {
    requireIdentifier(videoRenderId, 'videoRenderId', 200);
    const p4: any = getP4(this, 'video_render', videoRenderId);
    if (p4) {
      validateVideoRender(p4);
      verifyP4Lineage(this, p4);
      verifyStoredP4Lineage(this, p4);
      return p4;
    }
    const row: any = this.db
      .prepare('SELECT * FROM video_renders WHERE video_render_id = ?')
      .get(videoRenderId);
    if (!row) return null;
    try {
      const render: any = validateVideoRender(JSON.parse(row.payload_json));
      verifyPersistedColumns(render, row);
      if (videoRenderIdentityHash(render) !== row.identity_hash)
        throw new Error('identidade divergente');
      const related: any = this.#relatedArtifacts(render);
      this.#verifyRelated(render, related);
      const lineage: any = this.getArtifact(render.videoRenderId);
      if (
        !lineage ||
        lineage.artifactType !== 'video_render' ||
        lineage.contentHash !== render.contentHash ||
        !validRenderLineage(render, lineage)
      )
        throw new Error('linhagem divergente');
      return render;
    } catch (caught: any) {
      if (caught instanceof VideoRenderRepositoryError) throw caught;
      throw failure(
        'INVALID_PERSISTED_VIDEO_RENDER',
        'videoRenderId',
        'render persistido inválido',
        { cause: caught },
      );
    }
  }
  #relatedArtifacts(render: any): any {
    const run: any = this.getRun(render.pipelineRunId);
    if (!run)
      throw failure(
        'PIPELINE_RUN_NOT_FOUND',
        'pipelineRunId',
        'execução não encontrada',
      );
    const plan: any = this.getCompositionPlan(render.compositionPlanId);
    if (!plan)
      throw failure(
        'COMPOSITION_PLAN_NOT_FOUND',
        'compositionPlanId',
        'plano não encontrado',
      );
    return { run, plan };
  }
  #verifyRelated(render: any, { run, plan }: any): any {
    verifyScope(run, render, 'VIDEO_RENDER_RUN_SCOPE_MISMATCH');
    verifyScope(plan, render, 'VIDEO_RENDER_PLAN_SCOPE_MISMATCH');
    if (plan.contentHash !== render.compositionPlanContentHash)
      throw failure(
        'COMPOSITION_PLAN_CONTENT_HASH_MISMATCH',
        'compositionPlanContentHash',
        'hash do plano divergente',
      );
    if (run.projectSnapshot.channel.aspectRatio !== render.outputAspectRatio)
      throw failure(
        'OUTPUT_ASPECT_RATIO_MISMATCH',
        'outputAspectRatio',
        'proporção diverge do snapshot',
      );
    if (plan.outputAspectRatio !== render.outputAspectRatio)
      throw failure(
        'OUTPUT_ASPECT_RATIO_MISMATCH',
        'outputAspectRatio',
        'proporção diverge do plano',
      );
    if (plan.durationMilliseconds !== render.durationMilliseconds)
      throw failure(
        'VIDEO_RENDER_DURATION_MISMATCH',
        'durationMilliseconds',
        'medida do render diverge do plano',
      );
  }

  registerVideoComposition({
    request: requestValue,
    videoRender: renderValue,
  }: any) {
    let request: any;
    let render: any;
    try {
      request = validateVideoCompositionRequest(requestValue);
      render = validateVideoRender(renderValue);
    } catch (caught: any) {
      throw mapError(caught);
    }
    return this.#transaction(() => {
      const prior: any = this.db
        .prepare(
          `SELECT request_hash, video_render_id
        FROM video_composition_requests WHERE video_composition_request_id = ?`,
        )
        .get(request.videoCompositionRequestId);
      if (prior) {
        if (prior.request_hash !== request.contentHash)
          throw failure(
            'VIDEO_COMPOSITION_REQUEST_ID_REUSED',
            'videoCompositionRequestId',
            'identidade já usada com conteúdo divergente',
          );
        return this.getVideoRender(prior.video_render_id);
      }
      verifyCompositionBinding(request, render);
      const created: any = this.#registerValidated(render);
      this.db
        .prepare(
          `INSERT INTO video_composition_requests
        (video_composition_request_id, schema_version, request_hash,
         composition_plan_id, composition_plan_content_hash, container_format,
         width_pixels, height_pixels, video_render_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.videoCompositionRequestId,
          request.schemaVersion,
          request.contentHash,
          request.compositionPlanId,
          request.compositionPlanContentHash,
          request.containerFormat,
          request.widthPixels,
          request.heightPixels,
          created.videoRenderId,
          request.requestedAt,
        );
      return created;
    });
  }
  getVideoComposition(videoCompositionRequestId: any) {
    requireIdentifier(
      videoCompositionRequestId,
      'videoCompositionRequestId',
      180,
    );
    const row: any = this.db
      .prepare(
        `SELECT * FROM video_composition_requests
      WHERE video_composition_request_id = ?`,
      )
      .get(videoCompositionRequestId);
    if (!row) return null;
    try {
      const request: any = validateVideoCompositionRequest({
        schemaVersion: row.schema_version,
        videoCompositionRequestId: row.video_composition_request_id,
        compositionPlanId: row.composition_plan_id,
        compositionPlanContentHash: row.composition_plan_content_hash,
        containerFormat: row.container_format,
        widthPixels: row.width_pixels,
        heightPixels: row.height_pixels,
        requestedAt: row.created_at,
        contentHash: row.request_hash,
      });
      if (
        row.schema_version !== VIDEO_COMPOSITION_REQUEST_VERSION ||
        videoCompositionRequestHash(request) !== row.request_hash
      )
        throw new Error('solicitação inválida');
      const videoRender: any = this.getVideoRender(row.video_render_id);
      if (!videoRender) throw new Error('composição incompleta');
      verifyCompositionBinding(request, videoRender);
      return deepFreeze({ requestHash: row.request_hash, videoRender });
    } catch (caught: any) {
      if (caught instanceof VideoRenderRepositoryError) throw caught;
      throw failure(
        'INVALID_PERSISTED_VIDEO_COMPOSITION',
        'videoCompositionRequestId',
        'composição persistida inválida',
        { cause: caught },
      );
    }
  }
  listVideoRendersByCompositionPlan(compositionPlanId: any) {
    requireIdentifier(compositionPlanId, 'compositionPlanId', 200);
    return this.db
      .prepare(
        `SELECT video_render_id FROM video_renders
      WHERE composition_plan_id = ? ORDER BY revision, video_render_id`,
      )
      .all(compositionPlanId)
      .map(({ video_render_id: id }: any) => this.getVideoRender(id));
  }
  #registerValidated(
    render: any,
    { inputs = lineageInputs(render), generationMetadata = null }: any = {},
  ) {
    const identityHash: any = videoRenderIdentityHash(render);
    const prior: any = this.db
      .prepare(
        'SELECT identity_hash FROM video_renders WHERE video_render_id = ?',
      )
      .get(render.videoRenderId);
    if (prior) {
      if (prior.identity_hash !== identityHash)
        throw failure(
          'VIDEO_RENDER_ID_REUSED',
          'videoRenderId',
          'ID já usado com render incompatível',
        );
      return this.getVideoRender(render.videoRenderId);
    }
    const logicalPrior: any = this.db
      .prepare(
        'SELECT video_render_id FROM video_renders WHERE composition_plan_id = ? AND revision = ?',
      )
      .get(render.compositionPlanId, render.revision);
    if (logicalPrior)
      throw failure(
        'VIDEO_RENDER_REVISION_CONFLICT',
        'revision',
        'revisão já registrada para o plano',
      );
    const related: any = this.#relatedArtifacts(render);
    this.#verifyRelated(render, related);
    this.#validateRevision(render);
    this.#insertLineage(render, inputs, generationMetadata);
    this.db
      .prepare(
        `INSERT INTO video_renders
      (video_render_id, schema_version, identity_hash, pipeline_run_id, project_id,
       project_version, composition_plan_id, composition_plan_content_hash,
       output_aspect_ratio, duration_milliseconds, container_format, width_pixels,
       height_pixels, content_hash, logical_reference, created_at, revision,
       supersedes_video_render_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        render.videoRenderId,
        render.schemaVersion,
        identityHash,
        render.pipelineRunId,
        render.projectId,
        render.projectVersion,
        render.compositionPlanId,
        render.compositionPlanContentHash,
        render.outputAspectRatio,
        render.durationMilliseconds,
        render.containerFormat,
        render.widthPixels,
        render.heightPixels,
        render.contentHash,
        render.logicalReference,
        render.createdAt,
        render.revision,
        render.supersedesVideoRenderId,
        JSON.stringify(render),
      );
    return this.getVideoRender(render.videoRenderId);
  }
  #validateRevision(render: any) {
    if (render.revision === 1) return null;
    const previous: any = this.getVideoRender(render.supersedesVideoRenderId);
    if (!previous)
      throw failure(
        'SUPERSEDED_VIDEO_RENDER_NOT_FOUND',
        'supersedesVideoRenderId',
        'render anterior não encontrado',
      );
    for (const field of [
      'pipelineRunId',
      'projectId',
      'projectVersion',
      'compositionPlanId',
      'outputAspectRatio',
    ]) {
      if (previous[field] !== render[field])
        throw failure(
          'VIDEO_RENDER_SUPERSESSION_SCOPE_MISMATCH',
          field,
          'render anterior fora do escopo',
        );
    }
    if (previous.revision + 1 !== render.revision)
      throw failure(
        'VIDEO_RENDER_REVISION_MISMATCH',
        'revision',
        'revisão não é sucessora imediata',
      );
    return previous;
  }
  #insertLineage(
    render: any,
    inputs: any = lineageInputs(render),
    generationMetadata: any = null,
  ) {
    const artifact: any = validateArtifactLineage({
      schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
      artifactId: render.videoRenderId,
      artifactType: 'video_render',
      artifactVersion: render.revision,
      pipelineRunId: render.pipelineRunId,
      projectId: render.projectId,
      projectVersion: render.projectVersion,
      contentIdentity: `video-render:${render.compositionPlanId}`,
      hashAlgorithm: 'sha256',
      contentHash: render.contentHash,
      inputs,
      generationMetadata,
      createdAt: render.createdAt,
    });
    this.db
      .prepare(
        `INSERT INTO artifact_lineage
      (artifact_id, schema_version, artifact_type, artifact_version, identity_hash,
       pipeline_run_id, project_id, project_version, content_identity, hash_algorithm,
       content_hash, generation_metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.artifactId,
        artifact.schemaVersion,
        artifact.artifactType,
        artifact.artifactVersion,
        sha256(JSON.stringify(artifact)),
        artifact.pipelineRunId,
        artifact.projectId,
        artifact.projectVersion,
        artifact.contentIdentity,
        artifact.hashAlgorithm,
        artifact.contentHash,
        artifact.generationMetadata === null
          ? null
          : JSON.stringify(artifact.generationMetadata),
        artifact.createdAt,
      );
    const insert: any = this.db.prepare(`INSERT INTO artifact_lineage_inputs
      (artifact_id, position, kind, input_id, content_hash) VALUES (?, ?, ?, ?, ?)`);
    for (const input of artifact.inputs)
      insert.run(
        artifact.artifactId,
        input.position,
        input.kind,
        input.inputId,
        input.contentHash,
      );
  }
  #transaction(operation: any) {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result: any = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (caught: any) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw mapError(caught);
    }
  }
}
function lineageInputs(render: any): any {
  return [
    {
      position: 1,
      kind: 'INTERNAL_ARTIFACT',
      inputId: render.compositionPlanId,
      contentHash: render.compositionPlanContentHash,
    },
  ];
}
function validRenderLineage(render: any, lineage: any): any {
  if (lineage.generationMetadata?.taskType !== 'subtitle-burn-in')
    return (
      JSON.stringify(lineage.inputs) === JSON.stringify(lineageInputs(render))
    );
  const inputs: any = lineage.inputs;
  return (
    render.revision === 2 &&
    inputs.length === 3 &&
    inputs[0].inputId === render.compositionPlanId &&
    inputs[0].contentHash === render.compositionPlanContentHash &&
    inputs[1].inputId === render.supersedesVideoRenderId &&
    inputs[2].kind === 'INTERNAL_ARTIFACT'
  );
}
function verifyScope(stored: any, expected: any, code: any): any {
  for (const field of ['pipelineRunId', 'projectId', 'projectVersion']) {
    if (stored[field] !== expected[field])
      throw failure(code, field, 'escopo divergente');
  }
}
function verifyPersistedColumns(render: any, row: any): any {
  const expected: any = {
    video_render_id: render.videoRenderId,
    schema_version: render.schemaVersion,
    pipeline_run_id: render.pipelineRunId,
    project_id: render.projectId,
    project_version: render.projectVersion,
    composition_plan_id: render.compositionPlanId,
    composition_plan_content_hash: render.compositionPlanContentHash,
    output_aspect_ratio: render.outputAspectRatio,
    duration_milliseconds: render.durationMilliseconds,
    container_format: render.containerFormat,
    width_pixels: render.widthPixels,
    height_pixels: render.heightPixels,
    content_hash: render.contentHash,
    logical_reference: render.logicalReference,
    created_at: render.createdAt,
    revision: render.revision,
    supersedes_video_render_id: render.supersedesVideoRenderId,
  };
  for (const [field, value] of Object.entries(expected))
    if (row[field] !== value) throw new Error(`coluna divergente: ${field}`);
}
function requireIdentifier(value: any, field: any, max: any = 80): any {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw failure('INVALID_IDENTIFIER', field, 'identificador inválido');
}
function failure(code: any, field: any, message: any, options?: any): any {
  return new VideoRenderRepositoryError(code, field, message, options);
}

function verifyCompositionBinding(request: any, render: any): any {
  if (
    render.videoRenderId !==
      `video_render:${request.videoCompositionRequestId}` ||
    render.compositionPlanId !== request.compositionPlanId ||
    render.compositionPlanContentHash !== request.compositionPlanContentHash ||
    render.containerFormat !== request.containerFormat ||
    render.widthPixels !== request.widthPixels ||
    render.heightPixels !== request.heightPixels ||
    render.createdAt !== request.requestedAt ||
    render.revision !== 1 ||
    render.supersedesVideoRenderId !== null
  ) {
    throw failure(
      'VIDEO_COMPOSITION_SCOPE_MISMATCH',
      'videoCompositionRequestId',
      'solicitação e render divergentes',
    );
  }
}
function mapError(caught: any): any {
  if (caught instanceof VideoRenderRepositoryError) return caught;
  if (caught instanceof ContractValidationError)
    return failure(caught.code, caught.path, 'contrato de render inválido', {
      cause: caught,
    });
  if (caught?.name?.endsWith('RepositoryError') && caught.code)
    return failure(caught.code, caught.field, 'artefato relacionado inválido', {
      cause: caught,
    });
  const message: any = String(caught?.message);
  if (
    message.includes(
      'video_renders.composition_plan_id, video_renders.revision',
    )
  )
    return failure(
      'VIDEO_RENDER_REVISION_CONFLICT',
      'revision',
      'revisão já registrada',
      { cause: caught },
    );
  if (message.includes('video_renders.supersedes_video_render_id'))
    return failure(
      'VIDEO_RENDER_ALREADY_SUPERSEDED',
      'supersedesVideoRenderId',
      'render já substituído',
      { cause: caught },
    );
  if (
    message.includes(
      'artifact_lineage.artifact_type, artifact_lineage.content_identity, artifact_lineage.artifact_version',
    )
  )
    return failure(
      'VIDEO_RENDER_REVISION_CONFLICT',
      'revision',
      'revisão já registrada',
      { cause: caught },
    );
  if (message.includes('artifact_lineage.artifact_id'))
    return failure(
      'VIDEO_RENDER_ID_REUSED',
      'videoRenderId',
      'ID já registrado',
      { cause: caught },
    );
  if (message.includes('IMMUTABLE_VIDEO_RENDER'))
    return failure(
      'IMMUTABLE_VIDEO_RENDER',
      'videoRenderId',
      'render imutável',
      { cause: caught },
    );
  if (message.includes('IMMUTABLE_VIDEO_COMPOSITION_REQUEST'))
    return failure(
      'IMMUTABLE_VIDEO_COMPOSITION_REQUEST',
      'videoCompositionRequestId',
      'solicitação imutável',
      { cause: caught },
    );
  if (message.includes('VIDEO_COMPOSITION_SCOPE_MISMATCH'))
    return failure(
      'VIDEO_COMPOSITION_SCOPE_MISMATCH',
      'videoCompositionRequestId',
      'solicitação fora do escopo',
      { cause: caught },
    );
  if (message.includes('VIDEO_RENDER_SCOPE_MISMATCH'))
    return failure(
      'VIDEO_RENDER_SCOPE_MISMATCH',
      'videoRender',
      'artefatos fora do escopo',
      { cause: caught },
    );
  if (message.includes('VIDEO_RENDER_REVISION_MISMATCH'))
    return failure(
      'VIDEO_RENDER_REVISION_MISMATCH',
      'revision',
      'revisão inválida',
      { cause: caught },
    );
  if (typeof caught?.code === 'string' && caught.code.startsWith('ERR_SQLITE'))
    return failure(
      'VIDEO_RENDER_PERSISTENCE_FAILED',
      'videoRender',
      'não foi possível persistir o render',
      { cause: caught },
    );
  return caught;
}
function sha256(value: any): any {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value: any): any {
  const clone = structuredClone(value);
  function freeze(item: any) {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  }
  freeze(clone);
  return clone;
}
