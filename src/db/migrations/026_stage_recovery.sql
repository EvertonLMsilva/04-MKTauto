DROP TRIGGER IF EXISTS pipeline_runs_valid_state_update;

CREATE TRIGGER pipeline_runs_valid_state_update
BEFORE UPDATE ON pipeline_runs
WHEN (NEW.state IS NOT OLD.state OR NEW.completed_at IS NOT OLD.completed_at OR NEW.error_json IS NOT OLD.error_json)
  AND NOT (
    (OLD.state = 'RUNNING' AND NEW.state IN ('SUCCEEDED', 'FAILED') AND NEW.completed_at IS NOT NULL
      AND ((NEW.state = 'SUCCEEDED' AND NEW.error_json IS NULL) OR (NEW.state = 'FAILED' AND NEW.error_json IS NOT NULL)))
    OR (OLD.state = 'FAILED' AND NEW.state = 'RUNNING' AND NEW.completed_at IS NULL AND NEW.error_json IS NULL)
  )
BEGIN
  SELECT RAISE(ABORT, 'INVALID_PIPELINE_RUN_TRANSITION');
END;

CREATE TABLE IF NOT EXISTS pipeline_run_recoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  previous_state TEXT NOT NULL CHECK (previous_state = 'FAILED'),
  next_state TEXT NOT NULL CHECK (next_state = 'RUNNING'),
  changed_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS pipeline_run_recoveries_no_update
BEFORE UPDATE ON pipeline_run_recoveries
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_PIPELINE_RUN_RECOVERY'); END;

CREATE TRIGGER IF NOT EXISTS pipeline_run_recoveries_no_delete
BEFORE DELETE ON pipeline_run_recoveries
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_PIPELINE_RUN_RECOVERY'); END;

CREATE TABLE IF NOT EXISTS pipeline_stage_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  stage TEXT NOT NULL CHECK (stage IN ('RESEARCH','TREND_FORMAT_ANALYSIS','IDEA_GENERATION','IDEA_SELECTION','SCRIPT','VOICE','MEDIA','VISUAL_MOTION_PLAN','BACKGROUND_MUSIC','COMPOSITION','SUBTITLES','PREVIEW','QC')),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('INITIAL','AUTOMATIC','MANUAL')),
  state TEXT NOT NULL CHECK (state IN ('RUNNING','SUCCEEDED','FAILED')),
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  inputs_json TEXT NOT NULL CHECK (json_valid(inputs_json)),
  policy_versions_json TEXT NOT NULL CHECK (json_valid(policy_versions_json)),
  provider_config_hash TEXT CHECK (provider_config_hash IS NULL OR length(provider_config_hash) = 64),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failure_code TEXT,
  failure_field TEXT,
  retry_allowed INTEGER CHECK (retry_allowed IS NULL OR retry_allowed IN (0,1)),
  artifact_id TEXT,
  artifact_content_hash TEXT CHECK (artifact_content_hash IS NULL OR length(artifact_content_hash) = 64),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  UNIQUE (pipeline_run_id, stage, attempt),
  CHECK (
    (state = 'RUNNING' AND completed_at IS NULL AND failure_code IS NULL AND failure_field IS NULL AND retry_allowed IS NULL AND artifact_id IS NULL AND artifact_content_hash IS NULL AND result_json IS NULL)
    OR (state = 'SUCCEEDED' AND completed_at IS NOT NULL AND failure_code IS NULL AND failure_field IS NULL AND retry_allowed IS NULL AND artifact_id IS NOT NULL AND artifact_content_hash IS NOT NULL AND result_json IS NOT NULL)
    OR (state = 'FAILED' AND completed_at IS NOT NULL AND failure_code IS NOT NULL AND failure_field IS NOT NULL AND retry_allowed IS NOT NULL AND artifact_id IS NULL AND artifact_content_hash IS NULL AND result_json IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS pipeline_stage_attempts_identity ON pipeline_stage_attempts(pipeline_run_id, stage, identity_hash, state, attempt);
CREATE INDEX IF NOT EXISTS pipeline_stage_attempts_history ON pipeline_stage_attempts(pipeline_run_id, stage, attempt);

CREATE TRIGGER IF NOT EXISTS pipeline_stage_attempts_terminal_immutable
BEFORE UPDATE ON pipeline_stage_attempts
WHEN OLD.state != 'RUNNING'
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_STAGE_ATTEMPT'); END;

CREATE TRIGGER IF NOT EXISTS pipeline_stage_attempts_identity_immutable
BEFORE UPDATE ON pipeline_stage_attempts
WHEN NEW.pipeline_run_id IS NOT OLD.pipeline_run_id OR NEW.stage IS NOT OLD.stage
  OR NEW.attempt IS NOT OLD.attempt OR NEW.trigger_kind IS NOT OLD.trigger_kind
  OR NEW.identity_hash IS NOT OLD.identity_hash OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.inputs_json IS NOT OLD.inputs_json OR NEW.policy_versions_json IS NOT OLD.policy_versions_json
  OR NEW.provider_config_hash IS NOT OLD.provider_config_hash OR NEW.started_at IS NOT OLD.started_at
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_STAGE_ATTEMPT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS pipeline_stage_attempts_no_delete
BEFORE DELETE ON pipeline_stage_attempts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_STAGE_ATTEMPT'); END;
