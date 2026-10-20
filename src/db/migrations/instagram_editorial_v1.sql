CREATE TABLE IF NOT EXISTS instagram_caption_versions (
 execution_id TEXT NOT NULL REFERENCES campaign_executions(execution_id), revision INTEGER NOT NULL CHECK(revision>0),
 context_hash TEXT NOT NULL CHECK(length(context_hash)=64), content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash)=64),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), PRIMARY KEY(execution_id,revision)
);
CREATE TRIGGER IF NOT EXISTS instagram_caption_no_update BEFORE UPDATE ON instagram_caption_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_CAPTION'); END;
CREATE TRIGGER IF NOT EXISTS instagram_caption_no_delete BEFORE DELETE ON instagram_caption_versions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_CAPTION'); END;
CREATE TABLE IF NOT EXISTS instagram_publication_rights (
 scope_hash TEXT PRIMARY KEY CHECK(length(scope_hash)=64), content_hash TEXT NOT NULL CHECK(length(content_hash)=64), payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE TRIGGER IF NOT EXISTS instagram_publication_rights_no_update BEFORE UPDATE ON instagram_publication_rights BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_PUBLICATION_RIGHTS'); END;
CREATE TRIGGER IF NOT EXISTS instagram_publication_rights_no_delete BEFORE DELETE ON instagram_publication_rights BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_PUBLICATION_RIGHTS'); END;
