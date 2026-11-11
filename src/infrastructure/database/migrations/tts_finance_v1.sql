-- Explicit operational extension, independent of the legacy project schema version.
CREATE TABLE tts_finance_metadata(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO tts_finance_metadata VALUES(1);
CREATE TABLE tts_financial_approvals (
  operation_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  approval_json TEXT NOT NULL CHECK(json_valid(approval_json))
);
CREATE TABLE tts_operations (
  operation_id TEXT PRIMARY KEY REFERENCES tts_financial_approvals(operation_id),
  intent_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES video_generation_campaign_budgets(campaign_id),
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  state TEXT NOT NULL CHECK(state IN ('SUBMITTING','UNKNOWN','COMPLETED','REVIEW_REQUIRED')),
  created_at TEXT NOT NULL,
  audio_json TEXT CHECK(audio_json IS NULL OR json_valid(audio_json)),
  billing_json TEXT CHECK(billing_json IS NULL OR json_valid(billing_json)),
  reconciliation_reference TEXT,
  provider_request_id TEXT,
  error_code TEXT
);
CREATE TRIGGER tts_approval_no_update BEFORE UPDATE ON tts_financial_approvals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TTS_APPROVAL'); END;
CREATE TRIGGER tts_approval_no_delete BEFORE DELETE ON tts_financial_approvals BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TTS_APPROVAL'); END;
CREATE TRIGGER tts_operation_no_delete BEFORE DELETE ON tts_operations BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TTS_OPERATION'); END;
CREATE TRIGGER tts_operation_identity BEFORE UPDATE ON tts_operations
WHEN NEW.operation_id!=OLD.operation_id OR NEW.intent_hash!=OLD.intent_hash OR NEW.request_hash!=OLD.request_hash
 OR NEW.campaign_id!=OLD.campaign_id OR NEW.request_json!=OLD.request_json OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TTS_OPERATION'); END;
CREATE TRIGGER tts_operation_result BEFORE UPDATE ON tts_operations
WHEN (OLD.audio_json IS NOT NULL AND (NEW.audio_json IS NULL OR NEW.audio_json!=OLD.audio_json))
 OR (OLD.billing_json IS NOT NULL AND (NEW.billing_json IS NULL OR NEW.billing_json!=OLD.billing_json))
 OR (OLD.state IN ('COMPLETED','REVIEW_REQUIRED') AND NEW.state!=OLD.state)
 OR (OLD.state='UNKNOWN' AND NEW.state='SUBMITTING')
 OR (OLD.provider_request_id IS NOT NULL AND (NEW.provider_request_id IS NULL OR NEW.provider_request_id!=OLD.provider_request_id))
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_TTS_RESULT'); END;
