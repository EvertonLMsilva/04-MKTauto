import type { PostgresMigration } from '../../../infrastructure/database/postgres/index.js';
import { MEDIA_CATALOG_POSTGRES_MIGRATION_REGISTRY } from './postgres-media-catalog.migrations.js';

export const MEDIA_VOICE_POSTGRES_MIGRATIONS: readonly PostgresMigration[] = [
  {
    version: 8,
    name: '008_media_voice_tracks',
    sql: `
CREATE TABLE media.voice_tracks (
  voice_track_id TEXT COLLATE pg_catalog."C" PRIMARY KEY REFERENCES content.artifact_lineage(artifact_id),
  schema_version TEXT NOT NULL CHECK(schema_version='voice-track/1.0.0'),
  identity_hash media.sha256 NOT NULL,
  pipeline_run_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES campaign.pipeline_runs(pipeline_run_id),
  project_id TEXT COLLATE pg_catalog."C" NOT NULL, project_version media.safe_positive NOT NULL,
  script_id TEXT COLLATE pg_catalog."C" NOT NULL REFERENCES content.scripts(script_id), script_content_hash media.sha256 NOT NULL,
  language TEXT NOT NULL, voice_style TEXT NOT NULL, duration_milliseconds media.safe_positive NOT NULL,
  audio_format TEXT NOT NULL CHECK(audio_format IN ('mp3','wav','m4a','ogg','flac')),
  content_hash media.sha256 NOT NULL, storage_reference TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('SYNTHETIC_TTS','OPERATOR_RECORDING','AUTHORIZED_RECORDING')), provider TEXT,
  usage_basis TEXT NOT NULL CHECK(usage_basis IN ('OWNED','LICENSED','PROVIDER_TERMS')),
  commercial_use_allowed SMALLINT NOT NULL CHECK(commercial_use_allowed=1),
  created_at TEXT COLLATE pg_catalog."C" NOT NULL, revision media.safe_positive NOT NULL,
  supersedes_voice_track_id TEXT COLLATE pg_catalog."C" UNIQUE REFERENCES media.voice_tracks(voice_track_id),
  payload_json JSON NOT NULL, document_hash media.sha256 NOT NULL, rights_hash media.sha256 NOT NULL,
  UNIQUE(script_id,revision), FOREIGN KEY(project_id,project_version) REFERENCES project.project_snapshots(project_id,version),
  CHECK((origin IN ('OPERATOR_RECORDING','AUTHORIZED_RECORDING') AND provider IS NULL AND usage_basis IN ('OWNED','LICENSED'))
    OR (origin='SYNTHETIC_TTS' AND provider IS NOT NULL AND provider IN ('local_piper','local_espeak_ng','local_kokoro') AND usage_basis='LICENSED')),
  CHECK((revision=1 AND supersedes_voice_track_id IS NULL) OR (revision>1 AND supersedes_voice_track_id IS NOT NULL))
);
CREATE INDEX voice_tracks_run_order ON media.voice_tracks(pipeline_run_id,created_at,script_id,revision,voice_track_id);
CREATE INDEX voice_tracks_script_order ON media.voice_tracks(script_id,revision,voice_track_id);
CREATE FUNCTION media.validate_voice_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM campaign.pipeline_runs r JOIN content.scripts s ON s.script_id=NEW.script_id
    JOIN content.artifact_lineage a ON a.artifact_id=NEW.voice_track_id
    WHERE r.pipeline_run_id=NEW.pipeline_run_id AND r.project_id=NEW.project_id AND r.project_version=NEW.project_version
    AND s.pipeline_run_id=NEW.pipeline_run_id AND s.project_id=NEW.project_id AND s.project_version=NEW.project_version
    AND s.content_hash=NEW.script_content_hash AND s.language=NEW.language
    AND a.artifact_type='voice_track' AND a.artifact_version=NEW.revision AND a.pipeline_run_id=NEW.pipeline_run_id
    AND a.project_id=NEW.project_id AND a.project_version=NEW.project_version AND a.content_hash=NEW.content_hash
    AND a.content_identity IS NULL AND a.hash_algorithm='sha256' AND a.created_at=NEW.created_at
    AND a.generation_metadata_json->>'configurationHash'=NEW.document_hash
    AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs i WHERE i.artifact_id=a.artifact_id AND i.position=1
      AND i.kind='INTERNAL_ARTIFACT' AND i.input_id=NEW.script_id AND i.content_hash=NEW.script_content_hash)
    AND EXISTS(SELECT 1 FROM content.artifact_lineage_inputs i WHERE i.artifact_id=a.artifact_id AND i.position=2
      AND i.kind='EXTERNAL_INPUT' AND i.input_id='rights:' || NEW.rights_hash AND i.content_hash=NEW.rights_hash)
    AND (SELECT count(*) FROM content.artifact_lineage_inputs i WHERE i.artifact_id=a.artifact_id)=2)
  THEN RAISE EXCEPTION USING ERRCODE='P8001',MESSAGE='VOICE_TRACK_SCOPE_MISMATCH'; END IF;
  IF NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM media.voice_tracks p WHERE p.voice_track_id=NEW.supersedes_voice_track_id
    AND p.script_id=NEW.script_id AND p.pipeline_run_id=NEW.pipeline_run_id AND p.project_id=NEW.project_id
    AND p.project_version=NEW.project_version AND p.language=NEW.language AND p.voice_style=NEW.voice_style AND p.revision=NEW.revision-1)
  THEN RAISE EXCEPTION USING ERRCODE='P8002',MESSAGE='VOICE_TRACK_REVISION_MISMATCH'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_voice_scope BEFORE INSERT ON media.voice_tracks FOR EACH ROW EXECUTE FUNCTION media.validate_voice_scope();
CREATE FUNCTION media.require_voice_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM media.voice_tracks WHERE voice_track_id=NEW.artifact_id)
  THEN RAISE EXCEPTION USING ERRCODE='P8003',MESSAGE='ORPHAN_VOICE_LINEAGE'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER media_voice_lineage_owner AFTER INSERT ON content.artifact_lineage
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.artifact_type='voice_track') EXECUTE FUNCTION media.require_voice_owner();
CREATE FUNCTION media.reject_voice_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='P8004',MESSAGE='IMMUTABLE_VOICE_TRACK'; END $$;
CREATE TRIGGER immutable_voice_tracks BEFORE UPDATE OR DELETE ON media.voice_tracks FOR EACH ROW EXECUTE FUNCTION media.reject_voice_mutation();
`,
  },
];
export const MEDIA_VOICE_POSTGRES_MIGRATION_REGISTRY = [
  ...MEDIA_CATALOG_POSTGRES_MIGRATION_REGISTRY,
  ...MEDIA_VOICE_POSTGRES_MIGRATIONS,
] as const;
