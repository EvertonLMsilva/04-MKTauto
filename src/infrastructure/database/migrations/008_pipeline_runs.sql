CREATE TABLE pipeline_runs (
  pipeline_run_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  project_snapshot_json TEXT NOT NULL CHECK (json_valid(project_snapshot_json)),
  state TEXT NOT NULL CHECK (state IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version),
  CHECK (
    (state = 'RUNNING' AND completed_at IS NULL AND error_json IS NULL)
    OR (state = 'SUCCEEDED' AND completed_at IS NOT NULL AND error_json IS NULL)
    OR (state = 'FAILED' AND completed_at IS NOT NULL AND error_json IS NOT NULL)
  )
);

CREATE INDEX pipeline_runs_project_scope
  ON pipeline_runs(project_id, project_version, started_at);

CREATE TABLE pipeline_run_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  previous_state TEXT CHECK (previous_state IS NULL OR previous_state IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  next_state TEXT NOT NULL CHECK (next_state IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  changed_at TEXT NOT NULL,
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  CHECK (
    (previous_state IS NULL AND next_state = 'RUNNING' AND error_json IS NULL)
    OR (previous_state = 'RUNNING' AND next_state = 'SUCCEEDED' AND error_json IS NULL)
    OR (previous_state = 'RUNNING' AND next_state = 'FAILED' AND error_json IS NOT NULL)
  )
);

CREATE TRIGGER pipeline_runs_no_identity_update
BEFORE UPDATE ON pipeline_runs
WHEN NEW.pipeline_run_id IS NOT OLD.pipeline_run_id
  OR NEW.schema_version IS NOT OLD.schema_version
  OR NEW.identity_hash IS NOT OLD.identity_hash
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.project_version IS NOT OLD.project_version
  OR NEW.project_snapshot_json IS NOT OLD.project_snapshot_json
  OR NEW.started_at IS NOT OLD.started_at
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PIPELINE_RUN_IDENTITY');
END;

CREATE TRIGGER pipeline_runs_valid_state_update
BEFORE UPDATE ON pipeline_runs
WHEN (NEW.state IS NOT OLD.state
    OR NEW.completed_at IS NOT OLD.completed_at
    OR NEW.error_json IS NOT OLD.error_json)
  AND (OLD.state != 'RUNNING'
    OR NEW.state NOT IN ('SUCCEEDED', 'FAILED')
    OR NEW.completed_at IS NULL
    OR (NEW.state = 'SUCCEEDED' AND NEW.error_json IS NOT NULL)
    OR (NEW.state = 'FAILED' AND NEW.error_json IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PIPELINE_RUN_TRANSITION');
END;

CREATE TRIGGER pipeline_runs_no_delete
BEFORE DELETE ON pipeline_runs
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PIPELINE_RUN');
END;

CREATE TRIGGER pipeline_run_transitions_no_update
BEFORE UPDATE ON pipeline_run_transitions
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PIPELINE_RUN_TRANSITION');
END;

CREATE TRIGGER pipeline_run_transitions_no_delete
BEFORE DELETE ON pipeline_run_transitions
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PIPELINE_RUN_TRANSITION');
END;
