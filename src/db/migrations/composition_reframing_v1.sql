DROP TRIGGER campaign_execution_transition;
CREATE TRIGGER campaign_execution_transition BEFORE UPDATE ON campaign_executions
WHEN NEW.status IS NOT OLD.status AND NOT (
 (OLD.status='SCHEDULED' AND NEW.status IN ('RUNNING','CANCELLED'))
 OR (OLD.status='RUNNING' AND NEW.status IN ('WAITING_INPUT','WAITING_RECONCILIATION','SUCCEEDED','FAILED','CANCELLED'))
 OR (OLD.status IN ('WAITING_INPUT','WAITING_RECONCILIATION','FAILED') AND NEW.status IN ('SCHEDULED','CANCELLED'))
 OR (OLD.status IN ('CANCELLED','SUCCEEDED') AND NEW.status='WAITING_INPUT'
   AND NEW.version=OLD.version+1 AND EXISTS (
     SELECT 1 FROM campaign_execution_events e
     WHERE e.execution_id=NEW.execution_id AND e.event_type='COMPOSITION_REVISED'
       AND e.previous_status=OLD.status AND e.next_status=NEW.status
       AND e.sequence=(SELECT MAX(sequence) FROM campaign_execution_events WHERE execution_id=NEW.execution_id)
       AND json_extract(e.evidence_json,'$.policyVersion')='product-contain/1.0.0'
       AND length(json_extract(e.evidence_json,'$.previousRenderContentHash'))=64
       AND length(json_extract(e.evidence_json,'$.actorId'))>=3
       AND length(json_extract(e.evidence_json,'$.reason'))>=15
   ))
)
BEGIN SELECT RAISE(ABORT,'INVALID_CAMPAIGN_TRANSITION'); END;
