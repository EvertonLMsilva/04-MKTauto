import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  CampaignError,
  identifier,
  instant,
  productionDate,
  canonicalJson,
} from '../domain/campaign.js';
import type {
  CampaignExecution,
  CampaignEvent,
  CampaignStatus,
  ScheduleIdentity,
} from '../domain/campaign.js';

export class CampaignRepository {
  constructor(readonly db: DatabaseSync) {
    db.exec('PRAGMA busy_timeout=5000');
  }
  private tx<T>(action: () => T): T {
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
    const row = this.db
      .prepare('SELECT * FROM campaign_executions WHERE execution_id=?')
      .get(identifier(id));
    if (!row) throw new CampaignError('EXECUTION_NOT_FOUND');
    return row as unknown as CampaignExecution;
  }
  history(id: string): CampaignEvent[] {
    this.get(id);
    return this.db
      .prepare(
        'SELECT * FROM campaign_execution_events WHERE execution_id=? ORDER BY sequence',
      )
      .all(id)
      .map(
        (r) =>
          ({
            ...r,
            evidence: JSON.parse(String(r.evidence_json)),
          }) as unknown as CampaignEvent,
      );
  }
  listRecent(): CampaignExecution[] {
    return this.db
      .prepare(
        'SELECT * FROM campaign_executions ORDER BY updated_at DESC,execution_id LIMIT 100',
      )
      .all() as unknown as CampaignExecution[];
  }
  private event(
    id: string,
    type: string,
    prior: CampaignStatus | null,
    next: CampaignStatus,
    at: string,
    evidence: unknown,
  ) {
    this.db
      .prepare(
        'INSERT INTO campaign_execution_events VALUES(?,(SELECT COALESCE(MAX(sequence),0)+1 FROM campaign_execution_events WHERE execution_id=?),?,?,?,?,?)',
      )
      .run(id, id, type, prior, next, at, JSON.stringify(evidence));
  }
  schedule(input: ScheduleIdentity, request: unknown, now: string) {
    identifier(input.campaignId);
    identifier(input.runId);
    if (
      !Number.isSafeInteger(input.campaignRevision) ||
      input.campaignRevision < 1
    )
      throw new CampaignError('INVALID_CAMPAIGN_REVISION');
    const at = instant(input.scheduledAt),
      day = productionDate(at);
    now = instant(now);
    return this.tx(() => {
      const prior = this.db
        .prepare(
          'SELECT execution_id FROM campaign_executions WHERE campaign_id=? AND production_date=?',
        )
        .get(input.campaignId, day);
      if (prior) {
        const e = this.get(String(prior.execution_id));
        if (
          e.campaign_revision !== input.campaignRevision ||
          e.run_id !== input.runId ||
          e.scheduled_at !== at ||
          canonicalJson(this.history(e.execution_id)[0].evidence) !==
            canonicalJson(request)
        )
          throw new CampaignError('CAMPAIGN_DAY_CONFLICT');
        return e;
      }
      if (
        this.db
          .prepare('SELECT 1 FROM campaign_executions WHERE run_id=?')
          .get(input.runId)
      )
        throw new CampaignError('CAMPAIGN_RUN_CONFLICT');
      const id = randomUUID();
      this.db
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
      this.event(
        id,
        (request as Record<string, unknown>).legacyRecovery
          ? 'LEGACY_RECOVERY'
          : 'SCHEDULED',
        null,
        'SCHEDULED',
        now,
        request,
      );
      return this.get(id);
    });
  }
  due(now: string, id?: string) {
    return this.db
      .prepare(
        "SELECT * FROM campaign_executions WHERE status='SCHEDULED' AND scheduled_at<=? AND (? IS NULL OR execution_id=?) ORDER BY scheduled_at LIMIT 20",
      )
      .all(
        instant(now),
        id ?? null,
        id ?? null,
      ) as unknown as CampaignExecution[];
  }
  pendingFinalization() {
    return this.db
      .prepare(
        `SELECT * FROM campaign_executions
       WHERE status IN ('WAITING_INPUT','WAITING_RECONCILIATION')
       ORDER BY updated_at,execution_id`,
      )
      .all() as unknown as CampaignExecution[];
  }
  pendingPublicationPolls(now: string) {
    // Only resume the explicit, persisted read-only processing wait. Unknown effects,
    // missing approvals, revocations and auth/rate-limit errors never enter this path.
    return this.db
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
        new Date(Date.parse(instant(now)) - 60_000).toISOString(),
      ) as unknown as CampaignExecution[];
  }
  claim(id: string, now: string, ttl: number) {
    now = instant(now);
    if (!Number.isSafeInteger(ttl) || ttl < 1000)
      throw new CampaignError('INVALID_CLAIM_TTL');
    return this.tx(() => {
      const e = this.get(id);
      if (e.status !== 'SCHEDULED' || e.scheduled_at > now) return null;
      const token = randomUUID();
      this.db
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
      this.event(id, 'CLAIMED', e.status, 'RUNNING', now, {
        token,
        version: e.version + 1,
      });
      return this.get(id);
    });
  }
  private owned(id: string, token: string, now: string) {
    const e = this.get(id);
    if (
      e.status !== 'RUNNING' ||
      e.claim_token !== token ||
      !e.claim_expires_at ||
      e.claim_expires_at <= now
    )
      throw new CampaignError('CLAIM_LOST');
    return e;
  }
  heartbeat(id: string, token: string, now: string, ttl: number) {
    return this.tx(() => {
      this.owned(id, token, instant(now));
      this.db
        .prepare(
          'UPDATE campaign_executions SET claim_expires_at=?,updated_at=? WHERE execution_id=?',
        )
        .run(new Date(Date.parse(now) + ttl).toISOString(), now, id);
    });
  }
  ownedEvent(
    id: string,
    token: string,
    now: string,
    type: string,
    evidence: Record<string, unknown>,
    next?: CampaignStatus,
  ) {
    return this.tx(() => {
      const e = this.owned(id, token, instant(now));
      this.event(id, type, e.status, next ?? e.status, now, evidence);
      if (next)
        this.db
          .prepare(
            'UPDATE campaign_executions SET status=?,version=version+1,claim_token=NULL,claim_expires_at=NULL,updated_at=? WHERE execution_id=?',
          )
          .run(next, now, id);
      return this.get(id);
    });
  }
  recover(now: string, id?: string) {
    now = instant(now);
    this.tx(() => {
      const expired = this.db
        .prepare(
          "SELECT execution_id FROM campaign_executions WHERE status='RUNNING' AND claim_expires_at<=? AND (? IS NULL OR execution_id=?)",
        )
        .all(now, id ?? null, id ?? null);
      for (const row of expired) {
        const id = String(row.execution_id);
        this.db
          .prepare(
            "UPDATE campaign_executions SET status='WAITING_RECONCILIATION',version=version+1,claim_token=NULL,claim_expires_at=NULL,updated_at=? WHERE execution_id=?",
          )
          .run(now, id);
        this.event(
          id,
          'CLAIM_EXPIRED',
          'RUNNING',
          'WAITING_RECONCILIATION',
          now,
          { code: 'INTERRUPTED_EFFECT_REQUIRES_VERIFICATION' },
        );
      }
    });
  }
  cancel(id: string, now: string) {
    return this.tx(() => {
      const e = this.get(id);
      if (e.status === 'CANCELLED') return e;
      if (e.status === 'SUCCEEDED')
        throw new CampaignError('EXECUTION_TERMINAL');
      this.db
        .prepare(
          "UPDATE campaign_executions SET status='CANCELLED',version=version+1,claim_token=NULL,claim_expires_at=NULL,updated_at=? WHERE execution_id=?",
        )
        .run(instant(now), id);
      this.event(id, 'CANCELLED', e.status, 'CANCELLED', now, {
        inFlightEffectMayComplete:
          e.status === 'RUNNING' || e.status === 'WAITING_RECONCILIATION',
      });
      return this.get(id);
    });
  }
  resume(
    id: string,
    now: string,
    expectedVersion: number,
    verified: Record<string, unknown> | null = null,
  ) {
    return this.tx(() => {
      const e = this.get(id);
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
        this.event(id, 'STEP_DONE', e.status, e.status, now, verified);
      this.db
        .prepare(
          "UPDATE campaign_executions SET status='SCHEDULED',version=version+1,updated_at=? WHERE execution_id=?",
        )
        .run(instant(now), id);
      this.event(id, 'RESUMED', e.status, 'SCHEDULED', now, verified ?? {});
      return this.get(id);
    });
  }
  reviseComposition(
    id: string,
    version: number,
    now: string,
    evidence: Record<string, unknown>,
  ) {
    return this.tx(() => {
      const e = this.get(id);
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
          this.db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table) &&
          this.db
            .prepare(`SELECT 1 FROM ${table} WHERE execution_id=? LIMIT 1`)
            .get(id)
        )
          throw new CampaignError('COMPOSITION_REVISION_PUBLICATION_CONFLICT');
      this.event(
        id,
        'COMPOSITION_REVISED',
        e.status,
        'WAITING_INPUT',
        instant(now),
        evidence,
      );
      this.db
        .prepare(
          "UPDATE campaign_executions SET status='WAITING_INPUT',version=version+1,updated_at=? WHERE execution_id=?",
        )
        .run(now, id);
      return this.get(id);
    });
  }
  administrativeEvent(
    id: string,
    version: number,
    now: string,
    type: string,
    evidence: Record<string, unknown>,
  ) {
    return this.tx(() => {
      const e = this.get(id);
      if (e.version !== version || e.status !== 'WAITING_INPUT')
        throw new CampaignError('EXECUTION_VERSION_CONFLICT');
      this.event(id, type, e.status, e.status, instant(now), evidence);
      this.db
        .prepare(
          'UPDATE campaign_executions SET version=version+1,updated_at=? WHERE execution_id=?',
        )
        .run(now, id);
      return this.get(id);
    });
  }
}
