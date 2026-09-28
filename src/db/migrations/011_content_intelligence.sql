CREATE TABLE idea_batches (
  idea_batch_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  research_shortlist_id TEXT NOT NULL REFERENCES research_shortlists(artifact_id),
  policy_version TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('OPERATOR', 'EXTERNAL_CONSUMER')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, project_version)
    REFERENCES project_snapshots(project_id, version)
);

CREATE TABLE idea_candidates (
  idea_candidate_id TEXT PRIMARY KEY,
  idea_batch_id TEXT NOT NULL REFERENCES idea_batches(idea_batch_id),
  schema_version TEXT NOT NULL,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  content_identity TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  research_shortlist_id TEXT NOT NULL REFERENCES research_shortlists(artifact_id),
  reference_insight_id TEXT REFERENCES reference_insights(artifact_id),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, project_version)
    REFERENCES project_snapshots(project_id, version)
);

CREATE TABLE idea_candidate_evidence (
  idea_candidate_id TEXT NOT NULL REFERENCES idea_candidates(idea_candidate_id),
  kind TEXT NOT NULL CHECK (kind IN ('RESEARCH_CANDIDATE', 'REFERENCE_EVIDENCE')),
  position INTEGER NOT NULL CHECK (position > 0),
  evidence_id TEXT NOT NULL,
  PRIMARY KEY (idea_candidate_id, kind, position),
  UNIQUE (idea_candidate_id, kind, evidence_id)
);

CREATE TABLE idea_scores (
  idea_score_id TEXT PRIMARY KEY,
  idea_candidate_id TEXT NOT NULL UNIQUE REFERENCES idea_candidates(idea_candidate_id),
  idea_batch_id TEXT NOT NULL REFERENCES idea_batches(idea_batch_id),
  schema_version TEXT NOT NULL,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  policy_version TEXT NOT NULL,
  total REAL NOT NULL CHECK (total >= 0 AND total <= 1),
  rank INTEGER NOT NULL CHECK (rank > 0),
  content_hash TEXT NOT NULL CHECK (
    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  calculated_at TEXT NOT NULL,
  UNIQUE (idea_batch_id, rank),
  FOREIGN KEY (project_id, project_version)
    REFERENCES project_snapshots(project_id, version)
);

CREATE INDEX idea_candidates_pipeline_order
  ON idea_candidates(pipeline_run_id, created_at, idea_batch_id, idea_candidate_id);

CREATE INDEX idea_scores_batch_order
  ON idea_scores(idea_batch_id, rank, idea_candidate_id);

CREATE TRIGGER idea_batches_validate_scope
BEFORE INSERT ON idea_batches
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN research_shortlists s ON s.artifact_id = NEW.research_shortlist_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND s.pipeline_run_id = NEW.pipeline_run_id
    AND s.project_id = NEW.project_id AND s.project_version = NEW.project_version
)
BEGIN
  SELECT RAISE(ABORT, 'IDEA_BATCH_SCOPE_MISMATCH');
END;

CREATE TRIGGER idea_candidates_validate_scope
BEFORE INSERT ON idea_candidates
WHEN NOT EXISTS (
  SELECT 1 FROM idea_batches b
  WHERE b.idea_batch_id = NEW.idea_batch_id
    AND b.pipeline_run_id = NEW.pipeline_run_id
    AND b.project_id = NEW.project_id AND b.project_version = NEW.project_version
    AND b.research_shortlist_id = NEW.research_shortlist_id
) OR (
  NEW.reference_insight_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM reference_insights i
    WHERE i.artifact_id = NEW.reference_insight_id
      AND i.pipeline_run_id = NEW.pipeline_run_id
      AND i.project_id = NEW.project_id AND i.project_version = NEW.project_version
  )
)
BEGIN
  SELECT RAISE(ABORT, 'IDEA_CANDIDATE_SCOPE_MISMATCH');
END;

CREATE TRIGGER idea_scores_validate_scope
BEFORE INSERT ON idea_scores
WHEN NOT EXISTS (
  SELECT 1 FROM idea_candidates c
  WHERE c.idea_candidate_id = NEW.idea_candidate_id
    AND c.idea_batch_id = NEW.idea_batch_id
    AND c.pipeline_run_id = NEW.pipeline_run_id
    AND c.project_id = NEW.project_id AND c.project_version = NEW.project_version
)
BEGIN
  SELECT RAISE(ABORT, 'IDEA_SCORE_SCOPE_MISMATCH');
END;

CREATE TRIGGER idea_batches_no_update BEFORE UPDATE ON idea_batches BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_BATCH'); END;
CREATE TRIGGER idea_batches_no_delete BEFORE DELETE ON idea_batches BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_BATCH'); END;
CREATE TRIGGER idea_candidates_no_update BEFORE UPDATE ON idea_candidates BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_CANDIDATE'); END;
CREATE TRIGGER idea_candidates_no_delete BEFORE DELETE ON idea_candidates BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_CANDIDATE'); END;
CREATE TRIGGER idea_candidate_evidence_no_update BEFORE UPDATE ON idea_candidate_evidence BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_EVIDENCE'); END;
CREATE TRIGGER idea_candidate_evidence_no_delete BEFORE DELETE ON idea_candidate_evidence BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_EVIDENCE'); END;
CREATE TRIGGER idea_scores_no_update BEFORE UPDATE ON idea_scores BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_SCORE'); END;
CREATE TRIGGER idea_scores_no_delete BEFORE DELETE ON idea_scores BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_IDEA_SCORE'); END;
