PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE trend_runs (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ranking_config_version TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE source_runs (
  id TEXT PRIMARY KEY,
  trend_run_id TEXT NOT NULL REFERENCES trend_runs(id),
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE trend_candidates (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  platform_video_id TEXT,
  canonical_url_key TEXT NOT NULL,
  state TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  appearance_count INTEGER NOT NULL CHECK (appearance_count > 0),
  payload_json TEXT NOT NULL
);

CREATE UNIQUE INDEX trend_candidates_platform_video_id
  ON trend_candidates(platform, platform_video_id)
  WHERE platform_video_id IS NOT NULL;

CREATE INDEX trend_candidates_canonical_url
  ON trend_candidates(platform, canonical_url_key);

CREATE TABLE candidate_appearances (
  trend_run_id TEXT NOT NULL REFERENCES trend_runs(id),
  candidate_id TEXT NOT NULL REFERENCES trend_candidates(id),
  observed_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  previous_position INTEGER,
  current_position INTEGER,
  PRIMARY KEY (trend_run_id, candidate_id)
);

CREATE TABLE trend_snapshots (
  id TEXT PRIMARY KEY,
  trend_run_id TEXT NOT NULL REFERENCES trend_runs(id),
  candidate_id TEXT NOT NULL REFERENCES trend_candidates(id),
  captured_at TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (candidate_id, captured_at)
);

CREATE TABLE topic_clusters (
  id TEXT PRIMARY KEY,
  trend_run_id TEXT NOT NULL REFERENCES trend_runs(id),
  payload_json TEXT NOT NULL
);

CREATE TABLE topic_cluster_candidates (
  cluster_id TEXT NOT NULL REFERENCES topic_clusters(id),
  candidate_id TEXT NOT NULL REFERENCES trend_candidates(id),
  PRIMARY KEY (cluster_id, candidate_id)
);

CREATE TABLE topic_cluster_snapshots (
  cluster_id TEXT NOT NULL REFERENCES topic_clusters(id),
  snapshot_id TEXT NOT NULL REFERENCES trend_snapshots(id),
  PRIMARY KEY (cluster_id, snapshot_id)
);

CREATE TABLE trend_scores (
  id TEXT PRIMARY KEY,
  trend_run_id TEXT NOT NULL REFERENCES trend_runs(id),
  candidate_id TEXT NOT NULL REFERENCES trend_candidates(id),
  formula_version TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE trend_score_snapshots (
  score_id TEXT NOT NULL REFERENCES trend_scores(id),
  snapshot_id TEXT NOT NULL REFERENCES trend_snapshots(id),
  component TEXT NOT NULL,
  PRIMARY KEY (score_id, snapshot_id, component)
);

CREATE TABLE trend_operations (
  idempotency_key TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  trend_run_id TEXT NOT NULL REFERENCES trend_runs(id),
  created_at TEXT NOT NULL
);

CREATE TRIGGER trend_snapshots_no_update
BEFORE UPDATE ON trend_snapshots
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SNAPSHOT');
END;

CREATE TRIGGER trend_snapshots_no_delete
BEFORE DELETE ON trend_snapshots
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_SNAPSHOT');
END;
