-- Opt-in TTS dispatch audit. Does not change video policy or historical TTS rows.
CREATE TABLE tts_risk_dispatches_v2 (
  operation_id TEXT PRIMARY KEY REFERENCES tts_operations(operation_id),
  request_hash TEXT NOT NULL UNIQUE CHECK(length(request_hash)=64),
  approval_hash TEXT NOT NULL CHECK(length(approval_hash)=64),
  dispatched_at TEXT NOT NULL
);
CREATE TRIGGER tts_risk_dispatch_no_update BEFORE UPDATE ON tts_risk_dispatches_v2
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TTS_DISPATCH'); END;
CREATE TRIGGER tts_risk_dispatch_no_delete BEFORE DELETE ON tts_risk_dispatches_v2
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TTS_DISPATCH'); END;
