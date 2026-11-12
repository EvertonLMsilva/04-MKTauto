import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  exact,
  hashValue,
  publicText,
  timestamp,
  https,
  distributionFail,
} from './manual-distribution-contracts.js';

export const MANUAL_RECONCILIATION_VERSION =
  'manual-publication-reconciliation/1.0.0' as const;
export type ManualConfirmationOrigin =
  'UNCONFIRMED' | 'OPERATOR_ATTESTED' | 'PLATFORM_VERIFIED';
export interface ReconciliationInput {
  publicationId: string;
  packageHash: string;
  originalReceiptHash: string;
  platform: 'instagram' | 'facebook';
  account: string;
  externalId: string;
  externalUrl: string;
  publishedAt: string;
  evidenceReference: string;
  confirmationOrigin: 'OPERATOR_ATTESTED';
}
export interface ReconciliationEvent extends ReconciliationInput {
  schemaVersion: typeof MANUAL_RECONCILIATION_VERSION;
  reconciliationId: string;
  originalReviewHash: string;
  operatorId: string;
  recordedAt: string;
  idempotencyKey: string;
  contentHash: string;
}
export const reconciliationFields = [
  'publicationId',
  'packageHash',
  'originalReceiptHash',
  'platform',
  'account',
  'externalId',
  'externalUrl',
  'publishedAt',
  'evidenceReference',
  'confirmationOrigin',
] as const;
export function reconciliationFail(suffix: string): never {
  return distributionFail('DISTRIBUTION_RECONCILIATION_' + suffix) as never;
}
// Stable post permalink identity; tracking query parameters and www aliases must
// not permit assigning the same external post to another package/account.
export function externalPostKey(platform: string, value: string): string {
  https(value, 'externalUrl');
  const url = new URL(value),
    host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  if (
    url.port ||
    url.hash ||
    (platform === 'instagram'
      ? host !== 'instagram.com' ||
        !/^\/(p|reel|reels)\/[A-Za-z0-9_-]+$/.test(path)
      : platform === 'facebook'
        ? host !== 'facebook.com' ||
          !/^\/(reel\/[A-Za-z0-9_-]+|[A-Za-z0-9_.-]+\/(posts|videos)\/[A-Za-z0-9_-]+)$/.test(
            path,
          )
        : true)
  )
    reconciliationFail('DESTINATION_MISMATCH');
  // The same post shortcode/media ID may be exposed through p/reel/videos
  // aliases. Those routes must not turn one observation into two identities.
  return (
    'https://' +
    host +
    (platform === 'instagram' ? '/p/' : '/posts/') +
    path.split('/').at(-1)!
  );
}
export function validateReconciliationInput(raw: unknown): ReconciliationInput {
  exact(raw, reconciliationFields);
  const v = raw as ReconciliationInput;
  publicText(v.publicationId, 'publicationId', 200);
  hashValue(v.packageHash, 'packageHash');
  hashValue(v.originalReceiptHash, 'originalReceiptHash');
  if (!['instagram', 'facebook'].includes(v.platform))
    reconciliationFail('DESTINATION_MISMATCH');
  if (typeof v.account !== 'string' || !/^[1-9]\d{4,63}$/.test(v.account))
    reconciliationFail('SCOPE_MISMATCH');
  publicText(v.externalId, 'externalId', 200);
  if (!/^[A-Za-z0-9_-]+$/.test(v.externalId))
    reconciliationFail('EVIDENCE_REQUIRED');
  externalPostKey(v.platform, v.externalUrl);
  publicText(v.evidenceReference, 'evidenceReference', 1000);
  timestamp(v.publishedAt, 'publishedAt');
  if (v.confirmationOrigin !== 'OPERATOR_ATTESTED')
    reconciliationFail('ORIGIN_INVALID');
  return immutable(v);
}
export function reconciliationId(
  v: ReconciliationInput,
  operatorId: string,
  key: string,
): string {
  return (
    'manual_reconciliation:' +
    affiliateHash({ input: v, operatorId, idempotencyKey: key })
  );
}
export function validateReconciliationEvent(raw: unknown): ReconciliationEvent {
  exact(raw, [
    ...reconciliationFields,
    'schemaVersion',
    'reconciliationId',
    'originalReviewHash',
    'operatorId',
    'recordedAt',
    'idempotencyKey',
    'contentHash',
  ]);
  const v = raw as ReconciliationEvent;
  const input = Object.fromEntries(reconciliationFields.map((k) => [k, v[k]]));
  validateReconciliationInput(input);
  hashValue(v.originalReviewHash, 'originalReviewHash');
  affiliateIdentifier(v.operatorId, 'operatorId');
  affiliateIdentifier(v.idempotencyKey, 'idempotencyKey');
  timestamp(v.recordedAt, 'recordedAt');
  if (
    v.schemaVersion !== MANUAL_RECONCILIATION_VERSION ||
    affiliateHash(v) !== v.contentHash ||
    v.reconciliationId !==
      reconciliationId(
        input as unknown as ReconciliationInput,
        v.operatorId,
        v.idempotencyKey,
      ) ||
    Date.parse(v.publishedAt) > Date.parse(v.recordedAt)
  )
    reconciliationFail('INTEGRITY');
  return immutable(v);
}
