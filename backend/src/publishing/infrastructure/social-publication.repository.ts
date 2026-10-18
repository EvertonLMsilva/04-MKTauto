import { InstagramPublicationRepository } from './instagram-publication.repository.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { publicText } from '../domain/manual-distribution-contracts.js';
import { socialFail } from '../domain/social-publication-contracts.js';

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync, statSync } from 'node:fs';
const transitions: any = {
  PREPARED: ['CREATING_CONTAINER'],
  CREATING_CONTAINER: ['PROCESSING', 'UNCERTAIN'],
  PROCESSING: ['PROCESSING', 'READY', 'PUBLISHED', 'FAILED', 'EXPIRED'],
  READY: ['READY', 'PUBLISHING'],
  PUBLISHING: ['PUBLISHED', 'UNCERTAIN'],
  UNCERTAIN: ['UNCERTAIN', 'PUBLISHED', 'FAILED', 'EXPIRED'],
  PUBLISHED: ['PUBLISHED'],
  FAILED: [],
  EXPIRED: [],
};
const patchFields: any = new Set([
  'state',
  'containerId',
  'mediaId',
  'uncertainStage',
  'errorCode',
  'providerStatus',
  'confirmationSource',
  'transferEvidence',
  'uploadUri',
  'uploadStage',
  'requiresReconciliation',
  'remoteReceipt',
  'retryAfterSeconds',
]);
const contextSql: any = `CREATE TABLE IF NOT EXISTS social_publication_context (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), execution_mode TEXT NOT NULL CHECK(execution_mode IN ('fake','live')), database_id TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS social_context_no_update BEFORE UPDATE ON social_publication_context BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOCIAL_CONTEXT'); END;
 CREATE TRIGGER IF NOT EXISTS social_context_no_delete BEFORE DELETE ON social_publication_context BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SOCIAL_CONTEXT'); END;`;
const provenanceSql: any = `CREATE TRIGGER IF NOT EXISTS social_operation_mode_insert BEFORE INSERT ON social_publication_operations
 WHEN json_extract(NEW.payload_json,'$.executionMode') IS NOT (SELECT execution_mode FROM social_publication_context WHERE singleton=1)
  OR json_extract(NEW.payload_json,'$.databaseId') IS NOT (SELECT database_id FROM social_publication_context WHERE singleton=1)
 BEGIN SELECT RAISE(ABORT,'SOCIAL_EXECUTION_MODE_MISMATCH'); END;
 CREATE TRIGGER IF NOT EXISTS social_operation_mode_update BEFORE UPDATE ON social_publication_operations
 WHEN json_extract(NEW.payload_json,'$.executionMode') IS NOT (SELECT execution_mode FROM social_publication_context WHERE singleton=1)
  OR json_extract(NEW.payload_json,'$.databaseId') IS NOT (SELECT database_id FROM social_publication_context WHERE singleton=1)
 BEGIN SELECT RAISE(ABORT,'SOCIAL_EXECUTION_MODE_MISMATCH'); END;
 CREATE TRIGGER IF NOT EXISTS social_event_mode_insert BEFORE INSERT ON social_publication_events
 WHEN json_extract(NEW.payload_json,'$.executionMode') IS NOT (SELECT execution_mode FROM social_publication_context WHERE singleton=1)
  OR json_extract(NEW.payload_json,'$.databaseId') IS NOT (SELECT database_id FROM social_publication_context WHERE singleton=1)
 BEGIN SELECT RAISE(ABORT,'SOCIAL_EXECUTION_MODE_MISMATCH'); END;`;
const scheduleTriggers = `CREATE TRIGGER IF NOT EXISTS instagram_schedule_identity BEFORE UPDATE ON instagram_publication_schedules
 WHEN NEW.execution_id IS NOT OLD.execution_id OR NEW.request_json IS NOT OLD.request_json OR NEW.scheduled_at IS NOT OLD.scheduled_at
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_SCHEDULE'); END;
 CREATE TRIGGER IF NOT EXISTS instagram_schedule_no_delete BEFORE DELETE ON instagram_publication_schedules
 BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INSTAGRAM_SCHEDULE'); END;`;
const normalizeSql: any = (sql: any): any =>
  sql
    .replace(/\bIF NOT EXISTS\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;$/, '');
export function verifySocialContextProtections(db: any): any {
  for (const expected of `${contextSql}\n${provenanceSql}\n${scheduleTriggers}`.match(
    /CREATE TRIGGER[\s\S]*?END;/g,
  )!) {
    const name: any = /CREATE TRIGGER IF NOT EXISTS (\w+)/.exec(expected)![1];
    const actual: any = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
      .get(name)?.sql;
    if (!actual || normalizeSql(actual) !== normalizeSql(expected))
      socialFail('SOCIAL_CONTEXT_PROTECTION_INVALID');
  }
}
export class SocialPublicationRepository {
  [key: string]: any;
  constructor(
    base: { db: any },
    { mode = 'fake' }: { mode?: 'fake' | 'live'; readOnly?: boolean } = {},
  ) {
    if (!['fake', 'live'].includes(mode)) socialFail('SOCIAL_CONFIG_INVALID');
    this.db = base.db;
    const path = this.db
      .prepare('PRAGMA database_list')
      .all()
      .find((row: any) => row.name === 'main')?.file;
    const principal = fileURLToPath(
      new URL('../../../../data/mktauto.sqlite', import.meta.url),
    );
    if (
      (!path && mode === 'live') ||
      (path &&
        (resolve(path).toLowerCase() === principal.toLowerCase() ||
          (existsSync(principal) && sameFile(path, principal))))
    )
      socialFail('SOCIAL_DATABASE_BOUNDARY_INVALID');
    let row: any;
    try {
      row = this.db
        .prepare('SELECT * FROM social_publication_context WHERE singleton=1')
        .get();
      if (
        row?.execution_mode !== mode ||
        typeof row.database_id !== 'string' ||
        !row.database_id
      )
        socialFail('SOCIAL_LIVE_PROVENANCE_REQUIRED');
      for (const table of [
        'social_publication_operations',
        'social_publication_events',
      ])
        if (
          this.db
            .prepare(
              `SELECT 1 FROM ${table} WHERE json_extract(payload_json,'$.executionMode') IS NOT ? OR json_extract(payload_json,'$.databaseId') IS NOT ? LIMIT 1`,
            )
            .get(mode, row.database_id)
        )
          socialFail('SOCIAL_LIVE_PROVENANCE_REQUIRED');
    } catch {
      socialFail('SOCIAL_LIVE_PROVENANCE_REQUIRED');
    }
    verifySocialContextProtections(this.db);
    Object.defineProperties(this, {
      mode: { value: mode, enumerable: true },
      databaseId: { value: row.database_id, enumerable: true },
    });
  }
  #context(): any {
    const row: any = this.db
      .prepare('SELECT * FROM social_publication_context WHERE singleton=1')
      .get();
    if (
      row?.execution_mode !== this.mode ||
      row.database_id !== this.databaseId
    )
      socialFail('SOCIAL_EXECUTION_MODE_MISMATCH');
  }
  #transaction(fn: any): any {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value: any = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error: any) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(id: any): any {
    this.#context();
    publicText(id, 'operationId', 200);
    const row: any = this.db
      .prepare(
        'SELECT * FROM social_publication_operations WHERE operation_id=?',
      )
      .get(id);
    if (!row) return null;
    const value: any = JSON.parse(row.payload_json),
      { contentHash, ...body } = value;
    if (
      contentHash !== affiliateHash(body) ||
      value.version !== row.version ||
      value.operationId !== row.operation_id ||
      value.packageHash !== row.package_hash ||
      value.accountId !== row.account_id ||
      value.requestHash !== row.request_hash ||
      value.executionMode !== this.mode ||
      value.databaseId !== this.databaseId
    )
      socialFail('SOCIAL_PERSISTED_INTEGRITY');
    return Object.freeze(value);
  }
  authorizePublication(operation: any, at: string) {
    if (
      Number(this.db.prepare('PRAGMA user_version').get()?.user_version) >= 42
    )
      new InstagramPublicationRepository(this.db).authorize(operation, at);
  }
  history(id: string): any[] {
    const operation = this.get(id);
    if (!operation) return [];
    return this.db
      .prepare(
        'SELECT version,payload_json FROM social_publication_events WHERE operation_id=? ORDER BY version',
      )
      .all(id)
      .map((row: any) => {
        const value = JSON.parse(row.payload_json),
          { contentHash, ...body } = value;
        if (
          contentHash !== affiliateHash(body) ||
          value.operationId !== id ||
          value.version !== row.version ||
          value.packageHash !== operation.packageHash ||
          value.accountId !== operation.accountId ||
          value.requestHash !== operation.requestHash ||
          value.executionMode !== this.mode ||
          value.databaseId !== this.databaseId
        )
          socialFail('SOCIAL_PERSISTED_INTEGRITY');
        return Object.freeze(value);
      });
  }
  prepare(request: any, key: any, now: any): any {
    request = {
      ...request,
      executionMode: this.mode,
      databaseId: this.databaseId,
    };
    publicText(key, 'idempotencyKey', 200);
    const requestHash: any = affiliateHash(request),
      id: any = `social_publication:${requestHash}`;
    return this.#transaction((): any => {
      const prior: any = this.db
        .prepare(
          'SELECT * FROM social_publication_commands WHERE idempotency_key=?',
        )
        .get(key);
      if (prior && prior.request_hash !== requestHash)
        socialFail('SOCIAL_IDEMPOTENCY_CONFLICT');
      const destination: any = this.db
        .prepare(
          'SELECT operation_id FROM social_publication_operations WHERE package_hash=? AND account_id=?',
        )
        .get(request.packageHash, request.accountId);
      if (destination && destination.operation_id !== id)
        socialFail('SOCIAL_IDEMPOTENCY_CONFLICT');
      let value: any = this.get(id);
      if (!value) {
        value = this.#seal({
          ...request,
          requestHash,
          operationId: id,
          state: 'PREPARED',
          containerId: null,
          mediaId: null,
          uncertainStage: null,
          errorCode: null,
          providerStatus: null,
          confirmationSource: null,
          transferEvidence: null,
          version: 0,
          updatedAt: now,
        });
        this.db
          .prepare(
            'INSERT INTO social_publication_operations VALUES (?,?,?,?,?,?)',
          )
          .run(
            id,
            request.packageHash,
            request.accountId,
            requestHash,
            JSON.stringify(value),
            0,
          );
        this.#event(value);
      }
      if (!prior)
        this.db
          .prepare('INSERT INTO social_publication_commands VALUES (?,?,?)')
          .run(key, requestHash, id);
      return value;
    });
  }
  transition(
    id: any,
    expectedVersion: any,
    allowed: any,
    patch: any,
    now: any,
  ): any {
    return this.#transaction((): any => {
      const previous: any = this.get(id);
      if (!previous) socialFail('SOCIAL_OPERATION_NOT_FOUND');
      if (
        previous.version !== expectedVersion ||
        !allowed.includes(previous.state)
      )
        return { claimed: false, value: previous };
      const direct: any =
        previous.uploadStrategy === 'facebook-login-resumable/experimental';
      const next: any = patch.state ?? previous.state;
      const directTransition: any =
        direct &&
        ((previous.state === 'PROCESSING' && next === 'UNCERTAIN') ||
          (previous.state === 'UNCERTAIN' && next === 'READY'));
      if (
        Object.keys(patch).some((k: any): any => !patchFields.has(k)) ||
        (!transitions[previous.state]?.includes(next) && !directTransition) ||
        (direct && next === 'PUBLISHING')
      )
        socialFail('SOCIAL_TRANSITION_INVALID');
      if (
        patch.uploadStage !== undefined &&
        (!direct ||
          !['PENDING', 'UPLOADING', 'ACKNOWLEDGED'].includes(patch.uploadStage))
      )
        socialFail('SOCIAL_TRANSITION_INVALID');
      if (direct) {
        const stage: any = previous.uploadStage;
        const validStage: any =
          patch.uploadStage === undefined ||
          (patch.uploadStage === 'PENDING' &&
            previous.state === 'CREATING_CONTAINER' &&
            next === 'PROCESSING' &&
            stage === undefined) ||
          (patch.uploadStage === 'UPLOADING' &&
            previous.state === 'PROCESSING' &&
            next === 'PROCESSING' &&
            stage === 'PENDING') ||
          (patch.uploadStage === 'ACKNOWLEDGED' &&
            stage === 'UPLOADING' &&
            ((previous.state === 'PROCESSING' && next === 'PROCESSING') ||
              (previous.state === 'UNCERTAIN' &&
                next === 'READY' &&
                patch.providerStatus === 'FINISHED'))) ||
          (patch.uploadStage === 'ACKNOWLEDGED' &&
            stage === 'ACKNOWLEDGED' &&
            next === 'READY');
        if (
          !validStage ||
          (next === 'UNCERTAIN' &&
            previous.state === 'PROCESSING' &&
            stage !== 'UPLOADING') ||
          (next === 'READY' &&
            (patch.providerStatus !== 'FINISHED' ||
              !['UPLOADING', 'ACKNOWLEDGED'].includes(stage)))
        )
          socialFail('SOCIAL_TRANSITION_INVALID');
      }
      if (
        patch.uploadUri !== undefined &&
        (!direct ||
          previous.uploadUri ||
          typeof patch.uploadUri !== 'string' ||
          !/^https:\/\/rupload\.facebook\.com\/ig-api-upload\/v\d+\.\d+\/\d{5,64}$/.test(
            patch.uploadUri,
          ) ||
          patch.uploadUri.split('/').at(-1) !==
            (patch.containerId ?? previous.containerId))
      )
        socialFail('SOCIAL_UPLOAD_URI_INVALID');
      for (const k of ['containerId', 'mediaId'])
        if (
          patch[k] !== undefined &&
          (typeof patch[k] !== 'string' || !/^\d{5,64}$/.test(patch[k]))
        )
          socialFail('SOCIAL_RECEIPT_INVALID');
      if (
        patch.errorCode !== undefined &&
        patch.errorCode !== null &&
        !/^SOCIAL_[A-Z_]+$/.test(patch.errorCode)
      )
        socialFail('SOCIAL_TRANSITION_INVALID');
      if (
        patch.uncertainStage !== undefined &&
        patch.uncertainStage !== null &&
        !['CREATE', 'PUBLISH', ...(direct ? ['UPLOAD'] : [])].includes(
          patch.uncertainStage,
        )
      )
        socialFail('SOCIAL_TRANSITION_INVALID');
      if (
        patch.providerStatus !== undefined &&
        !['IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED'].includes(
          patch.providerStatus,
        )
      )
        socialFail('SOCIAL_TRANSITION_INVALID');
      if (
        patch.confirmationSource !== undefined &&
        !['PUBLISH_ACK', 'CONTAINER_STATUS'].includes(patch.confirmationSource)
      )
        socialFail('SOCIAL_TRANSITION_INVALID');
      if (patch.transferEvidence !== undefined) {
        const { evidenceHash, ...proof } = patch.transferEvidence ?? {};
        if (
          proof.executionMode !== this.mode ||
          proof.contentHash !== previous.mediaHash ||
          evidenceHash !== affiliateHash(proof)
        )
          socialFail('SOCIAL_HOSTED_MEDIA_UNVERIFIED');
      }
      if (
        patch.retryAfterSeconds !== undefined &&
        patch.retryAfterSeconds !== null &&
        (!Number.isSafeInteger(patch.retryAfterSeconds) ||
          patch.retryAfterSeconds < 0 ||
          patch.retryAfterSeconds > 86400)
      )
        socialFail('SOCIAL_TRANSITION_INVALID');
      if (
        patch.requiresReconciliation !== undefined &&
        typeof patch.requiresReconciliation !== 'boolean'
      )
        socialFail('SOCIAL_TRANSITION_INVALID');
      if (patch.remoteReceipt !== undefined) {
        const r = patch.remoteReceipt;
        if (
          next !== 'PUBLISHED' ||
          r?.mediaId !== previous.mediaId ||
          Object.keys(r).sort().join(',') !== 'mediaId,permalink,publishedAt' ||
          !/^https:\/\/(www\.)?instagram\.com\/(reel|p)\/[A-Za-z0-9_-]+\/$/.test(
            r.permalink,
          ) ||
          !Number.isFinite(Date.parse(r.publishedAt))
        )
          socialFail('SOCIAL_RECEIPT_INVALID');
      }
      const value: any = this.#seal({
        ...previous,
        ...patch,
        version: previous.version + 1,
        updatedAt: now,
      });
      this.db
        .prepare(
          'UPDATE social_publication_operations SET payload_json=?,version=? WHERE operation_id=? AND version=?',
        )
        .run(JSON.stringify(value), value.version, id, expectedVersion);
      this.#event(value);
      return { claimed: true, value };
    });
  }
  #seal(value: any): any {
    const { contentHash: _contentHash, ...body } = value;
    return Object.freeze({ ...body, contentHash: affiliateHash(body) });
  }
  #event(value: any): any {
    this.db
      .prepare('INSERT INTO social_publication_events VALUES (?,?,?)')
      .run(value.operationId, value.version, JSON.stringify(value));
  }
}
function sameFile(a: any, b: any): any {
  const first: any = statSync(realpathSync(a)),
    second: any = statSync(realpathSync(b));
  return first.dev === second.dev && first.ino === second.ino;
}

// Administrative provisioning only. Application constructors remain read-only with respect to schema.
export function provisionSocialContext(db: any) {
  db.exec(`CREATE TABLE IF NOT EXISTS instagram_publication_schedules (
    execution_id TEXT PRIMARY KEY REFERENCES campaign_executions(execution_id),
    request_json TEXT NOT NULL CHECK(json_valid(request_json)), scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('SCHEDULED','RUNNING','WAITING_RECONCILIATION','COMPLETED','FAILED','CANCELLED')),
    claim_token TEXT,claim_expires_at TEXT, updated_at TEXT NOT NULL,next_poll_at TEXT,result_json TEXT
  );`);
  db.exec(contextSql);
  const row = db
    .prepare('SELECT * FROM social_publication_context WHERE singleton=1')
    .get();
  if (!row) {
    if (db.prepare('SELECT 1 FROM social_publication_operations LIMIT 1').get())
      socialFail('SOCIAL_LIVE_PROVENANCE_REQUIRED');
    db.prepare('INSERT INTO social_publication_context VALUES(1,?,?)').run(
      'fake',
      randomUUID(),
    );
  }
  db.exec(provenanceSql);
  db.exec(scheduleTriggers);
  verifySocialContextProtections(db);
}
