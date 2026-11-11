CREATE TABLE media_acquisition_requests (
  media_acquisition_request_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'media-acquisition-request/1.0.0'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  script_id TEXT NOT NULL REFERENCES scripts(script_id),
  script_content_hash TEXT NOT NULL CHECK (length(script_content_hash) = 64 AND script_content_hash NOT GLOB '*[^0-9a-f]*'),
  visual_direction_position INTEGER NOT NULL CHECK (visual_direction_position > 0),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('IMAGE', 'VIDEO')),
  media_asset_id TEXT NOT NULL UNIQUE REFERENCES media_assets(media_asset_id),
  created_at TEXT NOT NULL
);

CREATE TRIGGER media_acquisition_requests_validate_scope
BEFORE INSERT ON media_acquisition_requests
WHEN NEW.media_asset_id <> 'media_asset:' || NEW.media_acquisition_request_id OR NOT EXISTS (
  SELECT 1 FROM media_assets
  WHERE media_asset_id = NEW.media_asset_id
    AND script_id = NEW.script_id
    AND script_content_hash = NEW.script_content_hash
    AND visual_direction_position = NEW.visual_direction_position
    AND asset_type = NEW.asset_type
    AND created_at = NEW.created_at
    AND revision = 1
    AND supersedes_media_asset_id IS NULL
)
BEGIN SELECT RAISE(ABORT, 'MEDIA_ACQUISITION_SCOPE_MISMATCH'); END;

CREATE TRIGGER media_acquisition_requests_no_update
BEFORE UPDATE ON media_acquisition_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_MEDIA_ACQUISITION_REQUEST'); END;

CREATE TRIGGER media_acquisition_requests_no_delete
BEFORE DELETE ON media_acquisition_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_MEDIA_ACQUISITION_REQUEST'); END;
