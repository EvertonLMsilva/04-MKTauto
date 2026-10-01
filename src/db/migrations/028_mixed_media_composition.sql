CREATE TABLE IF NOT EXISTS composition_plan_v2_details (
  composition_plan_id TEXT PRIMARY KEY REFERENCES composition_plans(composition_plan_id),
  schema_version TEXT NOT NULL CHECK (schema_version = 'composition-plan/2.0.0'),
  production_profile TEXT NOT NULL CHECK (production_profile = 'MIXED_MEDIA_V2'),
  composition_policy_version TEXT NOT NULL CHECK (composition_policy_version = 'mixed-media-composition-policy/2.0.0'),
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE IF NOT EXISTS composition_plan_v2_segments (
  composition_plan_id TEXT NOT NULL REFERENCES composition_plan_v2_details(composition_plan_id),
  position INTEGER NOT NULL CHECK (position > 0),
  visual_direction_position INTEGER NOT NULL CHECK (visual_direction_position > 0),
  media_asset_id TEXT NOT NULL REFERENCES media_assets(media_asset_id),
  media_asset_content_hash TEXT NOT NULL CHECK (length(media_asset_content_hash) = 64 AND media_asset_content_hash NOT GLOB '*[^0-9a-f]*'),
  media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO')),
  start_milliseconds INTEGER NOT NULL CHECK (start_milliseconds >= 0),
  end_milliseconds INTEGER NOT NULL CHECK (end_milliseconds > start_milliseconds),
  source_start_milliseconds INTEGER NOT NULL CHECK (source_start_milliseconds >= 0),
  playback_mode TEXT NOT NULL CHECK (playback_mode IN ('TRIM', 'LOOP')),
  original_audio_muted INTEGER NOT NULL CHECK (original_audio_muted = 1),
  framing_strategy TEXT NOT NULL CHECK (framing_strategy = 'COVER_CROP_9_16'),
  transition_policy_version TEXT NOT NULL CHECK (transition_policy_version = 'composition-transition/1.0.0'),
  transition_type TEXT NOT NULL CHECK (transition_type = 'CUT'),
  transition_duration_milliseconds INTEGER NOT NULL CHECK (transition_duration_milliseconds = 0),
  PRIMARY KEY (composition_plan_id, position),
  UNIQUE (composition_plan_id, visual_direction_position),
  UNIQUE (composition_plan_id, media_asset_id)
);

CREATE TRIGGER IF NOT EXISTS composition_plan_v2_details_no_update BEFORE UPDATE ON composition_plan_v2_details
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_COMPOSITION_PLAN_V2'); END;
CREATE TRIGGER IF NOT EXISTS composition_plan_v2_details_no_delete BEFORE DELETE ON composition_plan_v2_details
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_COMPOSITION_PLAN_V2'); END;
CREATE TRIGGER IF NOT EXISTS composition_plan_v2_segments_no_update BEFORE UPDATE ON composition_plan_v2_segments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_COMPOSITION_PLAN_V2_SEGMENT'); END;
CREATE TRIGGER IF NOT EXISTS composition_plan_v2_segments_no_delete BEFORE DELETE ON composition_plan_v2_segments
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_COMPOSITION_PLAN_V2_SEGMENT'); END;
