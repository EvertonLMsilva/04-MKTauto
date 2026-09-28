CREATE TABLE research_daily_runs (
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  logical_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  research_input_hash TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  config_json TEXT NOT NULL,
  source_plan_json TEXT NOT NULL,
  state TEXT NOT NULL,
  trend_run_id TEXT REFERENCES trend_runs(id),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  result_json TEXT,
  UNIQUE (pipeline_run_id, project_id, project_version, logical_date)
);

CREATE INDEX research_daily_runs_scope
  ON research_daily_runs(project_id, project_version, logical_date);

CREATE TABLE research_daily_steps (
  research_daily_run_id TEXT NOT NULL REFERENCES research_daily_runs(id),
  step_key TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  result_json TEXT,
  PRIMARY KEY (research_daily_run_id, step_key)
);

CREATE TABLE research_artifacts (
  artifact_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  research_daily_run_id TEXT NOT NULL UNIQUE REFERENCES research_daily_runs(id),
  trend_run_id TEXT NOT NULL REFERENCES trend_runs(id),
  pipeline_run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
