import { RESEARCH_POSTGRES_MIGRATION_REGISTRY } from '../../research/infrastructure/postgres-research.migrations.js';
import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';

/** Content owns the canonical lineage registry; future PG Media must reuse it. */
export const CONTENT_POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [
  {
    version: 3,
    name: '003_content_foundation',
    sql: `
CREATE SCHEMA content;
CREATE DOMAIN content.safe_positive AS BIGINT CHECK (VALUE BETWEEN 1 AND 9007199254740991);
CREATE DOMAIN content.sha256 AS TEXT COLLATE pg_catalog."C" CHECK (VALUE ~ '^[0-9a-f]{64}$');
CREATE TABLE content.artifact_lineage (
artifact_id TEXT COLLATE pg_catalog."C" PRIMARY KEY, schema_version TEXT COLLATE pg_catalog."C" NOT NULL, artifact_type TEXT COLLATE pg_catalog."C" NOT NULL,
artifact_version content.safe_positive NOT NULL, identity_hash content.sha256 NOT NULL, pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL, project_id TEXT COLLATE pg_catalog."C" NOT NULL,
project_version content.safe_positive NOT NULL, content_identity TEXT COLLATE pg_catalog."C", hash_algorithm TEXT COLLATE pg_catalog."C" NOT NULL CHECK(hash_algorithm='sha256'),
content_hash content.sha256 NOT NULL, generation_metadata_json JSON, created_at TEXT COLLATE pg_catalog."C" NOT NULL,
UNIQUE(artifact_type,content_identity,artifact_version)
);
CREATE TABLE content.artifact_lineage_inputs (
artifact_id TEXT COLLATE pg_catalog."C" REFERENCES content.artifact_lineage(artifact_id), position content.safe_positive,
kind TEXT COLLATE pg_catalog."C" NOT NULL CHECK(kind IN ('INTERNAL_ARTIFACT','EXTERNAL_INPUT')), input_id TEXT COLLATE pg_catalog."C" NOT NULL, content_hash content.sha256 NOT NULL,
PRIMARY KEY(artifact_id,position), UNIQUE(artifact_id,kind,input_id)
);
CREATE TABLE content.idea_batches (
idea_batch_id TEXT COLLATE pg_catalog."C" PRIMARY KEY, request_hash content.sha256 NOT NULL, pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL,
project_id TEXT COLLATE pg_catalog."C" NOT NULL, project_version content.safe_positive NOT NULL, research_shortlist_id TEXT COLLATE pg_catalog."C" NOT NULL,
policy_version TEXT COLLATE pg_catalog."C" NOT NULL, origin TEXT COLLATE pg_catalog."C" NOT NULL CHECK(origin IN ('OPERATOR','EXTERNAL_CONSUMER')), created_at TEXT COLLATE pg_catalog."C" NOT NULL
);
CREATE TABLE content.idea_candidates (
idea_candidate_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id),
idea_batch_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.idea_batches(idea_batch_id), schema_version TEXT COLLATE pg_catalog."C" NOT NULL,
pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL, project_id TEXT COLLATE pg_catalog."C" NOT NULL, project_version content.safe_positive NOT NULL,
content_identity TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE, content_hash content.sha256 NOT NULL, research_shortlist_id TEXT COLLATE pg_catalog."C" NOT NULL,
reference_insight_id TEXT COLLATE pg_catalog."C", payload_json JSON NOT NULL, created_at TEXT COLLATE pg_catalog."C" NOT NULL
);
CREATE TABLE content.idea_candidate_evidence (
idea_candidate_id TEXT COLLATE pg_catalog."C" REFERENCES content.idea_candidates(idea_candidate_id),
kind TEXT COLLATE pg_catalog."C" CHECK(kind IN ('RESEARCH_CANDIDATE','REFERENCE_EVIDENCE')), position content.safe_positive, evidence_id TEXT COLLATE pg_catalog."C" NOT NULL,
PRIMARY KEY(idea_candidate_id,kind,position), UNIQUE(idea_candidate_id,kind,evidence_id)
);
CREATE TABLE content.idea_scores (
idea_score_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id),
idea_candidate_id TEXT COLLATE pg_catalog."C" NOT NULL UNIQUE REFERENCES content.idea_candidates(idea_candidate_id),
idea_batch_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.idea_batches(idea_batch_id), schema_version TEXT COLLATE pg_catalog."C" NOT NULL,
pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL, project_id TEXT COLLATE pg_catalog."C" NOT NULL, project_version content.safe_positive NOT NULL, policy_version TEXT COLLATE pg_catalog."C" NOT NULL,
total NUMERIC NOT NULL CHECK(total BETWEEN 0 AND 1), rank content.safe_positive NOT NULL, content_hash content.sha256 NOT NULL,
payload_json JSON NOT NULL, calculated_at TEXT COLLATE pg_catalog."C" NOT NULL, UNIQUE(idea_batch_id,rank)
);
CREATE TABLE content.idea_selections (
idea_selection_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id),
schema_version TEXT COLLATE pg_catalog."C" NOT NULL, pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL, project_id TEXT COLLATE pg_catalog."C" NOT NULL, project_version content.safe_positive NOT NULL,
idea_batch_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.idea_batches(idea_batch_id),
idea_candidate_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.idea_candidates(idea_candidate_id),
idea_score_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.idea_scores(idea_score_id), idea_content_hash content.sha256 NOT NULL,
idea_score_content_hash content.sha256 NOT NULL, decision TEXT COLLATE pg_catalog."C" NOT NULL CHECK(decision='SELECTED'),
actor_type TEXT COLLATE pg_catalog."C" NOT NULL CHECK(actor_type='HUMAN'), actor_id TEXT COLLATE pg_catalog."C" NOT NULL, decided_at TEXT COLLATE pg_catalog."C" NOT NULL,
editorial_rationale TEXT COLLATE pg_catalog."C", revision content.safe_positive NOT NULL, supersedes_idea_selection_id TEXT COLLATE pg_catalog."C" UNIQUE REFERENCES content.idea_selections(idea_selection_id),
content_hash content.sha256 NOT NULL, payload_json JSON NOT NULL, UNIQUE(idea_batch_id,revision)
);
CREATE TABLE content.affiliate_editorial_selections (
selection_id TEXT COLLATE pg_catalog."C" PRIMARY KEY, pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL, project_id TEXT COLLATE pg_catalog."C" NOT NULL,
project_version content.safe_positive NOT NULL, briefing_id TEXT COLLATE pg_catalog."C" NOT NULL, content_hash content.sha256 NOT NULL, payload_json JSON NOT NULL
);
CREATE TABLE content.scripts (
script_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id), schema_version TEXT COLLATE pg_catalog."C" NOT NULL,
pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL, project_id TEXT COLLATE pg_catalog."C" NOT NULL, project_version content.safe_positive NOT NULL,
idea_selection_id TEXT COLLATE pg_catalog."C" REFERENCES content.idea_selections(idea_selection_id), idea_selection_content_hash content.sha256,
idea_candidate_id TEXT COLLATE pg_catalog."C" REFERENCES content.idea_candidates(idea_candidate_id), idea_content_hash content.sha256,
language TEXT COLLATE pg_catalog."C" NOT NULL, content_format TEXT COLLATE pg_catalog."C" NOT NULL CHECK(content_format IN ('short_video','long_video')),
estimated_duration_seconds content.safe_positive NOT NULL,
origin TEXT COLLATE pg_catalog."C" NOT NULL CHECK(origin IN ('OPERATOR','EXTERNAL_CONSUMER','AUTOMATION')), created_at TEXT COLLATE pg_catalog."C" NOT NULL,
revision content.safe_positive NOT NULL, supersedes_script_id TEXT COLLATE pg_catalog."C" UNIQUE REFERENCES content.scripts(script_id),
content_hash content.sha256 NOT NULL, payload_json JSON NOT NULL,
commercial_selection_id TEXT COLLATE pg_catalog."C" REFERENCES content.affiliate_editorial_selections(selection_id), commercial_selection_hash content.sha256,
UNIQUE(idea_selection_id,revision), UNIQUE(commercial_selection_id,revision),
CHECK ((schema_version='script/1.0.0' AND origin IN ('OPERATOR','EXTERNAL_CONSUMER') AND commercial_selection_id IS NULL AND commercial_selection_hash IS NULL AND idea_selection_id IS NOT NULL AND idea_selection_content_hash IS NOT NULL AND idea_candidate_id IS NOT NULL AND idea_content_hash IS NOT NULL) OR
(schema_version='script/2.0.0' AND origin IN ('OPERATOR','AUTOMATION') AND commercial_selection_id IS NOT NULL AND commercial_selection_hash IS NOT NULL AND idea_selection_id IS NULL AND idea_selection_content_hash IS NULL AND idea_candidate_id IS NULL AND idea_content_hash IS NULL))
);
-- Native, intra-domain integrity. External read contracts deliberately have no fabricated FK.
ALTER TABLE content.artifact_lineage ADD UNIQUE(artifact_id,pipeline_run_id,project_id,project_version,content_hash);
ALTER TABLE content.idea_batches ADD UNIQUE(idea_batch_id,pipeline_run_id,project_id,project_version);
ALTER TABLE content.idea_candidates ADD UNIQUE(idea_candidate_id,idea_batch_id,pipeline_run_id,project_id,project_version);
ALTER TABLE content.idea_candidates ADD UNIQUE(idea_candidate_id,pipeline_run_id,project_id,project_version,content_hash);
ALTER TABLE content.idea_scores ADD UNIQUE(idea_score_id,idea_candidate_id,idea_batch_id,pipeline_run_id,project_id,project_version,content_hash);
ALTER TABLE content.idea_selections ADD UNIQUE(idea_selection_id,idea_candidate_id,pipeline_run_id,project_id,project_version,content_hash);
ALTER TABLE content.affiliate_editorial_selections ADD UNIQUE(selection_id,pipeline_run_id,project_id,project_version,content_hash);
ALTER TABLE content.idea_candidates ADD FOREIGN KEY(idea_batch_id,pipeline_run_id,project_id,project_version) REFERENCES content.idea_batches(idea_batch_id,pipeline_run_id,project_id,project_version);
ALTER TABLE content.idea_scores ADD FOREIGN KEY(idea_candidate_id,idea_batch_id,pipeline_run_id,project_id,project_version) REFERENCES content.idea_candidates(idea_candidate_id,idea_batch_id,pipeline_run_id,project_id,project_version);
ALTER TABLE content.idea_selections ADD FOREIGN KEY(idea_candidate_id,pipeline_run_id,project_id,project_version,idea_content_hash) REFERENCES content.idea_candidates(idea_candidate_id,pipeline_run_id,project_id,project_version,content_hash);
ALTER TABLE content.idea_selections ADD FOREIGN KEY(idea_score_id,idea_candidate_id,idea_batch_id,pipeline_run_id,project_id,project_version,idea_score_content_hash) REFERENCES content.idea_scores(idea_score_id,idea_candidate_id,idea_batch_id,pipeline_run_id,project_id,project_version,content_hash);
ALTER TABLE content.scripts ADD FOREIGN KEY(idea_selection_id,idea_candidate_id,pipeline_run_id,project_id,project_version,idea_selection_content_hash) REFERENCES content.idea_selections(idea_selection_id,idea_candidate_id,pipeline_run_id,project_id,project_version,content_hash);
ALTER TABLE content.scripts ADD FOREIGN KEY(idea_candidate_id,pipeline_run_id,project_id,project_version,idea_content_hash) REFERENCES content.idea_candidates(idea_candidate_id,pipeline_run_id,project_id,project_version,content_hash);
ALTER TABLE content.scripts ADD FOREIGN KEY(commercial_selection_id,pipeline_run_id,project_id,project_version,commercial_selection_hash) REFERENCES content.affiliate_editorial_selections(selection_id,pipeline_run_id,project_id,project_version,content_hash);
CREATE FUNCTION content.validate_lineage_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='INTERNAL_ARTIFACT' AND NOT EXISTS (
 SELECT 1 FROM content.artifact_lineage parent JOIN content.artifact_lineage target
 ON target.artifact_id=NEW.artifact_id
 WHERE parent.artifact_id=NEW.input_id AND parent.content_hash=NEW.content_hash
 AND parent.pipeline_run_id=target.pipeline_run_id AND parent.project_id=target.project_id AND parent.project_version=target.project_version
 ) THEN RAISE EXCEPTION USING ERRCODE='P3002', MESSAGE='CONTENT_LINEAGE_INPUT_MISMATCH'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_lineage_input BEFORE INSERT ON content.artifact_lineage_inputs FOR EACH ROW EXECUTE FUNCTION content.validate_lineage_input();
CREATE FUNCTION content.validate_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='idea_selections' THEN
  IF (NEW.revision=1 AND NEW.supersedes_idea_selection_id IS NOT NULL) OR
  (NEW.revision>1 AND NOT EXISTS (SELECT 1 FROM content.idea_selections p WHERE p.idea_selection_id=NEW.supersedes_idea_selection_id AND p.idea_batch_id=NEW.idea_batch_id AND p.pipeline_run_id=NEW.pipeline_run_id AND p.project_id=NEW.project_id AND p.project_version=NEW.project_version AND p.revision+1=NEW.revision))
  THEN RAISE EXCEPTION USING ERRCODE='P3002', MESSAGE='CONTENT_REVISION_MISMATCH'; END IF;
 ELSE
  IF (NEW.revision=1 AND NEW.supersedes_script_id IS NOT NULL) OR
  (NEW.revision>1 AND NOT EXISTS (SELECT 1 FROM content.scripts p WHERE p.script_id=NEW.supersedes_script_id AND p.schema_version=NEW.schema_version AND p.idea_selection_id IS NOT DISTINCT FROM NEW.idea_selection_id AND p.commercial_selection_id IS NOT DISTINCT FROM NEW.commercial_selection_id AND p.pipeline_run_id=NEW.pipeline_run_id AND p.project_id=NEW.project_id AND p.project_version=NEW.project_version AND p.language=NEW.language AND p.content_format=NEW.content_format AND p.revision+1=NEW.revision))
  THEN RAISE EXCEPTION USING ERRCODE='P3002', MESSAGE='CONTENT_REVISION_MISMATCH'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_selection_revision BEFORE INSERT ON content.idea_selections FOR EACH ROW EXECUTE FUNCTION content.validate_revision();
CREATE TRIGGER validate_script_revision BEFORE INSERT ON content.scripts FOR EACH ROW EXECUTE FUNCTION content.validate_revision();
CREATE FUNCTION content.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P3001', MESSAGE='IMMUTABLE_CONTENT_RECORD'; END $$;
CREATE TRIGGER immutable_artifact_lineage BEFORE UPDATE OR DELETE ON content.artifact_lineage FOR EACH ROW EXECUTE FUNCTION content.reject_mutation();
CREATE TRIGGER immutable_artifact_lineage_inputs BEFORE UPDATE OR DELETE ON content.artifact_lineage_inputs FOR EACH ROW EXECUTE FUNCTION content.reject_mutation();
CREATE TRIGGER immutable_idea_batches BEFORE UPDATE OR DELETE ON content.idea_batches FOR EACH ROW EXECUTE FUNCTION content.reject_mutation();
CREATE TRIGGER immutable_idea_candidates BEFORE UPDATE OR DELETE ON content.idea_candidates FOR EACH ROW EXECUTE FUNCTION content.reject_mutation();
CREATE TRIGGER immutable_idea_candidate_evidence BEFORE UPDATE OR DELETE ON content.idea_candidate_evidence FOR EACH ROW EXECUTE FUNCTION content.reject_mutation();
CREATE TRIGGER immutable_idea_scores BEFORE UPDATE OR DELETE ON content.idea_scores FOR EACH ROW EXECUTE FUNCTION content.reject_mutation();
CREATE TRIGGER immutable_idea_selections BEFORE UPDATE OR DELETE ON content.idea_selections FOR EACH ROW EXECUTE FUNCTION content.reject_mutation();
CREATE TRIGGER immutable_affiliate_editorial_selections BEFORE UPDATE OR DELETE ON content.affiliate_editorial_selections FOR EACH ROW EXECUTE FUNCTION content.reject_mutation();
CREATE TRIGGER immutable_scripts BEFORE UPDATE OR DELETE ON content.scripts FOR EACH ROW EXECUTE FUNCTION content.reject_mutation();
CREATE INDEX ideas_run_order ON content.idea_candidates(pipeline_run_id,created_at,idea_batch_id,idea_candidate_id);
CREATE INDEX scores_batch_order ON content.idea_scores(idea_batch_id,rank,idea_candidate_id);
CREATE INDEX selections_run_order ON content.idea_selections(pipeline_run_id,decided_at,idea_batch_id,revision,idea_selection_id);
CREATE INDEX scripts_run_order ON content.scripts(pipeline_run_id,created_at,idea_selection_id,revision,script_id);
`,
  },
];
export const CONTENT_POSTGRES_MIGRATION_REGISTRY = [
  ...RESEARCH_POSTGRES_MIGRATION_REGISTRY,
  ...CONTENT_POSTGRES_MIGRATIONS,
] as const;
