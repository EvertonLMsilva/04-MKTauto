import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';
import { MEDIA_VOICE_POSTGRES_MIGRATION_REGISTRY } from './postgres-media-voice.migrations.js';
export const MEDIA_COMPOSITION_POSTGRES_MIGRATIONS: readonly PostgresMigration[] =
  [
    {
      version: 9,
      name: '009_media_composition_plans',
      sql: `
CREATE TABLE media.composition_plans (
 composition_plan_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id),
 schema_version TEXT NOT NULL CHECK(schema_version IN ('composition-plan/1.0.0','composition-plan/2.0.0')), identity_hash media.sha256 NOT NULL,
 pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id),
 project_id TEXT COLLATE pg_catalog."C" NOT NULL, project_version media.safe_positive NOT NULL,
 script_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.scripts(script_id),script_content_hash media.sha256 NOT NULL,
 voice_track_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES media.voice_tracks(voice_track_id),voice_track_content_hash media.sha256 NOT NULL,
 output_aspect_ratio TEXT NOT NULL CHECK(output_aspect_ratio IN ('9:16','1:1','16:9')),
 timeline_unit TEXT NOT NULL CHECK(timeline_unit='MILLISECOND'),continuity_mode TEXT NOT NULL CHECK(continuity_mode='CONTIGUOUS'),
 duration_milliseconds INTEGER NOT NULL CHECK(duration_milliseconds BETWEEN 1 AND 86400000),content_hash media.sha256 NOT NULL,
 created_at TEXT COLLATE pg_catalog."C" NOT NULL,revision media.safe_positive NOT NULL,
 supersedes_composition_plan_id TEXT COLLATE pg_catalog."C" UNIQUE REFERENCES media.composition_plans(composition_plan_id),
 production_profile TEXT,composition_policy_version TEXT,payload_json JSON NOT NULL,
 UNIQUE(script_id,revision),FOREIGN KEY(project_id,project_version) REFERENCES project.project_snapshots(project_id,version),
 CHECK((revision=1 AND supersedes_composition_plan_id IS NULL) OR (revision>1 AND supersedes_composition_plan_id IS NOT NULL)),
 CHECK((schema_version='composition-plan/1.0.0' AND production_profile IS NULL AND composition_policy_version IS NULL)
 OR (schema_version='composition-plan/2.0.0' AND production_profile IS NOT NULL AND production_profile='MIXED_MEDIA_V2'
 AND composition_policy_version IS NOT NULL AND composition_policy_version='mixed-media-composition-policy/2.0.0'))
);
CREATE TABLE media.composition_plan_segments (
 composition_plan_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES media.composition_plans(composition_plan_id),
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 300),visual_direction_position media.safe_positive NOT NULL,
 media_asset_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES media.media_assets(media_asset_id),media_asset_content_hash media.sha256 NOT NULL,
 start_milliseconds INTEGER NOT NULL CHECK(start_milliseconds>=0),end_milliseconds INTEGER NOT NULL CHECK(end_milliseconds>start_milliseconds AND end_milliseconds<=86400000),
 media_type TEXT,source_start_milliseconds BIGINT CHECK(source_start_milliseconds BETWEEN 0 AND 9007199254740991),
 playback_mode TEXT,original_audio_muted SMALLINT,framing_strategy TEXT,transition_policy_version TEXT,transition_type TEXT,
 transition_duration_milliseconds INTEGER,movement_requirement TEXT,
 PRIMARY KEY(composition_plan_id,position),UNIQUE(composition_plan_id,visual_direction_position),UNIQUE(composition_plan_id,media_asset_id)
);
CREATE INDEX composition_plans_run_order ON media.composition_plans(pipeline_run_id,created_at,script_id,revision,composition_plan_id);
CREATE INDEX composition_plans_script_order ON media.composition_plans(script_id,revision,composition_plan_id);
CREATE FUNCTION media.validate_composition_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM campaign.pipeline_runs r JOIN content.scripts s ON s.script_id=NEW.script_id
 JOIN media.voice_tracks v ON v.voice_track_id=NEW.voice_track_id JOIN content.artifact_lineage a ON a.artifact_id=NEW.composition_plan_id
 WHERE r.pipeline_run_id=NEW.pipeline_run_id AND r.project_id=NEW.project_id AND r.project_version=NEW.project_version
 AND r.project_snapshot_json->'channel'->>'aspectRatio'=NEW.output_aspect_ratio
 AND (NEW.schema_version='composition-plan/1.0.0' OR r.project_snapshot_json->'channel'->>'productionProfile'='MIXED_MEDIA_V2')
 AND s.pipeline_run_id=NEW.pipeline_run_id AND s.project_id=NEW.project_id AND s.project_version=NEW.project_version AND s.content_hash=NEW.script_content_hash
 AND v.pipeline_run_id=NEW.pipeline_run_id AND v.project_id=NEW.project_id AND v.project_version=NEW.project_version
 AND v.script_id=NEW.script_id AND v.script_content_hash=NEW.script_content_hash AND v.content_hash=NEW.voice_track_content_hash
 AND v.duration_milliseconds=NEW.duration_milliseconds AND v.commercial_use_allowed=1
 AND a.artifact_type='composition_plan' AND a.artifact_version=NEW.revision AND a.pipeline_run_id=NEW.pipeline_run_id
 AND a.project_id=NEW.project_id AND a.project_version=NEW.project_version AND a.content_hash=NEW.content_hash
 AND a.content_identity='composition-plan:' || NEW.script_id AND a.created_at=NEW.created_at
 AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs i WHERE i.artifact_id=a.artifact_id AND i.position=1 AND i.kind='INTERNAL_ARTIFACT' AND i.input_id=NEW.script_id AND i.content_hash=NEW.script_content_hash)
 AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs i WHERE i.artifact_id=a.artifact_id AND i.position=2 AND i.kind='INTERNAL_ARTIFACT' AND i.input_id=NEW.voice_track_id AND i.content_hash=NEW.voice_track_content_hash))
 THEN RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='COMPOSITION_PLAN_SCOPE_MISMATCH'; END IF;
 IF NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM media.composition_plans p WHERE p.composition_plan_id=NEW.supersedes_composition_plan_id
 AND p.pipeline_run_id=NEW.pipeline_run_id AND p.project_id=NEW.project_id AND p.project_version=NEW.project_version AND p.script_id=NEW.script_id
 AND p.output_aspect_ratio=NEW.output_aspect_ratio AND p.timeline_unit=NEW.timeline_unit AND p.continuity_mode=NEW.continuity_mode AND p.revision=NEW.revision-1)
 THEN RAISE EXCEPTION USING ERRCODE='P9002',MESSAGE='COMPOSITION_PLAN_REVISION_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_composition_scope BEFORE INSERT ON media.composition_plans FOR EACH ROW EXECUTE FUNCTION media.validate_composition_scope();
CREATE FUNCTION media.validate_composition_segment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p RECORD; m RECORD; d BIGINT;
BEGIN
 SELECT * INTO p FROM media.composition_plans WHERE composition_plan_id=NEW.composition_plan_id;
 SELECT * INTO m FROM media.media_assets WHERE media_asset_id=NEW.media_asset_id;
 IF p.composition_plan_id IS NULL OR m.media_asset_id IS NULL OR m.pipeline_run_id<>p.pipeline_run_id OR m.project_id<>p.project_id
 OR m.project_version<>p.project_version OR m.visual_direction_position<>NEW.visual_direction_position OR m.content_hash<>NEW.media_asset_content_hash OR m.commercial_use_allowed<>1
 THEN RAISE EXCEPTION USING ERRCODE='P9003',MESSAGE='COMPOSITION_SEGMENT_SCOPE_MISMATCH'; END IF;
 d=NEW.end_milliseconds-NEW.start_milliseconds;
 IF p.schema_version='composition-plan/1.0.0' THEN
   IF m.script_id<>p.script_id OR m.script_content_hash<>p.script_content_hash OR NEW.media_type IS NOT NULL OR NEW.source_start_milliseconds IS NOT NULL OR NEW.playback_mode IS NOT NULL OR NEW.original_audio_muted IS NOT NULL
   OR NEW.framing_strategy IS NOT NULL OR NEW.transition_policy_version IS NOT NULL OR NEW.transition_type IS NOT NULL OR NEW.transition_duration_milliseconds IS NOT NULL
   OR NEW.movement_requirement IS NOT NULL OR (m.asset_type='VIDEO' AND m.duration_milliseconds<d)
   THEN RAISE EXCEPTION USING ERRCODE='P9003',MESSAGE='COMPOSITION_SEGMENT_VARIANT_MISMATCH'; END IF;
 ELSE
   IF NEW.media_type IS NULL OR NEW.media_type<>m.asset_type OR NEW.source_start_milliseconds IS NULL
   OR NEW.playback_mode IS NULL OR NEW.playback_mode NOT IN ('TRIM','LOOP') OR NEW.original_audio_muted IS NULL OR NEW.original_audio_muted<>1
   OR NEW.framing_strategy IS NULL OR NEW.framing_strategy NOT IN ('COVER_CROP_9_16','CONTAIN_9_16')
   OR NEW.transition_policy_version IS NULL OR NEW.transition_policy_version<>'composition-transition/1.0.0'
   OR NEW.transition_type IS NULL OR NEW.transition_type<>'CUT' OR NEW.transition_duration_milliseconds IS NULL OR NEW.transition_duration_milliseconds<>0
   OR (NEW.movement_requirement IS NOT NULL AND (NEW.movement_requirement NOT IN ('REAL_MOTION_REQUIRED','STATIC_ALLOWED') OR (NEW.movement_requirement='REAL_MOTION_REQUIRED' AND NEW.media_type<>'VIDEO')))
   OR (m.asset_type='IMAGE' AND (NEW.source_start_milliseconds<>0 OR NEW.playback_mode<>'TRIM'))
   OR (m.asset_type='VIDEO' AND (NEW.source_start_milliseconds>=m.duration_milliseconds OR (NEW.playback_mode='TRIM' AND NEW.source_start_milliseconds+d>m.duration_milliseconds)))
   THEN RAISE EXCEPTION USING ERRCODE='P9003',MESSAGE='COMPOSITION_SEGMENT_VARIANT_MISMATCH'; END IF;
   IF m.asset_type='VIDEO' AND (m.origin='PROVIDER_GENERATED' OR NEW.movement_requirement='REAL_MOTION_REQUIRED')
   THEN RAISE EXCEPTION USING ERRCODE='P9006',MESSAGE='MEDIA_COMPOSITION_TEMPORAL_QC_DEPENDENCY_REQUIRED'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_composition_segment BEFORE INSERT ON media.composition_plan_segments FOR EACH ROW EXECUTE FUNCTION media.validate_composition_segment();
CREATE FUNCTION media.require_composition_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
 SELECT count(*) INTO n FROM media.composition_plan_segments WHERE composition_plan_id=NEW.composition_plan_id;
 IF n=0 OR n<>pg_catalog.json_array_length(NEW.payload_json->'segments')
 OR (SELECT max(position) FROM media.composition_plan_segments WHERE composition_plan_id=NEW.composition_plan_id)<>n
 OR NOT EXISTS(SELECT 1 FROM media.composition_plan_segments WHERE composition_plan_id=NEW.composition_plan_id AND position=1 AND start_milliseconds=0)
 OR NOT EXISTS(SELECT 1 FROM media.composition_plan_segments WHERE composition_plan_id=NEW.composition_plan_id AND position=n AND end_milliseconds=NEW.duration_milliseconds)
 OR EXISTS(SELECT 1 FROM media.composition_plan_segments s JOIN media.composition_plan_segments p ON p.composition_plan_id=s.composition_plan_id AND p.position=s.position-1 WHERE s.composition_plan_id=NEW.composition_plan_id AND s.start_milliseconds<>p.end_milliseconds)
 OR (SELECT count(*) FROM content.artifact_lineage_inputs WHERE artifact_id=NEW.composition_plan_id)<>n+2
 OR EXISTS(SELECT 1 FROM media.composition_plan_segments s WHERE s.composition_plan_id=NEW.composition_plan_id AND NOT EXISTS(SELECT 1 FROM content.artifact_lineage_inputs i WHERE i.artifact_id=s.composition_plan_id AND i.position=s.position+2 AND i.kind='INTERNAL_ARTIFACT' AND i.input_id=s.media_asset_id AND i.content_hash=s.media_asset_content_hash))
 OR EXISTS(SELECT 1 FROM pg_catalog.json_array_elements((SELECT payload_json->'visualDirections' FROM content.scripts WHERE script_id=NEW.script_id)) WITH ORDINALITY d(value,ordinality)
 WHERE NOT EXISTS(SELECT 1 FROM media.composition_plan_segments s WHERE s.composition_plan_id=NEW.composition_plan_id AND s.position=d.ordinality AND s.visual_direction_position=(d.value->>'position')::bigint))
 OR n<>(SELECT pg_catalog.json_array_length(payload_json->'visualDirections') FROM content.scripts WHERE script_id=NEW.script_id)
 THEN RAISE EXCEPTION USING ERRCODE='P9004',MESSAGE='INCOMPLETE_COMPOSITION_PLAN'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER composition_complete AFTER INSERT ON media.composition_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media.require_composition_complete();
CREATE FUNCTION media.require_composition_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM media.composition_plans WHERE composition_plan_id=NEW.artifact_id)
THEN RAISE EXCEPTION USING ERRCODE='P9004',MESSAGE='ORPHAN_COMPOSITION_LINEAGE'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER media_composition_lineage_owner AFTER INSERT ON content.artifact_lineage DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.artifact_type='composition_plan') EXECUTE FUNCTION media.require_composition_owner();
CREATE FUNCTION media.reject_composition_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P9005',MESSAGE='IMMUTABLE_COMPOSITION_PLAN'; END $$;
CREATE TRIGGER immutable_composition_plans BEFORE UPDATE OR DELETE ON media.composition_plans FOR EACH ROW EXECUTE FUNCTION media.reject_composition_mutation();
CREATE TRIGGER immutable_composition_segments BEFORE UPDATE OR DELETE ON media.composition_plan_segments FOR EACH ROW EXECUTE FUNCTION media.reject_composition_mutation();
`,
    },
  ];
export const MEDIA_COMPOSITION_POSTGRES_MIGRATION_REGISTRY = [
  ...MEDIA_VOICE_POSTGRES_MIGRATION_REGISTRY,
  ...MEDIA_COMPOSITION_POSTGRES_MIGRATIONS,
] as const;
