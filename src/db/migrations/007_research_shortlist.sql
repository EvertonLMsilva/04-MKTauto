CREATE TABLE research_shortlists (
  artifact_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  pipeline_run_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  logical_date TEXT NOT NULL,
  research_artifact_id TEXT NOT NULL REFERENCES research_artifacts(artifact_id),
  trend_run_id TEXT NOT NULL REFERENCES trend_runs(id),
  research_input_hash TEXT NOT NULL,
  research_topic_catalog_hash TEXT NOT NULL,
  trend_catalog_hash TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  state TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (research_artifact_id, policy_version, revision)
);

CREATE INDEX research_shortlists_scope
  ON research_shortlists(project_id, project_version, logical_date);
