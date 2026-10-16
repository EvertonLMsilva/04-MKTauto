PRAGMA defer_foreign_keys = ON;
CREATE TABLE script_generation_transport_blocks (
 generation_request_id TEXT NOT NULL REFERENCES script_generation_claims(generation_request_id),
 owner_token TEXT NOT NULL,
 failure_code TEXT NOT NULL CHECK(failure_code IN ('GLOBAL_FINANCE_REQUIRED','GLOBAL_PRICE_UNPROVEN','GLOBAL_DAILY_BUDGET_EXCEEDED','GLOBAL_MONTHLY_BUDGET_EXCEEDED')),
 recorded_at TEXT NOT NULL,
 PRIMARY KEY(generation_request_id,owner_token)
);
CREATE TRIGGER script_transport_blocks_no_update BEFORE UPDATE ON script_generation_transport_blocks
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SCRIPT_TRANSPORT_BLOCK'); END;
CREATE TRIGGER script_transport_blocks_no_delete BEFORE DELETE ON script_generation_transport_blocks
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SCRIPT_TRANSPORT_BLOCK'); END;
DROP TRIGGER script_generation_claim_state_transition;
CREATE TRIGGER script_generation_claim_state_transition BEFORE UPDATE ON script_generation_claims
WHEN NOT (
 (OLD.state='RESERVED' AND NEW.state IN ('DISPATCHING','RETRYABLE') AND NEW.owner_token=OLD.owner_token)
 OR (OLD.state='RESERVED' AND NEW.state='RESERVED' AND OLD.reserved_until<=CAST(unixepoch('subsec')*1000 AS INTEGER))
 OR (OLD.state='RETRYABLE' AND NEW.state='RESERVED')
 OR (OLD.state='DISPATCHING' AND NEW.state IN ('TERMINAL','RECONCILIATION_PENDING') AND NEW.owner_token=OLD.owner_token)
 OR (OLD.state='DISPATCHING' AND NEW.state='RETRYABLE' AND NEW.owner_token=OLD.owner_token AND EXISTS (
  SELECT 1 FROM script_generation_transport_blocks b WHERE b.generation_request_id=OLD.generation_request_id AND b.owner_token=OLD.owner_token
 ))
)
BEGIN SELECT RAISE(ABORT,'invalid script generation state transition'); END;
CREATE TEMP TABLE preserved_scripts AS SELECT * FROM scripts;
DROP TABLE scripts;
CREATE TABLE scripts (
  commercial_selection_id TEXT REFERENCES affiliate_editorial_selections(selection_id),
  commercial_selection_hash TEXT,
  script_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  idea_selection_id TEXT REFERENCES idea_selections(idea_selection_id),
  idea_selection_content_hash TEXT CHECK (length(idea_selection_content_hash) = 64 AND idea_selection_content_hash NOT GLOB '*[^0-9a-f]*'),
  idea_candidate_id TEXT REFERENCES idea_candidates(idea_candidate_id),
  idea_content_hash TEXT CHECK (length(idea_content_hash) = 64 AND idea_content_hash NOT GLOB '*[^0-9a-f]*'),
  language TEXT NOT NULL,
  content_format TEXT NOT NULL CHECK (content_format IN ('short_video', 'long_video')),
  estimated_duration_seconds INTEGER NOT NULL CHECK (estimated_duration_seconds > 0),
  origin TEXT NOT NULL CHECK (origin IN ('OPERATOR', 'EXTERNAL_CONSUMER', 'AUTOMATION')),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_script_id TEXT REFERENCES scripts(script_id),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (idea_selection_id, revision),
  UNIQUE (commercial_selection_id, revision),
  CHECK ((schema_version = 'script/1.0.0' AND origin IN ('OPERATOR','EXTERNAL_CONSUMER') AND commercial_selection_id IS NULL AND commercial_selection_hash IS NULL AND idea_selection_id IS NOT NULL AND idea_selection_content_hash IS NOT NULL AND idea_candidate_id IS NOT NULL AND idea_content_hash IS NOT NULL) OR (schema_version = 'script/2.0.0' AND origin IN ('OPERATOR', 'AUTOMATION') AND commercial_selection_id IS NOT NULL AND commercial_selection_hash IS NOT NULL AND length(commercial_selection_hash) = 64 AND commercial_selection_hash NOT GLOB '*[^0-9a-f]*' AND idea_selection_id IS NULL AND idea_selection_content_hash IS NULL AND idea_candidate_id IS NULL AND idea_content_hash IS NULL)),
  UNIQUE (supersedes_script_id),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version)
);

INSERT INTO scripts SELECT * FROM preserved_scripts;
DROP TABLE preserved_scripts;
CREATE INDEX scripts_run_order
  ON scripts(pipeline_run_id, created_at, idea_selection_id, revision, script_id);
CREATE INDEX scripts_selection_order
  ON scripts(idea_selection_id, revision, script_id);

CREATE TRIGGER scripts_validate_scope
BEFORE INSERT ON scripts
WHEN NEW.schema_version = 'script/1.0.0' AND NOT EXISTS (
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
      AND previous.idea_selection_id IS NEW.idea_selection_id
      AND previous.commercial_selection_id IS NEW.commercial_selection_id
      AND previous.pipeline_run_id = NEW.pipeline_run_id
      AND previous.project_id = NEW.project_id
      AND previous.project_version = NEW.project_version
      AND previous.idea_candidate_id IS NEW.idea_candidate_id
      AND previous.revision = NEW.revision - 1
  ))
BEGIN
  SELECT RAISE(ABORT, 'SCRIPT_REVISION_MISMATCH');
END;

CREATE TRIGGER scripts_no_update BEFORE UPDATE ON scripts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SCRIPT'); END;
CREATE TRIGGER scripts_no_delete BEFORE DELETE ON scripts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SCRIPT'); END;

CREATE TRIGGER scripts_validate_commercial_scope BEFORE INSERT ON scripts
WHEN NEW.schema_version = 'script/2.0.0' AND NOT EXISTS (
 SELECT 1 FROM affiliate_editorial_selections s JOIN pipeline_runs r ON r.pipeline_run_id=s.pipeline_run_id
 WHERE s.selection_id=NEW.commercial_selection_id AND s.content_hash=NEW.commercial_selection_hash
 AND s.pipeline_run_id=NEW.pipeline_run_id AND s.project_id=NEW.project_id AND s.project_version=NEW.project_version
 AND r.project_id=NEW.project_id AND r.project_version=NEW.project_version
) BEGIN SELECT RAISE(ABORT,'SCRIPT_SCOPE_MISMATCH'); END;
