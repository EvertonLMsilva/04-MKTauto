import { DatabaseSync } from 'node:sqlite';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import {
  buildCaption,
  validateCaptionEdit,
  publicationGrant,
  validPublicationGrant,
} from '../domain/instagram-editorial.js';
import {
  instagramCaption,
  socialFail,
} from '../domain/social-publication-contracts.js';
import { isAbsolute } from 'node:path';
export class InstagramEditorialService {
  constructor(private readonly path: string | null) {}
  private session<T>(write: boolean, action: (db: DatabaseSync) => T): T {
    if (!this.path || !isAbsolute(this.path))
      socialFail('SOCIAL_DATABASE_REQUIRED');
    const db = new DatabaseSync(this.path!, { readOnly: !write });
    try {
      db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON');
      return action(db);
    } finally {
      db.close();
    }
  }
  history(id: string) {
    return this.session(false, (db) =>
      db
        .prepare(
          'SELECT payload_json FROM instagram_caption_versions WHERE execution_id=? ORDER BY revision',
        )
        .all(id)
        .map((row) => {
          const v = JSON.parse(String(row.payload_json));
          const { contentHash, ...body } = v;
          if (affiliateHash(body) !== contentHash)
            socialFail('SOCIAL_CAPTION_INTEGRITY');
          return v;
        }),
    );
  }
  ensure(
    id: string,
    context: any,
    change?: { previousHash: string; text?: string; actorId: string },
  ) {
    return this.session(true, (db) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const rows = db
          .prepare(
            'SELECT payload_json FROM instagram_caption_versions WHERE execution_id=? ORDER BY revision DESC LIMIT 1',
          )
          .get(id);
        const previous = rows ? JSON.parse(String(rows.payload_json)) : null;
        if (previous) {
          const { contentHash, ...body } = previous;
          if (affiliateHash(body) !== contentHash)
            socialFail('SOCIAL_CAPTION_INTEGRITY');
        }
        const base = buildCaption(
          context,
          (previous?.revision ?? 0) + (change ? 1 : 0) || 1,
        );
        if (!change && previous?.contextHash === base.contextHash) {
          db.exec('COMMIT');
          return previous;
        }
        if (
          change &&
          (!previous || change.previousHash !== previous.contentHash)
        )
          socialFail('SOCIAL_CAPTION_VERSION_STALE');
        const text =
          change?.text !== undefined
            ? validateCaptionEdit(change.text, base)
            : base.text;
        const envelope = instagramCaption({
          caption: text,
          cta: context.briefing.cta,
          disclosure: context.briefing.disclosure,
          link: context.briefing.affiliateUrl,
        });
        const body = {
          ...base,
          text,
          envelope,
          executionId: id,
          revision: (previous?.revision ?? 0) + 1,
          previousHash: previous?.contentHash ?? null,
          context,
          actorId: change?.actorId ?? null,
          origin:
            change?.text !== undefined
              ? 'OPERATOR_EDIT'
              : 'AUTOMATIC_GROUNDED_EXTRACTION',
          createdAt: new Date().toISOString(),
        };
        const value = { ...body, contentHash: affiliateHash(body) };
        db.prepare(
          'INSERT INTO instagram_caption_versions VALUES(?,?,?,?,?)',
        ).run(
          id,
          value.revision,
          value.contextHash,
          value.contentHash,
          JSON.stringify(value),
        );
        db.exec('COMMIT');
        return value;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    });
  }
  grant(scope: any, input: any, actorId: string) {
    const value = publicationGrant(scope, input, actorId);
    return this.session(true, (db) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db
          .prepare(
            'SELECT payload_json FROM instagram_publication_rights WHERE scope_hash=?',
          )
          .get(scope.scopeHash);
        if (row) {
          const old = JSON.parse(String(row.payload_json));
          if (
            !validPublicationGrant(old, scope) ||
            old.sourceRef !== value.sourceRef ||
            old.statement !== value.statement ||
            old.actorId !== actorId
          )
            socialFail('SOCIAL_PUBLICATION_CONSENT_CONFLICT');
          db.exec('COMMIT');
          return old;
        }
        db.prepare(
          'INSERT INTO instagram_publication_rights VALUES(?,?,?)',
        ).run(scope.scopeHash, value.contentHash, JSON.stringify(value));
        db.exec('COMMIT');
        return value;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    });
  }
}
