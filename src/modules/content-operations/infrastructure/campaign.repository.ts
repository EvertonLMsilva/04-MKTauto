import type { OperationsSql } from './sqlite-operations.repository.js';
import { randomUUID } from 'node:crypto';
import { dailySchedule } from '../domain/campaign-schedule.js';
import type {
  CampaignOperationsStore,
  CampaignOperationalEvent,
  NotificationBaseline,
  NotificationAttempt,
  NotificationReference,
  NotificationReceipt,
} from '../application/campaign-operations.port.js';
type CatalogResolver = (
  previousProduct: string | null,
) => Record<string, unknown>;
import type { DatabaseSync } from 'node:sqlite';
import {
  CampaignError,
  identifier,
  instant,
  productionDate,
  canonicalJson,
} from '../domain/campaign.js';
export interface CampaignRecurrence {
  schemaVersion: 'campaign-recurrence/1.0.0';
  revision: number;
  enabled: boolean;
  commandId: string;
  request: Record<string, unknown>;
}
function requestDay(request: Record<string, unknown>): string {
  return productionDate(
    String(request.scheduledAt),
    request.schedule ? dailySchedule(request.schedule).timeZone : undefined,
  );
}
import type {
  CampaignExecution,
  CampaignEvent,
  CampaignStatus,
  ScheduleIdentity,
} from '../domain/campaign.js';
export class CampaignRepository implements CampaignOperationsStore {
  operationalExecutions(id?: string): CampaignExecution[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return (yield this.sql
          .prepare(
            `SELECT * FROM campaign_executions${id ? ' WHERE execution_id=?' : ''} ORDER BY production_date,execution_id`,
          )
          .all(...(id ? [id] : []))) as unknown as CampaignExecution[];
      }.call(this),
    );
  }
  operationalHistory(id: string): CampaignOperationalEvent[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.get(id);
        return (yield this.sql
          .prepare(
            'SELECT rowid AS cursor,* FROM campaign_execution_events WHERE execution_id=? ORDER BY sequence',
          )
          .all(id)).map((row: any) => ({
          ...row,
          evidence: JSON.parse(String(row.evidence_json)),
        })) as unknown as CampaignOperationalEvent[];
      }.call(this),
    );
  }
  checkpoint(): number {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return Number(
          (yield this.sql
            .prepare(
              'SELECT COALESCE(MAX(rowid),0) n FROM campaign_execution_events',
            )
            .get())?.n,
        );
      }.call(this),
    );
  }
  hasNotificationAttempt(key: string): boolean {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return !!(yield this.sql
          .prepare(
            "SELECT 1 FROM campaign_execution_events WHERE event_type='OPERATIONAL_NOTIFICATION_ATTEMPTED' AND json_extract(evidence_json,'$.key')=?",
          )
          .get(key));
      }.call(this),
    );
  }
  private notificationEvent(
    id: string,
    type: string,
    evidence: unknown,
    now: string,
  ) {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const e = yield this.get(id);
        yield this.event(id, type, e.status, e.status, now, evidence);
      }.call(this),
    );
  }
  notificationBaseline(
    destinationId: string,
    initial: () => NotificationBaseline,
    now = new Date().toISOString(),
  ): NotificationBaseline {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const prior = yield this.sql
                .prepare(
                  "SELECT evidence_json FROM campaign_execution_events WHERE event_type='OPERATIONAL_NOTIFICATION_BASELINE' AND json_extract(evidence_json,'$.destinationId')=? ORDER BY rowid LIMIT 1",
                )
                .get(destinationId);
              if (prior)
                return JSON.parse(String(prior.evidence_json)).baseline;
              const baseline = yield initial();
              const anchor = yield this.sql
                .prepare(
                  'SELECT execution_id FROM campaign_executions ORDER BY created_at,execution_id LIMIT 1',
                )
                .get();
              if (anchor)
                yield this.notificationEvent(
                  String(anchor.execution_id),
                  'OPERATIONAL_NOTIFICATION_BASELINE',
                  { destinationId, baseline },
                  now,
                );
              return baseline;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  claimNotification(
    intent: NotificationAttempt,
    eligible: () => boolean,
    now: string,
  ): boolean {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              if (yield this.hasNotificationAttempt(intent.key)) return false;
              // All BC readers use the same database. BEGIN IMMEDIATE excludes competing
              // writers while the synchronous policy revalidates facts through their ports.
              const current = yield eligible();
              if (typeof current !== 'boolean')
                throw new Error('SYNCHRONOUS_NOTIFICATION_VALIDATION_REQUIRED');
              if (!current) return false;
              yield this.notificationEvent(
                intent.executionId,
                'OPERATIONAL_NOTIFICATION_ATTEMPTED',
                {
                  key: intent.key,
                  kind: intent.kind,
                  sourceIdentity: intent.sourceIdentity,
                  destinationId: intent.destinationId,
                  status: 'ATTEMPTED',
                  messageHash: intent.messageHash,
                },
                now,
              );
              return true;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  finishNotification(
    intent: NotificationReference,
    result: NotificationReceipt,
    now: string,
  ) {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              if (
                yield this.sql
                  .prepare(
                    "SELECT 1 FROM campaign_execution_events WHERE event_type IN ('OPERATIONAL_NOTIFICATION_DELIVERED','OPERATIONAL_NOTIFICATION_FAILED','OPERATIONAL_NOTIFICATION_UNCERTAIN') AND json_extract(evidence_json,'$.key')=?",
                  )
                  .get(intent.key)
              )
                return;
              yield this.notificationEvent(
                intent.executionId,
                `OPERATIONAL_NOTIFICATION_${result.status}`,
                {
                  key: intent.key,
                  kind: intent.kind,
                  destinationId: intent.destinationId,
                  ...result,
                },
                now,
              );
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  recoverNotifications(destinationId: string, now: string) {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const attempted = yield this.sql
                .prepare(
                  "SELECT execution_id,occurred_at,evidence_json FROM campaign_execution_events WHERE event_type='OPERATIONAL_NOTIFICATION_ATTEMPTED' AND json_extract(evidence_json,'$.destinationId')=?",
                )
                .all(destinationId);
              for (const row of attempted) {
                const value = JSON.parse(String(row.evidence_json));
                if (
                  Date.parse(now) - Date.parse(String(row.occurred_at)) <
                  30000
                )
                  continue;
                const finished = yield this.sql
                  .prepare(
                    "SELECT 1 FROM campaign_execution_events WHERE event_type IN ('OPERATIONAL_NOTIFICATION_DELIVERED','OPERATIONAL_NOTIFICATION_FAILED','OPERATIONAL_NOTIFICATION_UNCERTAIN') AND json_extract(evidence_json,'$.key')=?",
                  )
                  .get(value.key);
                if (!finished)
                  yield this.notificationEvent(
                    String(row.execution_id),
                    'OPERATIONAL_NOTIFICATION_UNCERTAIN',
                    {
                      key: value.key,
                      kind: value.kind,
                      destinationId,
                      status: 'UNCERTAIN',
                      errorCode: 'NOTIFICATION_PROCESS_INTERRUPTED',
                    },
                    now,
                  );
              }
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  readonly sql: OperationsSql;
  private readonly native?: DatabaseSync;
  private readonly session?: {
    sql: OperationsSql;
    transaction<T>(work: () => T): any;
  };
  get db(): DatabaseSync {
    if (!this.native) throw new CampaignError('NATIVE_SQLITE_UNAVAILABLE');
    return this.native;
  }
  constructor(
    db:
      | DatabaseSync
      | {
          sql: OperationsSql;
          transaction<T>(work: () => T): any;
        },
  ) {
    if ('sql' in db) {
      this.session = db;
      this.sql = db.sql;
    } else {
      this.native = db;
      this.sql = db;
      db.exec('PRAGMA busy_timeout=5000');
    }
  }
  private tx<T>(action: () => T): T {
    if (this.session) return this.session.transaction(action);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw e;
    }
  }
  get(id: string): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const row = yield this.sql
          .prepare('SELECT * FROM campaign_executions WHERE execution_id=?')
          .get(identifier(id));
        if (!row) throw new CampaignError('EXECUTION_NOT_FOUND');
        return row as unknown as CampaignExecution;
      }.call(this),
    );
  }
  history(id: string): CampaignEvent[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.get(id);
        return (yield this.sql
          .prepare(
            'SELECT * FROM campaign_execution_events WHERE execution_id=? ORDER BY sequence',
          )
          .all(id)).map(
          (r: any) =>
            ({
              ...r,
              evidence: JSON.parse(String(r.evidence_json)),
            }) as unknown as CampaignEvent,
        );
      }.call(this),
    );
  }
  listRecent(): CampaignExecution[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return (yield this.sql
          .prepare(
            'SELECT * FROM campaign_executions ORDER BY updated_at DESC,execution_id LIMIT 100',
          )
          .all()) as unknown as CampaignExecution[];
      }.call(this),
    );
  }
  presentOperatorReview(
    id: string,
    version: number,
    actor: string,
    snapshot: Record<string, unknown>,
    now: string,
  ): string {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const e = yield this.get(id);
              if (e.version !== version || e.status !== 'WAITING_INPUT')
                throw new CampaignError('STALE_REVIEW_CONFLICT');
              const reviewId = randomUUID();
              yield this.event(
                id,
                'OPERATOR_REVIEW_PRESENTED',
                e.status,
                e.status,
                now,
                {
                  schemaVersion: 'operator-review/1.0.0',
                  reviewId,
                  actor,
                  version,
                  snapshot,
                },
              );
              return reviewId;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  private event(
    id: string,
    type: string,
    prior: CampaignStatus | null,
    next: CampaignStatus,
    at: string,
    evidence: unknown,
  ) {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        yield this.sql
          .prepare(
            'INSERT INTO campaign_execution_events VALUES(?,(SELECT COALESCE(MAX(sequence),0)+1 FROM campaign_execution_events WHERE execution_id=?),?,?,?,?,?)',
          )
          .run(id, id, type, prior, next, at, JSON.stringify(evidence));
      }.call(this),
    );
  }
  schedule(
    input: ScheduleIdentity,
    request: unknown,
    now: string,
  ): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              return yield this.persistSchedule(input, request, now);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  scheduleCatalog(
    request: Record<string, unknown>,
    now: string,
    catalog: CatalogResolver,
  ): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              return yield this.persistCatalogSchedule(request, now, catalog);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  private persistCatalogSchedule(
    request: Record<string, unknown>,
    now: string,
    catalog: CatalogResolver,
  ): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const campaignId = String(request.campaignId),
          day = requestDay(request);
        const existing = yield this.sql
          .prepare(
            'SELECT execution_id FROM campaign_executions WHERE campaign_id=? AND production_date=?',
          )
          .get(campaignId, day);
        if (existing) {
          const execution = yield this.get(String(existing.execution_id));
          const seed = (yield this.history(execution.execution_id))[0].evidence;
          if (
            seed.selectionMode !== 'CATALOG' ||
            execution.campaign_revision !== request.campaignRevision ||
            execution.scheduled_at !== request.scheduledAt ||
            canonicalJson(
              (seed.run as Record<string, unknown>)?.projectVersion,
            ) !==
              canonicalJson(
                (request.run as Record<string, unknown>)?.projectVersion,
              )
          )
            throw new CampaignError('CAMPAIGN_DAY_CONFLICT');
          return execution;
        }
        const prior = yield this.sql
          .prepare(
            `SELECT h.evidence_json FROM campaign_execution_events h
      JOIN campaign_executions e ON e.execution_id=h.execution_id
      WHERE e.campaign_id=? AND e.production_date<? AND h.event_type='PRODUCT_SELECTED'
      ORDER BY e.production_date DESC LIMIT 1`,
          )
          .get(campaignId, day);
        const previous = prior
          ? (JSON.parse(String(prior.evidence_json)) as {
              productId: string;
            })
          : null;
        const latest = yield this.sql
          .prepare(
            `SELECT h.evidence_json FROM campaign_execution_events h
      JOIN campaign_executions e ON e.execution_id=h.execution_id
      WHERE e.campaign_id=? AND e.production_date<? AND h.event_type='SCHEDULED'
      ORDER BY e.production_date DESC LIMIT 1`,
          )
          .get(campaignId, day);
        const lastRequest = latest
          ? (JSON.parse(String(latest.evidence_json)) as {
              selectionMode?: string;
              briefingId?: string;
            })
          : null;
        const fixedBrief =
          lastRequest?.selectionMode !== 'CATALOG' && lastRequest?.briefingId
            ? yield this.sql
                .prepare(
                  'SELECT content_json FROM affiliate_briefings WHERE briefing_id=?',
                )
                .get(lastRequest.briefingId)
            : null;
        const previousProduct = fixedBrief
          ? (
              JSON.parse(String(fixedBrief.content_json)) as {
                productId: string;
              }
            ).productId
          : (previous?.productId ?? null);
        // BEGIN IMMEDIATE protects the catalog snapshot, cursor and campaign/day reservation together.
        const frozen = yield catalog(previousProduct);
        const execution = yield this.persistSchedule(
          {
            campaignId,
            campaignRevision: Number(request.campaignRevision),
            runId: String(request.runId),
            scheduledAt: String(request.scheduledAt),
          },
          frozen,
          now,
        );
        if (frozen.catalogSelection)
          yield this.event(
            execution.execution_id,
            'PRODUCT_SELECTED',
            execution.status,
            execution.status,
            now,
            frozen.catalogSelection,
          );
        return execution;
      }.call(this),
    );
  }
  private persistSchedule(
    input: ScheduleIdentity,
    request: unknown,
    now: string,
  ): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        identifier(input.campaignId);
        identifier(input.runId);
        if (
          !Number.isSafeInteger(input.campaignRevision) ||
          input.campaignRevision < 1
        )
          throw new CampaignError('INVALID_CAMPAIGN_REVISION');
        const at = instant(input.scheduledAt),
          day = requestDay({
            ...(request as Record<string, unknown>),
            scheduledAt: at,
          });
        now = instant(now);
        const prior = yield this.sql
          .prepare(
            'SELECT execution_id FROM campaign_executions WHERE campaign_id=? AND production_date=?',
          )
          .get(input.campaignId, day);
        if (prior) {
          const e = yield this.get(String(prior.execution_id));
          if (
            e.campaign_revision !== input.campaignRevision ||
            e.run_id !== input.runId ||
            e.scheduled_at !== at ||
            canonicalJson((yield this.history(e.execution_id))[0].evidence) !==
              canonicalJson(request)
          )
            throw new CampaignError('CAMPAIGN_DAY_CONFLICT');
          return e;
        }
        if (
          yield this.sql
            .prepare('SELECT 1 FROM campaign_executions WHERE run_id=?')
            .get(input.runId)
        )
          throw new CampaignError('CAMPAIGN_RUN_CONFLICT');
        const id = randomUUID();
        yield this.sql
          .prepare(
            "INSERT INTO campaign_executions VALUES(?,?,?,?,?,?,'SCHEDULED',1,NULL,NULL,?,?)",
          )
          .run(
            id,
            input.campaignId,
            input.campaignRevision,
            day,
            at,
            input.runId,
            now,
            now,
          );
        yield this.event(
          id,
          (request as Record<string, unknown>).legacyRecovery
            ? 'LEGACY_RECOVERY'
            : 'SCHEDULED',
          null,
          'SCHEDULED',
          now,
          request,
        );
        return yield this.get(id);
      }.call(this),
    );
  }
  private recurrenceEvents(campaignId?: string): {
    executionId: string;
    config: CampaignRecurrence;
  }[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return (yield this.sql
          .prepare(
            `SELECT h.execution_id,h.evidence_json,e.campaign_id FROM campaign_execution_events h
      JOIN campaign_executions e ON e.execution_id=h.execution_id
      WHERE h.event_type='CAMPAIGN_RECURRENCE_CONFIGURED' AND (? IS NULL OR e.campaign_id=?)`,
          )
          .all(campaignId ?? null, campaignId ?? null)).map((row: any) => {
          const config = JSON.parse(
            String(row.evidence_json),
          ) as CampaignRecurrence;
          if (
            config.schemaVersion !== 'campaign-recurrence/1.0.0' ||
            !Number.isSafeInteger(config.revision) ||
            config.revision < 1 ||
            typeof config.enabled !== 'boolean' ||
            typeof config.commandId !== 'string' ||
            !config.request ||
            config.request.campaignId !== row.campaign_id
          )
            throw new CampaignError('INVALID_CAMPAIGN_RECURRENCE_HISTORY');
          return { executionId: String(row.execution_id), config };
        });
      }.call(this),
    );
  }
  recurrences(includeDisabled = false): {
    executionId: string;
    config: CampaignRecurrence;
  }[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const latest = new Map<
          string,
          ReturnType<CampaignRepository['recurrenceEvents']>[number]
        >();
        for (const event of yield this.recurrenceEvents()) {
          const id = (yield this.get(event.executionId)).campaign_id;
          if (
            !latest.has(id) ||
            latest.get(id)!.config.revision < event.config.revision
          )
            latest.set(id, event);
        }
        return [...latest.values()].filter(
          (e: any) => includeDisabled || e.config.enabled,
        );
      }.call(this),
    );
  }
  configureRecurrence(
    request: Record<string, unknown>,
    enabled: boolean,
    commandId: string,
    now: string,
    catalog?: CatalogResolver,
  ): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        identifier(commandId);
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const campaignId = String(request.campaignId);
              const events = yield this.recurrenceEvents(campaignId);
              const replay = events.find(
                (e: any) => e.config.commandId === commandId,
              );
              if (replay) {
                if (
                  replay.config.enabled !== enabled ||
                  canonicalJson(replay.config.request) !==
                    canonicalJson(request)
                )
                  throw new CampaignError('CAMPAIGN_RECURRENCE_CONFLICT');
                return yield this.get(replay.executionId);
              }
              const prior = yield this.sql
                .prepare(
                  'SELECT execution_id FROM campaign_executions WHERE campaign_id=? AND production_date=?',
                )
                .get(campaignId, requestDay(request));
              const execution = prior
                ? yield this.get(String(prior.execution_id))
                : request.selectionMode === 'CATALOG' && catalog
                  ? yield this.persistCatalogSchedule(request, now, catalog)
                  : yield this.persistSchedule(
                      {
                        campaignId,
                        campaignRevision: Number(request.campaignRevision),
                        runId: String(request.runId),
                        scheduledAt: String(request.scheduledAt),
                      },
                      request,
                      now,
                    );
              // Configuration commands may reuse today's master, but never rewrite it.
              const seed = (yield this.history(execution.execution_id))[0]
                .evidence;
              if (
                execution.campaign_revision !== request.campaignRevision ||
                execution.scheduled_at !== request.scheduledAt ||
                (seed.selectionMode ?? 'FIXED') !==
                  (request.selectionMode ?? 'FIXED') ||
                (request.selectionMode !== 'CATALOG' &&
                  canonicalJson(seed.localImage) !==
                    canonicalJson(request.localImage)) ||
                canonicalJson(
                  seed.run &&
                    (seed.run as Record<string, unknown>).projectVersion,
                ) !==
                  canonicalJson(
                    (request.run as Record<string, unknown>).projectVersion,
                  )
              )
                throw new CampaignError('CAMPAIGN_DAY_CONFLICT');
              const config: CampaignRecurrence = {
                schemaVersion: 'campaign-recurrence/1.0.0',
                revision:
                  Math.max(0, ...events.map((e: any) => e.config.revision)) + 1,
                commandId,
                enabled,
                request,
              };
              yield this.event(
                execution.execution_id,
                'CAMPAIGN_RECURRENCE_CONFIGURED',
                execution.status,
                execution.status,
                instant(now),
                config,
              );
              return execution;
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  scheduleRecurring(
    config: CampaignRecurrence,
    request: Record<string, unknown>,
    now: string,
    catalog?: CatalogResolver,
  ): CampaignExecution | null {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const current = yield (yield this.recurrences()).find(
                (e: any) =>
                  e.config.request.campaignId === config.request.campaignId,
              );
              if (!current || current.config.revision !== config.revision)
                return null;
              const campaignId = String(request.campaignId),
                day = requestDay(request);
              const existing = yield this.sql
                .prepare(
                  'SELECT execution_id FROM campaign_executions WHERE campaign_id=? AND production_date=?',
                )
                .get(campaignId, day);
              if (existing)
                return yield this.get(String(existing.execution_id));
              if (request.selectionMode === 'CATALOG' && catalog)
                return yield this.persistCatalogSchedule(request, now, catalog);
              return yield this.persistSchedule(
                {
                  campaignId,
                  campaignRevision: Number(request.campaignRevision),
                  runId: String(request.runId),
                  scheduledAt: String(request.scheduledAt),
                },
                request,
                now,
              );
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  due(now: string, id?: string): CampaignExecution[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return (yield this.sql
          .prepare(
            "SELECT * FROM campaign_executions WHERE status='SCHEDULED' AND scheduled_at<=? AND (? IS NULL OR execution_id=?) ORDER BY scheduled_at LIMIT 20",
          )
          .all(
            instant(now),
            id ?? null,
            id ?? null,
          )) as unknown as CampaignExecution[];
      }.call(this),
    );
  }
  pendingFinalization(): CampaignExecution[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return (yield this.sql
          .prepare(
            `SELECT * FROM campaign_executions
       WHERE status IN ('WAITING_INPUT','WAITING_RECONCILIATION')
       ORDER BY updated_at,execution_id`,
          )
          .all()) as unknown as CampaignExecution[];
      }.call(this),
    );
  }
  pendingPublicationPolls(now: string): CampaignExecution[] {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        // Only resume the explicit, persisted read-only processing wait. Unknown effects,
        // missing approvals, revocations and auth/rate-limit errors never enter this path.
        return (yield this.sql
          .prepare(
            `SELECT e.* FROM campaign_executions e
      JOIN campaign_execution_events h ON h.execution_id=e.execution_id
      WHERE e.status='WAITING_INPUT' AND h.sequence=(SELECT MAX(sequence) FROM campaign_execution_events WHERE execution_id=e.execution_id)
      AND h.event_type='PAUSED' AND json_extract(h.evidence_json,'$.code')='SOCIAL_PROCESSING_REQUIRED'
      AND json_extract(h.evidence_json,'$.step')='PUBLICATION' AND h.occurred_at<=?
      AND (SELECT COUNT(*) FROM campaign_execution_events a WHERE a.execution_id=e.execution_id AND a.event_type='STEP_STARTED' AND json_extract(a.evidence_json,'$.step')='PUBLICATION')<5
      LIMIT 20`,
          )
          .all(
            new Date(Date.parse(instant(now)) - 60000).toISOString(),
          )) as unknown as CampaignExecution[];
      }.call(this),
    );
  }
  claim(id: string, now: string, ttl: number): CampaignExecution | null {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        now = instant(now);
        if (!Number.isSafeInteger(ttl) || ttl < 1000)
          throw new CampaignError('INVALID_CLAIM_TTL');
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const e = yield this.get(id);
              if (e.status !== 'SCHEDULED' || e.scheduled_at > now) return null;
              const token = randomUUID();
              yield this.sql
                .prepare(
                  "UPDATE campaign_executions SET status='RUNNING',version=version+1,claim_token=?,claim_expires_at=?,updated_at=? WHERE execution_id=? AND version=?",
                )
                .run(
                  token,
                  new Date(Date.parse(now) + ttl).toISOString(),
                  now,
                  id,
                  e.version,
                );
              yield this.event(id, 'CLAIMED', e.status, 'RUNNING', now, {
                token,
                version: e.version + 1,
              });
              return yield this.get(id);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  private owned(id: string, token: string, now: string): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        const e = yield this.get(id);
        if (
          e.status !== 'RUNNING' ||
          e.claim_token !== token ||
          !e.claim_expires_at ||
          e.claim_expires_at <= now
        )
          throw new CampaignError('CLAIM_LOST');
        return e;
      }.call(this),
    );
  }
  heartbeat(id: string, token: string, now: string, ttl: number): void {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              yield this.owned(id, token, instant(now));
              yield this.sql
                .prepare(
                  'UPDATE campaign_executions SET claim_expires_at=?,updated_at=? WHERE execution_id=?',
                )
                .run(new Date(Date.parse(now) + ttl).toISOString(), now, id);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  ownedEvent(
    id: string,
    token: string,
    now: string,
    type: string,
    evidence: Record<string, unknown>,
    next?: CampaignStatus,
  ): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const e = yield this.owned(id, token, instant(now));
              yield this.event(
                id,
                type,
                e.status,
                next ?? e.status,
                now,
                evidence,
              );
              if (next)
                yield this.sql
                  .prepare(
                    'UPDATE campaign_executions SET status=?,version=version+1,claim_token=NULL,claim_expires_at=NULL,updated_at=? WHERE execution_id=?',
                  )
                  .run(next, now, id);
              return yield this.get(id);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  recover(now: string, id?: string): void {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        now = instant(now);
        yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const expired = yield this.sql
                .prepare(
                  "SELECT execution_id FROM campaign_executions WHERE status='RUNNING' AND claim_expires_at<=? AND (? IS NULL OR execution_id=?)",
                )
                .all(now, id ?? null, id ?? null);
              for (const row of expired) {
                const id = String(row.execution_id);
                yield this.sql
                  .prepare(
                    "UPDATE campaign_executions SET status='WAITING_RECONCILIATION',version=version+1,claim_token=NULL,claim_expires_at=NULL,updated_at=? WHERE execution_id=?",
                  )
                  .run(now, id);
                yield this.event(
                  id,
                  'CLAIM_EXPIRED',
                  'RUNNING',
                  'WAITING_RECONCILIATION',
                  now,
                  { code: 'INTERRUPTED_EFFECT_REQUIRES_VERIFICATION' },
                );
              }
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  cancel(id: string, now: string): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const e = yield this.get(id);
              if (e.status === 'CANCELLED') return e;
              if (e.status === 'SUCCEEDED')
                throw new CampaignError('EXECUTION_TERMINAL');
              yield this.sql
                .prepare(
                  "UPDATE campaign_executions SET status='CANCELLED',version=version+1,claim_token=NULL,claim_expires_at=NULL,updated_at=? WHERE execution_id=?",
                )
                .run(instant(now), id);
              yield this.event(id, 'CANCELLED', e.status, 'CANCELLED', now, {
                inFlightEffectMayComplete:
                  e.status === 'RUNNING' ||
                  e.status === 'WAITING_RECONCILIATION',
              });
              return yield this.get(id);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  resume(
    id: string,
    now: string,
    expectedVersion: number,
    verified: Record<string, unknown> | null = null,
  ): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const e = yield this.get(id);
              if (e.version !== expectedVersion)
                throw new CampaignError('EXECUTION_VERSION_CONFLICT');
              if (
                !['WAITING_INPUT', 'WAITING_RECONCILIATION', 'FAILED'].includes(
                  e.status,
                )
              )
                throw new CampaignError('EXECUTION_NOT_RECOVERABLE');
              if (e.status === 'WAITING_RECONCILIATION' && !verified)
                throw new CampaignError('RECONCILIATION_REQUIRED');
              if (verified?.step && verified.result)
                yield this.event(
                  id,
                  'STEP_DONE',
                  e.status,
                  e.status,
                  now,
                  verified,
                );
              yield this.sql
                .prepare(
                  "UPDATE campaign_executions SET status='SCHEDULED',version=version+1,updated_at=? WHERE execution_id=?",
                )
                .run(instant(now), id);
              yield this.event(
                id,
                'RESUMED',
                e.status,
                'SCHEDULED',
                now,
                verified ?? {},
              );
              return yield this.get(id);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  reviseComposition(
    id: string,
    version: number,
    now: string,
    evidence: Record<string, unknown>,
  ): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const e = yield this.get(id);
              if (
                e.version !== version ||
                !['WAITING_INPUT', 'CANCELLED', 'SUCCEEDED'].includes(e.status)
              )
                throw new CampaignError('EXECUTION_VERSION_CONFLICT');
              for (const table of [
                'instagram_publication_schedules',
                'instagram_publication_reservations',
              ])
                if (
                  (yield this.sql
                    .prepare(
                      "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                    )
                    .get(table)) &&
                  (yield this.sql
                    .prepare(
                      `SELECT 1 FROM ${table} WHERE execution_id=? LIMIT 1`,
                    )
                    .get(id))
                )
                  throw new CampaignError(
                    'COMPOSITION_REVISION_PUBLICATION_CONFLICT',
                  );
              yield this.event(
                id,
                'COMPOSITION_REVISED',
                e.status,
                'WAITING_INPUT',
                instant(now),
                evidence,
              );
              yield this.sql
                .prepare(
                  "UPDATE campaign_executions SET status='WAITING_INPUT',version=version+1,updated_at=? WHERE execution_id=?",
                )
                .run(now, id);
              return yield this.get(id);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
  administrativeEvent(
    id: string,
    version: number,
    now: string,
    type: string,
    evidence: Record<string, unknown>,
  ): CampaignExecution {
    return runCampaignIo(
      function* (this: any): Generator<unknown, any, any> {
        return yield this.tx(() =>
          runCampaignIo(
            function* (this: any): Generator<unknown, any, any> {
              const e = yield this.get(id);
              if (e.version !== version || e.status !== 'WAITING_INPUT')
                throw new CampaignError('EXECUTION_VERSION_CONFLICT');
              yield this.event(
                id,
                type,
                e.status,
                e.status,
                instant(now),
                evidence,
              );
              yield this.sql
                .prepare(
                  'UPDATE campaign_executions SET version=version+1,updated_at=? WHERE execution_id=?',
                )
                .run(now, id);
              return yield this.get(id);
            }.call(this),
          ),
        );
      }.call(this),
    );
  }
}
export type Io<A extends boolean, T> = A extends true ? Promise<T> : T;
/** Execute the shared Campaign algorithm synchronously for SQLite or await each PG I/O. */
export function runCampaignIo(steps: Generator<unknown, any, any>): any {
  function resume(method: 'next' | 'throw', input?: unknown): any {
    for (;;) {
      const step = method === 'next' ? steps.next(input) : steps.throw(input);
      if (step.done) return step.value;
      if (step.value instanceof Promise)
        return step.value.then(
          (value) => resume('next', value),
          (error) => resume('throw', error),
        );
      method = 'next';
      input = step.value;
    }
  }
  return resume('next');
}
export function iterateCampaignIo(
  items: any[],
  operation: (...args: any[]) => Generator<unknown, any, any>,
  mode: 'map' | 'forEach' | 'some',
): any {
  return runCampaignIo(
    (function* (): Generator<unknown, any, any> {
      const result = [];
      for (let index = 0; index < items.length; index++) {
        const value = yield runCampaignIo(operation(items[index], index));
        if (mode === 'some' && value) return true;
        result.push(value);
      }
      return mode === 'some' ? false : mode === 'forEach' ? undefined : result;
    })(),
  );
}
