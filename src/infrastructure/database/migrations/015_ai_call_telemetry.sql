CREATE TABLE ai_call_telemetry (
  ai_call_id TEXT PRIMARY KEY,
  logical_call_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL CHECK (schema_version = 'ai-call-telemetry/1.0.0'),
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  artifact_id TEXT REFERENCES artifact_lineage(artifact_id),
  cost_event_id TEXT UNIQUE REFERENCES cost_events(cost_event_id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  task_type TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  usage_origin TEXT,
  cost_amount TEXT,
  currency TEXT,
  cost_origin TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  occurred_at TEXT NOT NULL,
  fallback INTEGER CHECK (fallback IS NULL OR fallback IN (0, 1)),
  input_hash TEXT CHECK (input_hash IS NULL OR (length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*')),
  output_hash TEXT CHECK (output_hash IS NULL OR (length(output_hash) = 64 AND output_hash NOT GLOB '*[^0-9a-f]*')),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
  failure_code TEXT,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version),
  CHECK ((cost_amount IS NULL AND currency IS NULL AND cost_origin IS NULL AND cost_event_id IS NULL)
    OR (cost_amount IS NOT NULL AND currency IS NOT NULL AND cost_origin IS NOT NULL AND cost_event_id IS NOT NULL)),
  CHECK ((input_tokens IS NULL AND output_tokens IS NULL AND cached_input_tokens IS NULL AND usage_origin IS NULL)
    OR (usage_origin IS NOT NULL AND (input_tokens IS NOT NULL OR output_tokens IS NOT NULL OR cached_input_tokens IS NOT NULL))),
  CHECK ((outcome = 'SUCCESS' AND artifact_id IS NOT NULL AND failure_code IS NULL)
    OR (outcome = 'FAILURE' AND artifact_id IS NULL AND failure_code IS NOT NULL))
);

CREATE INDEX ai_call_telemetry_pipeline_order
  ON ai_call_telemetry(pipeline_run_id, occurred_at, ai_call_id);

CREATE TRIGGER ai_call_telemetry_validate_scope
BEFORE INSERT ON ai_call_telemetry
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs WHERE pipeline_run_id = NEW.pipeline_run_id
    AND project_id = NEW.project_id AND project_version = NEW.project_version
) OR (NEW.artifact_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM artifact_lineage WHERE artifact_id = NEW.artifact_id
    AND pipeline_run_id = NEW.pipeline_run_id AND project_id = NEW.project_id
    AND project_version = NEW.project_version
)) OR (NEW.cost_event_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM cost_events WHERE cost_event_id = NEW.cost_event_id
    AND pipeline_run_id = NEW.pipeline_run_id AND project_id = NEW.project_id
    AND project_version = NEW.project_version AND amount = NEW.cost_amount
    AND currency = NEW.currency AND artifact_id IS NEW.artifact_id
))
BEGIN SELECT RAISE(ABORT, 'AI_CALL_TELEMETRY_SCOPE_MISMATCH'); END;

CREATE TRIGGER ai_call_telemetry_no_update
BEFORE UPDATE ON ai_call_telemetry
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AI_CALL_TELEMETRY'); END;

CREATE TRIGGER ai_call_telemetry_no_delete
BEFORE DELETE ON ai_call_telemetry
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AI_CALL_TELEMETRY'); END;
