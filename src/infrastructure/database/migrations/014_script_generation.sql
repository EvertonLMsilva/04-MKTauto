CREATE TABLE script_generation_requests (
  generation_request_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'script-generation-request/1.0.0'),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  script_id TEXT NOT NULL UNIQUE REFERENCES scripts(script_id),
  created_at TEXT NOT NULL
);

CREATE TRIGGER script_generation_requests_validate_script
BEFORE INSERT ON script_generation_requests
WHEN NEW.script_id <> 'script:' || NEW.generation_request_id OR NOT EXISTS (
  SELECT 1 FROM scripts
  WHERE script_id = NEW.script_id AND created_at = NEW.created_at
)
BEGIN SELECT RAISE(ABORT, 'SCRIPT_GENERATION_SCOPE_MISMATCH'); END;

CREATE TRIGGER script_generation_requests_no_update
BEFORE UPDATE ON script_generation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SCRIPT_GENERATION_REQUEST'); END;

CREATE TRIGGER script_generation_requests_no_delete
BEFORE DELETE ON script_generation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SCRIPT_GENERATION_REQUEST'); END;
