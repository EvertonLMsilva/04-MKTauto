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
