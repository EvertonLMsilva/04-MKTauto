import { Inject, Injectable } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { AFFILIATE_DATABASE } from './affiliate-database.config.js';
import { SqliteAffiliateRepository } from './sqlite-affiliate.repository.js';
import { affiliateHash } from '../domain/affiliate-contracts.js';

// Affiliate-owned operational journal, never a second product catalog. Provisioned
// explicitly by configure(), not at Nest bootstrap. No change to PRAGMA user_version
// or global migrations. Existing product/campaign storage remains authoritative.
@Injectable()
export class ShopeeDynamicJournal {
  constructor(
    @Inject(AFFILIATE_DATABASE) private readonly path: string | null,
  ) {}
  initialize() {
    if (!this.path || !isAbsolute(this.path))
      throw new Error('SHOPEE_DATABASE_REQUIRED');
    const preflight = new SqliteAffiliateRepository(this.path, {
      readOnly: true,
    });
    try {
      if (
        !preflight.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='affiliate_campaign_sources_v1'",
          )
          .get()
      )
        throw new Error('SHOPEE_SCHEMA_PROVISION_REQUIRED');
    } finally {
      preflight.close();
    }
    this.withDb(false, (db) =>
      db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS affiliate_shopee_dynamic_events_v1 (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL, identity TEXT NOT NULL, event TEXT NOT NULL,
        content_hash TEXT NOT NULL, content_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(topic,identity,event)
      );
      CREATE TRIGGER IF NOT EXISTS affiliate_shopee_dynamic_no_update
        BEFORE UPDATE ON affiliate_shopee_dynamic_events_v1 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      CREATE TRIGGER IF NOT EXISTS affiliate_shopee_dynamic_no_delete
        BEFORE DELETE ON affiliate_shopee_dynamic_events_v1 BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
      COMMIT;
    `),
    );
  }
  put(topic: string, identity: string, event: string, value: unknown): boolean {
    // Hash exactly what is serialized; optional undefined fields are omitted by JSON.
    const content = JSON.stringify(value);
    const persisted: unknown = JSON.parse(content);
    return this.withDb(false, (db) => {
      const result = db
        .prepare(
          `INSERT INTO affiliate_shopee_dynamic_events_v1
        (topic,identity,event,content_hash,content_json) VALUES(?,?,?,?,?) ON CONFLICT(topic,identity,event) DO NOTHING`,
        )
        .run(
          topic,
          identity,
          event,
          affiliateHash({ value: persisted }),
          content,
        );
      return Number(result.changes) === 1;
    });
  }
  get<T>(topic: string, identity: string, event?: string): T | null {
    return this.withDb(true, (db) => {
      if (
        !db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='affiliate_shopee_dynamic_events_v1'",
          )
          .get()
      )
        return null;
      const row =
        event === undefined
          ? db
              .prepare(
                'SELECT content_hash,content_json FROM affiliate_shopee_dynamic_events_v1 WHERE topic=? AND identity=? ORDER BY sequence DESC LIMIT 1',
              )
              .get(topic, identity)
          : db
              .prepare(
                'SELECT content_hash,content_json FROM affiliate_shopee_dynamic_events_v1 WHERE topic=? AND identity=? AND event=?',
              )
              .get(topic, identity, event);
      if (!row) return null;
      const value: unknown = JSON.parse(String(row.content_json));
      if (affiliateHash({ value }) !== row.content_hash)
        throw new Error('SHOPEE_JOURNAL_INTEGRITY');
      return value as T;
    });
  }
  // One unresolved operation per project/product/shop, including across changed
  // SubIDs or origin URLs. Reserve both identities in a single SQLite transaction.
  claimLink(callId: string, scope: string, value: unknown): boolean {
    return this.withDb(false, (db) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = db
          .prepare(
            "SELECT event FROM affiliate_shopee_dynamic_events_v1 WHERE topic='LINK_SCOPE' AND identity=? ORDER BY sequence DESC LIMIT 1",
          )
          .get(scope);
        if (
          prior &&
          !db
            .prepare(
              "SELECT 1 FROM affiliate_shopee_dynamic_events_v1 WHERE topic='LINK' AND identity=? AND event IN ('RESULT','RECONCILED')",
            )
            .get(prior.event!)
        ) {
          db.exec('COMMIT');
          return false;
        }
        const content = JSON.stringify(value);
        const insert = db.prepare(
          'INSERT INTO affiliate_shopee_dynamic_events_v1(topic,identity,event,content_hash,content_json) VALUES(?,?,?,?,?) ON CONFLICT(topic,identity,event) DO NOTHING',
        );
        const reserved = insert.run(
          'LINK',
          callId,
          'CLAIM',
          affiliateHash({ value: JSON.parse(content) }),
          content,
        );
        if (!reserved.changes) {
          db.exec('COMMIT');
          return false;
        }
        insert.run(
          'LINK_SCOPE',
          scope,
          callId,
          affiliateHash({ value: { callId } }),
          JSON.stringify({ callId }),
        );
        db.exec('COMMIT');
        return true;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });
  }
  private withDb<T>(readOnly: boolean, operation: (db: DatabaseSync) => T) {
    if (!this.path || !isAbsolute(this.path))
      throw new Error('SHOPEE_DATABASE_REQUIRED');
    // Never create a database by accident, even during explicit provisioning.
    const check = new DatabaseSync(this.path, { readOnly: true });
    check.close();
    const db = new DatabaseSync(this.path, { readOnly });
    try {
      db.exec('PRAGMA busy_timeout=5000');
      return operation(db);
    } finally {
      db.close();
    }
  }
}
