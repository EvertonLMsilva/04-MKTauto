-- Administrative provisioner only: FK enforcement is restored after transactional
-- reconstruction and foreign_key_check. Existing owned indexes/triggers are saved
-- and restored by the provisioner; external references keep the canonical name.
CREATE TABLE social_publication_operations_v44 (
 operation_id TEXT PRIMARY KEY,
 package_hash TEXT NOT NULL CHECK(length(package_hash)=64),
 account_id TEXT NOT NULL,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(json_extract(payload_json,'$.state') IN ('PREPARED','CREATING_CONTAINER','PROCESSING','READY','PUBLISHING','PUBLISHED','UNCERTAIN','FAILED','EXPIRED','BLOCKED')),
 version INTEGER NOT NULL DEFAULT 0,
 supersession_revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(supersession_revision)='integer' AND supersession_revision>=0),
 root_operation_id TEXT REFERENCES social_publication_operations(operation_id),
 predecessor_id TEXT UNIQUE REFERENCES social_publication_operations(operation_id),
 supersession_id TEXT REFERENCES publication_supersessions(successor_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((supersession_revision=0 AND root_operation_id IS NULL AND predecessor_id IS NULL AND supersession_id IS NULL)
 OR (supersession_revision>0 AND root_operation_id IS NOT NULL AND predecessor_id IS NOT NULL AND supersession_id IS NOT NULL AND supersession_id=operation_id)),
 UNIQUE(root_operation_id,supersession_revision)
);
INSERT INTO social_publication_operations_v44(operation_id,package_hash,account_id,request_hash,payload_json,version)
 SELECT operation_id,package_hash,account_id,request_hash,payload_json,version FROM social_publication_operations;
DROP TABLE social_publication_operations;
ALTER TABLE social_publication_operations_v44 RENAME TO social_publication_operations;
CREATE UNIQUE INDEX social_publication_normal_identity ON social_publication_operations(package_hash,account_id) WHERE supersession_revision=0;

CREATE TABLE publication_supersessions (
 successor_id TEXT PRIMARY KEY REFERENCES social_publication_operations(operation_id),
 root_operation_id TEXT NOT NULL REFERENCES social_publication_operations(operation_id),
 predecessor_id TEXT NOT NULL UNIQUE REFERENCES social_publication_operations(operation_id),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>0),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
 authorization_id TEXT NOT NULL CHECK(length(trim(authorization_id)) BETWEEN 1 AND 200),
 superseded_at TEXT NOT NULL CHECK(julianday(superseded_at) IS NOT NULL),
 UNIQUE(root_operation_id,revision)
);
CREATE TABLE publication_active_ownership (
 execution_id TEXT NOT NULL REFERENCES campaign_executions(execution_id),
 campaign_id TEXT NOT NULL,
 artifact_hash TEXT NOT NULL CHECK(length(artifact_hash)=64),
 network TEXT NOT NULL CHECK(network IN ('INSTAGRAM','FACEBOOK_REELS')),
 account_id TEXT NOT NULL,
 reservation_operation_id TEXT NOT NULL UNIQUE REFERENCES social_publication_operations(operation_id),
 active_operation_id TEXT NOT NULL UNIQUE REFERENCES social_publication_operations(operation_id),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0),
 PRIMARY KEY(execution_id,network,account_id),
 UNIQUE(campaign_id,artifact_hash,network,account_id)
);
INSERT INTO publication_active_ownership
 SELECT execution_id,campaign_id,artifact_hash,network,account_id,operation_id,operation_id,0 FROM multi_network_publication_reservations;
INSERT INTO publication_active_ownership
 SELECT execution_id,campaign_id,artifact_hash,'INSTAGRAM',substr(destination,11),operation_id,operation_id,0 FROM instagram_publication_reservations;

CREATE TRIGGER publication_successor_binding BEFORE INSERT ON social_publication_operations
WHEN NEW.supersession_revision>0 AND NOT EXISTS (
 SELECT 1 FROM social_publication_operations root JOIN social_publication_operations prior ON prior.operation_id=NEW.predecessor_id
 JOIN publication_active_ownership own ON own.reservation_operation_id=root.operation_id AND own.active_operation_id=prior.operation_id
 WHERE root.operation_id=NEW.root_operation_id AND root.supersession_revision=0 AND own.network='FACEBOOK_REELS'
 AND own.revision+1=NEW.supersession_revision AND prior.supersession_revision=own.revision
 AND NEW.package_hash=root.package_hash AND NEW.account_id=root.account_id AND NEW.request_hash=root.request_hash
 AND json_extract(NEW.payload_json,'$.network')='FACEBOOK_REELS'
 AND json_extract(NEW.payload_json,'$.mediaHash')=json_extract(root.payload_json,'$.mediaHash')
 AND NEW.operation_id=root.operation_id||':supersession:'||NEW.supersession_revision||':'||root.request_hash
)
BEGIN SELECT RAISE(ABORT,'PUBLICATION_SUCCESSOR_BINDING_INVALID'); END;
CREATE TRIGGER publication_supersession_binding BEFORE INSERT ON publication_supersessions
WHEN NOT EXISTS (
 SELECT 1 FROM social_publication_operations o JOIN publication_active_ownership own ON own.active_operation_id=NEW.predecessor_id
 WHERE o.operation_id=NEW.successor_id AND o.root_operation_id=NEW.root_operation_id AND o.predecessor_id=NEW.predecessor_id
 AND o.supersession_revision=NEW.revision AND own.reservation_operation_id=NEW.root_operation_id AND own.revision+1=NEW.revision AND own.network='FACEBOOK_REELS'
)
BEGIN SELECT RAISE(ABORT,'PUBLICATION_SUPERSESSION_BINDING_INVALID'); END;
CREATE TRIGGER publication_supersession_transfer AFTER INSERT ON publication_supersessions
BEGIN UPDATE publication_active_ownership SET active_operation_id=NEW.successor_id,revision=NEW.revision
 WHERE active_operation_id=NEW.predecessor_id AND reservation_operation_id=NEW.root_operation_id; END;
CREATE TRIGGER publication_ownership_insert BEFORE INSERT ON publication_active_ownership
WHEN NEW.revision<>0 OR NEW.active_operation_id<>NEW.reservation_operation_id OR NOT (
 EXISTS(SELECT 1 FROM multi_network_publication_reservations r WHERE r.operation_id=NEW.reservation_operation_id
 AND r.execution_id=NEW.execution_id AND r.campaign_id=NEW.campaign_id AND r.artifact_hash=NEW.artifact_hash AND r.network=NEW.network AND r.account_id=NEW.account_id)
 OR (NEW.network='INSTAGRAM' AND EXISTS(SELECT 1 FROM instagram_publication_reservations r WHERE r.operation_id=NEW.reservation_operation_id
 AND r.execution_id=NEW.execution_id AND r.campaign_id=NEW.campaign_id AND r.artifact_hash=NEW.artifact_hash AND substr(r.destination,11)=NEW.account_id)))
BEGIN SELECT RAISE(ABORT,'PUBLICATION_OWNERSHIP_INVALID'); END;
CREATE TRIGGER publication_ownership_transfer BEFORE UPDATE ON publication_active_ownership
WHEN NEW.execution_id<>OLD.execution_id OR NEW.campaign_id<>OLD.campaign_id OR NEW.artifact_hash<>OLD.artifact_hash OR NEW.network<>OLD.network
 OR NEW.account_id<>OLD.account_id OR NEW.reservation_operation_id<>OLD.reservation_operation_id OR NOT EXISTS(
 SELECT 1 FROM publication_supersessions s WHERE s.predecessor_id=OLD.active_operation_id AND s.successor_id=NEW.active_operation_id
 AND s.root_operation_id=OLD.reservation_operation_id AND s.revision=NEW.revision AND NEW.revision=OLD.revision+1)
BEGIN SELECT RAISE(ABORT,'PUBLICATION_OWNERSHIP_INVALID'); END;
CREATE TRIGGER publication_ownership_no_delete BEFORE DELETE ON publication_active_ownership
BEGIN SELECT RAISE(ABORT,'PERSISTENT_PUBLICATION_OWNERSHIP'); END;
CREATE TRIGGER publication_supersessions_no_update BEFORE UPDATE ON publication_supersessions
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PUBLICATION_SUPERSESSION'); END;
CREATE TRIGGER publication_supersessions_no_delete BEFORE DELETE ON publication_supersessions
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PUBLICATION_SUPERSESSION'); END;
CREATE TRIGGER publication_operation_lineage_no_update BEFORE UPDATE ON social_publication_operations
WHEN NEW.operation_id<>OLD.operation_id OR NEW.package_hash<>OLD.package_hash OR NEW.account_id<>OLD.account_id OR NEW.request_hash<>OLD.request_hash
 OR NEW.supersession_revision<>OLD.supersession_revision OR NEW.root_operation_id IS NOT OLD.root_operation_id
 OR NEW.predecessor_id IS NOT OLD.predecessor_id OR NEW.supersession_id IS NOT OLD.supersession_id
 OR EXISTS(SELECT 1 FROM publication_supersessions s WHERE s.predecessor_id=OLD.operation_id)
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PUBLICATION_LINEAGE'); END;
CREATE TRIGGER publication_multi_reservation_owner AFTER INSERT ON multi_network_publication_reservations
BEGIN INSERT INTO publication_active_ownership VALUES(NEW.execution_id,NEW.campaign_id,NEW.artifact_hash,NEW.network,NEW.account_id,NEW.operation_id,NEW.operation_id,0); END;
CREATE TRIGGER publication_instagram_reservation_owner AFTER INSERT ON instagram_publication_reservations
BEGIN INSERT INTO publication_active_ownership VALUES(NEW.execution_id,NEW.campaign_id,NEW.artifact_hash,'INSTAGRAM',substr(NEW.destination,11),NEW.operation_id,NEW.operation_id,0); END;
