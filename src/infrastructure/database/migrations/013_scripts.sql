CREATE TABLE scripts (
  script_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  idea_selection_id TEXT NOT NULL REFERENCES idea_selections(idea_selection_id),
  idea_selection_content_hash TEXT NOT NULL CHECK (length(idea_selection_content_hash) = 64 AND idea_selection_content_hash NOT GLOB '*[^0-9a-f]*'),
  idea_candidate_id TEXT NOT NULL REFERENCES idea_candidates(idea_candidate_id),
  idea_content_hash TEXT NOT NULL CHECK (length(idea_content_hash) = 64 AND idea_content_hash NOT GLOB '*[^0-9a-f]*'),
  language TEXT NOT NULL,
  content_format TEXT NOT NULL CHECK (content_format IN ('short_video', 'long_video')),
  estimated_duration_seconds INTEGER NOT NULL CHECK (estimated_duration_seconds > 0),
  origin TEXT NOT NULL CHECK (origin IN ('OPERATOR', 'EXTERNAL_CONSUMER')),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_script_id TEXT REFERENCES scripts(script_id),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (idea_selection_id, revision),
  UNIQUE (supersedes_script_id),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version)
);

CREATE INDEX scripts_run_order
  ON scripts(pipeline_run_id, created_at, idea_selection_id, revision, script_id);
CREATE INDEX scripts_selection_order
  ON scripts(idea_selection_id, revision, script_id);

CREATE TRIGGER scripts_validate_scope
BEFORE INSERT ON scripts
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN idea_selections s ON s.idea_selection_id = NEW.idea_selection_id
  JOIN idea_candidates c ON c.idea_candidate_id = NEW.idea_candidate_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND s.pipeline_run_id = NEW.pipeline_run_id
    AND s.project_id = NEW.project_id AND s.project_version = NEW.project_version
    AND s.decision = 'SELECTED'
    AND s.idea_candidate_id = NEW.idea_candidate_id
    AND s.content_hash = NEW.idea_selection_content_hash
    AND s.idea_content_hash = NEW.idea_content_hash
    AND c.pipeline_run_id = NEW.pipeline_run_id
    AND c.project_id = NEW.project_id AND c.project_version = NEW.project_version
    AND c.content_hash = NEW.idea_content_hash
)
BEGIN
  SELECT RAISE(ABORT, 'SCRIPT_SCOPE_MISMATCH');
END;

CREATE TRIGGER scripts_validate_revision
BEFORE INSERT ON scripts
WHEN (NEW.revision = 1 AND NEW.supersedes_script_id IS NOT NULL)
  OR (NEW.revision > 1 AND NOT EXISTS (
    SELECT 1 FROM scripts previous
    WHERE previous.script_id = NEW.supersedes_script_id
      AND previous.idea_selection_id = NEW.idea_selection_id
      AND previous.pipeline_run_id = NEW.pipeline_run_id
      AND previous.project_id = NEW.project_id
      AND previous.project_version = NEW.project_version
      AND previous.idea_candidate_id = NEW.idea_candidate_id
      AND previous.revision = NEW.revision - 1
  ))
BEGIN
  SELECT RAISE(ABORT, 'SCRIPT_REVISION_MISMATCH');
END;

CREATE TRIGGER scripts_no_update BEFORE UPDATE ON scripts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SCRIPT'); END;
CREATE TRIGGER scripts_no_delete BEFORE DELETE ON scripts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SCRIPT'); END;
