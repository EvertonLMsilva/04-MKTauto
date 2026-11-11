CREATE TABLE quality_control_reports (
  quality_control_report_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK (schema_version = 'quality-control-report/1.0.0'),
  policy_version TEXT NOT NULL CHECK (policy_version = 'quality-control-policy/1.0.0'),
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  video_render_id TEXT NOT NULL REFERENCES video_renders(video_render_id),
  video_render_content_hash TEXT NOT NULL CHECK (length(video_render_content_hash) = 64 AND video_render_content_hash NOT GLOB '*[^0-9a-f]*'),
  result TEXT NOT NULL CHECK (result IN ('PASS', 'WARN', 'FAIL')),
  approval_blocked INTEGER NOT NULL CHECK (approval_blocked IN (0, 1)),
  checked_at TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (policy_version, video_render_id, video_render_content_hash),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version)
);

CREATE TABLE quality_control_findings (
  quality_control_report_id TEXT NOT NULL REFERENCES quality_control_reports(quality_control_report_id),
  position INTEGER NOT NULL CHECK (position > 0),
  code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS', 'WARN', 'FAIL')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  message TEXT NOT NULL,
  observed TEXT,
  expected TEXT,
  PRIMARY KEY (quality_control_report_id, position),
  UNIQUE (quality_control_report_id, code, subject_type, subject_id)
);

CREATE INDEX quality_control_reports_video_order
  ON quality_control_reports(video_render_id, policy_version, checked_at, quality_control_report_id);
CREATE INDEX quality_control_reports_run_order
  ON quality_control_reports(pipeline_run_id, checked_at, quality_control_report_id);

CREATE TRIGGER quality_control_reports_validate_binding
BEFORE INSERT ON quality_control_reports
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN video_renders v ON v.video_render_id = NEW.video_render_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND v.pipeline_run_id = NEW.pipeline_run_id
    AND v.project_id = NEW.project_id AND v.project_version = NEW.project_version
    AND v.content_hash = NEW.video_render_content_hash
    AND v.revision = 2
)
BEGIN SELECT RAISE(ABORT, 'QUALITY_CONTROL_VIDEO_BINDING_MISMATCH'); END;

CREATE TRIGGER quality_control_reports_no_update BEFORE UPDATE ON quality_control_reports
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_QUALITY_CONTROL_REPORT'); END;
CREATE TRIGGER quality_control_reports_no_delete BEFORE DELETE ON quality_control_reports
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_QUALITY_CONTROL_REPORT'); END;
CREATE TRIGGER quality_control_findings_no_update BEFORE UPDATE ON quality_control_findings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_QUALITY_CONTROL_FINDING'); END;
CREATE TRIGGER quality_control_findings_no_delete BEFORE DELETE ON quality_control_findings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_QUALITY_CONTROL_FINDING'); END;
