CREATE TABLE IF NOT EXISTS media_asset_sources (
  media_asset_id TEXT PRIMARY KEY REFERENCES media_assets(media_asset_id),
  provider TEXT NOT NULL,
  external_asset_id TEXT NOT NULL,
  license_name TEXT NOT NULL,
  license_url TEXT NOT NULL,
  photographer_name TEXT NOT NULL,
  photographer_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  CHECK (length(provider) BETWEEN 1 AND 100),
  CHECK (length(external_asset_id) BETWEEN 1 AND 100),
  CHECK (length(license_name) BETWEEN 1 AND 100),
  CHECK (license_url LIKE 'https://%'),
  CHECK (photographer_url LIKE 'https://%'),
  CHECK (source_url LIKE 'https://%')
);

CREATE TABLE IF NOT EXISTS media_selection_requests (
  media_selection_request_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'media-selection-request/1.0.0'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  script_id TEXT NOT NULL REFERENCES scripts(script_id),
  script_content_hash TEXT NOT NULL CHECK (length(script_content_hash) = 64 AND script_content_hash NOT GLOB '*[^0-9a-f]*'),
  visual_direction_position INTEGER NOT NULL CHECK (visual_direction_position > 0),
  production_profile TEXT NOT NULL CHECK (production_profile IN ('STATIC_IMAGE_V1', 'MIXED_MEDIA_V2')),
  requested_asset_type TEXT NOT NULL CHECK (requested_asset_type IN ('IMAGE', 'VIDEO')),
  selected_asset_type TEXT NOT NULL CHECK (selected_asset_type IN ('IMAGE', 'VIDEO')),
  media_asset_id TEXT NOT NULL UNIQUE REFERENCES media_assets(media_asset_id),
  fallback_code TEXT,
  created_at TEXT NOT NULL,
  CHECK ((requested_asset_type = selected_asset_type AND fallback_code IS NULL)
    OR (production_profile = 'MIXED_MEDIA_V2' AND requested_asset_type = 'VIDEO'
      AND selected_asset_type = 'IMAGE' AND fallback_code IS NOT NULL))
);

CREATE TRIGGER IF NOT EXISTS media_asset_sources_no_update BEFORE UPDATE ON media_asset_sources
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_MEDIA_ASSET_SOURCE'); END;
CREATE TRIGGER IF NOT EXISTS media_asset_sources_no_delete BEFORE DELETE ON media_asset_sources
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_MEDIA_ASSET_SOURCE'); END;
CREATE TRIGGER IF NOT EXISTS media_selection_requests_no_update BEFORE UPDATE ON media_selection_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_MEDIA_SELECTION'); END;
CREATE TRIGGER IF NOT EXISTS media_selection_requests_no_delete BEFORE DELETE ON media_selection_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_MEDIA_SELECTION'); END;
