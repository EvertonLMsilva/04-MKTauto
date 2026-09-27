CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  latest_version INTEGER NOT NULL CHECK (latest_version >= 1),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_snapshots (
  project_id TEXT NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  schema_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, version)
);

CREATE TRIGGER project_snapshots_no_update
BEFORE UPDATE ON project_snapshots
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PROJECT_SNAPSHOT');
END;

CREATE TRIGGER project_snapshots_no_delete
BEFORE DELETE ON project_snapshots
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_PROJECT_SNAPSHOT');
END;
