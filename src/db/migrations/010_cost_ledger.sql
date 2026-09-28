CREATE TABLE cost_events (
  cost_event_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  identity_hash TEXT NOT NULL CHECK (
    length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
  ),
  category TEXT NOT NULL CHECK (category IN (
    'production_cost', 'ai_cost', 'media_cost', 'voice_cost', 'publishing_cost'
  )),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  content_identity TEXT,
  artifact_id TEXT REFERENCES artifact_lineage(artifact_id),
  amount TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (
    length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'
  ),
  occurred_at TEXT NOT NULL,
  origin TEXT NOT NULL,
  attribution_rule_version TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (project_id, project_version)
    REFERENCES project_snapshots(project_id, version)
);

CREATE INDEX cost_events_pipeline_order
  ON cost_events(pipeline_run_id, occurred_at, cost_event_id);

CREATE TRIGGER cost_events_validate_run_scope
BEFORE INSERT ON cost_events
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs
  WHERE pipeline_run_id = NEW.pipeline_run_id
    AND project_id = NEW.project_id
    AND project_version = NEW.project_version
)
BEGIN
  SELECT RAISE(ABORT, 'COST_EVENT_RUN_SCOPE_MISMATCH');
END;

CREATE TRIGGER cost_events_validate_artifact_scope
BEFORE INSERT ON cost_events
WHEN NEW.artifact_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM artifact_lineage
  WHERE artifact_id = NEW.artifact_id
    AND pipeline_run_id = NEW.pipeline_run_id
    AND project_id = NEW.project_id
    AND project_version = NEW.project_version
    AND (NEW.content_identity IS NULL OR content_identity = NEW.content_identity)
)
BEGIN
  SELECT RAISE(ABORT, 'COST_EVENT_ARTIFACT_SCOPE_MISMATCH');
END;

CREATE TRIGGER cost_events_no_update
BEFORE UPDATE ON cost_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_COST_EVENT');
END;

CREATE TRIGGER cost_events_no_delete
BEFORE DELETE ON cost_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_COST_EVENT');
END;
