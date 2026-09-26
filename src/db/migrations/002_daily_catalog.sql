CREATE TABLE daily_runs (
  logical_date TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  config_json TEXT NOT NULL,
  state TEXT NOT NULL,
  trend_run_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  result_json TEXT
);

CREATE TABLE daily_steps (
  daily_run_id TEXT NOT NULL REFERENCES daily_runs(id),
  step_key TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  result_json TEXT,
  PRIMARY KEY (daily_run_id, step_key)
);

CREATE TABLE candidate_state_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_run_id TEXT NOT NULL REFERENCES daily_runs(id),
  candidate_id TEXT NOT NULL REFERENCES trend_candidates(id),
  previous_state TEXT NOT NULL,
  next_state TEXT NOT NULL,
  actor TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE UNIQUE INDEX trend_candidates_one_selected
  ON trend_candidates(state)
  WHERE state = 'SELECTED';
