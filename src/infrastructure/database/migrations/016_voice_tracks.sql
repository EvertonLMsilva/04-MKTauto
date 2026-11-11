CREATE TABLE voice_tracks (
  voice_track_id TEXT PRIMARY KEY REFERENCES artifact_lineage(artifact_id),
  schema_version TEXT NOT NULL,
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  script_id TEXT NOT NULL REFERENCES scripts(script_id),
  script_content_hash TEXT NOT NULL CHECK (length(script_content_hash) = 64 AND script_content_hash NOT GLOB '*[^0-9a-f]*'),
  language TEXT NOT NULL,
  voice_style TEXT NOT NULL,
  duration_milliseconds INTEGER NOT NULL CHECK (duration_milliseconds > 0),
  audio_format TEXT NOT NULL CHECK (audio_format IN ('mp3', 'wav', 'm4a', 'ogg', 'flac')),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  storage_reference TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('SYNTHETIC_TTS', 'OPERATOR_RECORDING', 'AUTHORIZED_RECORDING')),
  provider TEXT,
  usage_basis TEXT NOT NULL CHECK (usage_basis IN ('OWNED', 'LICENSED', 'PROVIDER_TERMS')),
  commercial_use_allowed INTEGER NOT NULL CHECK (commercial_use_allowed = 1),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_voice_track_id TEXT REFERENCES voice_tracks(voice_track_id),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (script_id, revision),
  UNIQUE (supersedes_voice_track_id),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version)
);

CREATE INDEX voice_tracks_run_order
  ON voice_tracks(pipeline_run_id, created_at, script_id, revision, voice_track_id);
CREATE INDEX voice_tracks_script_order
  ON voice_tracks(script_id, revision, voice_track_id);

CREATE TRIGGER voice_tracks_validate_scope
BEFORE INSERT ON voice_tracks
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN scripts s ON s.script_id = NEW.script_id
  JOIN artifact_lineage a ON a.artifact_id = NEW.voice_track_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND s.pipeline_run_id = NEW.pipeline_run_id
    AND s.project_id = NEW.project_id AND s.project_version = NEW.project_version
    AND s.content_hash = NEW.script_content_hash
    AND a.artifact_type = 'voice_track'
    AND a.pipeline_run_id = NEW.pipeline_run_id
    AND a.project_id = NEW.project_id AND a.project_version = NEW.project_version
    AND a.content_hash = NEW.content_hash
)
BEGIN
  SELECT RAISE(ABORT, 'VOICE_TRACK_SCOPE_MISMATCH');
END;

CREATE TRIGGER voice_tracks_validate_revision
BEFORE INSERT ON voice_tracks
WHEN (NEW.revision = 1 AND NEW.supersedes_voice_track_id IS NOT NULL)
  OR (NEW.revision > 1 AND NOT EXISTS (
    SELECT 1 FROM voice_tracks previous
    WHERE previous.voice_track_id = NEW.supersedes_voice_track_id
      AND previous.script_id = NEW.script_id
      AND previous.pipeline_run_id = NEW.pipeline_run_id
      AND previous.project_id = NEW.project_id
      AND previous.project_version = NEW.project_version
      AND previous.language = NEW.language
      AND previous.voice_style = NEW.voice_style
      AND previous.revision = NEW.revision - 1
  ))
BEGIN
  SELECT RAISE(ABORT, 'VOICE_TRACK_REVISION_MISMATCH');
END;

CREATE TRIGGER voice_tracks_no_update BEFORE UPDATE ON voice_tracks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VOICE_TRACK'); END;
CREATE TRIGGER voice_tracks_no_delete BEFORE DELETE ON voice_tracks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_VOICE_TRACK'); END;
