CREATE TABLE idea_selections (
  idea_selection_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  idea_batch_id TEXT NOT NULL REFERENCES idea_batches(idea_batch_id),
  idea_candidate_id TEXT NOT NULL REFERENCES idea_candidates(idea_candidate_id),
  idea_score_id TEXT NOT NULL REFERENCES idea_scores(idea_score_id),
  idea_content_hash TEXT NOT NULL CHECK (length(idea_content_hash) = 64 AND idea_content_hash NOT GLOB '*[^0-9a-f]*'),
  idea_score_content_hash TEXT NOT NULL CHECK (length(idea_score_content_hash) = 64 AND idea_score_content_hash NOT GLOB '*[^0-9a-f]*'),
  decision TEXT NOT NULL CHECK (decision = 'SELECTED'),
  actor_type TEXT NOT NULL CHECK (actor_type = 'HUMAN'),
  actor_id TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  editorial_rationale TEXT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_idea_selection_id TEXT REFERENCES idea_selections(idea_selection_id),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (idea_batch_id, revision),
  UNIQUE (supersedes_idea_selection_id),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version)
);

CREATE INDEX idea_selections_run_order
  ON idea_selections(pipeline_run_id, decided_at, idea_batch_id, revision, idea_selection_id);
CREATE INDEX idea_selections_batch_order
  ON idea_selections(idea_batch_id, revision, idea_selection_id);

CREATE TRIGGER idea_selections_validate_scope
BEFORE INSERT ON idea_selections
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN idea_batches b ON b.idea_batch_id = NEW.idea_batch_id
  JOIN idea_candidates c ON c.idea_candidate_id = NEW.idea_candidate_id
  JOIN idea_scores s ON s.idea_score_id = NEW.idea_score_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND b.pipeline_run_id = NEW.pipeline_run_id
    AND b.project_id = NEW.project_id AND b.project_version = NEW.project_version
    AND c.idea_batch_id = NEW.idea_batch_id AND c.pipeline_run_id = NEW.pipeline_run_id
    AND c.project_id = NEW.project_id AND c.project_version = NEW.project_version
    AND c.content_hash = NEW.idea_content_hash
    AND s.idea_candidate_id = NEW.idea_candidate_id AND s.idea_batch_id = NEW.idea_batch_id
    AND s.pipeline_run_id = NEW.pipeline_run_id
    AND s.project_id = NEW.project_id AND s.project_version = NEW.project_version
    AND s.content_hash = NEW.idea_score_content_hash
)
BEGIN
  SELECT RAISE(ABORT, 'IDEA_SELECTION_SCOPE_MISMATCH');
END;

CREATE TRIGGER idea_selections_validate_revision
BEFORE INSERT ON idea_selections
WHEN (NEW.revision = 1 AND NEW.supersedes_idea_selection_id IS NOT NULL)
  OR (NEW.revision > 1 AND NOT EXISTS (
    SELECT 1 FROM idea_selections previous
    WHERE previous.idea_selection_id = NEW.supersedes_idea_selection_id
      AND previous.idea_batch_id = NEW.idea_batch_id
      AND previous.pipeline_run_id = NEW.pipeline_run_id
      AND previous.project_id = NEW.project_id
      AND previous.project_version = NEW.project_version
      AND previous.revision = NEW.revision - 1
  ))
BEGIN
  SELECT RAISE(ABORT, 'IDEA_SELECTION_REVISION_MISMATCH');
END;

CREATE TRIGGER idea_selections_no_update BEFORE UPDATE ON idea_selections
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_SELECTION'); END;
CREATE TRIGGER idea_selections_no_delete BEFORE DELETE ON idea_selections
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_SELECTION'); END;
