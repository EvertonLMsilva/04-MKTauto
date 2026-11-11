CREATE TABLE affiliate_product_revisions (
  product_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  content_json TEXT NOT NULL,
  PRIMARY KEY (product_id, revision)
);
CREATE TABLE affiliate_campaign_revisions (
  campaign_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  project_id TEXT NOT NULL REFERENCES projects(id),
  product_id TEXT NOT NULL,
  product_revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  content_json TEXT NOT NULL,
  PRIMARY KEY (campaign_id, revision),
  FOREIGN KEY (product_id, product_revision) REFERENCES affiliate_product_revisions(product_id, revision)
);
CREATE TABLE affiliate_briefings (
  briefing_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  campaign_revision INTEGER NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  content_json TEXT NOT NULL,
  FOREIGN KEY (campaign_id, campaign_revision) REFERENCES affiliate_campaign_revisions(campaign_id, revision)
);
CREATE TABLE affiliate_run_bindings (
  pipeline_run_id TEXT PRIMARY KEY REFERENCES pipeline_runs(pipeline_run_id),
  briefing_id TEXT NOT NULL REFERENCES affiliate_briefings(briefing_id),
  briefing_hash TEXT NOT NULL CHECK (length(briefing_hash) = 64),
  campaign_id TEXT NOT NULL,
  campaign_revision INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  product_revision INTEGER NOT NULL,
  FOREIGN KEY (campaign_id, campaign_revision) REFERENCES affiliate_campaign_revisions(campaign_id, revision),
  FOREIGN KEY (product_id, product_revision) REFERENCES affiliate_product_revisions(product_id, revision)
);
-- Records the context before a provider call, including generic generation.
-- This closes the gap where a briefing could be attached to an in-flight generic run.
CREATE TABLE affiliate_script_contexts (
  generation_request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  briefing_hash TEXT CHECK (briefing_hash IS NULL OR length(briefing_hash) = 64)
);
CREATE TABLE affiliate_commands (
  idempotency_key TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  result_hash TEXT NOT NULL CHECK (length(result_hash) = 64),
  result_json TEXT NOT NULL
);

CREATE TRIGGER affiliate_product_revisions_no_update BEFORE UPDATE ON affiliate_product_revisions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_PRODUCT'); END;
CREATE TRIGGER affiliate_product_revisions_no_delete BEFORE DELETE ON affiliate_product_revisions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_PRODUCT'); END;
CREATE TRIGGER affiliate_campaign_revisions_no_update BEFORE UPDATE ON affiliate_campaign_revisions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_CAMPAIGN'); END;
CREATE TRIGGER affiliate_campaign_revisions_no_delete BEFORE DELETE ON affiliate_campaign_revisions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_CAMPAIGN'); END;
CREATE TRIGGER affiliate_briefings_no_update BEFORE UPDATE ON affiliate_briefings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_BRIEFING'); END;
CREATE TRIGGER affiliate_briefings_no_delete BEFORE DELETE ON affiliate_briefings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_BRIEFING'); END;
CREATE TRIGGER affiliate_run_bindings_no_update BEFORE UPDATE ON affiliate_run_bindings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_RUN_BINDING'); END;
CREATE TRIGGER affiliate_run_bindings_no_delete BEFORE DELETE ON affiliate_run_bindings
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_RUN_BINDING'); END;
CREATE TRIGGER affiliate_commands_no_update BEFORE UPDATE ON affiliate_commands
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_COMMAND'); END;
CREATE TRIGGER affiliate_commands_no_delete BEFORE DELETE ON affiliate_commands
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_COMMAND'); END;
CREATE TRIGGER affiliate_script_contexts_no_update BEFORE UPDATE ON affiliate_script_contexts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_SCRIPT_CONTEXT'); END;
CREATE TRIGGER affiliate_script_contexts_no_delete BEFORE DELETE ON affiliate_script_contexts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_AFFILIATE_SCRIPT_CONTEXT'); END;

CREATE TRIGGER affiliate_run_bindings_validate BEFORE INSERT ON affiliate_run_bindings
WHEN NOT EXISTS (
  SELECT 1 FROM affiliate_briefings b
  JOIN affiliate_campaign_revisions c ON c.campaign_id = b.campaign_id AND c.revision = b.campaign_revision
  JOIN pipeline_runs r ON r.pipeline_run_id = NEW.pipeline_run_id AND r.project_id = c.project_id AND r.state = 'RUNNING'
  WHERE b.briefing_id = NEW.briefing_id AND b.content_hash = NEW.briefing_hash
    AND c.campaign_id = NEW.campaign_id AND c.revision = NEW.campaign_revision
    AND c.product_id = NEW.product_id AND c.product_revision = NEW.product_revision
) OR EXISTS (SELECT 1 FROM scripts WHERE pipeline_run_id = NEW.pipeline_run_id)
  OR EXISTS (SELECT 1 FROM ai_call_telemetry WHERE pipeline_run_id = NEW.pipeline_run_id AND task_type = 'script_generation')
  OR EXISTS (SELECT 1 FROM affiliate_script_contexts WHERE pipeline_run_id = NEW.pipeline_run_id)
BEGIN SELECT RAISE(ABORT, 'AFFILIATE_RUN_BINDING_TOO_LATE_OR_INVALID'); END;

CREATE TRIGGER affiliate_script_contexts_validate BEFORE INSERT ON affiliate_script_contexts
WHEN (NEW.briefing_hash IS NULL AND EXISTS (
  SELECT 1 FROM affiliate_run_bindings WHERE pipeline_run_id = NEW.pipeline_run_id
)) OR (NEW.briefing_hash IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM affiliate_run_bindings WHERE pipeline_run_id = NEW.pipeline_run_id AND briefing_hash = NEW.briefing_hash
))
BEGIN SELECT RAISE(ABORT, 'AFFILIATE_SCRIPT_CONTEXT_MISMATCH'); END;
