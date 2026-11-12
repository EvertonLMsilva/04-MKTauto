import { InstagramPublicationRepository } from './instagram-publication.repository.js';
import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import { AffiliateRepositoryError } from '../../affiliate/domain/affiliate.errors.js';
import {
  distributionFail,
  hashValue,
} from '../domain/manual-distribution-contracts.js';
import type { AffiliateRepository } from '../../affiliate/application/ports/affiliate-repository.port.js';
import type { AffiliateRunContext } from '../../affiliate/application/ports/affiliate-run-context.port.js';
import type { DatabaseSync } from 'node:sqlite';
import {
  MANUAL_RECONCILIATION_VERSION,
  reconciliationFail,
  reconciliationId,
  validateReconciliationEvent,
  externalPostKey,
  type ReconciliationInput,
  type ReconciliationEvent,
} from '../domain/manual-publication-reconciliation.contracts.js';
export class ManualDistributionRepository {
  readonly db: DatabaseSync;
  readonly catalog: Pick<AffiliateRepository, 'getCampaign' | 'getProduct'> &
    Pick<AffiliateRunContext, 'resolveRunBriefing'>;
  constructor(
    base: { db: DatabaseSync },
    catalog: ManualDistributionRepository['catalog'],
  ) {
    this.db = base.db;
    this.catalog = catalog;
  }
  revokeApproval(value: unknown, at: string) {
    return new InstagramPublicationRepository(this.db).revoke(value, at);
  }
  isApprovalRevoked(hash: string) {
    return new InstagramPublicationRepository(this.db).revoked(hash);
  }
  private reconciliationSchema(required = false) {
    const exists = !!this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='manual_publication_reconciliations_v1'",
      )
      .get();
    const ledger = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE name='schema_lineage_extensions_v1'",
      )
      .get();
    const registered = ledger
      ? this.db
          .prepare(
            "SELECT name FROM schema_lineage_extensions_v1 WHERE lineage='manual-publication-reconciliation' AND version=1",
          )
          .get()
      : null;
    if (
      (required || exists || registered) &&
      (!exists || registered?.name !== 'manual_publication_reconciliation_v1')
    )
      reconciliationFail('SCHEMA_REQUIRED');
    return exists;
  }
  assertExternalAvailable(v: {
    publicationId: string;
    platform: string;
    externalId: string | null;
    externalUrl: string | null;
  }) {
    let key: string | null = null;
    if (v.externalUrl) {
      try {
        key = externalPostKey(v.platform, v.externalUrl);
      } catch {
        /* Legacy formats still use their existing gates. */
      }
    }
    for (const other of this.list('PUBLICATION')) {
      if (
        other.publicationId === v.publicationId ||
        other.platform !== v.platform
      )
        continue;
      let otherKey: string | null = null;
      if (other.externalUrl) {
        try {
          otherKey = externalPostKey(other.platform, other.externalUrl);
        } catch {
          /* No redirect resolution. */
        }
      }
      if (
        (v.externalId && v.externalId === other.externalId) ||
        (key && key === otherKey)
      )
        reconciliationFail('EVIDENCE_CONFLICT');
    }
    if (this.reconciliationSchema()) {
      const other = this.db
        .prepare(
          'SELECT publication_id FROM manual_publication_reconciliations_v1 WHERE publication_id!=? AND ((platform=? AND external_id=?) OR external_url_key=?)',
        )
        .get(v.publicationId, v.platform, v.externalId, key);
      if (other) reconciliationFail('EVIDENCE_CONFLICT');
    }
  }
  reconciliations(publicationId: string): ReconciliationEvent[] {
    const original = this.get('PUBLICATION', publicationId);
    if (!original) distributionFail('DISTRIBUTION_PUBLICATION_NOT_FOUND');
    if (!this.reconciliationSchema()) return [];
    return this.db
      .prepare(
        'SELECT * FROM manual_publication_reconciliations_v1 WHERE publication_id=? ORDER BY reconciliation_id',
      )
      .all(publicationId)
      .map((row) => {
        try {
          const event = validateReconciliationEvent(
            JSON.parse(String(row.payload_json)),
          );
          if (
            row.reconciliation_id !== event.reconciliationId ||
            row.publication_id !== event.publicationId ||
            row.package_hash !== event.packageHash ||
            row.original_receipt_hash !== event.originalReceiptHash ||
            row.platform !== event.platform ||
            row.account !== event.account ||
            row.external_id !== event.externalId ||
            row.external_url_key !==
              externalPostKey(event.platform, event.externalUrl) ||
            row.idempotency_key !== event.idempotencyKey ||
            row.confirmation_origin !== event.confirmationOrigin ||
            row.content_hash !== event.contentHash ||
            original.state !== 'UNCONFIRMED' ||
            original.packageHash !== event.packageHash ||
            original.contentHash !== event.originalReceiptHash ||
            original.platform !== event.platform ||
            original.account !== event.account ||
            original.reviewHash !== event.originalReviewHash
          )
            reconciliationFail('INTEGRITY');
          this.assertExternalAvailable(event);
          return event;
        } catch {
          return reconciliationFail('INTEGRITY');
        }
      });
  }
  effectivePublication(id: string) {
    const originalReceipt = this.get('PUBLICATION', id);
    if (!originalReceipt)
      distributionFail('DISTRIBUTION_PUBLICATION_NOT_FOUND');
    const reconciliationHistory = this.reconciliations(id),
      event = reconciliationHistory[0];
    const projected = event
      ? {
          ...originalReceipt,
          schemaVersion: 'manual-publication-effective/1.0.0',
          state: 'PUBLISHED',
          externalId: event.externalId,
          externalUrl: event.externalUrl,
          publishedAt: event.publishedAt,
          evidenceReference: event.evidenceReference,
          originalReceiptHash: originalReceipt.contentHash,
          reconciliationHash: event.contentHash,
          confirmationOrigin: event.confirmationOrigin,
        }
      : originalReceipt;
    const publication = event
      ? { ...projected, contentHash: affiliateHash(projected) }
      : originalReceipt;
    return immutable({
      originalReceipt,
      reconciliationHistory,
      effectiveState: publication.state,
      confirmationOrigin:
        event?.confirmationOrigin ??
        (originalReceipt.state === 'PUBLISHED'
          ? 'OPERATOR_ATTESTED'
          : 'UNCONFIRMED'),
      publication,
    });
  }
  reconcile(
    input: ReconciliationInput,
    operatorId: string,
    key: string,
    now: () => string,
    gate: () => void,
  ): ReconciliationEvent {
    this.reconciliationSchema(true);
    affiliateIdentifier(key, 'idempotencyKey');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      gate();
      const original = this.get('PUBLICATION', input.publicationId);
      if (
        !original ||
        original.state !== 'UNCONFIRMED' ||
        original.packageHash !== input.packageHash ||
        original.contentHash !== input.originalReceiptHash ||
        original.platform !== input.platform ||
        original.account !== input.account ||
        (original.externalId !== null &&
          original.externalId !== input.externalId) ||
        (original.externalUrl !== null &&
          externalPostKey(original.platform, original.externalUrl) !==
            externalPostKey(input.platform, input.externalUrl))
      )
        reconciliationFail('SCOPE_MISMATCH');
      const prior = this.db
        .prepare(
          'SELECT publication_id FROM manual_publication_reconciliations_v1 WHERE idempotency_key=?',
        )
        .get(key);
      if (prior && prior.publication_id !== input.publicationId)
        reconciliationFail('IDEMPOTENCY_CONFLICT');
      const existing = this.reconciliations(input.publicationId)[0];
      if (existing) {
        if (
          existing.idempotencyKey !== key ||
          existing.reconciliationId !== reconciliationId(input, operatorId, key)
        )
          reconciliationFail('CONFLICT');
        this.db.exec('COMMIT');
        return existing;
      }
      this.assertExternalAvailable(input);
      const body = {
        ...input,
        schemaVersion: MANUAL_RECONCILIATION_VERSION,
        reconciliationId: reconciliationId(input, operatorId, key),
        originalReviewHash: original.reviewHash as string,
        operatorId,
        recordedAt: now(),
        idempotencyKey: key,
      };
      const event = validateReconciliationEvent({
        ...body,
        contentHash: affiliateHash(body),
      });
      this.db
        .prepare(
          'INSERT INTO manual_publication_reconciliations_v1(reconciliation_id,publication_id,package_hash,original_receipt_hash,platform,account,external_id,external_url_key,confirmation_origin,idempotency_key,content_hash,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          event.reconciliationId,
          event.publicationId,
          event.packageHash,
          event.originalReceiptHash,
          event.platform,
          event.account,
          event.externalId,
          externalPostKey(event.platform, event.externalUrl),
          event.confirmationOrigin,
          key,
          event.contentHash,
          JSON.stringify(event),
        );
      const result = this.reconciliations(input.publicationId)[0]!;
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  command(
    kind: string,
    value: unknown,
    key: string,
    operation: () => any,
    guard = () => {},
  ) {
    if (!['PACKAGE', 'REVIEW', 'PUBLICATION', 'RESULTS'].includes(kind))
      throw new AffiliateRepositoryError(
        'INVALID_DISTRIBUTION_COMMAND',
        'type',
      );
    affiliateIdentifier(key, 'idempotencyKey');
    const hash = affiliateHash(value);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      guard();
      const prior = this.db
        .prepare('SELECT * FROM affiliate_commands WHERE idempotency_key=?')
        .get(key);
      let result: any;
      if (prior) {
        if (
          prior.command_type !== `DISTRIBUTION_${kind}` ||
          prior.payload_hash !== hash
        )
          throw new AffiliateRepositoryError(
            'AFFILIATE_IDEMPOTENCY_CONFLICT',
            'idempotencyKey',
          );
        try {
          result = JSON.parse(String(prior.result_json));
        } catch (cause) {
          throw new AffiliateRepositoryError(
            'INVALID_PERSISTED_AFFILIATE_DATA',
            'result',
            { cause },
          );
        }
        if (affiliateHash(result) !== prior.result_hash)
          throw new AffiliateRepositoryError(
            'AFFILIATE_HASH_MISMATCH',
            'result',
          );
        result = immutable(result);
      } else {
        result = operation();
        this.db
          .prepare('INSERT INTO affiliate_commands VALUES (?,?,?,?,?)')
          .run(
            key,
            `DISTRIBUTION_${kind}`,
            hash,
            affiliateHash(result),
            JSON.stringify(result),
          );
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(kind: string, id: string): any {
    const row = this.db
      .prepare(
        'SELECT * FROM manual_distribution_records WHERE kind=? AND record_id=?',
      )
      .get(kind, id);
    if (!row) return null;
    const value = JSON.parse(String(row.payload_json));
    if (
      affiliateHash(value) !== row.content_hash ||
      value.contentHash !== row.content_hash ||
      (value.packageHash ?? value.contentHash) !== row.package_hash
    )
      distributionFail('DISTRIBUTION_PERSISTED_INTEGRITY');
    return immutable(value);
  }
  put(kind: string, id: string, value: any): any {
    const prior = this.get(kind, id);
    if (prior) {
      if (prior.contentHash !== value.contentHash)
        distributionFail(`DISTRIBUTION_${kind}_CONFLICT`);
      return prior;
    }
    this.db
      .prepare('INSERT INTO manual_distribution_records VALUES (?,?,?,?,?)')
      .run(
        kind,
        id,
        value.packageHash ?? value.contentHash,
        value.contentHash,
        JSON.stringify(value),
      );
    return this.get(kind, id);
  }
  list(kind: string, packageHash?: string): any[] {
    if (packageHash !== undefined) hashValue(packageHash, 'packageHash');
    return this.db
      .prepare(
        `SELECT record_id FROM manual_distribution_records WHERE kind=?${packageHash === undefined ? '' : ' AND package_hash=?'} ORDER BY record_id`,
      )
      .all(...(packageHash === undefined ? [kind] : [kind, packageHash]))
      .map((row) => this.get(kind, String(row.record_id)));
  }
}
