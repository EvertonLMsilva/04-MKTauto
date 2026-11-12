import { createHash } from 'node:crypto';
import type { PostgresDatabase } from '../../src/infrastructure/database/postgres/index.js';
import { mediaCompositionFixture } from './media-composition-fixture.js';
import { PostgresMediaCompositionPersistence } from '../../src/modules/media/infrastructure/postgres-media-composition.persistence.js';
import { VideoRenderRepository } from '../../src/modules/media/infrastructure/video-render.reader.js';
import {
  validateVideoRender,
  videoRenderIdentityHash,
} from '../../src/modules/media/domain/video-render-contracts.js';
import { validateArtifactLineage } from '../../src/modules/content/domain/artifact-lineage-contracts.js';
import { videoCompositionRequestHash } from '../../src/modules/media/domain/video-composition-contracts.js';
import type { CompositionRender } from '../../src/modules/media/domain/render.types.js';
import { at } from './affiliate-fixture.js';

export function renderMetadata(
  plan: any,
  overrides: Record<string, unknown> = {},
): CompositionRender {
  return validateVideoRender({
    schemaVersion: 'video-render/1.0.0',
    videoRenderId: 'video_render:render_fixture_001',
    pipelineRunId: plan.pipelineRunId,
    projectId: plan.projectId,
    projectVersion: plan.projectVersion,
    compositionPlanId: plan.compositionPlanId,
    compositionPlanContentHash: plan.contentHash,
    outputAspectRatio: plan.outputAspectRatio,
    durationMilliseconds: plan.durationMilliseconds,
    containerFormat: 'mp4',
    widthPixels: 1080,
    heightPixels: 1920,
    contentHash: 'f'.repeat(64),
    logicalReference: 'render:fixture_001',
    createdAt: at,
    revision: 1,
    supersedesVideoRenderId: null,
    ...overrides,
  });
}
export async function mediaRenderFixture(
  db: PostgresDatabase,
  { mixed = false } = {},
) {
  const f = await mediaCompositionFixture(db, { mixed, video: mixed });
  try {
    const plans = await new PostgresMediaCompositionPersistence(db).open();
    try {
      await plans.registerCompositionPlan(f.plan);
    } finally {
      await plans.close();
    }
    f.nativeComposition.registerCompositionPlan(f.plan);
    const nativeRender = new VideoRenderRepository(
      f.sqlite.path,
      { get: (id) => f.native.getRun(id)! },
      { getScript: (id) => f.native.getScript(id) },
    );
    return {
      ...f,
      nativeRender,
      render: renderMetadata(f.plan),
      cleanupRender() {
        nativeRender.close();
        f.cleanupComposition();
      },
    };
  } catch (error) {
    f.cleanupComposition();
    throw error;
  }
}
export function nativeInitial(
  f: Awaited<ReturnType<typeof mediaRenderFixture>>,
  value: CompositionRender,
) {
  const body = {
    schemaVersion: 'video-composition-request/1.0.0',
    videoCompositionRequestId: value.videoRenderId.slice(
      'video_render:'.length,
    ),
    compositionPlanId: value.compositionPlanId,
    compositionPlanContentHash: value.compositionPlanContentHash,
    containerFormat: value.containerFormat,
    widthPixels: value.widthPixels,
    heightPixels: value.heightPixels,
    requestedAt: value.createdAt,
  };
  return f.nativeRender.registerVideoComposition({
    request: { ...body, contentHash: videoCompositionRequestHash(body) },
    videoRender: value,
  });
}
/** SQLite has no public generic registerVideoRender. Seed only a canonical revision through its real SQL constraints,
 * then use its unchanged public reader/list methods. This is metadata, not a subtitle-burn-in or P4 fixture. */
export function nativeRevision(
  f: Awaited<ReturnType<typeof mediaRenderFixture>>,
  value: CompositionRender,
) {
  const v = validateVideoRender(value),
    db = f.nativeRender.db;
  const a = validateArtifactLineage({
    schemaVersion: 'artifact-lineage/1.0.0',
    artifactId: v.videoRenderId,
    artifactType: 'video_render',
    artifactVersion: v.revision,
    pipelineRunId: v.pipelineRunId,
    projectId: v.projectId,
    projectVersion: v.projectVersion,
    contentIdentity: `video-render:${v.compositionPlanId}`,
    hashAlgorithm: 'sha256',
    contentHash: v.contentHash,
    inputs: [
      {
        position: 1,
        kind: 'INTERNAL_ARTIFACT',
        inputId: v.compositionPlanId,
        contentHash: v.compositionPlanContentHash,
      },
    ],
    generationMetadata: null,
    createdAt: v.createdAt,
  });
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      'INSERT INTO artifact_lineage(artifact_id,schema_version,artifact_type,artifact_version,identity_hash,pipeline_run_id,project_id,project_version,content_identity,hash_algorithm,content_hash,generation_metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?)',
    ).run(
      a.artifactId,
      a.schemaVersion,
      a.artifactType,
      a.artifactVersion,
      createHash('sha256').update(JSON.stringify(a)).digest('hex'),
      a.pipelineRunId,
      a.projectId,
      a.projectVersion,
      a.contentIdentity,
      a.hashAlgorithm,
      a.contentHash,
      a.createdAt,
    );
    db.prepare(
      'INSERT INTO artifact_lineage_inputs(artifact_id,position,kind,input_id,content_hash) VALUES(?,1,?,?,?)',
    ).run(
      a.artifactId,
      'INTERNAL_ARTIFACT',
      v.compositionPlanId,
      v.compositionPlanContentHash,
    );
    db.prepare(
      'INSERT INTO video_renders(video_render_id,schema_version,identity_hash,pipeline_run_id,project_id,project_version,composition_plan_id,composition_plan_content_hash,output_aspect_ratio,duration_milliseconds,container_format,width_pixels,height_pixels,content_hash,logical_reference,created_at,revision,supersedes_video_render_id,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      v.videoRenderId,
      v.schemaVersion,
      videoRenderIdentityHash(v),
      v.pipelineRunId,
      v.projectId,
      v.projectVersion,
      v.compositionPlanId,
      v.compositionPlanContentHash,
      v.outputAspectRatio,
      v.durationMilliseconds,
      v.containerFormat,
      v.widthPixels,
      v.heightPixels,
      v.contentHash,
      v.logicalReference,
      v.createdAt,
      v.revision,
      v.supersedesVideoRenderId,
      JSON.stringify(v),
    );
    db.exec('COMMIT');
    return f.nativeRender.getVideoRender(v.videoRenderId);
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
export function p4Metadata(source: CompositionRender) {
  return validateVideoRender({
    schemaVersion: 'video-render/2.0.0',
    videoRenderId: 'render_p4_unmigrated',
    pipelineRunId: source.pipelineRunId,
    projectId: source.projectId,
    projectVersion: source.projectVersion,
    origin: {
      schemaVersion: 'video-origin/1.0.0',
      kind: 'LEGACY_COMPOSITION',
      videoRenderId: source.videoRenderId,
      videoRenderContentHash: source.contentHash,
    },
    audioConfigId: 'audio_config_unmigrated',
    audioConfigHash: 'a'.repeat(64),
    narrationId: null,
    narrationHash: null,
    outputAspectRatio: '9:16',
    widthPixels: 1080,
    heightPixels: 1920,
    durationMilliseconds: 5000,
    frameCount: 150,
    frameRate: 30,
    videoCodec: 'h264',
    videoProfile: 'High',
    audioCodec: 'aac',
    audioProfile: 'LC',
    audioSampleRate: 48000,
    audioChannels: 2,
    contentHash: 'd'.repeat(64),
    logicalReference: `render:sha256_${'d'.repeat(64)}`,
    revision: 1,
    supersedesVideoRenderId: null,
    createdAt: at,
  });
}
