-- Isolated extension. Apply only to disposable fixtures in this delivery.
-- Operational provisioning requires a subsequent CORE change.
CREATE TABLE manual_image_review_packages_v1 (
  package_hash TEXT PRIMARY KEY CHECK(length(package_hash)=64),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
  CHECK(json_extract(snapshot_json,'$.package.packageHash')=package_hash)
) STRICT;
CREATE TABLE manual_image_review_decisions_v1 (
  decision_id TEXT PRIMARY KEY,
  package_hash TEXT NOT NULL REFERENCES manual_image_review_packages_v1(package_hash),
  revision INTEGER NOT NULL CHECK(revision>0),
  review_json TEXT NOT NULL CHECK(json_valid(review_json)),
  review_hash TEXT NOT NULL CHECK(length(review_hash)=64),
  reason TEXT,
  UNIQUE(package_hash,revision),
  UNIQUE(decision_id,review_hash),
  CHECK(json_extract(review_json,'$.decisionId')=decision_id),
  CHECK(json_extract(review_json,'$.packageHash')=package_hash),
  CHECK(json_extract(review_json,'$.contentHash')=review_hash),
  CHECK(json_extract(review_json,'$.revoked')=0),
  CHECK(json_extract(review_json,'$.schemaVersion')='manual-image-review/1.0.0'),
  CHECK(json_extract(review_json,'$.decision') IN ('APPROVED','REJECTED')),
  CHECK(json_extract(review_json,'$.decision')!='REJECTED' OR (reason IS NOT NULL AND length(trim(reason))>0))
) STRICT;
CREATE INDEX manual_image_review_latest_v1 ON manual_image_review_decisions_v1(package_hash,revision DESC);
CREATE TABLE manual_image_review_revocations_v1 (
  revocation_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,
  decision_hash TEXT NOT NULL,
  event_json TEXT NOT NULL CHECK(json_valid(event_json)),
  event_hash TEXT NOT NULL CHECK(length(event_hash)=64),
  UNIQUE(revocation_id,decision_id),
  FOREIGN KEY(decision_id,decision_hash) REFERENCES manual_image_review_decisions_v1(decision_id,review_hash),
  CHECK(json_extract(event_json,'$.decisionId')=decision_id),
  CHECK(json_extract(event_json,'$.decisionHash')=decision_hash),
  CHECK(json_extract(event_json,'$.revocationId')=revocation_id),
  CHECK(json_extract(event_json,'$.contentHash')=event_hash),
  CHECK(length(trim(json_extract(event_json,'$.reason')))>0)
) STRICT;
CREATE TABLE manual_image_review_commands_v1 (
  command_key TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  decision_id TEXT NOT NULL REFERENCES manual_image_review_decisions_v1(decision_id),
  revocation_id TEXT,
  FOREIGN KEY(revocation_id,decision_id) REFERENCES manual_image_review_revocations_v1(revocation_id,decision_id)
) STRICT;
CREATE TRIGGER manual_image_review_revision_v1 BEFORE INSERT ON manual_image_review_decisions_v1
WHEN NEW.revision != 1+(SELECT coalesce(max(revision),0) FROM manual_image_review_decisions_v1 WHERE package_hash=NEW.package_hash)
BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_REVISION_CONFLICT'); END;
CREATE TRIGGER manual_image_review_binding_v1 BEFORE INSERT ON manual_image_review_decisions_v1
WHEN NOT EXISTS (
 SELECT 1 FROM manual_image_review_packages_v1 p WHERE p.package_hash=NEW.package_hash
 AND json_extract(p.snapshot_json,'$.package.imageArtifactId')=json_extract(NEW.review_json,'$.imageArtifactId')
 AND json_extract(p.snapshot_json,'$.package.imageContentHash')=json_extract(NEW.review_json,'$.imageContentHash')
 AND json_extract(p.snapshot_json,'$.qc.report.contentHash')=json_extract(NEW.review_json,'$.qualityControlHash')
)
BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_BINDING_MISMATCH'); END;
CREATE TRIGGER manual_image_review_packages_no_update_v1 BEFORE UPDATE ON manual_image_review_packages_v1 BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER manual_image_review_packages_no_delete_v1 BEFORE DELETE ON manual_image_review_packages_v1 BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER manual_image_review_decisions_no_update_v1 BEFORE UPDATE ON manual_image_review_decisions_v1 BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER manual_image_review_decisions_no_delete_v1 BEFORE DELETE ON manual_image_review_decisions_v1 BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER manual_image_review_revocations_no_update_v1 BEFORE UPDATE ON manual_image_review_revocations_v1 BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER manual_image_review_revocations_no_delete_v1 BEFORE DELETE ON manual_image_review_revocations_v1 BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER manual_image_review_commands_no_update_v1 BEFORE UPDATE ON manual_image_review_commands_v1 BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_IMMUTABLE'); END;
CREATE TRIGGER manual_image_review_commands_no_delete_v1 BEFORE DELETE ON manual_image_review_commands_v1 BEGIN SELECT RAISE(ABORT,'IMAGE_REVIEW_IMMUTABLE'); END;
