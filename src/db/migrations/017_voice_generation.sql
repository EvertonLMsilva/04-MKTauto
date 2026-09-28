CREATE TABLE voice_generation_requests (
  generation_request_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'voice-generation-request/1.0.0'),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  script_id TEXT NOT NULL REFERENCES scripts(script_id),
  script_content_hash TEXT NOT NULL CHECK (
    length(script_content_hash) = 64 AND script_content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  voice_track_id TEXT NOT NULL UNIQUE REFERENCES voice_tracks(voice_track_id),
  created_at TEXT NOT NULL
);

CREATE TRIGGER voice_generation_requests_validate_scope
BEFORE INSERT ON voice_generation_requests
WHEN NEW.voice_track_id <> 'voice_track:' || NEW.generation_request_id OR NOT EXISTS (
  SELECT 1 FROM voice_tracks
  WHERE voice_track_id = NEW.voice_track_id
    AND script_id = NEW.script_id
    AND script_content_hash = NEW.script_content_hash
    AND created_at = NEW.created_at
    AND revision = 1
    AND supersedes_voice_track_id IS NULL
)
BEGIN SELECT RAISE(ABORT, 'VOICE_GENERATION_SCOPE_MISMATCH'); END;

CREATE TRIGGER voice_generation_requests_no_update
BEFORE UPDATE ON voice_generation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VOICE_GENERATION_REQUEST'); END;

CREATE TRIGGER voice_generation_requests_no_delete
BEFORE DELETE ON voice_generation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VOICE_GENERATION_REQUEST'); END;
