import { runAffiliateIo } from '../application/affiliate-io.js';
import { PostgresAffiliateSessionFactory } from './postgres-affiliate.session.js';
import type { Io } from '../application/affiliate-io.js';
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
export class ShopeeDynamicJournal<A extends boolean = false> {
  get asynchronous() {
    return typeof this.path === 'object' && this.path !== null;
  }
  constructor(
    @Inject(AFFILIATE_DATABASE)
    private readonly path: string | null | PostgresAffiliateSessionFactory,
  ) {}
  initialize(): Io<A, void> {
    if (this.path && typeof this.path !== 'string')
      return this.path.verify() as Io<A, void>;
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
    return this.withDb(false, (db: any) =>
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
  put(
    topic: string,
    identity: string,
    event: string,
    value: unknown,
  ): Io<A, boolean> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        // Hash exactly what is serialized; optional undefined fields are omitted by JSON.
        const content = JSON.stringify(value);
        const persisted: unknown = JSON.parse(content);
        return yield this.withDb(false, (db: any) =>
          runAffiliateIo(
            function* (this: any): Generator<unknown, any, any> {
              const result = yield db
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
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  get<T>(topic: string, identity: string, event?: string): Io<A, T | null> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.withDb(true, (db: any) =>
          runAffiliateIo(
            function* (this: any): Generator<unknown, any, any> {
              if (!(yield this.available(db))) return null;
              const row =
                event === undefined
                  ? yield db
                      .prepare(
                        'SELECT content_hash,content_json FROM affiliate_shopee_dynamic_events_v1 WHERE topic=? AND identity=? ORDER BY sequence DESC LIMIT 1',
                      )
                      .get(topic, identity)
                  : yield db
                      .prepare(
                        'SELECT content_hash,content_json FROM affiliate_shopee_dynamic_events_v1 WHERE topic=? AND identity=? AND event=?',
                      )
                      .get(topic, identity, event);
              if (!row) return null;
              const value: unknown = JSON.parse(String(row.content_json));
              if (affiliateHash({ value }) !== row.content_hash)
                throw new Error('SHOPEE_JOURNAL_INTEGRITY');
              return value as T;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  // One unresolved operation per project/product/shop, including across changed
  // SubIDs or origin URLs. Reserve both identities in a single SQLite transaction.
  claimLink(callId: string, scope: string, value: unknown): Io<A, boolean> {
    return runAffiliateIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.withDb(
          false,
          (db: any) =>
            runAffiliateIo(
              function* (this: any): Generator<unknown, any, any> {
                const prior = yield db
                  .prepare(
                    "SELECT event FROM affiliate_shopee_dynamic_events_v1 WHERE topic='LINK_SCOPE' AND identity=? ORDER BY sequence DESC LIMIT 1",
                  )
                  .get(scope);
                if (
                  prior &&
                  !(yield db
                    .prepare(
                      "SELECT 1 FROM affiliate_shopee_dynamic_events_v1 WHERE topic='LINK' AND identity=? AND event IN ('RESULT','RECONCILED')",
                    )
                    .get(prior.event!))
                ) {
                  return false;
                }
                const content = JSON.stringify(value);
                const insert = db.prepare(
                  'INSERT INTO affiliate_shopee_dynamic_events_v1(topic,identity,event,content_hash,content_json) VALUES(?,?,?,?,?) ON CONFLICT(topic,identity,event) DO NOTHING',
                );
                const reserved = yield insert.run(
                  'LINK',
                  callId,
                  'CLAIM',
                  affiliateHash({ value: JSON.parse(content) }),
                  content,
                );
                if (!reserved.changes) {
                  return false;
                }
                yield insert.run(
                  'LINK_SCOPE',
                  scope,
                  callId,
                  affiliateHash({ value: { callId } }),
                  JSON.stringify({ callId }),
                );
                return true;
              }.call(this),
            ),
          true,
        );
      }.call(this),
    );
  }
  private available(db: DatabaseSync): boolean {
    return (
      this.asynchronous ||
      !!db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='affiliate_shopee_dynamic_events_v1'",
        )
        .get()
    );
  }
  private withDb<T>(
    readOnly: boolean,
    operation: (db: any) => T,
    atomic = false,
  ): any {
    if (this.path && typeof this.path !== 'string')
      return this.path.withSession(readOnly, operation);
    if (!this.path || !isAbsolute(this.path))
      throw new Error('SHOPEE_DATABASE_REQUIRED');
    const check = new DatabaseSync(this.path, { readOnly: true });
    check.close();
    const db = new DatabaseSync(this.path, { readOnly });
    try {
      db.exec('PRAGMA busy_timeout=5000');
      if (atomic) db.exec('BEGIN IMMEDIATE');
      const result = operation(db);
      if (atomic) db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    } finally {
      db.close();
    }
  }
}
