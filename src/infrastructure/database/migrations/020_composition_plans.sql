CREATE TABLE composition_plans (
  composition_plan_id TEXT PRIMARY KEY REFERENCES artifact_lineage(artifact_id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'composition-plan/1.0.0'),
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  script_id TEXT NOT NULL REFERENCES scripts(script_id),
  script_content_hash TEXT NOT NULL CHECK (length(script_content_hash) = 64 AND script_content_hash NOT GLOB '*[^0-9a-f]*'),
  voice_track_id TEXT NOT NULL REFERENCES voice_tracks(voice_track_id),
  voice_track_content_hash TEXT NOT NULL CHECK (length(voice_track_content_hash) = 64 AND voice_track_content_hash NOT GLOB '*[^0-9a-f]*'),
  output_aspect_ratio TEXT NOT NULL CHECK (output_aspect_ratio IN ('9:16', '1:1', '16:9')),
  timeline_unit TEXT NOT NULL CHECK (timeline_unit = 'MILLISECOND'),
  continuity_mode TEXT NOT NULL CHECK (continuity_mode = 'CONTIGUOUS'),
  duration_milliseconds INTEGER NOT NULL CHECK (duration_milliseconds > 0 AND duration_milliseconds <= 86400000),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_composition_plan_id TEXT REFERENCES composition_plans(composition_plan_id),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (script_id, revision),
  UNIQUE (supersedes_composition_plan_id),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version)
);

CREATE TABLE composition_plan_segments (
  composition_plan_id TEXT NOT NULL REFERENCES composition_plans(composition_plan_id),
  position INTEGER NOT NULL CHECK (position > 0),
  visual_direction_position INTEGER NOT NULL CHECK (visual_direction_position > 0),
  media_asset_id TEXT NOT NULL REFERENCES media_assets(media_asset_id),
  media_asset_content_hash TEXT NOT NULL CHECK (length(media_asset_content_hash) = 64 AND media_asset_content_hash NOT GLOB '*[^0-9a-f]*'),
  start_milliseconds INTEGER NOT NULL CHECK (start_milliseconds >= 0),
  end_milliseconds INTEGER NOT NULL CHECK (end_milliseconds > start_milliseconds),
  PRIMARY KEY (composition_plan_id, position),
  UNIQUE (composition_plan_id, visual_direction_position),
  UNIQUE (composition_plan_id, media_asset_id)
);

CREATE INDEX composition_plans_run_order
  ON composition_plans(pipeline_run_id, created_at, script_id, revision, composition_plan_id);
CREATE INDEX composition_plans_script_order
  ON composition_plans(script_id, revision, composition_plan_id);

CREATE TRIGGER composition_plans_validate_scope
BEFORE INSERT ON composition_plans
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN scripts s ON s.script_id = NEW.script_id
  JOIN voice_tracks v ON v.voice_track_id = NEW.voice_track_id
  JOIN artifact_lineage a ON a.artifact_id = NEW.composition_plan_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND json_extract(r.project_snapshot_json, '$.channel.aspectRatio') = NEW.output_aspect_ratio
    AND s.pipeline_run_id = NEW.pipeline_run_id
    AND s.project_id = NEW.project_id AND s.project_version = NEW.project_version
    AND s.content_hash = NEW.script_content_hash
    AND v.pipeline_run_id = NEW.pipeline_run_id
    AND v.project_id = NEW.project_id AND v.project_version = NEW.project_version
    AND v.script_id = NEW.script_id AND v.script_content_hash = NEW.script_content_hash
    AND v.content_hash = NEW.voice_track_content_hash
    AND v.duration_milliseconds = NEW.duration_milliseconds
    AND v.commercial_use_allowed = 1
    AND a.artifact_type = 'composition_plan'
    AND a.pipeline_run_id = NEW.pipeline_run_id
    AND a.project_id = NEW.project_id AND a.project_version = NEW.project_version
    AND a.content_hash = NEW.content_hash
)
BEGIN SELECT RAISE(ABORT, 'COMPOSITION_PLAN_SCOPE_MISMATCH'); END;

CREATE TRIGGER composition_plans_validate_revision
BEFORE INSERT ON composition_plans
WHEN (NEW.revision = 1 AND NEW.supersedes_composition_plan_id IS NOT NULL)
  OR (NEW.revision > 1 AND NOT EXISTS (
    SELECT 1 FROM composition_plans previous
    WHERE previous.composition_plan_id = NEW.supersedes_composition_plan_id
      AND previous.pipeline_run_id = NEW.pipeline_run_id
      AND previous.project_id = NEW.project_id
      AND previous.project_version = NEW.project_version
      AND previous.script_id = NEW.script_id
      AND previous.output_aspect_ratio = NEW.output_aspect_ratio
      AND previous.revision = NEW.revision - 1
  ))
BEGIN SELECT RAISE(ABORT, 'COMPOSITION_PLAN_REVISION_MISMATCH'); END;

CREATE TRIGGER composition_plan_segments_validate_scope
BEFORE INSERT ON composition_plan_segments
WHEN NOT EXISTS (
  SELECT 1 FROM composition_plans p
  JOIN media_assets m ON m.media_asset_id = NEW.media_asset_id
  WHERE p.composition_plan_id = NEW.composition_plan_id
    AND m.pipeline_run_id = p.pipeline_run_id
    AND m.project_id = p.project_id AND m.project_version = p.project_version
    AND m.script_id = p.script_id AND m.script_content_hash = p.script_content_hash
    AND m.visual_direction_position = NEW.visual_direction_position
    AND m.content_hash = NEW.media_asset_content_hash
    AND m.commercial_use_allowed = 1
    AND (m.asset_type = 'IMAGE' OR m.duration_milliseconds >= NEW.end_milliseconds - NEW.start_milliseconds)
)
BEGIN SELECT RAISE(ABORT, 'COMPOSITION_SEGMENT_SCOPE_MISMATCH'); END;

CREATE TRIGGER composition_plans_no_update BEFORE UPDATE ON composition_plans
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_COMPOSITION_PLAN'); END;
CREATE TRIGGER composition_plans_no_delete BEFORE DELETE ON composition_plans
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_COMPOSITION_PLAN'); END;
CREATE TRIGGER composition_plan_segments_no_update BEFORE UPDATE ON composition_plan_segments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_COMPOSITION_PLAN_SEGMENT'); END;
CREATE TRIGGER composition_plan_segments_no_delete BEFORE DELETE ON composition_plan_segments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_COMPOSITION_PLAN_SEGMENT'); END;
