CREATE TABLE video_renders (
  video_render_id TEXT PRIMARY KEY REFERENCES artifact_lineage(artifact_id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'video-render/1.0.0'),
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  composition_plan_id TEXT NOT NULL REFERENCES composition_plans(composition_plan_id),
  composition_plan_content_hash TEXT NOT NULL CHECK (length(composition_plan_content_hash) = 64 AND composition_plan_content_hash NOT GLOB '*[^0-9a-f]*'),
  output_aspect_ratio TEXT NOT NULL CHECK (output_aspect_ratio IN ('9:16', '1:1', '16:9')),
  duration_milliseconds INTEGER NOT NULL CHECK (duration_milliseconds > 0 AND duration_milliseconds <= 86400000),
  container_format TEXT NOT NULL CHECK (container_format IN ('mp4', 'webm', 'mov')),
  width_pixels INTEGER NOT NULL CHECK (width_pixels > 0 AND width_pixels <= 100000),
  height_pixels INTEGER NOT NULL CHECK (height_pixels > 0 AND height_pixels <= 100000),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  logical_reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_video_render_id TEXT REFERENCES video_renders(video_render_id),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (composition_plan_id, revision),
  UNIQUE (supersedes_video_render_id),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version),
  CHECK ((output_aspect_ratio = '9:16' AND width_pixels * 16 = height_pixels * 9)
    OR (output_aspect_ratio = '1:1' AND width_pixels = height_pixels)
    OR (output_aspect_ratio = '16:9' AND width_pixels * 9 = height_pixels * 16))
);

CREATE INDEX video_renders_run_order
  ON video_renders(pipeline_run_id, created_at, composition_plan_id, revision, video_render_id);
CREATE INDEX video_renders_plan_order
  ON video_renders(composition_plan_id, revision, video_render_id);

CREATE TRIGGER video_renders_validate_scope
BEFORE INSERT ON video_renders
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN composition_plans p ON p.composition_plan_id = NEW.composition_plan_id
  JOIN artifact_lineage a ON a.artifact_id = NEW.video_render_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND json_extract(r.project_snapshot_json, '$.channel.aspectRatio') = NEW.output_aspect_ratio
    AND p.pipeline_run_id = NEW.pipeline_run_id
    AND p.project_id = NEW.project_id AND p.project_version = NEW.project_version
    AND p.content_hash = NEW.composition_plan_content_hash
    AND p.output_aspect_ratio = NEW.output_aspect_ratio
    AND p.duration_milliseconds = NEW.duration_milliseconds
    AND a.artifact_type = 'video_render'
    AND a.pipeline_run_id = NEW.pipeline_run_id
    AND a.project_id = NEW.project_id AND a.project_version = NEW.project_version
    AND a.content_hash = NEW.content_hash
)
BEGIN SELECT RAISE(ABORT, 'VIDEO_RENDER_SCOPE_MISMATCH'); END;

CREATE TRIGGER video_renders_validate_revision
BEFORE INSERT ON video_renders
WHEN (NEW.revision = 1 AND NEW.supersedes_video_render_id IS NOT NULL)
  OR (NEW.revision > 1 AND NOT EXISTS (
    SELECT 1 FROM video_renders previous
    WHERE previous.video_render_id = NEW.supersedes_video_render_id
      AND previous.pipeline_run_id = NEW.pipeline_run_id
      AND previous.project_id = NEW.project_id
      AND previous.project_version = NEW.project_version
      AND previous.composition_plan_id = NEW.composition_plan_id
      AND previous.output_aspect_ratio = NEW.output_aspect_ratio
      AND previous.revision = NEW.revision - 1
  ))
BEGIN SELECT RAISE(ABORT, 'VIDEO_RENDER_REVISION_MISMATCH'); END;

CREATE TRIGGER video_renders_no_update BEFORE UPDATE ON video_renders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_RENDER'); END;
CREATE TRIGGER video_renders_no_delete BEFORE DELETE ON video_renders
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_RENDER'); END;
