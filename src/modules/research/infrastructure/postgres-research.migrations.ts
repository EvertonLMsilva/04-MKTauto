import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';
import { PROJECT_POSTGRES_MIGRATIONS } from '../../project/infrastructure/postgres-project.migrations.js';

/** Research's own PostgreSQL lineage; JSON retains the original serialized bytes. */
export const RESEARCH_POSTGRES_MIGRATIONS: readonly PostgresMigration[] =
  Object.freeze([
    Object.freeze({
      version: 2,
      name: '002_research_foundation',
      sql: `
CREATE SCHEMA research;

-- Explicit binary collation preserves SQLite identity and lexical ordering.
CREATE TABLE research.trend_runs (
  id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  schema_version TEXT COLLATE pg_catalog."C" NOT NULL,
  state TEXT COLLATE pg_catalog."C" NOT NULL,
  created_at TEXT COLLATE pg_catalog."C" NOT NULL,
  updated_at TEXT COLLATE pg_catalog."C" NOT NULL,
  ranking_config_version TEXT COLLATE pg_catalog."C" NOT NULL,
  payload_json JSON NOT NULL
);

CREATE TABLE research.source_runs (
  id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  trend_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_runs(id),
  platform TEXT COLLATE pg_catalog."C" NOT NULL,
  status TEXT COLLATE pg_catalog."C" NOT NULL,
  started_at TEXT COLLATE pg_catalog."C" NOT NULL,
  completed_at TEXT COLLATE pg_catalog."C" NOT NULL,
  payload_json JSON NOT NULL
);
CREATE INDEX source_runs_trend_run_idx ON research.source_runs (trend_run_id, id);

CREATE TABLE research.trend_candidates (
  id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  identity_key TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE,
  platform TEXT COLLATE pg_catalog."C" NOT NULL,
  platform_video_id TEXT COLLATE pg_catalog."C",
  canonical_url_key TEXT COLLATE pg_catalog."C" NOT NULL,
  state TEXT COLLATE pg_catalog."C" NOT NULL,
  first_seen_at TEXT COLLATE pg_catalog."C" NOT NULL,
  last_seen_at TEXT COLLATE pg_catalog."C" NOT NULL,
  appearance_count BIGINT NOT NULL CHECK (appearance_count BETWEEN 1 AND 9007199254740991),
  payload_json JSON NOT NULL
);
CREATE UNIQUE INDEX trend_candidates_platform_video_id
  ON research.trend_candidates (platform, platform_video_id)
  WHERE platform_video_id IS NOT NULL;
CREATE INDEX trend_candidates_canonical_url
  ON research.trend_candidates (platform, canonical_url_key);
CREATE UNIQUE INDEX trend_candidates_one_selected
  ON research.trend_candidates (state) WHERE state = 'SELECTED';

CREATE TABLE research.candidate_appearances (
  trend_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_runs(id),
  candidate_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_candidates(id),
  observed_at TEXT COLLATE pg_catalog."C" NOT NULL,
  reason TEXT COLLATE pg_catalog."C" NOT NULL,
  -- SQLite integer affinity also accepts decimal observation metadata.
  previous_position NUMERIC,
  current_position NUMERIC,
  PRIMARY KEY (trend_run_id, candidate_id)
);
CREATE INDEX candidate_appearances_candidate_idx
  ON research.candidate_appearances (candidate_id, observed_at, trend_run_id);

CREATE TABLE research.trend_snapshots (
  id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  trend_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_runs(id),
  candidate_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_candidates(id),
  captured_at TEXT COLLATE pg_catalog."C" NOT NULL,
  metrics_json JSON NOT NULL,
  payload_json JSON NOT NULL,
  CONSTRAINT trend_snapshots_candidate_captured_unique UNIQUE (candidate_id, captured_at)
);
CREATE INDEX trend_snapshots_run_idx
  ON research.trend_snapshots (trend_run_id, captured_at, id);

CREATE TABLE research.topic_clusters (
  id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  trend_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_runs(id),
  payload_json JSON NOT NULL
);
CREATE INDEX topic_clusters_trend_run_idx ON research.topic_clusters (trend_run_id, id);

CREATE TABLE research.topic_cluster_candidates (
  cluster_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.topic_clusters(id),
  candidate_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_candidates(id),
  PRIMARY KEY (cluster_id, candidate_id)
);
CREATE INDEX topic_cluster_candidates_candidate_idx
  ON research.topic_cluster_candidates (candidate_id, cluster_id);

CREATE TABLE research.topic_cluster_snapshots (
  cluster_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.topic_clusters(id),
  snapshot_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_snapshots(id),
  PRIMARY KEY (cluster_id, snapshot_id)
);

CREATE TABLE research.trend_scores (
  id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  trend_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_runs(id),
  candidate_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_candidates(id),
  formula_version TEXT COLLATE pg_catalog."C" NOT NULL,
  calculated_at TEXT COLLATE pg_catalog."C" NOT NULL,
  payload_json JSON NOT NULL
);
CREATE INDEX trend_scores_trend_run_idx ON research.trend_scores (trend_run_id, id);

CREATE TABLE research.trend_score_snapshots (
  score_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_scores(id),
  snapshot_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_snapshots(id),
  component TEXT COLLATE pg_catalog."C" NOT NULL,
  PRIMARY KEY (score_id, snapshot_id, component)
);

CREATE TABLE research.trend_operations (
  idempotency_key TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  payload_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  trend_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_runs(id),
  created_at TEXT COLLATE pg_catalog."C" NOT NULL
);

CREATE TABLE research.research_daily_runs (
  id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE,
  project_id TEXT COLLATE pg_catalog."C" NOT NULL,
  project_version BIGINT NOT NULL CHECK (project_version BETWEEN 1 AND 9007199254740991),
  logical_date TEXT COLLATE pg_catalog."C" NOT NULL,
  timezone TEXT COLLATE pg_catalog."C" NOT NULL,
  research_input_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  config_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  config_json JSON NOT NULL,
  source_plan_json JSON NOT NULL,
  state TEXT COLLATE pg_catalog."C" NOT NULL,
  trend_run_id TEXT COLLATE pg_catalog."C" REFERENCES research.trend_runs(id),
  started_at TEXT COLLATE pg_catalog."C" NOT NULL,
  completed_at TEXT COLLATE pg_catalog."C",
  duration_ms NUMERIC,
  result_json JSON,
  UNIQUE (pipeline_run_id, project_id, project_version, logical_date)
);
CREATE INDEX research_daily_runs_scope
  ON research.research_daily_runs (project_id, project_version, logical_date);
CREATE INDEX research_daily_runs_trend_run_idx
  ON research.research_daily_runs (trend_run_id);

CREATE TABLE research.research_daily_steps (
  research_daily_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.research_daily_runs(id),
  step_key TEXT COLLATE pg_catalog."C" NOT NULL,
  state TEXT COLLATE pg_catalog."C" NOT NULL,
  started_at TEXT COLLATE pg_catalog."C" NOT NULL,
  completed_at TEXT COLLATE pg_catalog."C",
  duration_ms NUMERIC,
  result_json JSON,
  PRIMARY KEY (research_daily_run_id, step_key)
);

CREATE TABLE research.research_artifacts (
  artifact_id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  schema_version TEXT COLLATE pg_catalog."C" NOT NULL,
  research_daily_run_id TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE REFERENCES research.research_daily_runs(id),
  trend_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_runs(id),
  pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL,
  project_id TEXT COLLATE pg_catalog."C" NOT NULL,
  project_version BIGINT NOT NULL CHECK (project_version BETWEEN 1 AND 9007199254740991),
  content_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  payload_json JSON NOT NULL,
  created_at TEXT COLLATE pg_catalog."C" NOT NULL
);

CREATE TABLE research.reference_analysis_runs (
  id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE,
  project_id TEXT COLLATE pg_catalog."C" NOT NULL,
  project_version BIGINT NOT NULL CHECK (project_version BETWEEN 1 AND 9007199254740991),
  logical_date TEXT COLLATE pg_catalog."C" NOT NULL,
  timezone TEXT COLLATE pg_catalog."C" NOT NULL,
  research_input_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  project_snapshot_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  policy_version TEXT COLLATE pg_catalog."C" NOT NULL,
  config_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  state TEXT COLLATE pg_catalog."C" NOT NULL,
  started_at TEXT COLLATE pg_catalog."C" NOT NULL,
  completed_at TEXT COLLATE pg_catalog."C",
  duration_ms NUMERIC,
  result_json JSON,
  UNIQUE (pipeline_run_id, project_id, project_version, logical_date)
);
CREATE INDEX reference_analysis_scope
  ON research.reference_analysis_runs (project_id, project_version, logical_date);

CREATE TABLE research.reference_analysis_steps (
  reference_analysis_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.reference_analysis_runs(id),
  reference_key TEXT COLLATE pg_catalog."C" NOT NULL,
  state TEXT COLLATE pg_catalog."C" NOT NULL,
  started_at TEXT COLLATE pg_catalog."C" NOT NULL,
  completed_at TEXT COLLATE pg_catalog."C",
  duration_ms NUMERIC,
  result_json JSON,
  PRIMARY KEY (reference_analysis_run_id, reference_key)
);

CREATE TABLE research.reference_insights (
  artifact_id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  schema_version TEXT COLLATE pg_catalog."C" NOT NULL,
  reference_analysis_run_id TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE REFERENCES research.reference_analysis_runs(id),
  pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL,
  project_id TEXT COLLATE pg_catalog."C" NOT NULL,
  project_version BIGINT NOT NULL CHECK (project_version BETWEEN 1 AND 9007199254740991),
  content_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  payload_json JSON NOT NULL,
  created_at TEXT COLLATE pg_catalog."C" NOT NULL
);

CREATE TABLE research.research_shortlists (
  artifact_id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  schema_version TEXT COLLATE pg_catalog."C" NOT NULL,
  revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE,
  project_id TEXT COLLATE pg_catalog."C" NOT NULL,
  project_version BIGINT NOT NULL CHECK (project_version BETWEEN 1 AND 9007199254740991),
  logical_date TEXT COLLATE pg_catalog."C" NOT NULL,
  research_artifact_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.research_artifacts(artifact_id),
  trend_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES research.trend_runs(id),
  research_input_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  research_topic_catalog_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  trend_catalog_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  policy_version TEXT COLLATE pg_catalog."C" NOT NULL,
  state TEXT COLLATE pg_catalog."C" NOT NULL,
  content_hash TEXT COLLATE pg_catalog."C" NOT NULL,
  payload_json JSON NOT NULL,
  created_at TEXT COLLATE pg_catalog."C" NOT NULL,
  UNIQUE (research_artifact_id, policy_version, revision)
);
CREATE INDEX research_shortlists_scope
  ON research.research_shortlists (project_id, project_version, logical_date);

CREATE FUNCTION research.reject_trend_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P2001', MESSAGE = 'IMMUTABLE_SNAPSHOT';
END;
$body$;
CREATE TRIGGER trend_snapshots_immutable BEFORE UPDATE OR DELETE ON research.trend_snapshots
  FOR EACH ROW EXECUTE FUNCTION research.reject_trend_snapshot_mutation();
`,
    }),
  ]);

/** The existing runner owns the contiguous cross-module PostgreSQL registry. */
export const RESEARCH_POSTGRES_MIGRATION_REGISTRY: readonly PostgresMigration[] =
  Object.freeze([
    ...PROJECT_POSTGRES_MIGRATIONS,
    ...RESEARCH_POSTGRES_MIGRATIONS,
  ]);
