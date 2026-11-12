import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import {
  canonicalJson,
  identifier,
  instant,
} from '../content-operations/domain/campaign.js';
import type { ProjectSnapshotReader } from '../project/application/ports/project-snapshot-reader.port.js';
import { MultiPiecePlanRepository } from './multi-piece-plan.repository.js';
import {
  MultiPiecePlanError,
  planTimestamp,
  type StoredMultiPiecePlan,
} from './multi-piece-plan.contract.js';
import {
  MultiPieceQueueError,
  queuePlanHash,
  queueOccurrenceId,
  queueCommand,
  queueWorker,
  queueIdentities,
  queueHash,
  queuedEvent,
  transitionEvent,
  queueEntry,
  type QueueEvent,
  type QueueIdentity,
  type QueueEntry,
  type QueueEventKind,
  type OfflineWorkerIdentityReader,
} from './multi-piece-queue.contract.js';

const batches = 'operations_multi_piece_queue_plans_v1',
  entries = 'operations_multi_piece_queue_entries_v1',
  events = 'operations_multi_piece_queue_events_v1';
const tables = [batches, entries, events];
const schema = [
  ...tables,
  `${batches}_no_update`,
  `${batches}_no_delete`,
  `${batches}_seal`,
  `${entries}_no_delete`,
  `${entries}_insert`,
  `${entries}_update`,
  `${events}_no_update`,
  `${events}_no_delete`,
  `${events}_insert`,
  `${events}_apply`,
  'operations_multi_piece_queue_campaign_v1',
  'operations_multi_piece_queue_destination_v1',
  'operations_multi_piece_queue_claim_once_v1',
];
interface QueueOptions {
  projects?: ProjectSnapshotReader;
  workers?: OfflineWorkerIdentityReader;
  now?: () => string;
}
interface LoadedQueue {
  entries: QueueEntry[];
  history: Map<string, QueueEvent[]>;
}
function same(actual: unknown, expected: unknown) {
  if (canonicalJson(actual) !== canonicalJson(expected))
    throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_CORRUPT');
}
function eventRow(event: QueueEvent) {
  return {
    plan_hash: event.planHash,
    occurrence_id: event.occurrenceId,
    version: event.version,
    request_id: event.requestId,
    request_hash: event.requestHash,
    kind: event.kind,
    previous_state: event.previousState,
    state: event.state,
    previous_event_hash: event.previousEventHash,
    event_hash: event.eventHash,
    owner_json: canonicalJson(event.owner),
    actor_json: canonicalJson(event.actor),
    created_at: event.createdAt,
    event_json: canonicalJson(event),
  };
}
function entryRow(
  identity: QueueIdentity,
  ordinal: number,
  first: QueueEvent,
  last: QueueEvent,
) {
  return {
    plan_hash: identity.planHash,
    occurrence_id: identity.occurrenceId,
    piece_id: identity.pieceId,
    ordinal,
    destination_id: identity.destinationId,
    content_type: identity.contentType,
    project_id: identity.projectId,
    project_version: identity.projectVersion,
    campaign_id: identity.campaignId,
    campaign_revision: identity.campaignRevision,
    planned_at: identity.plannedAt,
    local_date: identity.localDate,
    local_time: identity.localTime,
    initial_state: identity.initialState,
    blockers_json: canonicalJson(identity.blockers),
    identity_hash: queueHash(identity),
    identity_json: canonicalJson(identity),
    state: last.state,
    version: last.version,
    owner_worker_id: last.owner?.workerId ?? null,
    owner_session_id: last.owner?.sessionId ?? null,
    claim_id: last.owner?.claimId ?? null,
    owner_json: canonicalJson(last.owner),
    head_event_hash: last.eventHash,
    created_at: first.createdAt,
    updated_at: last.createdAt,
  };
}
export class MultiPieceQueueRepository {
  private readonly plans: MultiPiecePlanRepository;
  constructor(
    private readonly path: string,
    private readonly options: QueueOptions = {},
  ) {
    this.plans = new MultiPiecePlanRepository(path);
  }
  private source(hash: string): StoredMultiPiecePlan {
    const source = this.plans.getPlanByHash(queuePlanHash(hash));
    if (!source)
      throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_PLAN_NOT_FOUND');
    return source;
  }
  private connection<T>(write: boolean, action: (db: DatabaseSync) => T): T {
    if (!isAbsolute(this.path))
      throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_DATABASE_REQUIRED');
    let probe: DatabaseSync;
    try {
      probe = new DatabaseSync(this.path, { readOnly: true });
    } catch (error) {
      throw new MultiPieceQueueError(
        'MULTI_PIECE_QUEUE_DATABASE_REQUIRED',
        error,
      );
    }
    probe.close();
    const db = new DatabaseSync(this.path, { readOnly: !write });
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const installed = new Set(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')",
          )
          .all()
          .map((row) => row.name),
      );
      if (
        [
          'operations_multi_piece_plans_v1',
          'operations_multi_piece_plan_pieces_v1',
          'operations_multi_piece_plan_occurrences_v1',
          'operations_multi_piece_plan_requests_v1',
        ].some((name) => !installed.has(name))
      )
        throw new MultiPiecePlanError('MULTI_PIECE_SCHEMA_NOT_PROVISIONED');
      if (schema.some((name) => !installed.has(name)))
        throw new MultiPieceQueueError(
          'MULTI_PIECE_QUEUE_SCHEMA_NOT_PROVISIONED',
        );
      db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      for (const table of tables)
        if (db.prepare(`PRAGMA foreign_key_check(${table})`).all().length)
          throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_CORRUPT');
      const result = action(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      if (
        error instanceof MultiPieceQueueError ||
        error instanceof MultiPiecePlanError
      )
        throw error;
      const busy =
        error &&
        typeof error === 'object' &&
        'errcode' in error &&
        [5, 6].includes(Number(error.errcode));
      throw new MultiPieceQueueError(
        busy
          ? 'MULTI_PIECE_QUEUE_BUSY'
          : 'MULTI_PIECE_QUEUE_PERSISTENCE_FAILED',
        error,
      );
    } finally {
      db.close();
    }
  }
  private insert(
    db: DatabaseSync,
    table: string,
    row: Record<string, SQLInputValue>,
  ) {
    const columns = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
    ).run(...Object.values(row));
  }
  private load(
    db: DatabaseSync,
    source: StoredMultiPiecePlan,
  ): LoadedQueue | null {
    const hash = source.plan.planHash,
      batch = db
        .prepare(`SELECT * FROM ${batches} WHERE plan_hash=?`)
        .get(hash);
    const rows = db
      .prepare(`SELECT * FROM ${entries} WHERE plan_hash=? ORDER BY ordinal`)
      .all(hash);
    const eventRows = db
      .prepare(
        `SELECT * FROM ${events} WHERE plan_hash=? ORDER BY occurrence_id,version`,
      )
      .all(hash);
    if (!batch) {
      if (rows.length || eventRows.length)
        throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_CORRUPT');
      return null;
    }
    try {
      const identities = queueIdentities(source),
        createdAt = planTimestamp(batch.created_at);
      same(batch, {
        plan_hash: hash,
        occurrence_count: identities.length,
        manifest_hash: queueHash(identities),
        created_at: createdAt,
      });
      if (rows.length !== identities.length) throw new Error('INCOMPLETE');
      const grouped = new Map<string, typeof eventRows>();
      for (const row of eventRows) {
        const group = grouped.get(String(row.occurrence_id)) ?? [];
        group.push(row);
        grouped.set(String(row.occurrence_id), group);
      }
      if (grouped.size !== identities.length)
        throw new Error('MISSING_HISTORY');
      const history = new Map<string, QueueEvent[]>();
      const result = identities.map((identity, ordinal) => {
        const records = grouped.get(identity.occurrenceId);
        if (!records?.length) throw new Error('MISSING_EVENT');
        const first = queuedEvent(identity, createdAt),
          expectedEvents: QueueEvent[] = [first];
        same(records[0], eventRow(first));
        for (let index = 1; index < records.length; index++) {
          const payload = JSON.parse(
            String(records[index].event_json),
          ) as QueueEvent;
          if (
            !['CLAIM', 'REVIEW_PENDING', 'MARK_UNKNOWN'].includes(
              payload.kind,
            ) ||
            !payload.actor
          )
            throw new Error('INVALID_EVENT');
          const actor = queueWorker(payload.actor);
          const expected = transitionEvent(
            identity,
            expectedEvents[index - 1],
            payload.kind as Exclude<QueueEventKind, 'ENQUEUED'>,
            queueCommand({
              planHash: hash,
              occurrenceId: identity.occurrenceId,
              requestId: payload.requestId,
              expectedVersion: index - 1,
            }),
            actor,
            planTimestamp(payload.createdAt),
          );
          same(records[index], eventRow(expected));
          expectedEvents.push(expected);
        }
        const last = expectedEvents[expectedEvents.length - 1];
        same(rows[ordinal], entryRow(identity, ordinal, first, last));
        history.set(identity.occurrenceId, expectedEvents);
        return queueEntry(identity, first, last);
      });
      return { entries: result, history };
    } catch (error) {
      throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_CORRUPT', error);
    }
  }
  async enqueuePlan(planHash: string) {
    const source = this.source(planHash);
    if (!this.options.projects?.get)
      throw new MultiPieceQueueError(
        'MULTI_PIECE_QUEUE_PROJECT_READER_REQUIRED',
      );
    const project = await this.options.projects.get(
      source.plan.projectId,
      source.plan.projectVersion,
    );
    if (
      !project ||
      project.project.id !== source.plan.projectId ||
      project.project.version !== source.plan.projectVersion
    )
      throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_PROJECT_NOT_RESOLVED');
    return this.connection(true, (db) => {
      const verified = this.source(planHash),
        prior = this.load(db, verified);
      if (prior) return prior.entries;
      const identities = queueIdentities(verified),
        createdAt = instant(this.options.now?.() ?? new Date().toISOString());
      identities.forEach((identity, ordinal) => {
        const event = queuedEvent(identity, createdAt);
        this.insert(db, entries, entryRow(identity, ordinal, event, event));
        this.insert(db, events, eventRow(event));
      });
      this.insert(db, batches, {
        plan_hash: planHash,
        occurrence_count: identities.length,
        manifest_hash: queueHash(identities),
        created_at: createdAt,
      });
      return this.load(db, verified)!.entries;
    });
  }
  private async transition(
    raw: unknown,
    principal: unknown,
    kind: Exclude<QueueEventKind, 'ENQUEUED'>,
  ) {
    const command = queueCommand(raw);
    if (!this.options.workers?.assertActive)
      throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_WORKER_REQUIRED');
    const actor = queueWorker(
      await this.options.workers.assertActive(principal),
    );
    return this.connection(true, (db) => {
      const loaded = this.load(db, this.source(command.planHash));
      const entry = loaded?.entries.find(
        (e) => e.identity.occurrenceId === command.occurrenceId,
      );
      if (!entry)
        throw new MultiPieceQueueError(
          'MULTI_PIECE_QUEUE_OCCURRENCE_NOT_FOUND',
        );
      const requestHash = queueHash({ kind, command, actor });
      const prior = db
        .prepare(
          `SELECT request_hash,plan_hash,occurrence_id FROM ${events} WHERE request_id=?`,
        )
        .get(command.requestId);
      if (prior) {
        if (
          prior.request_hash !== requestHash ||
          prior.plan_hash !== command.planHash ||
          prior.occurrence_id !== command.occurrenceId
        )
          throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_REQUEST_CONFLICT');
        return entry;
      }
      const history = loaded!.history.get(command.occurrenceId)!;
      const event = transitionEvent(
        entry.identity,
        history[history.length - 1],
        kind,
        command,
        actor,
        instant(this.options.now?.() ?? new Date().toISOString()),
      );
      this.insert(db, events, eventRow(event));
      return this.load(db, this.source(command.planHash))!.entries.find(
        (e) => e.identity.occurrenceId === command.occurrenceId,
      )!;
    });
  }
  claimForOfflineReview(command: unknown, principal: unknown) {
    return this.transition(command, principal, 'CLAIM');
  }
  markClaimUnknown(command: unknown, principal: unknown) {
    return this.transition(command, principal, 'MARK_UNKNOWN');
  }
  markReviewPending(command: unknown, principal: unknown) {
    return this.transition(command, principal, 'REVIEW_PENDING');
  }
  listByPlan(planHash: string) {
    queuePlanHash(planHash);
    return this.connection(
      false,
      (db) => this.load(db, this.source(planHash))?.entries ?? [],
    );
  }
  getOccurrence(planHash: string, occurrenceId: string) {
    queueOccurrenceId(occurrenceId);
    return (
      this.listByPlan(planHash).find(
        (e) => e.identity.occurrenceId === occurrenceId,
      ) ?? null
    );
  }
  getHistory(planHash: string, occurrenceId: string) {
    queuePlanHash(planHash);
    queueOccurrenceId(occurrenceId);
    return this.connection(
      false,
      (db) =>
        this.load(db, this.source(planHash))?.history.get(occurrenceId) ?? [],
    );
  }
  private matching(predicate: (entry: QueueEntry) => boolean) {
    return this.connection(false, (db) =>
      db
        .prepare(`SELECT plan_hash FROM ${batches} ORDER BY plan_hash`)
        .all()
        .flatMap((row) =>
          this.load(db, this.source(String(row.plan_hash)))!.entries.filter(
            predicate,
          ),
        )
        .sort(
          (a, b) =>
            (a.identity.plannedAt ?? '').localeCompare(
              b.identity.plannedAt ?? '',
            ) ||
            a.identity.occurrenceId.localeCompare(b.identity.occurrenceId) ||
            a.identity.planHash.localeCompare(b.identity.planHash),
        ),
    );
  }
  listByCampaign(campaignId: string, campaignRevision: number) {
    identifier(campaignId);
    if (!Number.isSafeInteger(campaignRevision) || campaignRevision < 1)
      throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_INPUT_INVALID');
    return this.matching(
      (e) =>
        e.identity.campaignId === campaignId &&
        e.identity.campaignRevision === campaignRevision,
    );
  }
  // Pending preparation excludes claimed/uncertain/blocked responsibility; none of
  // these queries dispatch work. REVIEW_PENDING is administrative, not approved.
  listPendingByDestination(destinationId: string) {
    identifier(destinationId);
    return this.matching(
      (e) =>
        e.identity.destinationId === destinationId &&
        ['PLANNED', 'REVIEW_PENDING'].includes(e.state),
    );
  }
}
