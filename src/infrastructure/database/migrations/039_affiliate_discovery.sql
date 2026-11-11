CREATE TABLE affiliate_discovery_decisions (
 discovery_run_id TEXT PRIMARY KEY,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 selected_external_product_id TEXT UNIQUE,
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE TRIGGER affiliate_discovery_decisions_no_update BEFORE UPDATE ON affiliate_discovery_decisions
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AFFILIATE_DISCOVERY'); END;
CREATE TRIGGER affiliate_discovery_decisions_no_delete BEFORE DELETE ON affiliate_discovery_decisions
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AFFILIATE_DISCOVERY'); END;
CREATE TABLE affiliate_discovery_execution (
 discovery_run_id TEXT PRIMARY KEY REFERENCES affiliate_discovery_decisions(discovery_run_id),
 state TEXT NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED','BLOCKED','UNKNOWN')),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
);
CREATE TABLE affiliate_discovery_events (
 id INTEGER PRIMARY KEY,
 discovery_run_id TEXT NOT NULL REFERENCES affiliate_discovery_decisions(discovery_run_id),
 state TEXT NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED','BLOCKED','UNKNOWN')),
 recorded_at TEXT NOT NULL,
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
);
CREATE TRIGGER affiliate_discovery_events_no_update BEFORE UPDATE ON affiliate_discovery_events
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AFFILIATE_DISCOVERY_EVENT'); END;
CREATE TRIGGER affiliate_discovery_events_no_delete BEFORE DELETE ON affiliate_discovery_events
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AFFILIATE_DISCOVERY_EVENT'); END;
CREATE TRIGGER affiliate_discovery_execution_no_delete BEFORE DELETE ON affiliate_discovery_execution
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AFFILIATE_DISCOVERY_EXECUTION'); END;
CREATE TRIGGER affiliate_discovery_execution_transition BEFORE UPDATE ON affiliate_discovery_execution
WHEN NEW.discovery_run_id IS NOT OLD.discovery_run_id OR NOT (
 (OLD.state='RUNNING' AND NEW.state IN ('SUCCEEDED','FAILED','BLOCKED','UNKNOWN'))
 OR (OLD.state IN ('FAILED','BLOCKED') AND NEW.state='RUNNING')
)
BEGIN SELECT RAISE(ABORT,'INVALID_AFFILIATE_DISCOVERY_TRANSITION'); END;
