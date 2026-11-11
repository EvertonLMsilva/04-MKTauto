import { AFFILIATE_POSTGRES_MIGRATION_REGISTRY } from '../../affiliate/infrastructure/postgres-affiliate.migrations.js';
import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';
export const CAMPAIGN_POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [
  {
    version: 5,
    name: '005_campaign_operations',
    sql: `
CREATE SCHEMA campaign;
CREATE DOMAIN campaign.safe_positive AS BIGINT CHECK(VALUE BETWEEN 1 AND 9007199254740991);
CREATE DOMAIN campaign.sha256 AS TEXT COLLATE pg_catalog."C" CHECK(VALUE ~ '^[0-9a-f]{64}$');
CREATE TABLE campaign.pipeline_runs (
pipeline_run_id TEXT COLLATE pg_catalog."C" PRIMARY KEY, schema_version TEXT COLLATE pg_catalog."C" NOT NULL, identity_hash campaign.sha256 NOT NULL, project_id TEXT COLLATE pg_catalog."C" NOT NULL, project_version campaign.safe_positive NOT NULL, project_snapshot_json JSON NOT NULL, state TEXT COLLATE pg_catalog."C" NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED')), started_at TEXT COLLATE pg_catalog."C" NOT NULL, completed_at TEXT COLLATE pg_catalog."C", error_json JSON, FOREIGN KEY(project_id,project_version) REFERENCES project.project_snapshots(project_id,version), CHECK((state='RUNNING' AND completed_at IS NULL AND error_json IS NULL) OR (state='SUCCEEDED' AND completed_at IS NOT NULL AND error_json IS NULL) OR (state='FAILED' AND completed_at IS NOT NULL AND error_json IS NOT NULL))
);
CREATE TABLE campaign.pipeline_run_transitions (
id campaign.safe_positive PRIMARY KEY, pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id), previous_state TEXT COLLATE pg_catalog."C", next_state TEXT COLLATE pg_catalog."C" NOT NULL, changed_at TEXT COLLATE pg_catalog."C" NOT NULL, error_json JSON, CHECK((previous_state IS NULL AND next_state='RUNNING' AND error_json IS NULL) OR (previous_state='RUNNING' AND next_state='SUCCEEDED' AND error_json IS NULL) OR (previous_state='RUNNING' AND next_state='FAILED' AND error_json IS NOT NULL))
);
CREATE TABLE campaign.pipeline_run_recoveries (
id campaign.safe_positive PRIMARY KEY, pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id), previous_state TEXT COLLATE pg_catalog."C" NOT NULL CHECK(previous_state='FAILED'), next_state TEXT COLLATE pg_catalog."C" NOT NULL CHECK(next_state='RUNNING'), changed_at TEXT COLLATE pg_catalog."C" NOT NULL
);
CREATE TABLE campaign.pipeline_stage_attempts (
id campaign.safe_positive PRIMARY KEY, pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id), stage TEXT COLLATE pg_catalog."C" NOT NULL CHECK(stage IN ('RESEARCH','TREND_FORMAT_ANALYSIS','IDEA_GENERATION','IDEA_SELECTION','SCRIPT','VOICE','MEDIA','VISUAL_MOTION_PLAN','BACKGROUND_MUSIC','COMPOSITION','SUBTITLES','PREVIEW','QC')), attempt campaign.safe_positive NOT NULL, trigger_kind TEXT COLLATE pg_catalog."C" NOT NULL CHECK(trigger_kind IN ('INITIAL','AUTOMATIC','MANUAL')), state TEXT COLLATE pg_catalog."C" NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED')), identity_hash campaign.sha256 NOT NULL, request_hash campaign.sha256 NOT NULL, inputs_json JSON NOT NULL, policy_versions_json JSON NOT NULL, provider_config_hash campaign.sha256, started_at TEXT COLLATE pg_catalog."C" NOT NULL, completed_at TEXT COLLATE pg_catalog."C", failure_code TEXT COLLATE pg_catalog."C", failure_field TEXT COLLATE pg_catalog."C", retry_allowed SMALLINT CHECK(retry_allowed IN (0,1)), artifact_id TEXT COLLATE pg_catalog."C", artifact_content_hash campaign.sha256, result_json JSON, UNIQUE(pipeline_run_id,stage,attempt), CHECK((state='RUNNING' AND completed_at IS NULL AND failure_code IS NULL AND failure_field IS NULL AND retry_allowed IS NULL AND artifact_id IS NULL AND artifact_content_hash IS NULL AND result_json IS NULL) OR (state='SUCCEEDED' AND completed_at IS NOT NULL AND failure_code IS NULL AND failure_field IS NULL AND retry_allowed IS NULL AND artifact_id IS NOT NULL AND artifact_content_hash IS NOT NULL AND result_json IS NOT NULL) OR (state='FAILED' AND completed_at IS NOT NULL AND failure_code IS NOT NULL AND failure_field IS NOT NULL AND retry_allowed IS NOT NULL AND artifact_id IS NULL AND artifact_content_hash IS NULL AND result_json IS NULL))
);
CREATE TABLE campaign.campaign_executions (
execution_id TEXT COLLATE pg_catalog."C" PRIMARY KEY, campaign_id TEXT COLLATE pg_catalog."C" NOT NULL, campaign_revision campaign.safe_positive NOT NULL, production_date TEXT COLLATE pg_catalog."C" NOT NULL CHECK(length(production_date)=10), scheduled_at TEXT COLLATE pg_catalog."C" NOT NULL, run_id TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE, status TEXT COLLATE pg_catalog."C" NOT NULL CHECK(status IN ('SCHEDULED','RUNNING','WAITING_INPUT','WAITING_RECONCILIATION','SUCCEEDED','FAILED','CANCELLED')), version campaign.safe_positive NOT NULL, claim_token TEXT COLLATE pg_catalog."C", claim_expires_at TEXT COLLATE pg_catalog."C", created_at TEXT COLLATE pg_catalog."C" NOT NULL, updated_at TEXT COLLATE pg_catalog."C" NOT NULL, UNIQUE(campaign_id,production_date), FOREIGN KEY(campaign_id,campaign_revision) REFERENCES affiliate.affiliate_campaign_revisions(campaign_id,revision), CHECK((claim_token IS NULL)=(claim_expires_at IS NULL)), CHECK((status='RUNNING')=(claim_token IS NOT NULL))
);
CREATE TABLE campaign.campaign_execution_events (
execution_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.campaign_executions(execution_id), sequence campaign.safe_positive NOT NULL, event_type TEXT COLLATE pg_catalog."C" NOT NULL, previous_status TEXT COLLATE pg_catalog."C", next_status TEXT COLLATE pg_catalog."C" NOT NULL CHECK(next_status IN ('SCHEDULED','RUNNING','WAITING_INPUT','WAITING_RECONCILIATION','SUCCEEDED','FAILED','CANCELLED')), occurred_at TEXT COLLATE pg_catalog."C" NOT NULL, evidence_json JSON NOT NULL, event_cursor campaign.safe_positive NOT NULL UNIQUE, PRIMARY KEY(execution_id,sequence)
);
CREATE FUNCTION campaign.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P5001',MESSAGE='IMMUTABLE_CAMPAIGN_HISTORY'; END $$;
-- Allocate under the same transaction lock; rollback does not consume cursor/attempt IDs.
CREATE FUNCTION campaign.allocate_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_id BIGINT;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(1296782401,5);
 IF TG_TABLE_NAME='campaign_execution_events' THEN
  IF NEW.event_cursor IS NULL THEN SELECT COALESCE(MAX(event_cursor),0)+1 INTO next_id FROM campaign.campaign_execution_events; NEW.event_cursor=next_id; END IF;
 ELSE
  IF NEW.id IS NULL THEN EXECUTE pg_catalog.format('SELECT COALESCE(MAX(id),0)+1 FROM campaign.%I',TG_TABLE_NAME) INTO next_id; NEW.id=next_id; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocate_id BEFORE INSERT ON campaign.pipeline_run_transitions FOR EACH ROW EXECUTE FUNCTION campaign.allocate_identity();
CREATE TRIGGER allocate_id BEFORE INSERT ON campaign.pipeline_run_recoveries FOR EACH ROW EXECUTE FUNCTION campaign.allocate_identity();
CREATE TRIGGER allocate_id BEFORE INSERT ON campaign.pipeline_stage_attempts FOR EACH ROW EXECUTE FUNCTION campaign.allocate_identity();
CREATE TRIGGER allocate_id BEFORE INSERT ON campaign.campaign_execution_events FOR EACH ROW EXECUTE FUNCTION campaign.allocate_identity();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON campaign.pipeline_run_transitions FOR EACH ROW EXECUTE FUNCTION campaign.reject_mutation();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON campaign.pipeline_run_recoveries FOR EACH ROW EXECUTE FUNCTION campaign.reject_mutation();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON campaign.campaign_execution_events FOR EACH ROW EXECUTE FUNCTION campaign.reject_mutation();
CREATE TRIGGER no_delete BEFORE DELETE ON campaign.pipeline_runs FOR EACH ROW EXECUTE FUNCTION campaign.reject_mutation();
CREATE TRIGGER no_delete BEFORE DELETE ON campaign.pipeline_stage_attempts FOR EACH ROW EXECUTE FUNCTION campaign.reject_mutation();
CREATE TRIGGER no_delete BEFORE DELETE ON campaign.campaign_executions FOR EACH ROW EXECUTE FUNCTION campaign.reject_mutation();
CREATE FUNCTION campaign.validate_run_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.pipeline_run_id,NEW.schema_version,NEW.identity_hash,NEW.project_id,NEW.project_version,NEW.project_snapshot_json::TEXT,NEW.started_at) IS DISTINCT FROM ROW(OLD.pipeline_run_id,OLD.schema_version,OLD.identity_hash,OLD.project_id,OLD.project_version,OLD.project_snapshot_json::TEXT,OLD.started_at) THEN RAISE EXCEPTION USING ERRCODE='P5001',MESSAGE='IMMUTABLE_PIPELINE_RUN_IDENTITY'; END IF;
 IF ROW(NEW.state,NEW.completed_at,NEW.error_json::TEXT) IS DISTINCT FROM ROW(OLD.state,OLD.completed_at,OLD.error_json::TEXT) AND NOT ((OLD.state='RUNNING' AND NEW.state IN ('SUCCEEDED','FAILED')) OR (OLD.state='FAILED' AND NEW.state='RUNNING')) THEN RAISE EXCEPTION USING ERRCODE='P5002',MESSAGE='INVALID_PIPELINE_RUN_TRANSITION'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_run BEFORE UPDATE ON campaign.pipeline_runs FOR EACH ROW EXECUTE FUNCTION campaign.validate_run_update();
CREATE FUNCTION campaign.validate_attempt_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state<>'RUNNING' OR NEW.state NOT IN ('SUCCEEDED','FAILED') OR
 ROW(NEW.id,NEW.pipeline_run_id,NEW.stage,NEW.attempt,NEW.trigger_kind,NEW.identity_hash,NEW.request_hash,NEW.inputs_json::TEXT,NEW.policy_versions_json::TEXT,NEW.provider_config_hash,NEW.started_at) IS DISTINCT FROM
 ROW(OLD.id,OLD.pipeline_run_id,OLD.stage,OLD.attempt,OLD.trigger_kind,OLD.identity_hash,OLD.request_hash,OLD.inputs_json::TEXT,OLD.policy_versions_json::TEXT,OLD.provider_config_hash,OLD.started_at)
 THEN RAISE EXCEPTION USING ERRCODE='P5001',MESSAGE='IMMUTABLE_STAGE_ATTEMPT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_attempt BEFORE UPDATE ON campaign.pipeline_stage_attempts FOR EACH ROW EXECUTE FUNCTION campaign.validate_attempt_update();
CREATE UNIQUE INDEX one_running_stage ON campaign.pipeline_stage_attempts(pipeline_run_id,stage) WHERE state='RUNNING';
CREATE FUNCTION campaign.validate_execution_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.execution_id,NEW.campaign_id,NEW.campaign_revision,NEW.production_date,NEW.scheduled_at,NEW.run_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.execution_id,OLD.campaign_id,OLD.campaign_revision,OLD.production_date,OLD.scheduled_at,OLD.run_id,OLD.created_at) THEN RAISE EXCEPTION USING ERRCODE='P5001',MESSAGE='IMMUTABLE_CAMPAIGN_IDENTITY'; END IF;
 IF NEW.status<>OLD.status AND NOT (
 (OLD.status='SCHEDULED' AND NEW.status IN ('RUNNING','CANCELLED')) OR
 (OLD.status='RUNNING' AND NEW.status IN ('WAITING_INPUT','WAITING_RECONCILIATION','SUCCEEDED','FAILED','CANCELLED')) OR
 (OLD.status IN ('WAITING_INPUT','WAITING_RECONCILIATION','FAILED') AND NEW.status IN ('SCHEDULED','CANCELLED'))
 ) THEN RAISE EXCEPTION USING ERRCODE='P5002',MESSAGE='INVALID_CAMPAIGN_TRANSITION'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_execution BEFORE UPDATE ON campaign.campaign_executions FOR EACH ROW EXECUTE FUNCTION campaign.validate_execution_update();
CREATE INDEX pipeline_project_scope ON campaign.pipeline_runs(project_id,project_version,started_at);
CREATE INDEX stage_identity ON campaign.pipeline_stage_attempts(pipeline_run_id,stage,identity_hash,state,attempt);
CREATE INDEX campaign_due ON campaign.campaign_executions(status,scheduled_at);
`,
  },
];
export const CAMPAIGN_POSTGRES_MIGRATION_REGISTRY = [
  ...AFFILIATE_POSTGRES_MIGRATION_REGISTRY,
  ...CAMPAIGN_POSTGRES_MIGRATIONS,
] as const;
