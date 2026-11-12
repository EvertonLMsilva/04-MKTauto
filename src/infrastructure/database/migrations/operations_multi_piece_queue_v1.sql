-- Explicit offline administrative extension; never installed at application startup.
-- E-009 is a prerequisite. No changes to existing tables or user_version.
PRAGMA foreign_keys=ON;
BEGIN IMMEDIATE;
SELECT plan_hash FROM operations_multi_piece_plans_v1 LIMIT 0;
SELECT occurrence_id FROM operations_multi_piece_plan_occurrences_v1 LIMIT 0;
CREATE TABLE operations_multi_piece_queue_plans_v1 (
 plan_hash TEXT NOT NULL PRIMARY KEY REFERENCES operations_multi_piece_plans_v1(plan_hash),
 occurrence_count INTEGER NOT NULL CHECK(typeof(occurrence_count)='integer' AND occurrence_count>0),
 manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
 created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL)
);
CREATE TABLE operations_multi_piece_queue_entries_v1 (
 plan_hash TEXT NOT NULL, occurrence_id TEXT NOT NULL, piece_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>=0),
 destination_id TEXT NOT NULL, content_type TEXT NOT NULL CHECK(content_type IN ('VIDEO','IMAGE')),
 project_id TEXT NOT NULL, project_version INTEGER NOT NULL CHECK(project_version>0),
 campaign_id TEXT NOT NULL, campaign_revision INTEGER NOT NULL CHECK(campaign_revision>0),
 planned_at TEXT, local_date TEXT NOT NULL, local_time TEXT,
 initial_state TEXT NOT NULL CHECK(initial_state IN ('PLANNED','BLOCKED')),
 blockers_json TEXT NOT NULL CHECK(json_valid(blockers_json) AND json_type(blockers_json)='array'),
 identity_hash TEXT NOT NULL CHECK(length(identity_hash)=64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
 identity_json TEXT NOT NULL CHECK(json_valid(identity_json)) CHECK(json_extract(identity_json,'$.occurrenceId') IS occurrence_id),
 state TEXT NOT NULL CHECK(state IN ('PLANNED','BLOCKED','CLAIMED_FOR_OFFLINE_REVIEW','REVIEW_PENDING','UNKNOWN')),
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version>=0),
 owner_worker_id TEXT, owner_session_id TEXT, claim_id TEXT,
 owner_json TEXT NOT NULL CHECK(json_valid(owner_json)),
 head_event_hash TEXT NOT NULL,
 created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL),
 updated_at TEXT NOT NULL CHECK(julianday(updated_at) IS NOT NULL),
 PRIMARY KEY(plan_hash,occurrence_id), UNIQUE(plan_hash,ordinal),
 FOREIGN KEY(plan_hash,occurrence_id) REFERENCES operations_multi_piece_plan_occurrences_v1(plan_hash,occurrence_id),
 FOREIGN KEY(plan_hash) REFERENCES operations_multi_piece_queue_plans_v1(plan_hash) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(head_event_hash) REFERENCES operations_multi_piece_queue_events_v1(event_hash) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state IN ('PLANNED','BLOCKED') AND owner_json='null' AND owner_worker_id IS NULL AND owner_session_id IS NULL AND claim_id IS NULL)
 OR (state IN ('CLAIMED_FOR_OFFLINE_REVIEW','REVIEW_PENDING','UNKNOWN') AND owner_worker_id IS NOT NULL AND owner_session_id IS NOT NULL AND claim_id IS NOT NULL
 AND json_extract(owner_json,'$.workerId') IS owner_worker_id AND json_extract(owner_json,'$.sessionId') IS owner_session_id AND json_extract(owner_json,'$.claimId') IS claim_id))
);
CREATE INDEX operations_multi_piece_queue_campaign_v1 ON operations_multi_piece_queue_entries_v1(campaign_id,campaign_revision,planned_at);
CREATE INDEX operations_multi_piece_queue_destination_v1 ON operations_multi_piece_queue_entries_v1(destination_id,state,planned_at);
CREATE TABLE operations_multi_piece_queue_events_v1 (
 plan_hash TEXT NOT NULL, occurrence_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version>=0),
 request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 kind TEXT NOT NULL CHECK(kind IN ('ENQUEUED','CLAIM','REVIEW_PENDING','MARK_UNKNOWN')),
 previous_state TEXT, state TEXT NOT NULL CHECK(state IN ('PLANNED','BLOCKED','CLAIMED_FOR_OFFLINE_REVIEW','REVIEW_PENDING','UNKNOWN')),
 previous_event_hash TEXT REFERENCES operations_multi_piece_queue_events_v1(event_hash),
 event_hash TEXT NOT NULL UNIQUE CHECK(length(event_hash)=64 AND event_hash NOT GLOB '*[^0-9a-f]*'),
 owner_json TEXT NOT NULL CHECK(json_valid(owner_json)), actor_json TEXT NOT NULL CHECK(json_valid(actor_json)),
 created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL),
 event_json TEXT NOT NULL CHECK(json_valid(event_json)) CHECK(json_extract(event_json,'$.eventHash') IS event_hash),
 PRIMARY KEY(plan_hash,occurrence_id,version),
 FOREIGN KEY(plan_hash,occurrence_id) REFERENCES operations_multi_piece_queue_entries_v1(plan_hash,occurrence_id)
);
CREATE UNIQUE INDEX operations_multi_piece_queue_claim_once_v1 ON operations_multi_piece_queue_events_v1(plan_hash,occurrence_id) WHERE kind='CLAIM';
CREATE TRIGGER operations_multi_piece_queue_plans_v1_no_update BEFORE UPDATE ON operations_multi_piece_queue_plans_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_QUEUE_IMMUTABLE'); END;
CREATE TRIGGER operations_multi_piece_queue_plans_v1_no_delete BEFORE DELETE ON operations_multi_piece_queue_plans_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_QUEUE_IMMUTABLE'); END;
CREATE TRIGGER operations_multi_piece_queue_events_v1_no_update BEFORE UPDATE ON operations_multi_piece_queue_events_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_QUEUE_IMMUTABLE'); END;
CREATE TRIGGER operations_multi_piece_queue_events_v1_no_delete BEFORE DELETE ON operations_multi_piece_queue_events_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_QUEUE_IMMUTABLE'); END;
CREATE TRIGGER operations_multi_piece_queue_entries_v1_no_delete BEFORE DELETE ON operations_multi_piece_queue_entries_v1 BEGIN SELECT RAISE(ABORT,'MULTI_PIECE_QUEUE_IMMUTABLE'); END;
CREATE TRIGGER operations_multi_piece_queue_entries_v1_insert BEFORE INSERT ON operations_multi_piece_queue_entries_v1 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM operations_multi_piece_queue_plans_v1 WHERE plan_hash=NEW.plan_hash)
 THEN RAISE(ABORT,'MULTI_PIECE_QUEUE_SEALED') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM operations_multi_piece_plan_occurrences_v1 o
 JOIN operations_multi_piece_plan_pieces_v1 p ON p.plan_hash=o.plan_hash AND p.piece_id=o.piece_id
 JOIN operations_multi_piece_plans_v1 h ON h.plan_hash=o.plan_hash
 WHERE o.plan_hash=NEW.plan_hash AND o.occurrence_id=NEW.occurrence_id AND o.ordinal=NEW.ordinal
 AND o.piece_id=NEW.piece_id AND o.destination_id=NEW.destination_id AND o.planned_at IS NEW.planned_at
 AND h.project_id=NEW.project_id AND h.project_version=NEW.project_version AND p.content_type=NEW.content_type
 AND p.campaign_id=NEW.campaign_id AND p.campaign_revision=NEW.campaign_revision AND p.local_date=NEW.local_date AND p.local_time IS NEW.local_time
 AND o.status=NEW.initial_state AND json(json_extract(o.payload_json,'$.blockers'))=json(NEW.blockers_json)
 AND NEW.state=NEW.initial_state AND NEW.version=0 AND NEW.owner_json='null' AND NEW.created_at=NEW.updated_at)
 THEN RAISE(ABORT,'MULTI_PIECE_QUEUE_SOURCE_MISMATCH') END;
END;
CREATE TRIGGER operations_multi_piece_queue_entries_v1_update BEFORE UPDATE ON operations_multi_piece_queue_entries_v1 BEGIN
 SELECT CASE WHEN NEW.plan_hash IS NOT OLD.plan_hash OR NEW.occurrence_id IS NOT OLD.occurrence_id OR NEW.piece_id IS NOT OLD.piece_id
 OR NEW.ordinal IS NOT OLD.ordinal OR NEW.destination_id IS NOT OLD.destination_id OR NEW.content_type IS NOT OLD.content_type
 OR NEW.project_id IS NOT OLD.project_id OR NEW.project_version IS NOT OLD.project_version OR NEW.campaign_id IS NOT OLD.campaign_id
 OR NEW.campaign_revision IS NOT OLD.campaign_revision OR NEW.planned_at IS NOT OLD.planned_at OR NEW.local_date IS NOT OLD.local_date
 OR NEW.local_time IS NOT OLD.local_time OR NEW.initial_state IS NOT OLD.initial_state OR NEW.blockers_json IS NOT OLD.blockers_json
 OR NEW.identity_hash IS NOT OLD.identity_hash OR NEW.identity_json IS NOT OLD.identity_json OR NEW.created_at IS NOT OLD.created_at
 THEN RAISE(ABORT,'MULTI_PIECE_QUEUE_IDENTITY_IMMUTABLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM operations_multi_piece_queue_events_v1 e WHERE e.plan_hash=OLD.plan_hash AND e.occurrence_id=OLD.occurrence_id
 AND e.version=OLD.version+1 AND e.version=NEW.version AND e.previous_state=OLD.state AND e.previous_event_hash=OLD.head_event_hash
 AND e.event_hash=NEW.head_event_hash AND e.state=NEW.state AND e.owner_json=NEW.owner_json AND e.created_at=NEW.updated_at
 AND json_extract(e.owner_json,'$.workerId') IS NEW.owner_worker_id AND json_extract(e.owner_json,'$.sessionId') IS NEW.owner_session_id AND json_extract(e.owner_json,'$.claimId') IS NEW.claim_id)
 THEN RAISE(ABORT,'MULTI_PIECE_QUEUE_INVALID_TRANSITION') END;
END;
CREATE TRIGGER operations_multi_piece_queue_events_v1_insert BEFORE INSERT ON operations_multi_piece_queue_events_v1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM operations_multi_piece_queue_entries_v1 e WHERE e.plan_hash=NEW.plan_hash AND e.occurrence_id=NEW.occurrence_id)
 THEN RAISE(ABORT,'MULTI_PIECE_QUEUE_INVALID_EVENT') END;
 SELECT CASE WHEN NEW.version=0 AND NOT EXISTS(SELECT 1 FROM operations_multi_piece_queue_entries_v1 e WHERE e.plan_hash=NEW.plan_hash AND e.occurrence_id=NEW.occurrence_id
 AND NEW.kind='ENQUEUED' AND NEW.previous_state IS NULL AND NEW.previous_event_hash IS NULL AND NEW.state=e.initial_state AND e.version=0
 AND NEW.owner_json='null' AND NEW.actor_json='null' AND NEW.event_hash=e.head_event_hash AND NEW.created_at=e.created_at
 AND NOT EXISTS(SELECT 1 FROM operations_multi_piece_queue_plans_v1 WHERE plan_hash=NEW.plan_hash))
 THEN RAISE(ABORT,'MULTI_PIECE_QUEUE_INVALID_EVENT') END;
 SELECT CASE WHEN NEW.version>0 AND NOT EXISTS(SELECT 1 FROM operations_multi_piece_queue_entries_v1 e WHERE e.plan_hash=NEW.plan_hash AND e.occurrence_id=NEW.occurrence_id
 AND NEW.version=e.version+1 AND NEW.previous_state=e.state AND NEW.previous_event_hash=e.head_event_hash
 AND EXISTS(SELECT 1 FROM operations_multi_piece_queue_plans_v1 WHERE plan_hash=NEW.plan_hash)
 AND ((NEW.kind='CLAIM' AND e.state='PLANNED' AND NEW.state='CLAIMED_FOR_OFFLINE_REVIEW' AND e.owner_json='null' AND json_array_length(e.blockers_json)=0 AND e.planned_at IS NOT NULL
 AND json_extract(NEW.owner_json,'$.workerId') IS NOT NULL AND json_extract(NEW.owner_json,'$.workerId')=json_extract(NEW.actor_json,'$.workerId')
 AND json_extract(NEW.owner_json,'$.sessionId') IS NOT NULL AND json_extract(NEW.owner_json,'$.sessionId')=json_extract(NEW.actor_json,'$.sessionId') AND json_extract(NEW.owner_json,'$.claimId')=NEW.request_hash)
 OR (e.state='CLAIMED_FOR_OFFLINE_REVIEW' AND NEW.owner_json=e.owner_json AND json_extract(NEW.actor_json,'$.workerId')=e.owner_worker_id
 AND ((NEW.kind='MARK_UNKNOWN' AND NEW.state='UNKNOWN') OR (NEW.kind='REVIEW_PENDING' AND NEW.state='REVIEW_PENDING' AND json_extract(NEW.actor_json,'$.sessionId')=e.owner_session_id)))))
 THEN RAISE(ABORT,'MULTI_PIECE_QUEUE_INVALID_EVENT') END;
END;
CREATE TRIGGER operations_multi_piece_queue_events_v1_apply AFTER INSERT ON operations_multi_piece_queue_events_v1 WHEN NEW.version>0 BEGIN
 UPDATE operations_multi_piece_queue_entries_v1 SET state=NEW.state,version=NEW.version,owner_json=NEW.owner_json,
 owner_worker_id=json_extract(NEW.owner_json,'$.workerId'),owner_session_id=json_extract(NEW.owner_json,'$.sessionId'),claim_id=json_extract(NEW.owner_json,'$.claimId'),
 head_event_hash=NEW.event_hash,updated_at=NEW.created_at WHERE plan_hash=NEW.plan_hash AND occurrence_id=NEW.occurrence_id;
END;
CREATE TRIGGER operations_multi_piece_queue_plans_v1_seal BEFORE INSERT ON operations_multi_piece_queue_plans_v1 BEGIN
 SELECT CASE WHEN NEW.occurrence_count IS NOT (SELECT occurrence_count FROM operations_multi_piece_plans_v1 WHERE plan_hash=NEW.plan_hash)
 OR NEW.occurrence_count IS NOT (SELECT count(*) FROM operations_multi_piece_queue_entries_v1 WHERE plan_hash=NEW.plan_hash)
 OR NEW.occurrence_count IS NOT (SELECT count(*) FROM operations_multi_piece_queue_events_v1 WHERE plan_hash=NEW.plan_hash AND version=0)
 THEN RAISE(ABORT,'MULTI_PIECE_QUEUE_INCOMPLETE') END;
END;
COMMIT;
