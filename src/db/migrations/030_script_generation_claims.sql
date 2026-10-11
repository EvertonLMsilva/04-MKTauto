CREATE TABLE script_generation_claims (
  generation_request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('RESERVED', 'RETRYABLE', 'DISPATCHING', 'RECONCILIATION_PENDING', 'TERMINAL')),
  owner_token TEXT NOT NULL,
  reserved_until INTEGER NOT NULL,
  FOREIGN KEY (generation_request_id) REFERENCES affiliate_script_contexts(generation_request_id)
);
-- An old context without terminal evidence may already have contacted a provider.
INSERT INTO script_generation_claims
SELECT generation_request_id, request_hash, 'RECONCILIATION_PENDING', 'legacy', 0
FROM affiliate_script_contexts;
CREATE TRIGGER script_generation_claim_identity_no_update
BEFORE UPDATE OF generation_request_id, request_hash ON script_generation_claims
BEGIN SELECT RAISE(ABORT, 'script generation identity is immutable'); END;
CREATE TRIGGER script_generation_claim_no_delete BEFORE DELETE ON script_generation_claims
BEGIN SELECT RAISE(ABORT, 'script generation claim cannot be deleted'); END;
CREATE TRIGGER script_generation_claim_state_transition BEFORE UPDATE ON script_generation_claims
WHEN NOT (
  (OLD.state = 'RESERVED' AND NEW.state IN ('DISPATCHING', 'RETRYABLE') AND NEW.owner_token = OLD.owner_token)
  OR (OLD.state = 'RESERVED' AND NEW.state = 'RESERVED' AND OLD.reserved_until <= CAST(unixepoch('subsec') * 1000 AS INTEGER))
  OR (OLD.state = 'RETRYABLE' AND NEW.state = 'RESERVED')
  OR (OLD.state = 'DISPATCHING' AND NEW.state IN ('TERMINAL', 'RECONCILIATION_PENDING') AND NEW.owner_token = OLD.owner_token)
)
BEGIN SELECT RAISE(ABORT, 'invalid script generation state transition'); END;
