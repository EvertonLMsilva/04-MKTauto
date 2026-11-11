CREATE TABLE video_generation_campaign_budgets (
  campaign_id TEXT PRIMARY KEY,
  campaign_revision INTEGER NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
  FOREIGN KEY (campaign_id, campaign_revision) REFERENCES affiliate_campaign_revisions(campaign_id, revision)
);
CREATE TABLE video_generation_operations (
  generation_request_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES video_generation_campaign_budgets(campaign_id),
  pipeline_run_id TEXT NOT NULL REFERENCES affiliate_run_bindings(pipeline_run_id),
  original_slot INTEGER NOT NULL CHECK (original_slot > 0),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  ceiling_json TEXT NOT NULL CHECK (json_valid(ceiling_json)),
  state TEXT NOT NULL CHECK (state IN ('RESERVED','SUBMITTING','SUBMITTED','UNKNOWN','COMPLETED','FAILED','CANCELLED')),
  owner_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  cost_event_id TEXT NOT NULL UNIQUE,
  CHECK ((state IN ('RESERVED','SUBMITTING','CANCELLED') AND result_json IS NULL)
    OR (state IN ('SUBMITTED','UNKNOWN','COMPLETED','FAILED') AND result_json IS NOT NULL AND json_extract(result_json, '$.state') = state))
);
CREATE UNIQUE INDEX video_generation_original_slot ON video_generation_operations(campaign_id, original_slot) WHERE state != 'CANCELLED';
CREATE TRIGGER video_generation_policy_no_update BEFORE UPDATE ON video_generation_campaign_budgets
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_BUDGET'); END;
CREATE TRIGGER video_generation_policy_no_delete BEFORE DELETE ON video_generation_campaign_budgets
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_BUDGET'); END;
CREATE TRIGGER video_generation_identity_no_update BEFORE UPDATE ON video_generation_operations
WHEN NEW.generation_request_id != OLD.generation_request_id OR NEW.campaign_id != OLD.campaign_id
  OR NEW.pipeline_run_id != OLD.pipeline_run_id OR NEW.original_slot != OLD.original_slot
  OR NEW.request_hash != OLD.request_hash OR NEW.request_json != OLD.request_json OR NEW.cost_event_id != OLD.cost_event_id
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_GENERATION_IDENTITY'); END;
CREATE TRIGGER video_generation_operation_no_delete BEFORE DELETE ON video_generation_operations
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_GENERATION_OPERATION'); END;
CREATE TRIGGER video_generation_operation_transition BEFORE UPDATE ON video_generation_operations
WHEN NOT (
  (OLD.state = 'CANCELLED' AND NEW.state = 'RESERVED')
  OR (OLD.state = 'RESERVED' AND NEW.state IN ('SUBMITTING','CANCELLED')
    AND NEW.owner_token = OLD.owner_token AND NEW.ceiling_json = OLD.ceiling_json AND NEW.created_at = OLD.created_at)
  OR (OLD.state IN ('SUBMITTING','SUBMITTED','UNKNOWN') AND NEW.state IN ('SUBMITTED','UNKNOWN','COMPLETED','FAILED')
    AND NEW.owner_token = OLD.owner_token AND NEW.ceiling_json = OLD.ceiling_json AND NEW.created_at = OLD.created_at)
)
BEGIN SELECT RAISE(ABORT, 'INVALID_VIDEO_GENERATION_TRANSITION'); END;
