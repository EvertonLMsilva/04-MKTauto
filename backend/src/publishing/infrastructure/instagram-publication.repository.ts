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
  authorize(operation: any, now: string, expectedClaim?: string) {
    const r = this.reservation(operation.operationId);
    if (!r) socialFail('SOCIAL_RESERVATION_REQUIRED');
    if (this.revoked(String(r.review_hash)))
      socialFail('SOCIAL_APPROVAL_REVOKED');
    const e = this.db
      .prepare('SELECT * FROM campaign_executions WHERE execution_id=?')
      .get(r.execution_id!);
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
