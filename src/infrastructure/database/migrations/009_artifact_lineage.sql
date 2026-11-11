CREATE TABLE artifact_lineage (
  artifact_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  artifact_version INTEGER NOT NULL CHECK (artifact_version > 0),
  identity_hash TEXT NOT NULL CHECK (
    length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'
  ),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  content_identity TEXT,
  hash_algorithm TEXT NOT NULL CHECK (hash_algorithm = 'sha256'),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  generation_metadata_json TEXT CHECK (
    generation_metadata_json IS NULL OR json_valid(generation_metadata_json)
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, project_version)
    REFERENCES project_snapshots(project_id, version)
);

CREATE UNIQUE INDEX artifact_lineage_content_identity
  ON artifact_lineage(artifact_type, content_identity, artifact_version)
  WHERE content_identity IS NOT NULL;

CREATE INDEX artifact_lineage_pipeline_order
  ON artifact_lineage(pipeline_run_id, created_at, artifact_id);

CREATE TABLE artifact_lineage_inputs (
  artifact_id TEXT NOT NULL REFERENCES artifact_lineage(artifact_id),
  position INTEGER NOT NULL CHECK (position > 0),
  kind TEXT NOT NULL CHECK (kind IN ('INTERNAL_ARTIFACT', 'EXTERNAL_INPUT')),
  input_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (artifact_id, position),
  UNIQUE (artifact_id, kind, input_id)
);

CREATE TRIGGER artifact_lineage_validate_run_scope
BEFORE INSERT ON artifact_lineage
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs
  WHERE pipeline_run_id = NEW.pipeline_run_id
    AND project_id = NEW.project_id
    AND project_version = NEW.project_version
)
BEGIN
  SELECT RAISE(ABORT, 'ARTIFACT_RUN_SCOPE_MISMATCH');
END;

CREATE TRIGGER artifact_lineage_validate_internal_input
BEFORE INSERT ON artifact_lineage_inputs
WHEN NEW.kind = 'INTERNAL_ARTIFACT' AND (
  NEW.input_id = NEW.artifact_id OR NOT EXISTS (
    SELECT 1
    FROM artifact_lineage parent
    JOIN artifact_lineage child ON child.artifact_id = NEW.artifact_id
    WHERE parent.artifact_id = NEW.input_id
      AND parent.pipeline_run_id = child.pipeline_run_id
      AND parent.project_id = child.project_id
      AND parent.project_version = child.project_version
      AND parent.content_hash = NEW.content_hash
  )
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_INTERNAL_ARTIFACT_INPUT');
END;

CREATE TRIGGER artifact_lineage_no_update
BEFORE UPDATE ON artifact_lineage
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ARTIFACT');
END;

CREATE TRIGGER artifact_lineage_no_delete
BEFORE DELETE ON artifact_lineage
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ARTIFACT');
END;

CREATE TRIGGER artifact_lineage_inputs_no_update
BEFORE UPDATE ON artifact_lineage_inputs
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ARTIFACT_INPUT');
END;

CREATE TRIGGER artifact_lineage_inputs_no_delete
BEFORE DELETE ON artifact_lineage_inputs
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_ARTIFACT_INPUT');
END;
