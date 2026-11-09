import {
  validateSupersessionRequest,
  assertSupersessionEligible,
  assertSupersessionObservation,
  assertSuccessorAuthorization,
} from '../domain/facebook-supersession.js';
import type {
  FacebookSupersessionRequest,
  FacebookSuccessorAuthorization,
  FacebookLineageEvidence,
} from '../domain/facebook-supersession.js';
import { DestinationReservationsRepository } from './destination-reservations.repository.js';
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
  'sessionEvidence',
  'executionAuthorization',
  'uploadAudit',
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
  assertNotSuperseded(id: string) {
    if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 44)
      return;
    if (
      this.db
        .prepare(
          'SELECT 1 FROM publication_supersessions WHERE predecessor_id=?',
        )
        .get(id)
    )
      socialFail('SOCIAL_OPERATION_SUPERSEDED');
  }
  lineage(id: string) {
    if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 44)
      return null;
    return this.db
      .prepare(
        'SELECT root_operation_id,predecessor_id,supersession_revision FROM social_publication_operations WHERE operation_id=?',
      )
      .get(id);
  }
  assertSessionNotInAncestors(id: string, videoId: string) {
    if (!(this.lineage(id)?.supersession_revision > 0)) return;
    const ancestors = this.resolveSupersessionLineage(id).slice(0, -1);
    if (ancestors.some(({ operation }) => operation.containerId === videoId))
      socialFail('SOCIAL_SESSION_ID_CONFLICT');
  }
  resolveSupersessionLineage(id: string) {
    const nodes: { operation: any; history: any[]; row: any }[] = [];
    const seen = new Set<string>();
    let cursor: string | null = id;
    while (cursor !== null) {
      if (seen.has(cursor)) socialFail('SOCIAL_PERSISTED_INTEGRITY');
      seen.add(cursor);
      const operation = this.get(cursor);
      const row: any = this.db
        .prepare(
          'SELECT root_operation_id,predecessor_id,supersession_revision,supersession_id FROM social_publication_operations WHERE operation_id=?',
        )
        .get(cursor);
      if (
        !operation ||
        !row ||
        !Number.isSafeInteger(row.supersession_revision) ||
        row.supersession_revision < 0
      )
        socialFail('SOCIAL_PERSISTED_INTEGRITY');
      const history = this.history(cursor);
      if (
        history.length !== operation.version + 1 ||
        history.some((e, i) => e.version !== i) ||
        history.at(-1)?.contentHash !== operation.contentHash
      )
        socialFail('SOCIAL_PERSISTED_INTEGRITY');
      nodes.unshift({ operation, history, row });
      cursor = row.predecessor_id;
    }
    const root = nodes[0].operation;
    if (
      root.operationId !== `social_publication:${root.requestHash}` ||
      root.network !== 'FACEBOOK_REELS'
    )
      socialFail('SOCIAL_PERSISTED_INTEGRITY');
    const owner = this.db
      .prepare(
        'SELECT * FROM publication_active_ownership WHERE reservation_operation_id=?',
      )
      .get(root.operationId);
    if (
      !owner ||
      owner.active_operation_id !== id ||
      owner.revision !== nodes.length - 1 ||
      owner.network !== root.network ||
      'facebook_reels:' + owner.account_id !== root.accountId ||
      owner.artifact_hash !== root.mediaHash
    )
      socialFail('SOCIAL_RESERVATION_CONFLICT');
    const videoIds = new Set<string>();
    for (const [revision, node] of nodes.entries()) {
      const { operation: op, row } = node;
      if (op.containerId) {
        if (videoIds.has(op.containerId))
          socialFail('SOCIAL_SESSION_ID_CONFLICT');
        videoIds.add(op.containerId);
      }
      if (
        row.supersession_revision !== revision ||
        [
          'packageHash',
          'accountId',
          'requestHash',
          'mediaHash',
          'caption',
          'network',
          'publicationFlowVersion',
          'uploadStrategy',
        ].some((k) => op[k] !== root[k])
      )
        socialFail('SOCIAL_PERSISTED_INTEGRITY');
      const children = this.db
        .prepare(
          'SELECT operation_id FROM social_publication_operations WHERE predecessor_id=?',
        )
        .all(op.operationId);
      const ledgerChildren = this.db
        .prepare(
          'SELECT successor_id FROM publication_supersessions WHERE predecessor_id=?',
        )
        .all(op.operationId);
      const next = nodes[revision + 1]?.operation.operationId;
      if (
        children.length !== (next ? 1 : 0) ||
        ledgerChildren.length !== children.length ||
        (next &&
          (children[0].operation_id !== next ||
            ledgerChildren[0].successor_id !== next))
      )
        socialFail('SOCIAL_PERSISTED_INTEGRITY');
      if (revision === 0) {
        if (
          row.root_operation_id !== null ||
          row.predecessor_id !== null ||
          row.supersession_id !== null ||
          op.supersession
        )
          socialFail('SOCIAL_PERSISTED_INTEGRITY');
        continue;
      }
      const prior = nodes[revision - 1];
      const s = op.supersession;
      const record = this.db
        .prepare('SELECT * FROM publication_supersessions WHERE successor_id=?')
        .get(op.operationId);
      if (
        !s ||
        !record ||
        op.operationId !==
          `${root.operationId}:supersession:${revision}:${root.requestHash}` ||
        row.root_operation_id !== root.operationId ||
        row.predecessor_id !== prior.operation.operationId ||
        row.supersession_id !== op.operationId ||
        s.rootOperationId !== root.operationId ||
        s.predecessorId !== prior.operation.operationId ||
        s.predecessorVideoId !== prior.operation.containerId ||
        s.revision !== revision ||
        s.executionAuthorizationRequired !== true ||
        record.root_operation_id !== root.operationId ||
        record.predecessor_id !== prior.operation.operationId ||
        record.revision !== revision ||
        record.reason !== s.reason ||
        record.authorization_id !== s.decisionId ||
        record.superseded_at !== s.preparedAt
      )
        socialFail('SOCIAL_PERSISTED_INTEGRITY');
      const decision = validateSupersessionRequest({
        originalOperationId: s.predecessorId,
        revision,
        decisionId: s.decisionId,
        actor: s.actor,
        reason: s.reason,
        remoteObservation: s.remoteObservation,
        acceptResidualRisk: s.acceptResidualRisk,
        expectedVersion: prior.operation.version,
      });
      if (affiliateHash(decision) !== s.decisionHash)
        socialFail('SOCIAL_PERSISTED_INTEGRITY');
      assertSupersessionObservation(
        s.remoteObservation,
        prior.operation,
        prior.history,
        s.preparedAt,
      );
    }
    return nodes;
  }
  validateSupersessionLineage(
    id: string,
    evidence: FacebookLineageEvidence | undefined,
    now: string,
    includeCurrent = false,
  ) {
    const nodes = this.resolveSupersessionLineage(id);
    const ancestors = includeCurrent ? nodes : nodes.slice(0, -1);
    if (!Array.isArray(evidence) || evidence.length !== ancestors.length)
      socialFail('SOCIAL_SUPERSESSION_OBSERVATION_INVALID');
    for (const [index, { operation, history }] of ancestors.entries()) {
      const captured = evidence![index];
      if (
        !captured ||
        captured.operationId !== operation.operationId ||
        captured.version !== operation.version ||
        captured.contentHash !== operation.contentHash
      )
        socialFail('SOCIAL_PERSISTED_INTEGRITY');
      assertSupersessionEligible(operation, history, captured.version);
      assertSupersessionObservation(
        captured.observation,
        operation,
        history,
        now,
      );
    }
  }
  supersessionReplay(raw: FacebookSupersessionRequest) {
    const command = validateSupersessionRequest(raw);
    if (
      Number(this.db.prepare('PRAGMA user_version').get()?.user_version) !== 44
    )
      socialFail('SOCIAL_SCHEMA_44_REQUIRED');
    const key = `facebook_supersession:${command.originalOperationId}:${command.revision}`;
    publicText(key, 'idempotencyKey', 200);
    const prior = this.db
      .prepare(
        'SELECT request_hash,operation_id FROM social_publication_commands WHERE idempotency_key=?',
      )
      .get(key);
    if (!prior) return null;
    if (prior.request_hash !== affiliateHash(command))
      socialFail('SOCIAL_SUPERSESSION_CONFLICT');
    const saved = this.get(prior.operation_id);
    if (!saved || saved.supersession?.decisionHash !== prior.request_hash)
      socialFail('SOCIAL_PERSISTED_INTEGRITY');
    return saved;
  }
  prepareSupersession(
    raw: FacebookSupersessionRequest,
    now: string | (() => string),
    revalidate: () => void,
    evidence?: FacebookLineageEvidence,
  ) {
    const command = validateSupersessionRequest(raw);
    return this.#transaction(() => {
      const at = typeof now === 'function' ? now() : now;
      const replay = this.supersessionReplay(command);
      if (replay) return replay;
      const op = this.get(command.originalOperationId);
      if (!op) socialFail('SOCIAL_OPERATION_NOT_FOUND');
      this.assertNotSuperseded(op.operationId);
      const history = this.history(op.operationId);
      assertSupersessionEligible(op, history, command.expectedVersion);
      this.validateSupersessionLineage(op.operationId, evidence, at, true);
      assertSupersessionObservation(command.remoteObservation, op, history, at);
      const lineage = this.lineage(op.operationId),
        rootId = lineage.root_operation_id ?? op.operationId;
      if (command.revision !== lineage.supersession_revision + 1)
        socialFail('SOCIAL_SUPERSESSION_CONFLICT');
      const owner = this.db
        .prepare(
          'SELECT * FROM publication_active_ownership WHERE active_operation_id=?',
        )
        .get(op.operationId);
      if (
        !owner ||
        owner.reservation_operation_id !== rootId ||
        owner.revision !== lineage.supersession_revision
      )
        socialFail('SOCIAL_RESERVATION_CONFLICT');
      if (typeof revalidate !== 'function' || revalidate() !== undefined)
        socialFail('SOCIAL_SUPERSESSION_INELIGIBLE');
      new DestinationReservationsRepository(this.db).authorize(op, at);
      const root = this.get(rootId),
        id = `${rootId}:supersession:${command.revision}:${root.requestHash}`;
      publicText(id, 'operationId', 200);
      const decisionHash = affiliateHash(command);
      const value = this.#seal({
        packageHash: op.packageHash,
        accountId: op.accountId,
        requestHash: root.requestHash,
        network: op.network,
        mediaHash: op.mediaHash,
        caption: op.caption,
        publicationFlowVersion: op.publicationFlowVersion,
        uploadStrategy: op.uploadStrategy,
        executionMode: this.mode,
        databaseId: this.databaseId,
        state: 'PREPARED',
        version: 0,
        operationId: id,
        containerId: null,
        mediaId: null,
        uncertainStage: null,
        errorCode: null,
        providerStatus: null,
        confirmationSource: null,
        transferEvidence: null,
        updatedAt: at,
        supersession: {
          rootOperationId: rootId,
          predecessorId: op.operationId,
          predecessorVideoId: op.containerId,
          revision: command.revision,
          decisionId: command.decisionId,
          actor: command.actor,
          reason: command.reason,
          acceptResidualRisk: true,
          remoteObservation: command.remoteObservation,
          decisionHash,
          preparedAt: at,
          executionAuthorizationRequired: true,
        },
      });
      this.db
        .prepare(
          'INSERT INTO social_publication_operations(operation_id,package_hash,account_id,request_hash,payload_json,version,supersession_revision,root_operation_id,predecessor_id,supersession_id) VALUES(?,?,?,?,?,0,?,?,?,?)',
        )
        .run(
          id,
          value.packageHash,
          value.accountId,
          value.requestHash,
          JSON.stringify(value),
          command.revision,
          rootId,
          op.operationId,
          id,
        );
      this.db
        .prepare('INSERT INTO publication_supersessions VALUES(?,?,?,?,?,?,?)')
        .run(
          id,
          rootId,
          op.operationId,
          command.revision,
          command.reason,
          command.decisionId,
          at,
        );
      this.#event(value);
      this.db
        .prepare('INSERT INTO social_publication_commands VALUES(?,?,?)')
        .run(
          `facebook_supersession:${op.operationId}:${command.revision}`,
          decisionHash,
          id,
        );
      return value;
    });
  }
  authorizePublication(
    operation: any,
    at: string,
    grant?: FacebookSuccessorAuthorization,
  ) {
    this.assertNotSuperseded(operation.operationId);
    if (this.lineage(operation.operationId)?.supersession_revision > 0) {
      this.resolveSupersessionLineage(operation.operationId);
      const record = this.db
        .prepare('SELECT * FROM publication_supersessions WHERE successor_id=?')
        .get(operation.operationId);
      if (!record) socialFail('SOCIAL_PERSISTED_INTEGRITY');
      assertSuccessorAuthorization(operation, record, grant, at);
    }
    if (
      Number(this.db.prepare('PRAGMA user_version').get()?.user_version) >= 42
    )
      (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) >= 43
        ? new DestinationReservationsRepository(this.db)
        : new InstagramPublicationRepository(this.db)
      ).authorize(operation, at);
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
            'INSERT INTO social_publication_operations(operation_id,package_hash,account_id,request_hash,payload_json,version) VALUES (?,?,?,?,?,?)',
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
    grant?: FacebookSuccessorAuthorization,
    evidence?: FacebookLineageEvidence,
  ): any {
    return this.#transaction((): any => {
      const at = typeof now === 'function' ? now() : now;
      const previous: any = this.get(id);
      if (!previous) socialFail('SOCIAL_OPERATION_NOT_FOUND');
      if (
        previous.version !== expectedVersion ||
        !allowed.includes(previous.state)
      )
        return { claimed: false, value: previous };
      if (
        ['CREATING_CONTAINER', 'PUBLISHING'].includes(patch.state) ||
        patch.uploadStage === 'UPLOADING' ||
        patch.uploadAudit?.at(-1)?.kind === 'ATTEMPT_STARTED'
      ) {
        this.authorizePublication(previous, at, grant);
        if (this.lineage(id)?.supersession_revision > 0) {
          this.validateSupersessionLineage(id, evidence, at);
          patch = { ...patch, executionAuthorization: grant };
        }
      }
      const direct: any = [
        'facebook-login-resumable/experimental',
        'facebook-reels-local/1',
      ].includes(previous.uploadStrategy);
      const next: any = patch.state ?? previous.state;
      const sessionRecovery =
        previous.network === 'FACEBOOK_REELS' &&
        previous.state === 'UNCERTAIN' &&
        previous.uncertainStage === 'CREATE' &&
        !previous.containerId &&
        !previous.uploadUri &&
        previous.uploadStage === undefined &&
        next === 'PROCESSING' &&
        patch.uploadStage === 'PENDING' &&
        patch.sessionEvidence?.source === 'DOCUMENTED_RECOVERY' &&
        patch.sessionEvidence.originalUrlRecovered === false &&
        patch.sessionEvidence.videoId === patch.containerId &&
        patch.sessionEvidence.pageId ===
          previous.accountId.replace(/^facebook_reels:/, '');
      if (patch.containerId !== undefined)
        this.assertSessionNotInAncestors(id, patch.containerId);
      if (sessionRecovery) {
        this.assertNotSuperseded(id);
        new DestinationReservationsRepository(this.db).authorize(previous, at);
      }
      const directTransition: any =
        direct &&
        ((previous.state === 'PROCESSING' && next === 'UNCERTAIN') ||
          (previous.state === 'UNCERTAIN' && next === 'READY') ||
          sessionRecovery);
      if (
        Object.keys(patch).some((k: any): any => !patchFields.has(k)) ||
        (!transitions[previous.state]?.includes(next) && !directTransition) ||
        (direct &&
          next === 'PUBLISHING' &&
          (previous.publicationFlowVersion !== 2 ||
            previous.state !== 'READY' ||
            previous.uploadStage !== 'ACKNOWLEDGED' ||
            previous.providerStatus !== 'FINISHED' ||
            !previous.uploadUri ||
            previous.uncertainStage ||
            previous.requiresReconciliation ||
            previous.transferEvidence?.operationId !== previous.operationId ||
            previous.transferEvidence?.containerId !== previous.containerId ||
            previous.transferEvidence?.contentHash !== previous.mediaHash))
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
          sessionRecovery ||
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
          !(
            previous.network === 'FACEBOOK_REELS'
              ? /^https:\/\/rupload\.facebook\.com\/video-upload\/v\d+\.0\/\d{5,64}$/
              : /^https:\/\/rupload\.facebook\.com\/ig-api-upload\/(?:v\d+\.\d+\/)?\d{5,64}$/
          ).test(patch.uploadUri) ||
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
        previous.network === 'FACEBOOK_REELS' &&
        previous.containerId &&
        patch.containerId !== undefined &&
        patch.containerId !== previous.containerId
      )
        socialFail('SOCIAL_SESSION_ID_CONFLICT');
      if (
        previous.sessionEvidence &&
        patch.sessionEvidence &&
        affiliateHash(previous.sessionEvidence) !==
          affiliateHash(patch.sessionEvidence)
      )
        socialFail('SOCIAL_SESSION_EVIDENCE_IMMUTABLE');
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
      if (patch.uploadAudit !== undefined) {
        const old = previous.uploadAudit ?? [],
          audit = patch.uploadAudit;
        if (
          previous.network !== 'FACEBOOK_REELS' ||
          !Array.isArray(audit) ||
          audit.length !== old.length + 1 ||
          affiliateHash(audit.slice(0, -1)) !== affiliateHash(old)
        )
          socialFail('SOCIAL_AUDIT_INVALID');
        const e = audit.at(-1),
          prior = old.at(-1);
        const keys = [
          'requestType',
          'kind',
          'at',
          'method',
          'destination',
          'payloadSize',
          'httpStatus',
          'error',
          'attemptId',
          'operationId',
          'videoId',
        ];
        if (
          !e ||
          Object.keys(e).some((k) => !keys.includes(k)) ||
          e.operationId !== previous.operationId ||
          e.videoId !== previous.containerId ||
          !/^[a-f0-9-]{36}$/.test(e.attemptId) ||
          !Number.isFinite(Date.parse(e.at)) ||
          e.method !== 'POST' ||
          e.requestType !== 'UPLOAD' ||
          e.destination !== previous.uploadUri ||
          !Number.isSafeInteger(e.payloadSize) ||
          e.payloadSize < 1 ||
          (e.kind === 'HTTP_RESPONSE' && !Number.isInteger(e.httpStatus)) ||
          (e.httpStatus !== undefined &&
            (!Number.isInteger(e.httpStatus) ||
              e.httpStatus < 100 ||
              e.httpStatus > 599)) ||
          (e.error !== undefined &&
            ![
              'TIMEOUT',
              'NETWORK',
              'INVALID_RESPONSE',
              'HTTP_REJECTED',
              'UNCONFIRMED',
            ].includes(e.error)) ||
          ![
            'ATTEMPT_STARTED',
            'HTTP_RESPONSE',
            'RESPONSE_UNKNOWN',
            'OBSERVED_FAILURE',
            'TRANSFER_CONFIRMED',
          ].includes(e.kind) ||
          (e.kind === 'ATTEMPT_STARTED'
            ? old.length !== 0
            : !prior ||
              prior.attemptId !== e.attemptId ||
              e.payloadSize !== prior.payloadSize ||
              Date.parse(e.at) < Date.parse(prior.at) ||
              Date.parse(e.at) < Date.parse(old[0].at) ||
              !(prior.kind === 'ATTEMPT_STARTED'
                ? ['HTTP_RESPONSE', 'RESPONSE_UNKNOWN'].includes(e.kind)
                : prior.kind === 'HTTP_RESPONSE' &&
                  [
                    'RESPONSE_UNKNOWN',
                    'OBSERVED_FAILURE',
                    'TRANSFER_CONFIRMED',
                  ].includes(e.kind))) ||
          (e.kind === 'TRANSFER_CONFIRMED' &&
            (prior?.kind !== 'HTTP_RESPONSE' ||
              !Number.isInteger(prior.httpStatus) ||
              prior.httpStatus < 200 ||
              prior.httpStatus > 299)) ||
          previous.uploadStage !== 'UPLOADING'
        )
          socialFail('SOCIAL_AUDIT_INVALID');
      }
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
          !(previous.network === 'FACEBOOK_REELS'
            ? r.permalink === null ||
              /^https:\/\/www\.facebook\.com\/reel\/\d+\/?$/.test(r.permalink)
            : /^https:\/\/(www\.)?instagram\.com\/(reel|p)\/[A-Za-z0-9_-]+\/$/.test(
                r.permalink,
              )) ||
          !Number.isFinite(Date.parse(r.publishedAt))
        )
          socialFail('SOCIAL_RECEIPT_INVALID');
      }
      const value: any = this.#seal({
        ...previous,
        ...patch,
        version: previous.version + 1,
        updatedAt: at,
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
