CREATE TABLE instagram_approval_revocations (
 review_hash TEXT PRIMARY KEY CHECK(length(review_hash)=64),
 package_hash TEXT NOT NULL CHECK(length(package_hash)=64),
 review_kind TEXT NOT NULL DEFAULT 'REVIEW' CHECK(review_kind='REVIEW'),
 actor TEXT NOT NULL CHECK(length(trim(actor)) BETWEEN 1 AND 100),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
 revoked_at TEXT NOT NULL,
 FOREIGN KEY(review_kind,package_hash) REFERENCES manual_distribution_records(kind,record_id)
);
CREATE TRIGGER instagram_revocation_binding BEFORE INSERT ON instagram_approval_revocations
WHEN NOT EXISTS (SELECT 1 FROM manual_distribution_records WHERE kind='REVIEW' AND record_id=NEW.package_hash
 AND content_hash=NEW.review_hash AND json_extract(payload_json,'$.mediaDecision.decision')='APPROVED')
BEGIN SELECT RAISE(ABORT,'INSTAGRAM_APPROVED_REVIEW_REQUIRED'); END;
CREATE TRIGGER instagram_revocations_no_update BEFORE UPDATE ON instagram_approval_revocations
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_REVOCATION'); END;
CREATE TRIGGER instagram_revocations_no_delete BEFORE DELETE ON instagram_approval_revocations
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_REVOCATION'); END;

CREATE TABLE instagram_publication_reservations (
 campaign_id TEXT NOT NULL,
 artifact_hash TEXT NOT NULL CHECK(length(artifact_hash)=64),
 destination TEXT NOT NULL CHECK(destination GLOB 'instagram:[1-9]*' AND substr(destination,11) NOT GLOB '*[^0-9]*'),
 execution_id TEXT NOT NULL UNIQUE REFERENCES campaign_executions(execution_id),
 operation_id TEXT NOT NULL UNIQUE REFERENCES social_publication_operations(operation_id),
 package_hash TEXT NOT NULL,
 review_hash TEXT NOT NULL CHECK(length(review_hash)=64),
 reserved_at TEXT NOT NULL,
 PRIMARY KEY(campaign_id,artifact_hash,destination)
);
CREATE TRIGGER instagram_reservation_binding BEFORE INSERT ON instagram_publication_reservations
WHEN NOT EXISTS (
 SELECT 1 FROM social_publication_operations o
 JOIN manual_distribution_records p ON p.kind='PACKAGE' AND p.record_id=o.package_hash
 JOIN manual_distribution_records r ON r.kind='REVIEW' AND r.record_id=p.record_id
 JOIN campaign_executions e ON e.execution_id=NEW.execution_id
 WHERE o.operation_id=NEW.operation_id AND o.package_hash=NEW.package_hash
 AND NEW.destination='instagram:'||o.account_id AND NEW.artifact_hash=json_extract(o.payload_json,'$.mediaHash')
 AND NEW.artifact_hash=json_extract(p.payload_json,'$.identity.videoRenderContentHash')
 AND NEW.campaign_id=json_extract(p.payload_json,'$.campaignId') AND e.campaign_id=NEW.campaign_id
 AND e.run_id=json_extract(p.payload_json,'$.identity.pipelineRunId')
 AND NEW.review_hash=r.content_hash AND json_extract(r.payload_json,'$.mediaDecision.decision')='APPROVED'
 AND NOT EXISTS(SELECT 1 FROM instagram_approval_revocations v WHERE v.review_hash=r.content_hash)
 AND NOT EXISTS(SELECT 1 FROM social_publication_operations old
   LEFT JOIN manual_distribution_records oldp ON oldp.kind='PACKAGE' AND oldp.record_id=old.package_hash
   WHERE old.operation_id<>NEW.operation_id AND old.account_id=o.account_id
   AND json_extract(old.payload_json,'$.mediaHash')=NEW.artifact_hash
   AND (oldp.record_id IS NULL OR json_extract(oldp.payload_json,'$.campaignId')=NEW.campaign_id))
)
BEGIN SELECT RAISE(ABORT,'INSTAGRAM_RESERVATION_BINDING_INVALID'); END;
CREATE TRIGGER instagram_reservations_no_update BEFORE UPDATE ON instagram_publication_reservations
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_RESERVATION'); END;
CREATE TRIGGER instagram_reservations_no_delete BEFORE DELETE ON instagram_publication_reservations
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_RESERVATION'); END;
