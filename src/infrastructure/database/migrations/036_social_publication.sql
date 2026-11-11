CREATE TABLE social_publication_operations (
 operation_id TEXT PRIMARY KEY,
 package_hash TEXT NOT NULL CHECK(length(package_hash)=64),
 account_id TEXT NOT NULL,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(json_extract(payload_json,'$.state') IN ('PREPARED','CREATING_CONTAINER','PROCESSING','READY','PUBLISHING','PUBLISHED','UNCERTAIN','FAILED','EXPIRED','BLOCKED')),
 version INTEGER NOT NULL DEFAULT 0,
 UNIQUE(package_hash,account_id)
);
CREATE TABLE social_publication_commands (
 idempotency_key TEXT PRIMARY KEY,
 request_hash TEXT NOT NULL,
 operation_id TEXT NOT NULL REFERENCES social_publication_operations(operation_id)
);
CREATE TABLE social_publication_events (
 operation_id TEXT NOT NULL REFERENCES social_publication_operations(operation_id),
 version INTEGER NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 PRIMARY KEY(operation_id,version)
);
CREATE UNIQUE INDEX social_publication_media_id ON social_publication_operations(
 account_id,json_extract(payload_json,'$.mediaId')
) WHERE json_extract(payload_json,'$.mediaId') IS NOT NULL;
CREATE TRIGGER social_events_no_update BEFORE UPDATE ON social_publication_events
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOCIAL_EVENT'); END;
CREATE TRIGGER social_events_no_delete BEFORE DELETE ON social_publication_events
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOCIAL_EVENT'); END;
CREATE TRIGGER social_operations_no_delete BEFORE DELETE ON social_publication_operations
BEGIN SELECT RAISE(ABORT,'PERSISTENT_SOCIAL_IDENTITY'); END;
CREATE TRIGGER social_commands_no_update BEFORE UPDATE ON social_publication_commands
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOCIAL_COMMAND'); END;
CREATE TRIGGER social_commands_no_delete BEFORE DELETE ON social_publication_commands
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOCIAL_COMMAND'); END;
