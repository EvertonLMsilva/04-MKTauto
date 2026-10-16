CREATE TABLE video_generation_estimate_approvals (
  request_hash TEXT PRIMARY KEY CHECK (length(request_hash)=64),
  campaign_id TEXT NOT NULL REFERENCES video_generation_campaign_budgets(campaign_id),
  quote_hash TEXT NOT NULL CHECK (length(quote_hash)=64),
  approval_json TEXT NOT NULL CHECK (json_valid(approval_json))
);
CREATE TRIGGER video_estimate_approval_no_update BEFORE UPDATE ON video_generation_estimate_approvals
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_ESTIMATE_APPROVAL'); END;
CREATE TRIGGER video_estimate_approval_no_delete BEFORE DELETE ON video_generation_estimate_approvals
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_ESTIMATE_APPROVAL'); END;
