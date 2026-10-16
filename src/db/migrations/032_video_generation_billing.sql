CREATE UNIQUE INDEX video_generation_provider_request
ON video_generation_operations(json_extract(request_json, '$.provider'), json_extract(result_json, '$.providerRequestId'))
WHERE json_extract(result_json, '$.providerRequestId') IS NOT NULL;
CREATE TRIGGER video_generation_provider_request_immutable BEFORE UPDATE ON video_generation_operations
WHEN json_extract(OLD.result_json, '$.providerRequestId') IS NOT NULL
  AND json_extract(NEW.result_json, '$.providerRequestId') IS NOT json_extract(OLD.result_json, '$.providerRequestId')
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_PROVIDER_REQUEST_ID'); END;
CREATE TABLE video_generation_billing (
  generation_request_id TEXT PRIMARY KEY REFERENCES video_generation_operations(generation_request_id),
  provider_request_id TEXT NOT NULL,
  actual_cost_usd TEXT NOT NULL,
  evidence_reference TEXT NOT NULL
);
CREATE TRIGGER video_generation_billing_no_update BEFORE UPDATE ON video_generation_billing
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_BILLING'); END;
CREATE TRIGGER video_generation_billing_no_delete BEFORE DELETE ON video_generation_billing
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VIDEO_BILLING'); END;
