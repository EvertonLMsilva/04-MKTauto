import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';
import { MEDIA_COMPOSITION_POSTGRES_MIGRATION_REGISTRY } from './postgres-media-composition.migrations.js';
export const MEDIA_RENDER_POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [
  {
    version: 10,
    name: '010_media_video_renders',
    sql: `
CREATE TABLE media.video_renders (
 video_render_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id),
 schema_version TEXT NOT NULL CHECK(schema_version='video-render/1.0.0'),identity_hash media.sha256 NOT NULL,
 pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id),
 project_id TEXT COLLATE pg_catalog."C" NOT NULL,project_version media.safe_positive NOT NULL,
 composition_plan_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES media.composition_plans(composition_plan_id),
 composition_plan_content_hash media.sha256 NOT NULL,output_aspect_ratio TEXT NOT NULL CHECK(output_aspect_ratio IN ('9:16','1:1','16:9')),
 duration_milliseconds INTEGER NOT NULL CHECK(duration_milliseconds BETWEEN 1 AND 86400000),
 container_format TEXT NOT NULL CHECK(container_format IN ('mp4','webm','mov')),
 width_pixels INTEGER NOT NULL CHECK(width_pixels BETWEEN 1 AND 100000),height_pixels INTEGER NOT NULL CHECK(height_pixels BETWEEN 1 AND 100000),
 content_hash media.sha256 NOT NULL,logical_reference TEXT NOT NULL,created_at TEXT COLLATE pg_catalog."C" NOT NULL,revision media.safe_positive NOT NULL,
 supersedes_video_render_id TEXT COLLATE pg_catalog."C" UNIQUE REFERENCES media.video_renders(video_render_id),payload_json JSON NOT NULL,
 UNIQUE(composition_plan_id,revision),FOREIGN KEY(project_id,project_version) REFERENCES project.project_snapshots(project_id,version),
 CHECK((revision=1 AND supersedes_video_render_id IS NULL) OR (revision>1 AND supersedes_video_render_id IS NOT NULL)),
 CHECK((output_aspect_ratio='9:16' AND width_pixels::bigint*16=height_pixels::bigint*9)
 OR (output_aspect_ratio='1:1' AND width_pixels=height_pixels) OR (output_aspect_ratio='16:9' AND width_pixels::bigint*9=height_pixels::bigint*16)),
 CHECK(logical_reference ~ '^[a-z][a-z0-9_-]{2,40}:[a-z0-9][a-z0-9._-]{2,200}$'
 AND logical_reference !~* '^(https?|file|data|s3|gs|az|blob|bucket|object|storage|path):'
 AND logical_reference !~* '(^|[:._-])(token|secret|credential|password|signature|api.?key)([:._-]|$)')
);
CREATE INDEX video_renders_run_order ON media.video_renders(pipeline_run_id,created_at,composition_plan_id,revision,video_render_id);
CREATE INDEX video_renders_plan_order ON media.video_renders(composition_plan_id,revision,video_render_id);
CREATE FUNCTION media.validate_render_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM campaign.pipeline_runs r JOIN media.composition_plans p ON p.composition_plan_id=NEW.composition_plan_id
 JOIN content.artifact_lineage a ON a.artifact_id=NEW.video_render_id
 WHERE r.pipeline_run_id=NEW.pipeline_run_id AND r.project_id=NEW.project_id AND r.project_version=NEW.project_version
 AND r.project_snapshot_json->'channel'->>'aspectRatio'=NEW.output_aspect_ratio
 AND p.pipeline_run_id=NEW.pipeline_run_id AND p.project_id=NEW.project_id AND p.project_version=NEW.project_version
 AND p.content_hash=NEW.composition_plan_content_hash AND p.output_aspect_ratio=NEW.output_aspect_ratio AND p.duration_milliseconds=NEW.duration_milliseconds
 AND a.artifact_type='video_render' AND a.artifact_version=NEW.revision AND a.pipeline_run_id=NEW.pipeline_run_id
 AND a.project_id=NEW.project_id AND a.project_version=NEW.project_version AND a.content_hash=NEW.content_hash AND a.hash_algorithm='sha256'
 AND a.content_identity='video-render:' || NEW.composition_plan_id AND a.created_at=NEW.created_at AND a.generation_metadata_json IS NULL
 AND (SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id)=1
 AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs i WHERE i.artifact_id=a.artifact_id AND i.position=1
 AND i.kind='INTERNAL_ARTIFACT' AND i.input_id=NEW.composition_plan_id AND i.content_hash=NEW.composition_plan_content_hash))
 THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='VIDEO_RENDER_SCOPE_MISMATCH'; END IF;
 IF NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM media.video_renders p WHERE p.video_render_id=NEW.supersedes_video_render_id
 AND p.pipeline_run_id=NEW.pipeline_run_id AND p.project_id=NEW.project_id AND p.project_version=NEW.project_version
 AND p.composition_plan_id=NEW.composition_plan_id AND p.output_aspect_ratio=NEW.output_aspect_ratio AND p.revision=NEW.revision-1)
 THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='VIDEO_RENDER_REVISION_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_render_scope BEFORE INSERT ON media.video_renders FOR EACH ROW EXECUTE FUNCTION media.validate_render_scope();
CREATE FUNCTION media.require_render_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM media.video_renders WHERE video_render_id=NEW.artifact_id)
THEN RAISE EXCEPTION USING ERRCODE='P1003',MESSAGE='ORPHAN_VIDEO_RENDER_LINEAGE'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER media_render_lineage_owner AFTER INSERT ON content.artifact_lineage
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.artifact_type='video_render') EXECUTE FUNCTION media.require_render_owner();
CREATE FUNCTION media.reject_render_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P1004',MESSAGE='IMMUTABLE_VIDEO_RENDER'; END $$;
CREATE TRIGGER immutable_video_renders BEFORE UPDATE OR DELETE ON media.video_renders FOR EACH ROW EXECUTE FUNCTION media.reject_render_mutation();
`,
  },
];
export const MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY = [
  ...MEDIA_COMPOSITION_POSTGRES_MIGRATION_REGISTRY,
  ...MEDIA_RENDER_POSTGRES_MIGRATIONS,
] as const;
