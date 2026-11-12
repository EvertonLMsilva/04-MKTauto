import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';
import { FINANCE_LEDGER_POSTGRES_MIGRATION_REGISTRY } from '../../finance/infrastructure/postgres-finance-ledger.migrations.js';
export const MEDIA_CATALOG_POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [
  {
    version: 7,
    name: '007_media_catalog_foundation',
    sql: `
CREATE SCHEMA media;
CREATE DOMAIN media.sha256 AS TEXT COLLATE pg_catalog."C" CHECK(VALUE ~ '^[a-f0-9]{64}$');
CREATE DOMAIN media.safe_positive AS BIGINT CHECK(VALUE BETWEEN 1 AND 9007199254740991);
CREATE TABLE media.media_assets (
media_asset_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id),
schema_version TEXT NOT NULL CHECK(schema_version IN ('media-asset/1.0.0','media-asset/2.0.0')),identity_hash media.sha256 NOT NULL,
pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id),project_id TEXT COLLATE pg_catalog."C" NOT NULL,project_version media.safe_positive NOT NULL,
script_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.scripts(script_id),script_content_hash media.sha256 NOT NULL,visual_direction_position media.safe_positive NOT NULL,
asset_type TEXT NOT NULL CHECK(asset_type IN ('IMAGE','VIDEO')),media_format TEXT NOT NULL,width_pixels INTEGER NOT NULL CHECK(width_pixels BETWEEN 1 AND 100000),height_pixels INTEGER NOT NULL CHECK(height_pixels BETWEEN 1 AND 100000),duration_milliseconds INTEGER,
content_hash media.sha256 NOT NULL,media_reference TEXT NOT NULL,origin TEXT NOT NULL CHECK(origin IN ('OPERATOR_OWNED','AUTHORIZED_THIRD_PARTY','PROVIDER_GENERATED','PROVIDER_LICENSED')),provider TEXT,
usage_basis TEXT NOT NULL CHECK(usage_basis IN ('OWNED','LICENSED','EXPLICIT_PERMISSION','PROVIDER_TERMS')),commercial_use_allowed SMALLINT NOT NULL CHECK(commercial_use_allowed=1),created_at TEXT COLLATE pg_catalog."C" NOT NULL,
revision media.safe_positive NOT NULL,supersedes_media_asset_id TEXT COLLATE pg_catalog."C" UNIQUE REFERENCES media.media_assets(media_asset_id),payload_json JSON NOT NULL,
UNIQUE(script_id,visual_direction_position,asset_type,revision),FOREIGN KEY(project_id,project_version) REFERENCES project.project_snapshots(project_id,version),
CHECK((asset_type='IMAGE' AND media_format IN ('jpeg','png','webp') AND duration_milliseconds IS NULL) OR (asset_type='VIDEO' AND media_format IN ('mp4','webm','mov') AND duration_milliseconds BETWEEN 1 AND 86400000)),
CHECK((origin IN ('PROVIDER_GENERATED','PROVIDER_LICENSED') AND provider IS NOT NULL) OR (origin IN ('OPERATOR_OWNED','AUTHORIZED_THIRD_PARTY') AND provider IS NULL)),
CHECK(media_reference NOT LIKE 'media:sha256_%' OR media_reference='media:sha256_' || content_hash)
);
CREATE TABLE media.media_asset_sources (
media_asset_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES media.media_assets(media_asset_id),provider TEXT NOT NULL,external_asset_id TEXT NOT NULL,license_name TEXT NOT NULL,license_url TEXT NOT NULL CHECK(license_url LIKE 'https://%'),photographer_name TEXT NOT NULL,photographer_url TEXT NOT NULL CHECK(photographer_url LIKE 'https://%'),source_url TEXT NOT NULL CHECK(source_url LIKE 'https://%')
);
CREATE TABLE media.media_acquisition_requests (
media_acquisition_request_id TEXT COLLATE pg_catalog."C" PRIMARY KEY,schema_version TEXT NOT NULL CHECK(schema_version='media-acquisition-request/1.0.0'),request_hash media.sha256 NOT NULL,
script_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.scripts(script_id),script_content_hash media.sha256 NOT NULL,visual_direction_position media.safe_positive NOT NULL,asset_type TEXT NOT NULL CHECK(asset_type IN ('IMAGE','VIDEO')),
media_asset_id TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE REFERENCES media.media_assets(media_asset_id),created_at TEXT COLLATE pg_catalog."C" NOT NULL
);
CREATE TABLE media.media_selection_requests (
media_selection_request_id TEXT COLLATE pg_catalog."C" PRIMARY KEY,schema_version TEXT NOT NULL CHECK(schema_version='media-selection-request/1.0.0'),request_hash media.sha256 NOT NULL,
script_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.scripts(script_id),script_content_hash media.sha256 NOT NULL,visual_direction_position media.safe_positive NOT NULL,
production_profile TEXT NOT NULL CHECK(production_profile IN ('STATIC_IMAGE_V1','MIXED_MEDIA_V2')),requested_asset_type TEXT NOT NULL CHECK(requested_asset_type IN ('IMAGE','VIDEO')),selected_asset_type TEXT NOT NULL CHECK(selected_asset_type IN ('IMAGE','VIDEO')),
media_asset_id TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE REFERENCES media.media_assets(media_asset_id),fallback_code TEXT,created_at TEXT COLLATE pg_catalog."C" NOT NULL,
CHECK((requested_asset_type=selected_asset_type AND fallback_code IS NULL) OR (production_profile='MIXED_MEDIA_V2' AND requested_asset_type='VIDEO' AND selected_asset_type='IMAGE' AND fallback_code='PROVIDER_NO_ELIGIBLE_VIDEO'))
);
CREATE FUNCTION media.validate_asset_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
IF NOT EXISTS(SELECT 1 FROM campaign.pipeline_runs r JOIN content.scripts s ON s.script_id=NEW.script_id JOIN content.artifact_lineage a ON a.artifact_id=NEW.media_asset_id
 WHERE r.pipeline_run_id=NEW.pipeline_run_id AND r.project_id=NEW.project_id AND r.project_version=NEW.project_version
 AND s.pipeline_run_id=NEW.pipeline_run_id AND s.project_id=NEW.project_id AND s.project_version=NEW.project_version AND s.content_hash=NEW.script_content_hash
 AND EXISTS(SELECT 1 FROM pg_catalog.json_array_elements(s.payload_json->'visualDirections') d WHERE (d->>'position')::bigint=NEW.visual_direction_position)
 AND a.artifact_type='media_asset' AND a.pipeline_run_id=NEW.pipeline_run_id AND a.project_id=NEW.project_id AND a.project_version=NEW.project_version AND a.content_hash=NEW.content_hash AND a.artifact_version=NEW.revision)
THEN RAISE EXCEPTION USING ERRCODE='P7001',MESSAGE='MEDIA_ASSET_SCOPE_MISMATCH'; END IF;
IF (NEW.revision=1 AND NEW.supersedes_media_asset_id IS NOT NULL) OR (NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM media.media_assets p WHERE p.media_asset_id=NEW.supersedes_media_asset_id
 AND p.script_id=NEW.script_id AND p.pipeline_run_id=NEW.pipeline_run_id AND p.project_id=NEW.project_id AND p.project_version=NEW.project_version AND p.visual_direction_position=NEW.visual_direction_position AND p.asset_type=NEW.asset_type AND p.revision=NEW.revision-1))
THEN RAISE EXCEPTION USING ERRCODE='P7002',MESSAGE='MEDIA_ASSET_REVISION_MISMATCH'; END IF;
RETURN NEW;
END $$;
CREATE TRIGGER validate_asset_scope BEFORE INSERT ON media.media_assets FOR EACH ROW EXECUTE FUNCTION media.validate_asset_scope();
CREATE FUNCTION media.validate_receipt_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a RECORD;
BEGIN
SELECT * INTO a FROM media.media_assets WHERE media_asset_id=NEW.media_asset_id;
IF NOT FOUND OR a.script_id<>NEW.script_id OR a.script_content_hash<>NEW.script_content_hash OR a.visual_direction_position<>NEW.visual_direction_position
THEN RAISE EXCEPTION USING ERRCODE='P7003',MESSAGE='MEDIA_RECEIPT_SCOPE_MISMATCH'; END IF;
IF TG_TABLE_NAME='media_acquisition_requests' THEN
 IF a.asset_type<>NEW.asset_type OR a.created_at<>NEW.created_at OR a.media_asset_id<>'media_asset:' || NEW.media_acquisition_request_id OR a.revision<>1 OR a.supersedes_media_asset_id IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='P7003',MESSAGE='MEDIA_ACQUISITION_SCOPE_MISMATCH'; END IF;
ELSE
 IF a.asset_type<>NEW.selected_asset_type OR NEW.requested_asset_type<>(CASE WHEN NEW.production_profile='MIXED_MEDIA_V2' THEN 'VIDEO' ELSE 'IMAGE' END)
 THEN RAISE EXCEPTION USING ERRCODE='P7003',MESSAGE='MEDIA_SELECTION_SCOPE_MISMATCH'; END IF;
END IF;
RETURN NEW;
END $$;
CREATE TRIGGER validate_acquisition_scope BEFORE INSERT ON media.media_acquisition_requests FOR EACH ROW EXECUTE FUNCTION media.validate_receipt_scope();
CREATE TRIGGER validate_selection_scope BEFORE INSERT ON media.media_selection_requests FOR EACH ROW EXECUTE FUNCTION media.validate_receipt_scope();
CREATE FUNCTION media.require_owned_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM media.media_assets WHERE media_asset_id=NEW.artifact_id) THEN RAISE EXCEPTION USING ERRCODE='P7004',MESSAGE='ORPHAN_MEDIA_LINEAGE'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER media_lineage_owner AFTER INSERT ON content.artifact_lineage DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.artifact_type='media_asset') EXECUTE FUNCTION media.require_owned_lineage();
CREATE FUNCTION media.validate_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p JSON;
BEGIN
SELECT payload_json INTO p FROM media.media_assets WHERE media_asset_id=NEW.media_asset_id;
IF p->'source' IS NULL OR pg_catalog.json_typeof(p->'source')='null' OR p->>'provider' IS DISTINCT FROM NEW.provider
 OR p->'source'->>'externalAssetId' IS DISTINCT FROM NEW.external_asset_id OR p->'source'->>'licenseName' IS DISTINCT FROM NEW.license_name OR p->'source'->>'licenseUrl' IS DISTINCT FROM NEW.license_url
 OR p->'source'->>'photographerName' IS DISTINCT FROM NEW.photographer_name OR p->'source'->>'photographerUrl' IS DISTINCT FROM NEW.photographer_url OR p->'source'->>'sourceUrl' IS DISTINCT FROM NEW.source_url
THEN RAISE EXCEPTION USING ERRCODE='P7005',MESSAGE='MEDIA_SOURCE_MISMATCH'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER validate_source BEFORE INSERT ON media.media_asset_sources FOR EACH ROW EXECUTE FUNCTION media.validate_source();
CREATE FUNCTION media.require_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF pg_catalog.json_typeof(NEW.payload_json->'source')='object' AND NOT EXISTS(SELECT 1 FROM media.media_asset_sources WHERE media_asset_id=NEW.media_asset_id)
THEN RAISE EXCEPTION USING ERRCODE='P7005',MESSAGE='MEDIA_SOURCE_REQUIRED'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER media_source_required AFTER INSERT ON media.media_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION media.require_source();
CREATE FUNCTION media.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P7006',MESSAGE='IMMUTABLE_MEDIA_RECORD'; END $$;
CREATE TRIGGER immutable_assets BEFORE UPDATE OR DELETE ON media.media_assets FOR EACH ROW EXECUTE FUNCTION media.reject_mutation();
CREATE TRIGGER immutable_sources BEFORE UPDATE OR DELETE ON media.media_asset_sources FOR EACH ROW EXECUTE FUNCTION media.reject_mutation();
CREATE TRIGGER immutable_acquisitions BEFORE UPDATE OR DELETE ON media.media_acquisition_requests FOR EACH ROW EXECUTE FUNCTION media.reject_mutation();
CREATE TRIGGER immutable_selections BEFORE UPDATE OR DELETE ON media.media_selection_requests FOR EACH ROW EXECUTE FUNCTION media.reject_mutation();
CREATE INDEX media_assets_run_order ON media.media_assets(pipeline_run_id,created_at,script_id,visual_direction_position,asset_type,revision,media_asset_id);
CREATE INDEX media_assets_script_order ON media.media_assets(script_id,visual_direction_position,asset_type,revision,media_asset_id);
`,
  },
];
export const MEDIA_CATALOG_POSTGRES_MIGRATION_REGISTRY = [
  ...FINANCE_LEDGER_POSTGRES_MIGRATION_REGISTRY,
  ...MEDIA_CATALOG_POSTGRES_MIGRATIONS,
] as const;
