import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';

/** New PostgreSQL DDL, not a replay of SQLite's migration lineage. */
export const PROJECT_POSTGRES_MIGRATIONS: readonly PostgresMigration[] =
  Object.freeze([
    Object.freeze({
      version: 1,
      name: '001_project_foundation',
      sql: `
CREATE SCHEMA project;
CREATE TABLE project.projects (
  id TEXT PRIMARY KEY,
  latest_version BIGINT NOT NULL CHECK (latest_version BETWEEN 1 AND 9007199254740991),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE project.project_snapshots (
  project_id TEXT NOT NULL REFERENCES project.projects(id),
  version BIGINT NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  schema_version TEXT NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, version)
);
ALTER TABLE project.projects ADD CONSTRAINT projects_latest_snapshot_fk
  FOREIGN KEY (id, latest_version) REFERENCES project.project_snapshots(project_id, version)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE project.project_commands (
  idempotency_key TEXT PRIMARY KEY,
  command_type TEXT NOT NULL CHECK (command_type IN ('CREATE_PROJECT', 'CREATE_PROJECT_VERSION', 'ARCHIVE_PROJECT')),
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_version BIGINT NOT NULL CHECK (project_version BETWEEN 1 AND 9007199254740991),
  result_json JSON NOT NULL,
  FOREIGN KEY (project_id, project_version) REFERENCES project.project_snapshots(project_id, version)
);
CREATE INDEX projects_updated_at_idx ON project.projects (updated_at DESC, id);
CREATE INDEX project_commands_project_idx ON project.project_commands (project_id, project_version);
CREATE FUNCTION project.reject_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P1001', MESSAGE = 'IMMUTABLE_PROJECT_SNAPSHOT';
END;
$body$;
CREATE FUNCTION project.reject_command_mutation() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P1002', MESSAGE = 'IMMUTABLE_PROJECT_COMMAND';
END;
$body$;
CREATE TRIGGER project_snapshots_immutable BEFORE UPDATE OR DELETE ON project.project_snapshots
  FOR EACH ROW EXECUTE FUNCTION project.reject_snapshot_mutation();
CREATE TRIGGER project_commands_immutable BEFORE UPDATE OR DELETE ON project.project_commands
  FOR EACH ROW EXECUTE FUNCTION project.reject_command_mutation();
`,
    }),
  ]);
