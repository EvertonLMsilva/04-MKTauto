CREATE TABLE subtitle_tracks (
  subtitle_track_id TEXT PRIMARY KEY REFERENCES artifact_lineage(artifact_id),
  schema_version TEXT NOT NULL,
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64 AND identity_hash NOT GLOB '*[^0-9a-f]*'),
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(pipeline_run_id),
  project_id TEXT NOT NULL,
  project_version INTEGER NOT NULL CHECK (project_version > 0),
  script_id TEXT NOT NULL REFERENCES scripts(script_id),
  script_content_hash TEXT NOT NULL CHECK (length(script_content_hash) = 64 AND script_content_hash NOT GLOB '*[^0-9a-f]*'),
  voice_track_id TEXT NOT NULL REFERENCES voice_tracks(voice_track_id),
  voice_track_content_hash TEXT NOT NULL CHECK (length(voice_track_content_hash) = 64 AND voice_track_content_hash NOT GLOB '*[^0-9a-f]*'),
  language TEXT NOT NULL,
  time_unit TEXT NOT NULL CHECK (time_unit = 'MILLISECONDS'),
  duration_milliseconds INTEGER NOT NULL CHECK (duration_milliseconds > 0),
  style_policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  supersedes_subtitle_track_id TEXT REFERENCES subtitle_tracks(subtitle_track_id),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE (script_id, voice_track_id, revision),
  UNIQUE (supersedes_subtitle_track_id),
  FOREIGN KEY (project_id, project_version) REFERENCES project_snapshots(project_id, version)
);

CREATE TABLE subtitle_cues (
  subtitle_track_id TEXT NOT NULL REFERENCES subtitle_tracks(subtitle_track_id),
  position INTEGER NOT NULL CHECK (position > 0),
  text TEXT NOT NULL CHECK (length(text) > 0),
  start_milliseconds INTEGER NOT NULL CHECK (start_milliseconds >= 0),
  end_milliseconds INTEGER NOT NULL CHECK (end_milliseconds > start_milliseconds),
  PRIMARY KEY (subtitle_track_id, position)
);

CREATE INDEX subtitle_tracks_run_order
  ON subtitle_tracks(pipeline_run_id, created_at, script_id, voice_track_id, revision, subtitle_track_id);
CREATE INDEX subtitle_tracks_script_order
  ON subtitle_tracks(script_id, voice_track_id, revision, subtitle_track_id);
CREATE INDEX subtitle_tracks_voice_order
  ON subtitle_tracks(voice_track_id, script_id, revision, subtitle_track_id);

CREATE TRIGGER subtitle_tracks_validate_scope
BEFORE INSERT ON subtitle_tracks
WHEN NOT EXISTS (
  SELECT 1 FROM pipeline_runs r
  JOIN scripts s ON s.script_id = NEW.script_id
  JOIN voice_tracks v ON v.voice_track_id = NEW.voice_track_id
  JOIN artifact_lineage a ON a.artifact_id = NEW.subtitle_track_id
  WHERE r.pipeline_run_id = NEW.pipeline_run_id
    AND r.project_id = NEW.project_id AND r.project_version = NEW.project_version
    AND s.pipeline_run_id = NEW.pipeline_run_id
    AND s.project_id = NEW.project_id AND s.project_version = NEW.project_version
    AND s.content_hash = NEW.script_content_hash AND s.language = NEW.language
    AND v.pipeline_run_id = NEW.pipeline_run_id
    AND v.project_id = NEW.project_id AND v.project_version = NEW.project_version
    AND v.script_id = NEW.script_id AND v.script_content_hash = NEW.script_content_hash
    AND v.content_hash = NEW.voice_track_content_hash AND v.language = NEW.language
    AND v.duration_milliseconds = NEW.duration_milliseconds
    AND a.artifact_type = 'subtitle_track'
    AND a.pipeline_run_id = NEW.pipeline_run_id
    AND a.project_id = NEW.project_id AND a.project_version = NEW.project_version
    AND a.content_hash = NEW.content_hash
)
BEGIN SELECT RAISE(ABORT, 'SUBTITLE_TRACK_SCOPE_MISMATCH'); END;

CREATE TRIGGER subtitle_tracks_validate_revision
BEFORE INSERT ON subtitle_tracks
WHEN (NEW.revision = 1 AND NEW.supersedes_subtitle_track_id IS NOT NULL)
  OR (NEW.revision > 1 AND NOT EXISTS (
    SELECT 1 FROM subtitle_tracks previous
    WHERE previous.subtitle_track_id = NEW.supersedes_subtitle_track_id
      AND previous.pipeline_run_id = NEW.pipeline_run_id
      AND previous.project_id = NEW.project_id AND previous.project_version = NEW.project_version
      AND previous.script_id = NEW.script_id AND previous.script_content_hash = NEW.script_content_hash
      AND previous.voice_track_id = NEW.voice_track_id
      AND previous.voice_track_content_hash = NEW.voice_track_content_hash
      AND previous.language = NEW.language AND previous.time_unit = NEW.time_unit
      AND previous.duration_milliseconds = NEW.duration_milliseconds
      AND previous.revision = NEW.revision - 1
  ))
BEGIN SELECT RAISE(ABORT, 'SUBTITLE_TRACK_REVISION_MISMATCH'); END;

CREATE TRIGGER subtitle_tracks_no_update BEFORE UPDATE ON subtitle_tracks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SUBTITLE_TRACK'); END;
CREATE TRIGGER subtitle_tracks_no_delete BEFORE DELETE ON subtitle_tracks
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SUBTITLE_TRACK'); END;
CREATE TRIGGER subtitle_cues_no_update BEFORE UPDATE ON subtitle_cues
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SUBTITLE_CUE'); END;
CREATE TRIGGER subtitle_cues_no_delete BEFORE DELETE ON subtitle_cues
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SUBTITLE_CUE'); END;
