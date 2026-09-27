CREATE TABLE project_commands (
  idempotency_key TEXT PRIMARY KEY,
  command_type TEXT NOT NULL CHECK (command_type IN ('CREATE_PROJECT', 'CREATE_PROJECT_VERSION', 'ARCHIVE_PROJECT')),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version >= 1),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version)
);

CREATE TRIGGER project_commands_no_update
BEFORE UPDATE ON project_commands
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PROJECT_COMMAND');
END;

CREATE TRIGGER project_commands_no_delete
BEFORE DELETE ON project_commands
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PROJECT_COMMAND');
END;
