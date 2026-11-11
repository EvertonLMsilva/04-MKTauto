CREATE TABLE manual_distribution_records (
  kind TEXT NOT NULL CHECK(kind IN ('PACKAGE','REVIEW','PUBLICATION','RESULTS')),
  record_id TEXT NOT NULL,
  package_hash TEXT NOT NULL CHECK(length(package_hash)=64),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(kind,record_id)
);
CREATE UNIQUE INDEX manual_distribution_review ON manual_distribution_records(package_hash) WHERE kind='REVIEW';
CREATE UNIQUE INDEX manual_distribution_publication ON manual_distribution_records(package_hash) WHERE kind='PUBLICATION';
CREATE UNIQUE INDEX manual_distribution_external_id ON manual_distribution_records(
 json_extract(payload_json,'$.platform'),json_extract(payload_json,'$.account'),json_extract(payload_json,'$.externalId')
) WHERE kind='PUBLICATION' AND json_extract(payload_json,'$.externalId') IS NOT NULL;
CREATE UNIQUE INDEX manual_distribution_external_url ON manual_distribution_records(
 json_extract(payload_json,'$.platform'),json_extract(payload_json,'$.account'),json_extract(payload_json,'$.externalUrl')
) WHERE kind='PUBLICATION' AND json_extract(payload_json,'$.externalUrl') IS NOT NULL;
CREATE TRIGGER manual_distribution_no_update BEFORE UPDATE ON manual_distribution_records
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MANUAL_DISTRIBUTION'); END;
CREATE TRIGGER manual_distribution_no_delete BEFORE DELETE ON manual_distribution_records
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MANUAL_DISTRIBUTION'); END;
