CREATE TABLE fal_generations (
  generation_key TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  basis_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('DISPATCHING','IN_QUEUE','IN_PROGRESS','COMPLETED','FAILED','RECONCILIATION_PENDING')),
  request_id TEXT UNIQUE,
  status_url TEXT,
  response_url TEXT,
  estimate_amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  estimate_source TEXT NOT NULL,
  output_json TEXT,
  output_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE fal_generation_requests (
  acquisition_request_id TEXT PRIMARY KEY,
  generation_key TEXT NOT NULL REFERENCES fal_generations(generation_key),
  request_hash TEXT NOT NULL
);
CREATE TRIGGER fal_generation_identity_immutable BEFORE UPDATE ON fal_generations
WHEN NEW.generation_key != OLD.generation_key OR NEW.pipeline_run_id != OLD.pipeline_run_id
  OR NEW.basis_json != OLD.basis_json OR NEW.estimate_amount != OLD.estimate_amount
  OR NEW.currency != OLD.currency OR NEW.estimate_source != OLD.estimate_source
  OR (OLD.request_id IS NOT NULL AND NEW.request_id IS NOT OLD.request_id)
  OR (OLD.status_url IS NOT NULL AND NEW.status_url IS NOT OLD.status_url)
  OR (OLD.response_url IS NOT NULL AND NEW.response_url IS NOT OLD.response_url)
  OR (OLD.output_json IS NOT NULL AND NEW.output_json IS NOT OLD.output_json)
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_FAL_GENERATION'); END;
CREATE TRIGGER fal_generation_no_delete BEFORE DELETE ON fal_generations
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_FAL_GENERATION'); END;
CREATE TRIGGER fal_generation_request_no_update BEFORE UPDATE ON fal_generation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_FAL_GENERATION_REQUEST'); END;
CREATE TRIGGER fal_generation_request_no_delete BEFORE DELETE ON fal_generation_requests
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_FAL_GENERATION_REQUEST'); END;
