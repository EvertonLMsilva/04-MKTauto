-- Additive schema-42 extension; registered separately from immutable numbered histories.
CREATE TABLE affiliate_campaign_sources_v1 (
 source_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision > 0),
 campaign_id TEXT NOT NULL,
 campaign_revision INTEGER NOT NULL,
 product_id TEXT NOT NULL,
 product_revision INTEGER NOT NULL,
 briefing_id TEXT REFERENCES affiliate_briefings(briefing_id),
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 content_json TEXT NOT NULL CHECK(json_valid(content_json)),
 PRIMARY KEY(source_id,revision),
 UNIQUE(campaign_id,campaign_revision,revision),
 FOREIGN KEY(campaign_id,campaign_revision) REFERENCES affiliate_campaign_revisions(campaign_id,revision),
 FOREIGN KEY(product_id,product_revision) REFERENCES affiliate_product_revisions(product_id,revision)
);
CREATE UNIQUE INDEX affiliate_campaign_source_briefing_v1 ON affiliate_campaign_sources_v1(briefing_id) WHERE briefing_id IS NOT NULL;
CREATE TRIGGER affiliate_campaign_sources_v1_no_update BEFORE UPDATE ON affiliate_campaign_sources_v1
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AFFILIATE_CAMPAIGN_SOURCE'); END;
CREATE TRIGGER affiliate_campaign_sources_v1_no_delete BEFORE DELETE ON affiliate_campaign_sources_v1
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_AFFILIATE_CAMPAIGN_SOURCE'); END;
CREATE TRIGGER affiliate_campaign_sources_v1_scope BEFORE INSERT ON affiliate_campaign_sources_v1
WHEN NOT EXISTS (SELECT 1 FROM affiliate_campaign_revisions c
 WHERE c.campaign_id=NEW.campaign_id AND c.revision=NEW.campaign_revision
 AND c.product_id=NEW.product_id AND c.product_revision=NEW.product_revision
 AND json_extract(c.content_json,'$.affiliateUrl')=json_extract(NEW.content_json,'$.affiliateUrl'))
 OR (NEW.briefing_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM affiliate_briefings b
 WHERE b.briefing_id=NEW.briefing_id AND b.campaign_id=NEW.campaign_id AND b.campaign_revision=NEW.campaign_revision))
 OR EXISTS (SELECT 1 FROM affiliate_campaign_sources_v1 s
 WHERE s.campaign_id=NEW.campaign_id AND s.campaign_revision=NEW.campaign_revision AND s.source_id<>NEW.source_id)
BEGIN SELECT RAISE(ABORT,'AFFILIATE_SOURCE_SCOPE_MISMATCH'); END;
