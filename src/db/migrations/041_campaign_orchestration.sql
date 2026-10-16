CREATE TABLE campaign_executions (
 execution_id TEXT PRIMARY KEY,
 campaign_id TEXT NOT NULL,
 campaign_revision INTEGER NOT NULL,
 production_date TEXT NOT NULL CHECK(length(production_date)=10),
 scheduled_at TEXT NOT NULL,
 run_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('SCHEDULED','RUNNING','WAITING_INPUT','WAITING_RECONCILIATION','SUCCEEDED','FAILED','CANCELLED')),
 version INTEGER NOT NULL CHECK(version>0),
 claim_token TEXT,
 claim_expires_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(campaign_id,production_date),
 FOREIGN KEY(campaign_id,campaign_revision) REFERENCES affiliate_campaign_revisions(campaign_id,revision),
 CHECK((claim_token IS NULL)=(claim_expires_at IS NULL)),
 CHECK((status='RUNNING')=(claim_token IS NOT NULL))
);
CREATE INDEX campaign_executions_due ON campaign_executions(status,scheduled_at);
CREATE TABLE campaign_execution_events (
 execution_id TEXT NOT NULL REFERENCES campaign_executions(execution_id),
 sequence INTEGER NOT NULL CHECK(sequence>0),
 event_type TEXT NOT NULL,
 previous_status TEXT,
 next_status TEXT NOT NULL,
 occurred_at TEXT NOT NULL,
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 PRIMARY KEY(execution_id,sequence)
);
CREATE TRIGGER campaign_events_no_update BEFORE UPDATE ON campaign_execution_events
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CAMPAIGN_EVENT'); END;
CREATE TRIGGER campaign_events_no_delete BEFORE DELETE ON campaign_execution_events
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CAMPAIGN_EVENT'); END;
CREATE TRIGGER campaign_execution_identity BEFORE UPDATE ON campaign_executions
WHEN NEW.execution_id IS NOT OLD.execution_id OR NEW.campaign_id IS NOT OLD.campaign_id
 OR NEW.campaign_revision IS NOT OLD.campaign_revision OR NEW.production_date IS NOT OLD.production_date
 OR NEW.scheduled_at IS NOT OLD.scheduled_at OR NEW.run_id IS NOT OLD.run_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CAMPAIGN_IDENTITY'); END;
CREATE TRIGGER campaign_execution_transition BEFORE UPDATE ON campaign_executions
WHEN NEW.status IS NOT OLD.status AND NOT (
 (OLD.status='SCHEDULED' AND NEW.status IN ('RUNNING','CANCELLED'))
 OR (OLD.status='RUNNING' AND NEW.status IN ('WAITING_INPUT','WAITING_RECONCILIATION','SUCCEEDED','FAILED','CANCELLED'))
 OR (OLD.status IN ('WAITING_INPUT','WAITING_RECONCILIATION','FAILED') AND NEW.status IN ('SCHEDULED','CANCELLED'))
)
BEGIN SELECT RAISE(ABORT,'INVALID_CAMPAIGN_TRANSITION'); END;
