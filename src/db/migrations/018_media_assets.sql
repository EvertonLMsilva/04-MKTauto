CREATE TABLE media_assets (
  media_asset_id TEXT PRIMARY KEY REFERENCES artifact_lineage(artifact_id),
  schema_version TEXT NOT NULL,
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  script_id TEXT NOT NULL REFERENCES scripts(script_id),
  script_content_hash TEXT NOT NULL CHECK (length(script_content_hash) = 64 AND script_content_hash NOT GLOB '*[^0-9a-f]*'),
  visual_direction_position INTEGER NOT NULL CHECK (visual_direction_position > 0),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('IMAGE', 'VIDEO')),
  media_format TEXT NOT NULL,
  width_pixels INTEGER NOT NULL CHECK (width_pixels > 0 AND width_pixels <= 100000),
  height_pixels INTEGER NOT NULL CHECK (height_pixels > 0 AND height_pixels <= 100000),
  duration_milliseconds INTEGER,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  media_reference TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('OPERATOR_OWNED', 'AUTHORIZED_THIRD_PARTY', 'PROVIDER_GENERATED', 'PROVIDER_LICENSED')),
  provider TEXT,
  usage_basis TEXT NOT NULL CHECK (usage_basis IN ('OWNED', 'LICENSED', 'EXPLICIT_PERMISSION', 'PROVIDER_TERMS')),
  commercial_use_allowed INTEGER NOT NULL CHECK (commercial_use_allowed = 1),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_media_asset_id TEXT REFERENCES media_assets(media_asset_id),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  CHECK ((asset_type = 'IMAGE' AND media_format IN ('jpeg', 'png', 'webp') AND duration_milliseconds IS NULL)
    OR (asset_type = 'VIDEO' AND media_format IN ('mp4', 'webm', 'mov') AND duration_milliseconds > 0)),
  CHECK ((origin IN ('PROVIDER_GENERATED', 'PROVIDER_LICENSED') AND provider IS NOT NULL)
    OR (origin IN ('OPERATOR_OWNED', 'AUTHORIZED_THIRD_PARTY') AND provider IS NULL)),
  UNIQUE (script_id, visual_direction_position, asset_type, revision),
  UNIQUE (supersedes_media_asset_id),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version)
);

CREATE INDEX media_assets_run_order
  ON media_assets(pipeline_run_id, created_at, script_id, visual_direction_position, asset_type, revision, media_asset_id);
CREATE INDEX media_assets_script_order
  ON media_assets(script_id, visual_direction_position, asset_type, revision, media_asset_id);

CREATE TRIGGER media_assets_validate_scope
BEFORE INSERT ON media_assets
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN scripts s ON s.script_id = NEW.script_id
  JOIN artifact_lineage a ON a.artifact_id = NEW.media_asset_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND s.pipeline_run_id = NEW.pipeline_run_id
    AND s.project_id = NEW.project_id AND s.project_version = NEW.project_version
    AND s.content_hash = NEW.script_content_hash
    AND EXISTS (
      SELECT 1 FROM json_each(s.payload_json, '$.visualDirections') direction
      WHERE json_extract(direction.value, '$.position') = NEW.visual_direction_position
    )
    AND a.artifact_type = 'media_asset'
    AND a.pipeline_run_id = NEW.pipeline_run_id
    AND a.project_id = NEW.project_id AND a.project_version = NEW.project_version
    AND a.content_hash = NEW.content_hash
)
BEGIN
  SELECT RAISE(ABORT, 'MEDIA_ASSET_SCOPE_MISMATCH');
END;

CREATE TRIGGER media_assets_validate_revision
BEFORE INSERT ON media_assets
WHEN (NEW.revision = 1 AND NEW.supersedes_media_asset_id IS NOT NULL)
  OR (NEW.revision > 1 AND NOT EXISTS (
    SELECT 1 FROM media_assets previous
    WHERE previous.media_asset_id = NEW.supersedes_media_asset_id
      AND previous.script_id = NEW.script_id
      AND previous.pipeline_run_id = NEW.pipeline_run_id
      AND previous.project_id = NEW.project_id
      AND previous.project_version = NEW.project_version
      AND previous.visual_direction_position = NEW.visual_direction_position
      AND previous.asset_type = NEW.asset_type
      AND previous.revision = NEW.revision - 1
  ))
BEGIN
  SELECT RAISE(ABORT, 'MEDIA_ASSET_REVISION_MISMATCH');
END;

CREATE TRIGGER media_assets_no_update BEFORE UPDATE ON media_assets
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_MEDIA_ASSET'); END;
CREATE TRIGGER media_assets_no_delete BEFORE DELETE ON media_assets
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_MEDIA_ASSET'); END;
