-- Additive extension. Original receipts and migrations 001-044 are untouched.
CREATE TABLE manual_publication_reconciliations_v1 (
  reconciliation_id TEXT PRIMARY KEY,
  publication_kind TEXT NOT NULL DEFAULT 'PUBLICATION' CHECK(publication_kind='PUBLICATION'),
  publication_id TEXT NOT NULL UNIQUE,
  package_kind TEXT NOT NULL DEFAULT 'PACKAGE' CHECK(package_kind='PACKAGE'),
  package_hash TEXT NOT NULL CHECK(length(package_hash)=64),
  original_receipt_hash TEXT NOT NULL CHECK(length(original_receipt_hash)=64),
  platform TEXT NOT NULL CHECK(platform IN ('instagram','facebook')),
  account TEXT NOT NULL,
  external_id TEXT NOT NULL CHECK(length(trim(external_id))>0),
  external_url_key TEXT NOT NULL CHECK(length(external_url_key)>0),
  confirmation_origin TEXT NOT NULL CHECK(confirmation_origin='OPERATOR_ATTESTED'),
  idempotency_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash)=64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  FOREIGN KEY(publication_kind,publication_id) REFERENCES manual_distribution_records(kind,record_id),
  FOREIGN KEY(package_kind,package_hash) REFERENCES manual_distribution_records(kind,record_id),
  UNIQUE(platform,external_id), UNIQUE(external_url_key),
  CHECK(json_extract(payload_json,'$.schemaVersion') IS 'manual-publication-reconciliation/1.0.0'),
  CHECK(json_extract(payload_json,'$.reconciliationId') IS reconciliation_id),
  CHECK(json_extract(payload_json,'$.publicationId') IS publication_id),
  CHECK(json_extract(payload_json,'$.packageHash') IS package_hash),
  CHECK(json_extract(payload_json,'$.originalReceiptHash') IS original_receipt_hash),
  CHECK(json_extract(payload_json,'$.platform') IS platform),
  CHECK(json_extract(payload_json,'$.account') IS account),
  CHECK(json_extract(payload_json,'$.externalId') IS external_id),
  CHECK(json_extract(payload_json,'$.confirmationOrigin') IS confirmation_origin),
  CHECK(json_extract(payload_json,'$.idempotencyKey') IS idempotency_key),
  CHECK(json_extract(payload_json,'$.contentHash') IS content_hash)
);
CREATE INDEX manual_reconciliation_package_v1 ON manual_publication_reconciliations_v1(package_hash);
CREATE TRIGGER manual_reconciliation_scope_v1 BEFORE INSERT ON manual_publication_reconciliations_v1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM manual_distribution_records p WHERE p.kind='PUBLICATION' AND p.record_id=NEW.publication_id
    AND p.package_hash=NEW.package_hash AND p.content_hash=NEW.original_receipt_hash
    AND json_extract(p.payload_json,'$.state')='UNCONFIRMED'
    AND json_extract(p.payload_json,'$.platform')=NEW.platform
    AND json_extract(p.payload_json,'$.account')=NEW.account
    AND json_extract(p.payload_json,'$.reviewHash')=json_extract(NEW.payload_json,'$.originalReviewHash')
  ) THEN RAISE(ABORT,'DISTRIBUTION_RECONCILIATION_SCOPE_MISMATCH') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM manual_distribution_records p WHERE p.kind='PUBLICATION' AND p.record_id!=NEW.publication_id
    AND json_extract(p.payload_json,'$.platform')=NEW.platform
    AND json_extract(p.payload_json,'$.externalId')=NEW.external_id
  ) THEN RAISE(ABORT,'DISTRIBUTION_RECONCILIATION_EVIDENCE_CONFLICT') END;
END;
CREATE TRIGGER manual_reconciliation_no_update_v1 BEFORE UPDATE ON manual_publication_reconciliations_v1
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MANUAL_RECONCILIATION'); END;
CREATE TRIGGER manual_reconciliation_no_delete_v1 BEFORE DELETE ON manual_publication_reconciliations_v1
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MANUAL_RECONCILIATION'); END;
