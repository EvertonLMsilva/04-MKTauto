import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../../content-operations/domain/campaign.js';
import type { DatabaseSync } from 'node:sqlite';
import {
  exact,
  hashValue,
  publicText,
  timestamp,
} from '../domain/manual-distribution-contracts.js';
import { socialFail } from '../domain/social-publication-contracts.js';

export class InstagramPublicationRepository {
  constructor(readonly db: DatabaseSync) {}
  revoked(reviewHash: string) {
    return !!this.db
      .prepare(
        'SELECT 1 FROM instagram_approval_revocations WHERE review_hash=?',
      )
      .get(reviewHash);
  }
  revoke(raw: unknown, at: string) {
    const v = raw as Record<string, string>;
    exact(v, ['packageHash', 'reviewHash', 'actor', 'reason']);
    hashValue(v.packageHash, 'packageHash');
    hashValue(v.reviewHash, 'reviewHash');
    publicText(v.actor, 'actor', 100);
    publicText(v.reason, 'reason');
    timestamp(at, 'revokedAt');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db
        .prepare(
          'SELECT * FROM instagram_approval_revocations WHERE review_hash=?',
        )
        .get(v.reviewHash);
      if (prior) {
        if (
          prior.package_hash !== v.packageHash ||
          prior.actor !== v.actor ||
          prior.reason !== v.reason
        )
          socialFail('SOCIAL_REVOCATION_CONFLICT');
        this.db.exec('COMMIT');
        return prior;
      }
      const review = this.db
        .prepare(
          "SELECT content_hash,payload_json FROM manual_distribution_records WHERE kind='REVIEW' AND record_id=?",
        )
        .get(v.packageHash);
      if (
        review?.content_hash !== v.reviewHash ||
        JSON.parse(String(review.payload_json)).mediaDecision.decision !==
          'APPROVED'
      )
        socialFail('SOCIAL_APPROVED_REVIEW_REQUIRED');
      this.db
        .prepare(
          'INSERT INTO instagram_approval_revocations(review_hash,package_hash,actor,reason,revoked_at) VALUES(?,?,?,?,?)',
        )
        .run(v.reviewHash, v.packageHash, v.actor, v.reason, at);
      this.db.exec('COMMIT');
      return this.db
        .prepare(
          'SELECT * FROM instagram_approval_revocations WHERE review_hash=?',
        )
        .get(v.reviewHash)!;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  forExecution(id: string) {
    const row = this.db
      .prepare(
        'SELECT operation_id FROM instagram_publication_reservations WHERE execution_id=?',
      )
      .get(id);
    return row ? { operationId: String(row.operation_id) } : null;
  }
  reservation(operationId: string) {
    return this.db
      .prepare(
        'SELECT * FROM instagram_publication_reservations WHERE operation_id=?',
      )
      .get(operationId);
  }
  reserve(
    executionId: string,
    operation: any,
    pkg: any,
    reviewHash: string,
    at: string,
  ) {
    const destination = `instagram:${operation.accountId}`;
    if (!/^[1-9]\d{4,63}$/.test(operation.accountId))
      socialFail('SOCIAL_DESTINATION_INVALID');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db
        .prepare(
          'SELECT * FROM instagram_publication_reservations WHERE campaign_id=? AND artifact_hash=? AND destination=?',
        )
        .get(pkg.campaignId, operation.mediaHash, destination);
      if (prior) {
        if (
          prior.operation_id !== operation.operationId ||
          prior.execution_id !== executionId ||
          prior.review_hash !== reviewHash
        )
          socialFail('SOCIAL_PUBLICATION_IDENTITY_CONFLICT');
      } else {
        const historical = this.db
          .prepare(
            `SELECT 1 FROM social_publication_operations o
          LEFT JOIN manual_distribution_records p ON p.kind='PACKAGE' AND p.record_id=o.package_hash
          WHERE o.operation_id<>? AND o.account_id=? AND json_extract(o.payload_json,'$.mediaHash')=?
          AND (p.record_id IS NULL OR json_extract(p.payload_json,'$.campaignId')=?) LIMIT 1`,
          )
          .get(
            operation.operationId,
            operation.accountId,
            operation.mediaHash,
            pkg.campaignId,
          );
        if (historical) socialFail('SOCIAL_PUBLICATION_IDENTITY_CONFLICT');
        this.db
          .prepare(
            'INSERT INTO instagram_publication_reservations VALUES(?,?,?,?,?,?,?,?)',
          )
          .run(
            pkg.campaignId,
            operation.mediaHash,
            destination,
            executionId,
            operation.operationId,
            pkg.contentHash,
            reviewHash,
            at,
          );
      }
      this.db.exec('COMMIT');
      return this.reservation(operation.operationId)!;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  schedule(
    executionId: string,
    input: {
      packageHash: string;
      accountId: string;
      scheduledAt: string;
      actor: string;
      reviewHash: string;
    },
    now: string,
  ) {
    timestamp(input.scheduledAt, 'scheduledAt');
    hashValue(input.packageHash, 'packageHash');
    publicText(input.actor, 'actor', 100);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.scheduled(executionId);
      if (prior) {
        const request = JSON.parse(String(prior.request_json));
        if (canonicalJson(request) !== canonicalJson(input))
          socialFail('SOCIAL_SCHEDULE_CONFLICT');
        this.db.exec('COMMIT');
        return prior;
      }
      this.db
        .prepare(
          "INSERT INTO instagram_publication_schedules(execution_id,request_json,scheduled_at,status,updated_at) VALUES(?,?,?,'SCHEDULED',?)",
        )
        .run(executionId, JSON.stringify(input), input.scheduledAt, now);
      this.db.exec('COMMIT');
      return this.scheduled(executionId);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private schedulesReady() {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='instagram_publication_schedules'",
        )
        .get()
    )
      socialFail('SOCIAL_SCHEDULER_CONFIGURATION_REQUIRED');
  }
  scheduled(id: string) {
    this.schedulesReady();
    return this.db
      .prepare(
        'SELECT * FROM instagram_publication_schedules WHERE execution_id=?',
      )
      .get(id) as Record<string, any> | undefined;
  }
  scheduleContext(id: string) {
    const execution = this.db
      .prepare('SELECT * FROM campaign_executions WHERE execution_id=?')
      .get(id);
    const event = this.db
      .prepare(
        "SELECT evidence_json FROM campaign_execution_events WHERE execution_id=? AND event_type='STEP_DONE' AND json_extract(evidence_json,'$.step')='HANDOFF' ORDER BY sequence DESC LIMIT 1",
      )
      .get(id);
    if (execution?.status !== 'SUCCEEDED' || !event)
      socialFail('SOCIAL_HANDOFF_REQUIRED');
    const handoff = JSON.parse(String(event!.evidence_json)).result;
    if (!handoff?.approvalId) socialFail('SOCIAL_HANDOFF_REQUIRED');
    const initial = this.db
      .prepare(
        'SELECT evidence_json FROM campaign_execution_events WHERE execution_id=? ORDER BY sequence LIMIT 1',
      )
      .get(id);
    const request = initial ? JSON.parse(String(initial.evidence_json)) : {};
    return {
      execution,
      handoff,
      financialOperationIds:
        request.legacyRecovery?.financialOperationIds ??
        [request.generationRequestId].filter(Boolean),
    };
  }
  dueSchedules(now: string) {
    this.schedulesReady();
    return this.db
      .prepare(
        "SELECT execution_id FROM instagram_publication_schedules WHERE scheduled_at<=? AND (next_poll_at IS NULL OR next_poll_at<=?) AND (status IN ('SCHEDULED','WAITING_RECONCILIATION') OR (status='RUNNING' AND claim_expires_at<=?)) ORDER BY scheduled_at LIMIT 20",
      )
      .all(now, now, now)
      .map((r) => String(r.execution_id));
  }
  claimSchedule(id: string, now: string) {
    const token = randomUUID(),
      expires = new Date(Date.parse(now) + 120000).toISOString();
    const result = this.db
      .prepare(
        "UPDATE instagram_publication_schedules SET status='RUNNING',claim_token=?,claim_expires_at=?,updated_at=? WHERE execution_id=? AND scheduled_at<=? AND (status IN ('SCHEDULED','WAITING_RECONCILIATION') OR (status='RUNNING' AND claim_expires_at<=?))",
      )
      .run(token, expires, now, id, now, now);
    return result.changes ? this.scheduled(id) : null;
  }
  finishSchedule(
    id: string,
    token: string,
    status: string,
    result: unknown,
    now: string,
  ) {
    if (
      ![
        'SCHEDULED',
        'COMPLETED',
        'WAITING_RECONCILIATION',
        'FAILED',
        'CANCELLED',
      ].includes(status)
    )
      socialFail('SOCIAL_SCHEDULE_INVALID');
    const next = ['SCHEDULED', 'WAITING_RECONCILIATION'].includes(status)
      ? new Date(Date.parse(now) + 30000).toISOString()
      : now;
    this.db
      .prepare(
        'UPDATE instagram_publication_schedules SET status=?,result_json=?,claim_token=NULL,claim_expires_at=NULL,updated_at=?,next_poll_at=? WHERE execution_id=? AND claim_token=?',
      )
      .run(status, JSON.stringify(result), now, next, id, token);
  }
  cancelSchedule(id: string, now: string) {
    const value = this.scheduled(id);
    if (!value) socialFail('SOCIAL_SCHEDULE_NOT_FOUND');
    if (value!.status === 'CANCELLED') return value;
    if (value!.status !== 'SCHEDULED' || this.forExecution(id))
      socialFail('SOCIAL_CANCELLATION_RECONCILIATION_REQUIRED');
    this.db
      .prepare(
        "UPDATE instagram_publication_schedules SET status='CANCELLED',updated_at=? WHERE execution_id=? AND status='SCHEDULED'",
      )
      .run(now, id);
    return this.scheduled(id);
  }
  authorize(operation: any, now: string, expectedClaim?: string) {
    const r = this.reservation(operation.operationId);
    if (!r) socialFail('SOCIAL_RESERVATION_REQUIRED');
    if (this.revoked(String(r.review_hash)))
      socialFail('SOCIAL_APPROVAL_REVOKED');
    const e = this.db
      .prepare('SELECT * FROM campaign_executions WHERE execution_id=?')
      .get(r.execution_id!);
    const schedule = this.db
      .prepare(
        'SELECT * FROM instagram_publication_schedules WHERE execution_id=?',
      )
      .get(r.execution_id!) as Record<string, any> | undefined;
    if (schedule) {
      const request = JSON.parse(schedule.request_json);
      if (
        e?.status !== 'SUCCEEDED' ||
        r.campaign_id !== e.campaign_id ||
        r.artifact_hash !== operation.mediaHash ||
        r.package_hash !== operation.packageHash ||
        r.destination !== `instagram:${operation.accountId}` ||
        schedule.status !== 'RUNNING' ||
        !schedule.claim_token ||
        schedule.claim_expires_at <= now ||
        schedule.scheduled_at > now ||
        (expectedClaim !== undefined &&
          expectedClaim !== schedule.claim_token) ||
        request.packageHash !== operation.packageHash ||
        request.accountId !== operation.accountId ||
        request.reviewHash !== r.review_hash
      )
        socialFail('SOCIAL_CAMPAIGN_AUTHORIZATION_REQUIRED');
      return r;
    }
    if (
      !e ||
      (expectedClaim !== undefined && e.claim_token !== expectedClaim) ||
      e.status !== 'RUNNING' ||
      !e.claim_token ||
      String(e.claim_expires_at) <= now
    )
      socialFail('SOCIAL_CAMPAIGN_AUTHORIZATION_REQUIRED');
    if (String(e.scheduled_at) > now) socialFail('SOCIAL_SCHEDULE_REQUIRED');
    if (
      r.campaign_id !== e.campaign_id ||
      r.artifact_hash !== operation.mediaHash ||
      r.package_hash !== operation.packageHash ||
      r.destination !== `instagram:${operation.accountId}`
    )
      socialFail('SOCIAL_RESERVATION_CONFLICT');
    return r;
  }
}
