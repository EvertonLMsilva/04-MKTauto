-- Additive extension of the existing ledger. V1 rows and triggers are untouched.
CREATE TABLE cost_adjustments (
 adjustment_id TEXT PRIMARY KEY,
 original_cost_event_id TEXT NOT NULL REFERENCES cost_events(cost_event_id),
 tts_operation_id TEXT NOT NULL REFERENCES tts_operations(operation_id),
 delta_units TEXT NOT NULL CHECK(length(delta_units)<=59 AND (
   (delta_units GLOB '[1-9]*' AND delta_units NOT GLOB '*[^0-9]*') OR
   (delta_units GLOB '-[1-9]*' AND substr(delta_units,2) NOT GLOB '*[^0-9]*'))),
 currency TEXT NOT NULL CHECK(currency='USD'),
 evidence_reference TEXT NOT NULL CHECK(length(trim(evidence_reference))>0),
 evidence_hash TEXT NOT NULL CHECK(length(evidence_hash)=64 AND evidence_hash NOT GLOB '*[^0-9a-f]*'),
 idempotency_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 identity_hash TEXT NOT NULL CHECK(length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
 UNIQUE(original_cost_event_id,tts_operation_id)
);
CREATE INDEX cost_adjustments_original ON cost_adjustments(original_cost_event_id);
CREATE TRIGGER cost_adjustments_no_update BEFORE UPDATE ON cost_adjustments BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_ADJUSTMENT'); END;
CREATE TRIGGER cost_adjustments_no_delete BEFORE DELETE ON cost_adjustments BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COST_ADJUSTMENT'); END;
CREATE TRIGGER cost_adjustments_validate_scope BEFORE INSERT ON cost_adjustments
WHEN NOT EXISTS (
 SELECT 1 FROM cost_events c JOIN tts_operations t ON t.operation_id=NEW.tts_operation_id
 WHERE c.cost_event_id=NEW.original_cost_event_id AND c.cost_event_id='tts_cost:'||t.operation_id
 AND c.category='voice_cost' AND c.currency=NEW.currency AND c.origin='openai'
 AND c.pipeline_run_id=json_extract(t.request_json,'$.operation.pipelineRunId')
 AND t.state IN ('COMPLETED','REVIEW_REQUIRED') AND t.billing_json IS NOT NULL
 AND t.reconciliation_reference IS NOT NULL
 AND NEW.evidence_reference=json_extract(t.billing_json,'$.evidenceReference')
)
BEGIN SELECT RAISE(ABORT,'COST_ADJUSTMENT_SCOPE_INVALID'); END;
-- Compare canonical integer strings rather than SQLite REAL (no rounding).
-- One adjustment per original/operation makes this bound sufficient for reductions.
CREATE TRIGGER cost_adjustments_nonnegative BEFORE INSERT ON cost_adjustments
WHEN substr(NEW.delta_units,1,1)='-' AND EXISTS (
 SELECT 1 FROM (
   SELECT ltrim(
     CASE WHEN instr(amount,'.')=0 THEN amount||'000000000000000000'
     ELSE substr(amount,1,instr(amount,'.')-1)||substr(substr(amount,instr(amount,'.')+1)||'000000000000000000',1,18) END,
     '0') AS original_units
   FROM cost_events WHERE cost_event_id=NEW.original_cost_event_id
 ) WHERE length(substr(NEW.delta_units,2))>length(original_units)
 OR (length(substr(NEW.delta_units,2))=length(original_units)
     AND substr(NEW.delta_units,2)>original_units COLLATE BINARY)
)
BEGIN SELECT RAISE(ABORT,'COST_ADJUSTMENT_NEGATIVE_BALANCE'); END;
