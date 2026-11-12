import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';
import { MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY } from './postgres-media-render.migrations.js';
export const MEDIA_SUBTITLE_POSTGRES_MIGRATIONS: readonly PostgresMigration[] =
  [
    {
      version: 11,
      name: '011_media_subtitle_burnin_dependencies',
      sql: `
CREATE TABLE media.local_alignments (
 alignment_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id),
 document_hash media.sha256 NOT NULL UNIQUE,evidence_hash media.sha256 NOT NULL,
 pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id),
 project_id TEXT COLLATE pg_catalog."C" NOT NULL,project_version media.safe_positive NOT NULL,
 voice_track_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES media.voice_tracks(voice_track_id),voice_track_content_hash media.sha256 NOT NULL,
 script_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.scripts(script_id),script_content_hash media.sha256 NOT NULL,script_revision media.safe_positive NOT NULL,
 duration_milliseconds media.safe_positive NOT NULL,created_at TEXT COLLATE pg_catalog."C" NOT NULL,
 FOREIGN KEY(project_id,project_version) REFERENCES project.project_snapshots(project_id,version)
);
CREATE TABLE media.local_subtitles (
 subtitle_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id),
 alignment_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES media.local_alignments(alignment_id),evidence_hash media.sha256 NOT NULL,
 voice_track_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES media.voice_tracks(voice_track_id),
 script_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.scripts(script_id),script_content_hash media.sha256 NOT NULL,
 srt_hash media.sha256 NOT NULL,ass_hash media.sha256 NOT NULL,document_hash media.sha256 NOT NULL UNIQUE,identity_hash media.sha256 NOT NULL,
 pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id),
 project_id TEXT COLLATE pg_catalog."C" NOT NULL,project_version media.safe_positive NOT NULL,created_at TEXT COLLATE pg_catalog."C" NOT NULL,payload_json JSON NOT NULL,
 FOREIGN KEY(project_id,project_version) REFERENCES project.project_snapshots(project_id,version),CHECK(identity_hash=document_hash)
);
CREATE TABLE media.video_render_burnins (
 video_render_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES media.video_renders(video_render_id) DEFERRABLE INITIALLY DEFERRED,
 source_render_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES media.video_renders(video_render_id),
 subtitle_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES media.local_subtitles(subtitle_id),document_hash media.sha256 NOT NULL,
 CHECK(video_render_id<>source_render_id)
);
CREATE FUNCTION media.validate_local_evidence_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a RECORD;
BEGIN
 IF TG_TABLE_NAME='local_alignments' THEN
  SELECT * INTO a FROM content.artifact_lineage WHERE artifact_id=NEW.alignment_id;
 ELSE
  SELECT * INTO a FROM content.artifact_lineage WHERE artifact_id=NEW.subtitle_id;
 END IF;
 IF a.artifact_id IS NULL OR a.artifact_version<>1 OR a.content_identity IS NOT NULL OR a.pipeline_run_id<>NEW.pipeline_run_id
 OR a.project_id<>NEW.project_id OR a.project_version<>NEW.project_version OR a.content_hash<>NEW.document_hash OR a.created_at<>NEW.created_at
 OR a.generation_metadata_json::jsonb IS DISTINCT FROM pg_catalog.jsonb_build_object('provider','local','model','local-flow/1','taskType','local-evidence','promptVersion','none','configurationHash',NEW.document_hash,'publicConfiguration',NULL)
 THEN RAISE EXCEPTION USING ERRCODE='P1101',MESSAGE='LOCAL_EVIDENCE_LINEAGE_MISMATCH'; END IF;
 IF TG_TABLE_NAME='local_alignments' THEN
  IF a.artifact_type<>'local_alignment' OR NOT EXISTS(SELECT 1 FROM media.voice_tracks v JOIN content.scripts s ON s.script_id=NEW.script_id
   WHERE v.voice_track_id=NEW.voice_track_id AND v.origin IN ('OPERATOR_RECORDING','AUTHORIZED_RECORDING') AND v.content_hash=NEW.voice_track_content_hash
   AND v.script_id=NEW.script_id AND v.script_content_hash=NEW.script_content_hash AND v.pipeline_run_id=NEW.pipeline_run_id
   AND v.project_id=NEW.project_id AND v.project_version=NEW.project_version AND v.duration_milliseconds=NEW.duration_milliseconds AND v.created_at=NEW.created_at
   AND s.pipeline_run_id=NEW.pipeline_run_id AND s.project_id=NEW.project_id AND s.project_version=NEW.project_version AND s.content_hash=NEW.script_content_hash AND s.revision=NEW.script_revision)
   OR (SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id)<>2
   OR NOT EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=1 AND kind='INTERNAL_ARTIFACT' AND input_id=NEW.voice_track_id AND content_hash=NEW.voice_track_content_hash)
   OR NOT EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=2 AND kind='INTERNAL_ARTIFACT' AND input_id=NEW.script_id AND content_hash=NEW.script_content_hash)
   THEN RAISE EXCEPTION USING ERRCODE='P1101',MESSAGE='LOCAL_ALIGNMENT_SCOPE_MISMATCH'; END IF;
 ELSE
  IF a.artifact_type<>'local_subtitles' OR NOT EXISTS(SELECT 1 FROM media.local_alignments l WHERE l.alignment_id=NEW.alignment_id
   AND l.evidence_hash=NEW.evidence_hash AND l.voice_track_id=NEW.voice_track_id AND l.script_id=NEW.script_id AND l.script_content_hash=NEW.script_content_hash
   AND l.pipeline_run_id=NEW.pipeline_run_id AND l.project_id=NEW.project_id AND l.project_version=NEW.project_version AND l.created_at=NEW.created_at
   AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=1 AND kind='INTERNAL_ARTIFACT' AND input_id=l.alignment_id AND content_hash=l.document_hash)
   AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=3 AND kind='INTERNAL_ARTIFACT' AND input_id=l.voice_track_id AND content_hash=l.voice_track_content_hash))
   OR (SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id)<>3
   OR NOT EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=2 AND kind='INTERNAL_ARTIFACT' AND input_id=NEW.script_id AND content_hash=NEW.script_content_hash)
   OR NEW.payload_json->>'subtitleId' IS DISTINCT FROM NEW.subtitle_id OR NEW.payload_json->>'alignmentId' IS DISTINCT FROM NEW.alignment_id
   OR NEW.payload_json->>'evidenceHash' IS DISTINCT FROM NEW.evidence_hash OR NEW.payload_json->>'voiceTrackId' IS DISTINCT FROM NEW.voice_track_id
   OR NEW.payload_json->>'scriptId' IS DISTINCT FROM NEW.script_id OR NEW.payload_json->>'scriptContentHash' IS DISTINCT FROM NEW.script_content_hash
   OR NEW.payload_json->>'srtHash' IS DISTINCT FROM NEW.srt_hash OR NEW.payload_json->>'assHash' IS DISTINCT FROM NEW.ass_hash
   THEN RAISE EXCEPTION USING ERRCODE='P1101',MESSAGE='LOCAL_SUBTITLE_SCOPE_MISMATCH'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_local_alignment BEFORE INSERT ON media.local_alignments FOR EACH ROW EXECUTE FUNCTION media.validate_local_evidence_scope();
CREATE TRIGGER validate_local_subtitle BEFORE INSERT ON media.local_subtitles FOR EACH ROW EXECUTE FUNCTION media.validate_local_evidence_scope();
CREATE FUNCTION media.require_local_evidence_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF (NEW.artifact_type='local_alignment' AND NOT EXISTS(SELECT 1 FROM media.local_alignments WHERE alignment_id=NEW.artifact_id))
 OR (NEW.artifact_type='local_subtitles' AND NOT EXISTS(SELECT 1 FROM media.local_subtitles WHERE subtitle_id=NEW.artifact_id))
 THEN RAISE EXCEPTION USING ERRCODE='P1102',MESSAGE='ORPHAN_LOCAL_EVIDENCE_LINEAGE'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER local_evidence_owner AFTER INSERT ON content.artifact_lineage DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN(NEW.artifact_type IN ('local_alignment','local_subtitles')) EXECUTE FUNCTION media.require_local_evidence_owner();
CREATE FUNCTION media.require_burnin_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM media.video_renders v JOIN content.artifact_lineage a ON a.artifact_id=v.video_render_id
 JOIN media.video_renders p ON p.video_render_id=NEW.source_render_id JOIN media.local_subtitles s ON s.subtitle_id=NEW.subtitle_id
 WHERE v.video_render_id=NEW.video_render_id AND v.revision=2 AND p.revision=1 AND v.supersedes_video_render_id=p.video_render_id
 AND a.content_identity IS NULL AND a.artifact_type='video_render'
 AND a.generation_metadata_json::jsonb=pg_catalog.jsonb_build_object('provider','local','model','local-flow/1','taskType','subtitle-burn-in','promptVersion','none','configurationHash',NEW.document_hash,'publicConfiguration',NULL)
 AND (SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id)=3
 AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=1 AND kind='INTERNAL_ARTIFACT' AND input_id=v.composition_plan_id AND content_hash=v.composition_plan_content_hash)
 AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=2 AND kind='INTERNAL_ARTIFACT' AND input_id=p.video_render_id AND content_hash=p.content_hash)
 AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=3 AND kind='INTERNAL_ARTIFACT' AND input_id=s.subtitle_id AND content_hash=s.document_hash))
 THEN RAISE EXCEPTION USING ERRCODE='P1104',MESSAGE='INVALID_BURNIN_OWNER'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER render_burnin_owner AFTER INSERT ON media.video_render_burnins DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION media.require_burnin_owner();
CREATE OR REPLACE FUNCTION media.validate_render_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM campaign.pipeline_runs r JOIN media.composition_plans p ON p.composition_plan_id=NEW.composition_plan_id
 JOIN content.artifact_lineage a ON a.artifact_id=NEW.video_render_id
 WHERE r.pipeline_run_id=NEW.pipeline_run_id AND r.project_id=NEW.project_id AND r.project_version=NEW.project_version
 AND r.project_snapshot_json->'channel'->>'aspectRatio'=NEW.output_aspect_ratio
 AND p.pipeline_run_id=NEW.pipeline_run_id AND p.project_id=NEW.project_id AND p.project_version=NEW.project_version
 AND p.content_hash=NEW.composition_plan_content_hash AND p.output_aspect_ratio=NEW.output_aspect_ratio AND p.duration_milliseconds=NEW.duration_milliseconds
 AND a.artifact_type='video_render' AND a.artifact_version=NEW.revision AND a.pipeline_run_id=NEW.pipeline_run_id
 AND a.project_id=NEW.project_id AND a.project_version=NEW.project_version AND a.content_hash=NEW.content_hash AND a.hash_algorithm='sha256' AND a.created_at=NEW.created_at
 AND (
  (a.content_identity='video-render:' || NEW.composition_plan_id AND a.generation_metadata_json IS NULL
   AND NOT EXISTS(SELECT 1 FROM media.video_render_burnins WHERE video_render_id=NEW.video_render_id)
   AND (SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id)=1
   AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=1 AND kind='INTERNAL_ARTIFACT' AND input_id=NEW.composition_plan_id AND content_hash=NEW.composition_plan_content_hash))
  OR
  (a.content_identity IS NULL AND NEW.revision=2 AND EXISTS(SELECT 1 FROM media.video_render_burnins b
   JOIN media.video_renders v ON v.video_render_id=b.source_render_id JOIN media.local_subtitles s ON s.subtitle_id=b.subtitle_id
   WHERE b.video_render_id=NEW.video_render_id AND v.video_render_id=NEW.supersedes_video_render_id AND v.revision=1
   AND v.pipeline_run_id=NEW.pipeline_run_id AND v.project_id=NEW.project_id AND v.project_version=NEW.project_version
   AND v.composition_plan_id=NEW.composition_plan_id AND v.composition_plan_content_hash=NEW.composition_plan_content_hash
   AND v.width_pixels=NEW.width_pixels AND v.height_pixels=NEW.height_pixels AND v.container_format=NEW.container_format
   AND v.duration_milliseconds=NEW.duration_milliseconds AND v.output_aspect_ratio=NEW.output_aspect_ratio AND v.created_at=NEW.created_at
   AND s.pipeline_run_id=NEW.pipeline_run_id AND s.project_id=NEW.project_id AND s.project_version=NEW.project_version
   AND s.script_id=p.script_id AND s.script_content_hash=p.script_content_hash AND s.voice_track_id=p.voice_track_id
   AND a.generation_metadata_json::jsonb=pg_catalog.jsonb_build_object('provider','local','model','local-flow/1','taskType','subtitle-burn-in','promptVersion','none','configurationHash',b.document_hash,'publicConfiguration',NULL)
   AND (SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id)=3
   AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=1 AND kind='INTERNAL_ARTIFACT' AND input_id=NEW.composition_plan_id AND content_hash=NEW.composition_plan_content_hash)
   AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=2 AND kind='INTERNAL_ARTIFACT' AND input_id=v.video_render_id AND content_hash=v.content_hash)
   AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs WHERE artifact_id=a.artifact_id AND position=3 AND kind='INTERNAL_ARTIFACT' AND input_id=s.subtitle_id AND content_hash=s.document_hash)))
 ))
 THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='VIDEO_RENDER_SCOPE_MISMATCH'; END IF;
 IF NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM media.video_renders p WHERE p.video_render_id=NEW.supersedes_video_render_id
 AND p.pipeline_run_id=NEW.pipeline_run_id AND p.project_id=NEW.project_id AND p.project_version=NEW.project_version
 AND p.composition_plan_id=NEW.composition_plan_id AND p.output_aspect_ratio=NEW.output_aspect_ratio AND p.revision=NEW.revision-1)
 THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='VIDEO_RENDER_REVISION_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION media.reject_subtitle_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P1103',MESSAGE='IMMUTABLE_LOCAL_SUBTITLE_RECORD'; END $$;
CREATE TRIGGER immutable_local_alignments BEFORE UPDATE OR DELETE ON media.local_alignments FOR EACH ROW EXECUTE FUNCTION media.reject_subtitle_mutation();
CREATE TRIGGER immutable_local_subtitles BEFORE UPDATE OR DELETE ON media.local_subtitles FOR EACH ROW EXECUTE FUNCTION media.reject_subtitle_mutation();
CREATE TRIGGER immutable_render_burnins BEFORE UPDATE OR DELETE ON media.video_render_burnins FOR EACH ROW EXECUTE FUNCTION media.reject_subtitle_mutation();
`,
    },
  ];
export const MEDIA_SUBTITLE_POSTGRES_MIGRATION_REGISTRY = [
  ...MEDIA_RENDER_POSTGRES_MIGRATION_REGISTRY,
  ...MEDIA_SUBTITLE_POSTGRES_MIGRATIONS,
] as const;
