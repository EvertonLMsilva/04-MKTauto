-- Additive, explicit administrative extension. Not part of schema-provisioner.
-- No user_version change and no references/writes to operational execution tables.
PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
CREATE TABLE operations_multi_piece_plans_v1 (
 plan_hash TEXT NOT NULL PRIMARY KEY CHECK(length(plan_hash)=64 AND plan_hash NOT GLOB '*[^0-9a-f]*'),
 schema_version TEXT NOT NULL CHECK(schema_version='operations-multi-piece-calendar/1.0.0'),
 project_id TEXT NOT NULL,
 project_version INTEGER NOT NULL CHECK(typeof(project_version)='integer' AND project_version>0),
 time_zone TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
 profile TEXT NOT NULL CHECK(profile='FOUR_WEEK_MULTI_PIECE'),
 status TEXT NOT NULL CHECK(status IN ('PLANNED','BLOCKED')),
 piece_count INTEGER NOT NULL CHECK(typeof(piece_count)='integer' AND piece_count>0),
 occurrence_count INTEGER NOT NULL CHECK(typeof(occurrence_count)='integer' AND occurrence_count>=piece_count),
 input_json TEXT NOT NULL CHECK(json_valid(input_json)),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(json_extract(payload_json,'$.planHash') IS plan_hash),
 created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL),
 UNIQUE(plan_hash,project_id)
);
CREATE INDEX operations_multi_piece_plans_project_v1 ON operations_multi_piece_plans_v1(project_id,created_at,plan_hash);
CREATE TABLE operations_multi_piece_plan_pieces_v1 (
 plan_hash TEXT NOT NULL REFERENCES operations_multi_piece_plans_v1(plan_hash),
 piece_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>=0),
 campaign_id TEXT NOT NULL, campaign_revision INTEGER NOT NULL CHECK(typeof(campaign_revision)='integer' AND campaign_revision>0),
 content_type TEXT NOT NULL CHECK(content_type IN ('VIDEO','IMAGE')),
 local_date TEXT NOT NULL, local_time TEXT, planned_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('PLANNED','BLOCKED')),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(json_extract(payload_json,'$.pieceId') IS piece_id),
 PRIMARY KEY(plan_hash,piece_id), UNIQUE(plan_hash,ordinal)
);
CREATE INDEX operations_multi_piece_plan_campaign_v1 ON operations_multi_piece_plan_pieces_v1(campaign_id,campaign_revision,plan_hash);
CREATE TABLE operations_multi_piece_plan_occurrences_v1 (
 plan_hash TEXT NOT NULL, occurrence_id TEXT NOT NULL, piece_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>=0),
 destination_id TEXT NOT NULL, planned_at TEXT,
 status TEXT NOT NULL CHECK(status IN ('PLANNED','BLOCKED')),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(json_extract(payload_json,'$.occurrenceId') IS occurrence_id),
 PRIMARY KEY(plan_hash,occurrence_id), UNIQUE(plan_hash,ordinal), UNIQUE(plan_hash,piece_id,destination_id),
 FOREIGN KEY(plan_hash,piece_id) REFERENCES operations_multi_piece_plan_pieces_v1(plan_hash,piece_id)
);
CREATE INDEX operations_multi_piece_plan_destination_v1 ON operations_multi_piece_plan_occurrences_v1(destination_id,planned_at,plan_hash);
-- Separate immutable request bindings allow multiple idempotency keys to reference
-- one plan without duplicating content. First binding also seals its child rows.
CREATE TABLE operations_multi_piece_plan_requests_v1 (
 project_id TEXT NOT NULL, request_id TEXT NOT NULL, plan_hash TEXT NOT NULL,
 created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL),
 receipt_hash TEXT NOT NULL CHECK(length(receipt_hash)=64 AND receipt_hash NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(project_id,request_id),
 FOREIGN KEY(plan_hash,project_id) REFERENCES operations_multi_piece_plans_v1(plan_hash,project_id)
);
CREATE INDEX operations_multi_piece_plan_request_hash_v1 ON operations_multi_piece_plan_requests_v1(plan_hash,created_at,request_id);
CREATE TRIGGER operations_multi_piece_plans_v1_no_update BEFORE UPDATE ON operations_multi_piece_plans_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plans_v1_no_delete BEFORE DELETE ON operations_multi_piece_plans_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plan_pieces_v1_no_update BEFORE UPDATE ON operations_multi_piece_plan_pieces_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plan_pieces_v1_no_delete BEFORE DELETE ON operations_multi_piece_plan_pieces_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plan_occurrences_v1_no_update BEFORE UPDATE ON operations_multi_piece_plan_occurrences_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plan_occurrences_v1_no_delete BEFORE DELETE ON operations_multi_piece_plan_occurrences_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plan_requests_v1_no_update BEFORE UPDATE ON operations_multi_piece_plan_requests_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plan_requests_v1_no_delete BEFORE DELETE ON operations_multi_piece_plan_requests_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plan_pieces_v1_sealed BEFORE INSERT ON operations_multi_piece_plan_pieces_v1
 WHEN EXISTS(SELECT 1 FROM operations_multi_piece_plan_requests_v1 WHERE plan_hash=NEW.plan_hash)
 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plan_occurrences_v1_sealed BEFORE INSERT ON operations_multi_piece_plan_occurrences_v1
 WHEN EXISTS(SELECT 1 FROM operations_multi_piece_plan_requests_v1 WHERE plan_hash=NEW.plan_hash)
 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_APPEND_ONLY'); END;
CREATE TRIGGER operations_multi_piece_plan_requests_v1_complete BEFORE INSERT ON operations_multi_piece_plan_requests_v1
 WHEN NOT EXISTS(SELECT 1 FROM operations_multi_piece_plans_v1 p WHERE p.plan_hash=NEW.plan_hash
 AND p.piece_count=(SELECT count(*) FROM operations_multi_piece_plan_pieces_v1 WHERE plan_hash=NEW.plan_hash)
 AND p.occurrence_count=(SELECT count(*) FROM operations_multi_piece_plan_occurrences_v1 WHERE plan_hash=NEW.plan_hash))
 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_INCOMPLETE'); END;
COMMIT;
