import { createHash } from 'node:crypto';
import {
  PostgresDatabase,
  postgresMigrationChecksum,
} from '../../../infrastructure/database/postgres/index.js';
import {
  validateVideoRender,
  videoRenderIdentityHash,
} from '../domain/video-render-contracts.js';
import type { CompositionRender } from '../domain/render.types.js';
import { validateArtifactLineage } from '../../content/domain/artifact-lineage-contracts.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import { VideoRenderRepositoryError } from './video-render.reader.js';
import { CompositionPlanRepositoryError } from './composition-plan.reader.js';
import { MediaAssetRepositoryError } from './media-asset.repository.js';
import { PostgresMediaCompositionRepository } from './postgres-media-composition.persistence.js';
import { PostgresMediaCatalogSession } from './postgres-media-catalog.session.js';
import { MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY } from './postgres-media-render.migrations.js';

export interface AsyncMediaRenderRepository {
  registerVideoRender(value: unknown): Promise<CompositionRender>;
  getVideoRender(id: string): Promise<CompositionRender | null>;
  listVideoRendersByCompositionPlan(id: string): Promise<CompositionRender[]>;
  listVideoRendersByPipelineRun(id: string): Promise<CompositionRender[]>;
  getVideoRenderSuccessor(id: string): Promise<CompositionRender | null>;
  close(): Promise<void>;
}
const fail = (code: string, field: string, message: string) =>
  new VideoRenderRepositoryError(code, field, message);
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function mapped(error: unknown): unknown {
  if (error instanceof VideoRenderRepositoryError) return error;
  if (error instanceof ContractValidationError)
    return fail(error.code, error.path, 'contrato de render inválido');
  if (
    error instanceof MediaAssetRepositoryError ||
    error instanceof CompositionPlanRepositoryError
  )
    return fail(
      [
        'MEDIA_ASSET_PERSISTENCE_FAILED',
        'COMPOSITION_PLAN_PERSISTENCE_FAILED',
      ].includes(error.code)
        ? 'VIDEO_RENDER_PERSISTENCE_FAILED'
        : error.code,
      error.field,
      'artefato relacionado ou sessão inválidos',
    );
  return error;
}
function validated(value: unknown): CompositionRender {
  const render = validateVideoRender(value);
  if (render.schemaVersion !== 'video-render/1.0.0')
    throw fail(
      'MEDIA_RENDER_P4_DEPENDENCY_REQUIRED',
      'schemaVersion',
      'configuração de áudio, origem, narração e linhagem P4 ainda não migradas',
    );
  return render;
}
function identifier(value: string, field: string, max = 200) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    throw fail('INVALID_IDENTIFIER', field, 'identificador inválido');
}
function scope(
  stored: { pipelineRunId: string; projectId: string; projectVersion: number },
  r: CompositionRender,
  code: string,
) {
  for (const k of ['pipelineRunId', 'projectId', 'projectVersion'] as const)
    if (stored[k] !== r[k]) throw fail(code, k, 'escopo divergente');
}
function columns(r: CompositionRender): Record<string, unknown> {
  return {
    video_render_id: r.videoRenderId,
    schema_version: r.schemaVersion,
    identity_hash: videoRenderIdentityHash(r),
    pipeline_run_id: r.pipelineRunId,
    project_id: r.projectId,
    project_version: r.projectVersion,
    composition_plan_id: r.compositionPlanId,
    composition_plan_content_hash: r.compositionPlanContentHash,
    output_aspect_ratio: r.outputAspectRatio,
    duration_milliseconds: r.durationMilliseconds,
    container_format: r.containerFormat,
    width_pixels: r.widthPixels,
    height_pixels: r.heightPixels,
    content_hash: r.contentHash,
    logical_reference: r.logicalReference,
    created_at: r.createdAt,
    revision: r.revision,
    supersedes_video_render_id: r.supersedesVideoRenderId,
    payload_json: JSON.stringify(r),
  };
}
function lineage(r: CompositionRender) {
  return validateArtifactLineage({
    schemaVersion: 'artifact-lineage/1.0.0',
    artifactId: r.videoRenderId,
    artifactType: 'video_render',
    artifactVersion: r.revision,
    pipelineRunId: r.pipelineRunId,
    projectId: r.projectId,
    projectVersion: r.projectVersion,
    contentIdentity: `video-render:${r.compositionPlanId}`,
    hashAlgorithm: 'sha256',
    contentHash: r.contentHash,
    inputs: [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: r.compositionPlanId,
        contentHash: r.compositionPlanContentHash,
      },
    ],
    generationMetadata: null,
    createdAt: r.createdAt,
  });
}
export class PostgresMediaRenderRepository implements AsyncMediaRenderRepository {
  private readonly plans: PostgresMediaCompositionRepository;
  constructor(private readonly session: PostgresMediaCatalogSession) {
    this.plans = new PostgresMediaCompositionRepository(session);
  }
  async close(): Promise<void> {
    this.session.close();
  }
  private async run<T>(work: () => Promise<T>, write = false): Promise<T> {
    try {
      return await this.session.run(work, write);
    } catch (error) {
      throw mapped(error);
    }
  }
  private async related(r: CompositionRender): Promise<void> {
    const run = await this.session.getRun(r.pipelineRunId);
    if (!run)
      throw fail(
        'PIPELINE_RUN_NOT_FOUND',
        'pipelineRunId',
        'execução não encontrada',
      );
    const plan = await this.plans.getCompositionPlan(r.compositionPlanId);
    if (!plan)
      throw fail(
        'COMPOSITION_PLAN_NOT_FOUND',
        'compositionPlanId',
        'plano não encontrado',
      );
    scope(run, r, 'VIDEO_RENDER_RUN_SCOPE_MISMATCH');
    scope(plan, r, 'VIDEO_RENDER_PLAN_SCOPE_MISMATCH');
    if (plan.contentHash !== r.compositionPlanContentHash)
      throw fail(
        'COMPOSITION_PLAN_CONTENT_HASH_MISMATCH',
        'compositionPlanContentHash',
        'hash do plano divergente',
      );
    if (
      run.projectSnapshot.channel.aspectRatio !== r.outputAspectRatio ||
      plan.outputAspectRatio !== r.outputAspectRatio
    )
      throw fail(
        'OUTPUT_ASPECT_RATIO_MISMATCH',
        'outputAspectRatio',
        'proporção diverge do snapshot ou plano',
      );
    if (plan.durationMilliseconds !== r.durationMilliseconds)
      throw fail(
        'VIDEO_RENDER_DURATION_MISMATCH',
        'durationMilliseconds',
        'duração diverge do plano',
      );
  }
  private async previous(
    r: CompositionRender,
    seen: Set<string>,
  ): Promise<void> {
    if (r.revision === 1) return;
    const previous = r.supersedesVideoRenderId
      ? await this.read(r.supersedesVideoRenderId, seen)
      : null;
    if (!previous)
      throw fail(
        'SUPERSEDED_VIDEO_RENDER_NOT_FOUND',
        'supersedesVideoRenderId',
        'render anterior não encontrado',
      );
    for (const k of [
      'pipelineRunId',
      'projectId',
      'projectVersion',
      'compositionPlanId',
      'outputAspectRatio',
    ] as const)
      if (previous[k] !== r[k])
        throw fail(
          'VIDEO_RENDER_SUPERSESSION_SCOPE_MISMATCH',
          k,
          'render anterior fora do escopo',
        );
    if (previous.revision + 1 !== r.revision)
      throw fail(
        'VIDEO_RENDER_REVISION_MISMATCH',
        'revision',
        'revisão não é sucessora imediata',
      );
  }
  async registerVideoRender(value: unknown): Promise<CompositionRender> {
    let r: CompositionRender;
    try {
      r = validated(value);
    } catch (error) {
      throw mapped(error);
    }
    return this.run(async () => {
      const prior = (
        await this.session.query(
          'media',
          'SELECT identity_hash FROM media.video_renders WHERE video_render_id=$1',
          [r.videoRenderId],
        )
      ).rows[0];
      if (prior) {
        if (prior.identity_hash !== videoRenderIdentityHash(r))
          throw fail(
            'VIDEO_RENDER_ID_REUSED',
            'videoRenderId',
            'ID reutilizado com render incompatível',
          );
        return (await this.read(r.videoRenderId, new Set()))!;
      }
      if (
        (
          await this.session.query(
            'media',
            'SELECT 1 FROM media.video_renders WHERE composition_plan_id=$1 AND revision=$2',
            [r.compositionPlanId, r.revision],
          )
        ).rows.length
      )
        throw fail(
          'VIDEO_RENDER_REVISION_CONFLICT',
          'revision',
          'revisão já registrada para o plano',
        );
      if (
        (
          await this.session.query(
            'content',
            'SELECT 1 FROM content.artifact_lineage WHERE artifact_id=$1',
            [r.videoRenderId],
          )
        ).rows.length
      )
        throw fail(
          'VIDEO_RENDER_ID_REUSED',
          'videoRenderId',
          'ID já registrado na linhagem canônica',
        );
      await this.related(r);
      await this.previous(r, new Set([r.videoRenderId]));
      const a = lineage(r);
      await this.session.query(
        'content',
        'INSERT INTO content.artifact_lineage(artifact_id,schema_version,artifact_type,artifact_version,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12)',
        [
          a.artifactId,
          a.schemaVersion,
          a.artifactType,
          a.artifactVersion,
          hash(a),
          a.pipelineRunId,
          a.projectId,
          a.projectVersion,
          a.contentIdentity,
          a.hashAlgorithm,
          a.contentHash,
          a.createdAt,
        ],
      );
      await this.session.query(
        'content',
        'INSERT INTO content.artifact_lineage_inputs(artifact_id,position,kind,input_id,content_hash) VALUES($1,1,$2,$3,$4)',
        [
          r.videoRenderId,
          'INTERNAL_ARTIFACT',
          r.compositionPlanId,
          r.compositionPlanContentHash,
        ],
      );
      const c = columns(r);
      // Only fixed column names from the mapping are interpolated; all data is parameterized.
      await this.session.query(
        'media',
        `INSERT INTO media.video_renders(${Object.keys(c).join(',')}) VALUES(${Object.keys(
          c,
        )
          .map((_, i) => `$${i + 1}`)
          .join(',')})`,
        Object.values(c),
      );
      return (await this.read(r.videoRenderId, new Set()))!;
    }, true);
  }
  async getVideoRender(id: string): Promise<CompositionRender | null> {
    identifier(id, 'videoRenderId');
    return this.run(() => this.read(id, new Set()));
  }
  private async read(
    id: string,
    seen: Set<string>,
  ): Promise<CompositionRender | null> {
    if (seen.has(id))
      throw fail(
        'INVALID_PERSISTED_VIDEO_RENDER',
        'videoRenderId',
        'ciclo de supersession',
      );
    seen.add(id);
    const row = (
      await this.session.query(
        'media',
        'SELECT * FROM media.video_renders WHERE video_render_id=$1',
        [id],
      )
    ).rows[0];
    if (!row) return null;
    try {
      const r = validated(JSON.parse(row.payload_json));
      const expected = columns(r);
      delete expected.payload_json;
      if (Object.entries(expected).some(([k, v]) => row[k] !== v))
        throw new Error('INVALID_COLUMNS');
      await this.related(r);
      await this.previous(r, seen);
      const stored = (
        await this.session.query(
          'content',
          'SELECT * FROM content.artifact_lineage WHERE artifact_id=$1',
          [id],
        )
      ).rows[0];
      if (!stored) throw new Error('MISSING_LINEAGE');
      const inputs = (
        await this.session.query(
          'content',
          'SELECT position,kind,input_id AS "inputId",content_hash AS "contentHash" FROM content.artifact_lineage_inputs WHERE artifact_id=$1 ORDER BY position',
          [id],
        )
      ).rows;
      const actual = validateArtifactLineage({
        schemaVersion: stored.schema_version,
        artifactId: stored.artifact_id,
        artifactType: stored.artifact_type,
        artifactVersion: stored.artifact_version,
        pipelineRunId: stored.pipeline_run_id,
        projectId: stored.project_id,
        projectVersion: stored.project_version,
        contentIdentity: stored.content_identity,
        hashAlgorithm: stored.hash_algorithm,
        contentHash: stored.content_hash,
        inputs,
        generationMetadata:
          stored.generation_metadata_json === null
            ? null
            : JSON.parse(stored.generation_metadata_json),
        createdAt: stored.created_at,
      });
      if (
        stored.identity_hash !== hash(actual) ||
        JSON.stringify(actual) !== JSON.stringify(lineage(r))
      )
        throw new Error('INVALID_LINEAGE');
      return r;
    } catch (error) {
      if (
        error instanceof VideoRenderRepositoryError ||
        error instanceof MediaAssetRepositoryError ||
        error instanceof CompositionPlanRepositoryError
      )
        throw mapped(error);
      throw fail(
        'INVALID_PERSISTED_VIDEO_RENDER',
        'videoRenderId',
        'render persistido inválido',
      );
    }
  }
  private async list(sql: string, id: string): Promise<CompositionRender[]> {
    return this.run(async () => {
      const rows = (await this.session.query('media', sql, [id])).rows,
        renders: CompositionRender[] = [];
      for (const row of rows)
        renders.push((await this.read(row.video_render_id, new Set()))!);
      return renders;
    });
  }
  async listVideoRendersByCompositionPlan(
    id: string,
  ): Promise<CompositionRender[]> {
    identifier(id, 'compositionPlanId');
    return this.list(
      'SELECT video_render_id FROM media.video_renders WHERE composition_plan_id=$1 ORDER BY revision,video_render_id',
      id,
    );
  }
  async listVideoRendersByPipelineRun(
    id: string,
  ): Promise<CompositionRender[]> {
    identifier(id, 'pipelineRunId', 80);
    return this.list(
      'SELECT video_render_id FROM media.video_renders WHERE pipeline_run_id=$1 ORDER BY created_at,composition_plan_id,revision,video_render_id',
      id,
    );
  }
  async getVideoRenderSuccessor(id: string): Promise<CompositionRender | null> {
    identifier(id, 'videoRenderId');
    return (
      (
        await this.list(
          'SELECT video_render_id FROM media.video_renders WHERE supersedes_video_render_id=$1',
          id,
        )
      )[0] ?? null
    );
  }
}
export class PostgresMediaRenderPersistence {
  constructor(private readonly database: PostgresDatabase) {}
  async open(readOnly = false): Promise<AsyncMediaRenderRepository> {
    await PostgresMediaCatalogSession.verify(this.database);
    const rows = (
      await this.database.query(
        'SELECT version,name,checksum FROM platform.schema_migrations ORDER BY version',
        [],
        'media',
      )
    ).rows;
    if (
      MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY.some(
        (m) =>
          !rows.some(
            (r) =>
              r.version === m.version &&
              r.name === m.name &&
              r.checksum === postgresMigrationChecksum(m.sql),
          ),
      )
    )
      throw fail(
        'MEDIA_RENDER_SCHEMA_VERSION_UNSUPPORTED',
        'schemaVersion',
        'migration v10 requerida',
      );
    return new PostgresMediaRenderRepository(
      new PostgresMediaCatalogSession(this.database, readOnly),
    );
  }
}
