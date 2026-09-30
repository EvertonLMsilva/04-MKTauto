CREATE TABLE human_approval_decisions (
  human_approval_decision_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'human-approval-decision/1.0.0'),
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  video_render_id TEXT NOT NULL REFERENCES video_renders(video_render_id),
  video_render_revision INTEGER NOT NULL CHECK (video_render_revision > 0),
  video_render_content_hash TEXT NOT NULL CHECK (length(video_render_content_hash) = 64 AND video_render_content_hash NOT GLOB '*[^0-9a-f]*'),
  quality_control_report_id TEXT NOT NULL REFERENCES quality_control_reports(quality_control_report_id),
  quality_control_report_content_hash TEXT NOT NULL CHECK (length(quality_control_report_content_hash) = 64 AND quality_control_report_content_hash NOT GLOB '*[^0-9a-f]*'),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  actor TEXT NOT NULL,
  justification TEXT,
  decided_at TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (project_id, project_version, pipeline_run_id, video_render_id,
    video_render_revision, video_render_content_hash, quality_control_report_id,
    quality_control_report_content_hash),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version),
  CHECK (decision <> 'REJECTED' OR justification IS NOT NULL)
);

CREATE INDEX human_approval_decisions_run_order
  ON human_approval_decisions(pipeline_run_id, decided_at, human_approval_decision_id);
CREATE INDEX human_approval_decisions_approved_exact
  ON human_approval_decisions(project_id, project_version, pipeline_run_id,
    video_render_id, video_render_revision, video_render_content_hash,
    quality_control_report_id, quality_control_report_content_hash, decision);

CREATE TRIGGER human_approval_decisions_validate_binding
BEFORE INSERT ON human_approval_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN video_renders v ON v.video_render_id = NEW.video_render_id
  JOIN quality_control_reports q ON q.quality_control_report_id = NEW.quality_control_report_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND v.pipeline_run_id = NEW.pipeline_run_id
    AND v.project_id = NEW.project_id AND v.project_version = NEW.project_version
    AND v.revision = NEW.video_render_revision
    AND v.content_hash = NEW.video_render_content_hash
    AND q.pipeline_run_id = NEW.pipeline_run_id
    AND q.project_id = NEW.project_id AND q.project_version = NEW.project_version
    AND q.video_render_id = NEW.video_render_id
    AND q.video_render_content_hash = NEW.video_render_content_hash
    AND q.content_hash = NEW.quality_control_report_content_hash
)
BEGIN SELECT RAISE(ABORT, 'HUMAN_APPROVAL_BINDING_MISMATCH'); END;

CREATE TRIGGER human_approval_decisions_no_update BEFORE UPDATE ON human_approval_decisions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_HUMAN_APPROVAL_DECISION'); END;
CREATE TRIGGER human_approval_decisions_no_delete BEFORE DELETE ON human_approval_decisions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_HUMAN_APPROVAL_DECISION'); END;
