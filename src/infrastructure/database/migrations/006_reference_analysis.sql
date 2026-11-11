CREATE TABLE reference_analysis_runs (
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  logical_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  research_input_hash TEXT NOT NULL,
  project_snapshot_hash TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  result_json TEXT,
  UNIQUE (pipeline_run_id, project_id, project_version, logical_date)
);

CREATE INDEX reference_analysis_scope
  ON reference_analysis_runs(project_id, project_version, logical_date);

CREATE TABLE reference_analysis_steps (
  reference_analysis_run_id TEXT NOT NULL REFERENCES reference_analysis_runs(id),
  reference_key TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  result_json TEXT,
  PRIMARY KEY (reference_analysis_run_id, reference_key)
);

CREATE TABLE reference_insights (
  artifact_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  reference_analysis_run_id TEXT NOT NULL UNIQUE REFERENCES reference_analysis_runs(id),
  pipeline_run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
