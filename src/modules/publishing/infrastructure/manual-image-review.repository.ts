import type { DatabaseSync } from 'node:sqlite';
import {
  affiliateHash,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  effectiveImageReview,
  reviewFail,
  reviewReason,
  validateImageReview,
  validateImageReviewSnapshot,
  type ImageReviewRecord,
  type ImageReviewRevocation,
  type ImageReviewSnapshot,
} from '../domain/manual-image-review-contracts.js';
import {
  exact,
  publicText,
  timestamp,
} from '../domain/manual-distribution-contracts.js';

// No provisioning, connection opening or operational module wiring. The caller
// owns the database; this delivery uses only isolated, disposable databases.
export class ManualImageReviewRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');
    const objects = new Set(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')",
        )
        .all()
        .map((r) => String(r.name)),
    );
    const required = [
      'manual_image_review_packages_v1',
      'manual_image_review_decisions_v1',
      'manual_image_review_revocations_v1',
      'manual_image_review_commands_v1',
      'manual_image_review_revision_v1',
      'manual_image_review_binding_v1',
      'manual_image_review_latest_v1',
    ];
    for (const table of ['packages', 'decisions', 'revocations', 'commands'])
      for (const action of ['update', 'delete'])
        required.push(`manual_image_review_${table}_no_${action}_v1`);
    if (
      required.some((name) => !objects.has(name)) ||
      db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1
    )
      reviewFail('IMAGE_REVIEW_SCHEMA_REQUIRED');
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private prior(key: string, hash: string): string | null {
    const row = this.db
      .prepare(
        'SELECT * FROM manual_image_review_commands_v1 WHERE command_key=?',
      )
      .get(key);
    if (!row) return null;
    if (row.payload_hash !== hash)
      reviewFail('IMAGE_REVIEW_IDEMPOTENCY_CONFLICT');
    return String(row.decision_id);
  }
  getRecord(decisionId: string): ImageReviewRecord | null {
    const row = this.db
      .prepare(
        'SELECT d.*,p.snapshot_json,p.snapshot_hash FROM manual_image_review_decisions_v1 d JOIN manual_image_review_packages_v1 p USING(package_hash) WHERE decision_id=?',
      )
      .get(decisionId);
    if (!row) return null;
    const review = validateImageReview(JSON.parse(String(row.review_json)));
    const snapshot = validateImageReviewSnapshot(
      JSON.parse(String(row.snapshot_json)) as ImageReviewSnapshot,
    );
    if (
      affiliateHash(snapshot) !== row.snapshot_hash ||
      review.contentHash !== row.review_hash ||
      review.packageHash !== snapshot.package.packageHash ||
      review.imageArtifactId !== snapshot.package.imageArtifactId ||
      review.imageContentHash !== snapshot.package.imageContentHash ||
      review.qualityControlHash !== snapshot.qc.report.contentHash ||
      review.revoked
    )
      reviewFail('IMAGE_REVIEW_STORAGE_INVALID');
    return immutable({
      review,
      snapshot,
      revision: Number(row.revision),
      reason: reviewReason(row.reason, review.decision === 'REJECTED'),
    });
  }
  private isRevoked(decisionId: string): boolean {
    const row = this.db
      .prepare(
        'SELECT * FROM manual_image_review_revocations_v1 WHERE decision_id=?',
      )
      .get(decisionId);
    if (!row) return false;
    const event = JSON.parse(String(row.event_json)) as ImageReviewRevocation;
    const original = this.getRecord(decisionId)!;
    exact(event, [
      'schemaVersion',
      'revocationId',
      'decisionId',
      'decisionHash',
      'actor',
      'revokedAt',
      'reason',
      'contentHash',
    ]);
    publicText(event.actor, 'actor', 160);
    timestamp(event.revokedAt, 'revokedAt');
    reviewReason(event.reason, true);
    if (
      event.schemaVersion !== 'manual-image-review-revocation/1.0.0' ||
      affiliateHash(event) !== row.event_hash ||
      event.contentHash !== row.event_hash ||
      event.decisionId !== decisionId ||
      event.decisionHash !== original.review.contentHash ||
      event.revocationId !== row.revocation_id
    )
      reviewFail('IMAGE_REVIEW_STORAGE_INVALID');
    return true;
  }
  getImageApproval(packageHash: string) {
    // A single SQLite statement observes the latest revision and revocation in
    // one read snapshot, including concurrent changes by other processes.
    const row = this.db
      .prepare(
        'SELECT d.review_json, r.event_json FROM manual_image_review_decisions_v1 d LEFT JOIN manual_image_review_revocations_v1 r USING(decision_id) WHERE d.package_hash=? ORDER BY d.revision DESC LIMIT 1',
      )
      .get(packageHash);
    if (!row) return null;
    const original = validateImageReview(JSON.parse(String(row.review_json)));
    if (original.packageHash !== packageHash)
      reviewFail('IMAGE_REVIEW_STORAGE_INVALID');
    if (row.event_json !== null) {
      const event = JSON.parse(String(row.event_json)) as ImageReviewRevocation;
      if (
        event.decisionId !== original.decisionId ||
        event.decisionHash !== original.contentHash ||
        affiliateHash(event) !== event.contentHash
      )
        reviewFail('IMAGE_REVIEW_STORAGE_INVALID');
    }
    return effectiveImageReview(original, row.event_json !== null);
  }
  decide(
    key: string,
    payloadHash: string,
    snapshot: ImageReviewSnapshot,
    expectedRevision: number,
    make: () => ImageReviewRecord,
  ): ImageReviewRecord {
    return this.transaction(() => {
      const prior = this.prior(key, payloadHash);
      if (prior) return this.getRecord(prior)!;
      const normalized = validateImageReviewSnapshot(snapshot),
        hash = affiliateHash(normalized);
      const current = this.db
        .prepare(
          'SELECT coalesce(max(revision),0) AS revision FROM manual_image_review_decisions_v1 WHERE package_hash=?',
        )
        .get(normalized.package.packageHash)!;
      if (Number(current.revision) !== expectedRevision)
        reviewFail('IMAGE_REVIEW_REVISION_CONFLICT');
      const old = this.db
        .prepare(
          'SELECT snapshot_hash FROM manual_image_review_packages_v1 WHERE package_hash=?',
        )
        .get(normalized.package.packageHash);
      if (old && old.snapshot_hash !== hash)
        reviewFail('IMAGE_REVIEW_PACKAGE_CONFLICT');
      if (!old)
        this.db
          .prepare('INSERT INTO manual_image_review_packages_v1 VALUES(?,?,?)')
          .run(
            normalized.package.packageHash,
            JSON.stringify(normalized),
            hash,
          );
      const record = make(),
        review = validateImageReview(record.review);
      reviewReason(record.reason, review.decision === 'REJECTED');
      if (
        review.revoked ||
        review.packageHash !== normalized.package.packageHash ||
        record.revision !== expectedRevision + 1
      )
        reviewFail('IMAGE_REVIEW_BINDING_MISMATCH');
      this.db
        .prepare(
          'INSERT INTO manual_image_review_decisions_v1 VALUES(?,?,?,?,?,?)',
        )
        .run(
          review.decisionId,
          review.packageHash,
          record.revision,
          JSON.stringify(review),
          review.contentHash,
          record.reason,
        );
      this.db
        .prepare(
          'INSERT INTO manual_image_review_commands_v1 VALUES(?,?,?,NULL)',
        )
        .run(key, payloadHash, review.decisionId);
      return this.getRecord(review.decisionId)!;
    });
  }
  revoke(
    key: string,
    payloadHash: string,
    decisionId: string,
    decisionHash: string,
    make: () => ImageReviewRevocation,
  ): ImageReviewRecord {
    return this.transaction(() => {
      const prior = this.prior(key, payloadHash);
      if (prior) return this.getRecord(prior)!;
      const record = this.getRecord(decisionId);
      if (!record || record.review.contentHash !== decisionHash)
        reviewFail('IMAGE_REVIEW_DECISION_MISMATCH');
      if (this.isRevoked(decisionId))
        reviewFail('IMAGE_REVIEW_ALREADY_REVOKED');
      const event = make();
      publicText(event.actor, 'actor', 160);
      publicText(event.revocationId, 'revocationId', 160);
      timestamp(event.revokedAt, 'revokedAt');
      reviewReason(event.reason, true);
      if (
        event.schemaVersion !== 'manual-image-review-revocation/1.0.0' ||
        event.decisionId !== decisionId ||
        event.decisionHash !== decisionHash ||
        event.contentHash !== affiliateHash(event)
      )
        reviewFail('IMAGE_REVIEW_BINDING_MISMATCH');
      this.db
        .prepare(
          'INSERT INTO manual_image_review_revocations_v1 VALUES(?,?,?,?,?)',
        )
        .run(
          event.revocationId,
          decisionId,
          decisionHash,
          JSON.stringify(event),
          event.contentHash,
        );
      this.db
        .prepare('INSERT INTO manual_image_review_commands_v1 VALUES(?,?,?,?)')
        .run(key, payloadHash, decisionId, event.revocationId);
      return record;
    });
  }
}
