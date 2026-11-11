CREATE TABLE multi_network_publication_reservations (
 execution_id TEXT NOT NULL REFERENCES campaign_executions(execution_id),
 network TEXT NOT NULL CHECK(network IN ('INSTAGRAM','FACEBOOK_REELS')),
 account_id TEXT NOT NULL CHECK(account_id NOT GLOB '*[^0-9]*' AND length(account_id) BETWEEN 5 AND 64),
 destination TEXT NOT NULL CHECK(destination=CASE network WHEN 'INSTAGRAM' THEN 'instagram:' ELSE 'facebook_reels:' END||account_id),
 campaign_id TEXT NOT NULL,
 artifact_hash TEXT NOT NULL CHECK(length(artifact_hash)=64),
 operation_id TEXT NOT NULL UNIQUE REFERENCES social_publication_operations(operation_id),
 package_hash TEXT NOT NULL CHECK(length(package_hash)=64),
 review_hash TEXT NOT NULL CHECK(length(review_hash)=64),
 reserved_at TEXT NOT NULL,
 PRIMARY KEY(execution_id,network,account_id),
 UNIQUE(campaign_id,artifact_hash,network,account_id)
);
CREATE TRIGGER multi_network_reservation_binding BEFORE INSERT ON multi_network_publication_reservations
WHEN NOT EXISTS (
 SELECT 1 FROM social_publication_operations o
 JOIN manual_distribution_records p ON p.kind='PACKAGE' AND p.record_id=o.package_hash
 JOIN manual_distribution_records r ON r.kind='REVIEW' AND r.record_id=p.record_id
 JOIN campaign_executions e ON e.execution_id=NEW.execution_id
 WHERE o.operation_id=NEW.operation_id AND o.package_hash=NEW.package_hash
 AND o.account_id=CASE NEW.network WHEN 'INSTAGRAM' THEN NEW.account_id ELSE NEW.destination END
 AND COALESCE(json_extract(o.payload_json,'$.network'),'INSTAGRAM')=NEW.network
 AND json_extract(p.payload_json,'$.platform')=CASE NEW.network WHEN 'INSTAGRAM' THEN 'instagram' ELSE 'facebook' END
 AND json_extract(p.payload_json,'$.account')=NEW.account_id
 AND NEW.artifact_hash=json_extract(o.payload_json,'$.mediaHash')
 AND NEW.artifact_hash=json_extract(p.payload_json,'$.identity.videoRenderContentHash')
 AND NEW.campaign_id=e.campaign_id AND e.campaign_id=json_extract(p.payload_json,'$.campaignId')
 AND e.run_id=json_extract(p.payload_json,'$.identity.pipelineRunId')
 AND r.content_hash=NEW.review_hash AND json_extract(r.payload_json,'$.mediaDecision.decision')='APPROVED'
 AND NOT EXISTS(SELECT 1 FROM instagram_approval_revocations v WHERE v.review_hash=NEW.review_hash)
)
BEGIN SELECT RAISE(ABORT,'SOCIAL_RESERVATION_BINDING_INVALID'); END;
CREATE TRIGGER multi_network_legacy_identity BEFORE INSERT ON multi_network_publication_reservations
WHEN NEW.network='INSTAGRAM' AND EXISTS(
 SELECT 1 FROM instagram_publication_reservations r WHERE r.execution_id=NEW.execution_id
 OR (r.campaign_id=NEW.campaign_id AND r.artifact_hash=NEW.artifact_hash AND r.destination=NEW.destination)
)
BEGIN SELECT RAISE(ABORT,'SOCIAL_PUBLICATION_IDENTITY_CONFLICT'); END;
CREATE TRIGGER instagram_multi_network_identity BEFORE INSERT ON instagram_publication_reservations
WHEN EXISTS(SELECT 1 FROM multi_network_publication_reservations r WHERE r.network='INSTAGRAM'
 AND (r.execution_id=NEW.execution_id OR (r.campaign_id=NEW.campaign_id AND r.artifact_hash=NEW.artifact_hash AND r.destination=NEW.destination)))
BEGIN SELECT RAISE(ABORT,'SOCIAL_PUBLICATION_IDENTITY_CONFLICT'); END;
CREATE TRIGGER multi_network_reservations_no_update BEFORE UPDATE ON multi_network_publication_reservations
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PUBLICATION_RESERVATION'); END;
CREATE TRIGGER multi_network_reservations_no_delete BEFORE DELETE ON multi_network_publication_reservations
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PUBLICATION_RESERVATION'); END;
