CREATE TABLE video_composition_requests (
  video_composition_request_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'video-composition-request/1.0.0'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  composition_plan_id TEXT NOT NULL REFERENCES composition_plans(composition_plan_id),
  composition_plan_content_hash TEXT NOT NULL CHECK (length(composition_plan_content_hash) = 64 AND composition_plan_content_hash NOT GLOB '*[^0-9a-f]*'),
  container_format TEXT NOT NULL CHECK (container_format IN ('mp4', 'webm', 'mov')),
  width_pixels INTEGER NOT NULL CHECK (width_pixels > 0 AND width_pixels <= 100000),
  height_pixels INTEGER NOT NULL CHECK (height_pixels > 0 AND height_pixels <= 100000),
  video_render_id TEXT NOT NULL UNIQUE REFERENCES video_renders(video_render_id),
  created_at TEXT NOT NULL
);

CREATE TRIGGER video_composition_requests_validate_scope
BEFORE INSERT ON video_composition_requests
WHEN NEW.video_render_id <> ('video_render:' || NEW.video_composition_request_id) OR NOT EXISTS (
  SELECT 1 FROM video_renders r
  JOIN composition_plans p ON p.composition_plan_id = NEW.composition_plan_id
  WHERE r.video_render_id = NEW.video_render_id
    AND r.composition_plan_id = NEW.composition_plan_id
    AND r.composition_plan_content_hash = NEW.composition_plan_content_hash
    AND r.container_format = NEW.container_format
    AND r.width_pixels = NEW.width_pixels
    AND r.height_pixels = NEW.height_pixels
    AND r.created_at = NEW.created_at
    AND r.revision = 1
    AND r.supersedes_video_render_id IS NULL
    AND p.content_hash = NEW.composition_plan_content_hash
)
BEGIN SELECT RAISE(ABORT, 'VIDEO_COMPOSITION_SCOPE_MISMATCH'); END;

CREATE TRIGGER video_composition_requests_no_update
BEFORE UPDATE ON video_composition_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_COMPOSITION_REQUEST'); END;

CREATE TRIGGER video_composition_requests_no_delete
BEFORE DELETE ON video_composition_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_COMPOSITION_REQUEST'); END;
