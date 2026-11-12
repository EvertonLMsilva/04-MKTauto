import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';
import { CAMPAIGN_POSTGRES_MIGRATION_REGISTRY } from '../../content-operations/infrastructure/postgres-campaign.migrations.js';

export const FINANCE_LEDGER_POSTGRES_MIGRATIONS: readonly PostgresMigration[] =
  [
    {
      version: 6,
      name: '006_finance_ledger_foundation',
      sql: `
CREATE SCHEMA finance;
CREATE DOMAIN finance.sha256 AS TEXT COLLATE pg_catalog."C" CHECK(VALUE ~ '^[0-9a-f]{64}$');
-- Unbounded NUMERIC plus checks rejects excess scale instead of rounding it.
CREATE DOMAIN finance.positive_amount AS NUMERIC CHECK(VALUE > 0 AND VALUE < 1e40::numeric AND pg_catalog.scale(VALUE) <= 18);
CREATE TABLE finance.cost_events (
  cost_event_id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  schema_version TEXT NOT NULL CHECK(schema_version='cost-event/1.0.0'),
  identity_hash finance.sha256 NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('production_cost','ai_cost','media_cost','voice_cost','publishing_cost')),
  pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id),
  project_id TEXT COLLATE pg_catalog."C" NOT NULL,
  project_version BIGINT NOT NULL CHECK(project_version BETWEEN 1 AND 9007199254740991),
  content_identity TEXT COLLATE pg_catalog."C",
  artifact_id TEXT COLLATE pg_catalog."C" REFERENCES content.artifact_lineage(artifact_id),
  amount finance.positive_amount NOT NULL,
  currency TEXT COLLATE pg_catalog."C" NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  occurred_at TEXT COLLATE pg_catalog."C" NOT NULL,
  origin TEXT NOT NULL,
  attribution_rule_version TEXT NOT NULL,
  recorded_at TEXT COLLATE pg_catalog."C" NOT NULL,
  FOREIGN KEY(project_id,project_version) REFERENCES project.project_snapshots(project_id,version),
  UNIQUE(cost_event_id,identity_hash)
);
CREATE TABLE finance.ledger_receipts (
  cost_event_id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  identity_hash finance.sha256 NOT NULL,
  result_hash finance.sha256 NOT NULL CHECK(result_hash=identity_hash),
  result_json JSON NOT NULL CHECK(pg_catalog.json_typeof(result_json)='object'),
  FOREIGN KEY(cost_event_id,identity_hash) REFERENCES finance.cost_events(cost_event_id,identity_hash),
  UNIQUE(cost_event_id,identity_hash)
);
ALTER TABLE finance.cost_events ADD CONSTRAINT cost_receipt_required FOREIGN KEY(cost_event_id,identity_hash) REFERENCES finance.ledger_receipts(cost_event_id,identity_hash) DEFERRABLE INITIALLY DEFERRED;
-- Records only: TTS operation/billing/reconciliation is not migrated by this foundation.
CREATE TABLE finance.cost_adjustments (
  adjustment_id TEXT COLLATE pg_catalog."C" PRIMARY KEY,
  original_cost_event_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES finance.cost_events(cost_event_id),
  tts_operation_id TEXT COLLATE pg_catalog."C" NOT NULL,
  delta_units TEXT NOT NULL CHECK(delta_units ~ '^-?[1-9][0-9]{0,57}$'),
  currency TEXT NOT NULL CHECK(currency='USD'),
  evidence_reference TEXT NOT NULL CHECK(pg_catalog.btrim(evidence_reference) <> ''),
  evidence_hash finance.sha256 NOT NULL,
  idempotency_key TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE,
  created_at TEXT COLLATE pg_catalog."C" NOT NULL,
  identity_hash finance.sha256 NOT NULL,
  UNIQUE(original_cost_event_id,tts_operation_id)
);
CREATE FUNCTION finance.validate_cost_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_row RECORD; artifact_row RECORD;
BEGIN
  SELECT project_id,project_version INTO run_row FROM campaign.pipeline_runs WHERE pipeline_run_id=NEW.pipeline_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P6001', MESSAGE='PIPELINE_RUN_NOT_FOUND'; END IF;
  IF run_row.project_id <> NEW.project_id THEN RAISE EXCEPTION USING ERRCODE='P6002', MESSAGE='COST_EVENT_RUN_SCOPE_MISMATCH'; END IF;
  IF run_row.project_version <> NEW.project_version THEN RAISE EXCEPTION USING ERRCODE='P6003', MESSAGE='COST_EVENT_RUN_SCOPE_MISMATCH'; END IF;
  IF NEW.artifact_id IS NOT NULL THEN
    SELECT pipeline_run_id,project_id,project_version,content_identity INTO artifact_row FROM content.artifact_lineage WHERE artifact_id=NEW.artifact_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P6004', MESSAGE='COST_EVENT_ARTIFACT_NOT_FOUND'; END IF;
    IF artifact_row.pipeline_run_id <> NEW.pipeline_run_id OR artifact_row.project_id <> NEW.project_id OR artifact_row.project_version <> NEW.project_version THEN
      RAISE EXCEPTION USING ERRCODE='P6005', MESSAGE='COST_EVENT_ARTIFACT_SCOPE_MISMATCH';
    END IF;
    IF NEW.content_identity IS NOT NULL AND NEW.content_identity IS DISTINCT FROM artifact_row.content_identity THEN
      RAISE EXCEPTION USING ERRCODE='P6006', MESSAGE='COST_EVENT_CONTENT_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_cost_scope BEFORE INSERT ON finance.cost_events FOR EACH ROW EXECUTE FUNCTION finance.validate_cost_scope();
-- Fail closed until a later, explicit migration supplies canonical PostgreSQL TTS reconciliation.
CREATE FUNCTION finance.require_adjustment_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P6009', MESSAGE='COST_ADJUSTMENT_RECONCILIATION_REQUIRED'; END $$;
CREATE TRIGGER require_adjustment_reconciliation BEFORE INSERT ON finance.cost_adjustments FOR EACH ROW EXECUTE FUNCTION finance.require_adjustment_reconciliation();
CREATE FUNCTION finance.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P6008', MESSAGE='IMMUTABLE_FINANCE_RECORD'; END $$;
CREATE TRIGGER immutable_cost_events BEFORE UPDATE OR DELETE ON finance.cost_events FOR EACH ROW EXECUTE FUNCTION finance.reject_mutation();
CREATE TRIGGER immutable_ledger_receipts BEFORE UPDATE OR DELETE ON finance.ledger_receipts FOR EACH ROW EXECUTE FUNCTION finance.reject_mutation();
CREATE TRIGGER immutable_cost_adjustments BEFORE UPDATE OR DELETE ON finance.cost_adjustments FOR EACH ROW EXECUTE FUNCTION finance.reject_mutation();
CREATE INDEX cost_events_pipeline_order ON finance.cost_events(pipeline_run_id,occurred_at,cost_event_id);
CREATE INDEX cost_adjustments_original_order ON finance.cost_adjustments(original_cost_event_id,created_at,adjustment_id);
`,
    },
  ];

export const FINANCE_LEDGER_POSTGRES_MIGRATION_REGISTRY = [
  ...CAMPAIGN_POSTGRES_MIGRATION_REGISTRY,
  ...FINANCE_LEDGER_POSTGRES_MIGRATIONS,
] as const;
