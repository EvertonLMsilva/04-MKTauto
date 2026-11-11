-- Parallel V2 payloads leave all legacy FK/lineage constraints and records intact.
CREATE TABLE p4_artifacts (
  kind TEXT NOT NULL CHECK(kind IN ('audio_config','voice_track','video_render','qc_report','human_approval')),
  artifact_id TEXT NOT NULL,
  identity_hash TEXT NOT NULL CHECK(length(identity_hash)=64),
  pipeline_run_id TEXT REFERENCES pipeline_runs(pipeline_run_id),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(kind,artifact_id)
);
CREATE TRIGGER p4_artifact_no_update BEFORE UPDATE ON p4_artifacts
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_P4_ARTIFACT'); END;
CREATE UNIQUE INDEX p4_audio_revision ON p4_artifacts(json_extract(payload_json,'$.campaignId'),json_extract(payload_json,'$.revision')) WHERE kind='audio_config';
CREATE TRIGGER p4_artifact_no_delete BEFORE DELETE ON p4_artifacts
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_P4_ARTIFACT'); END;
