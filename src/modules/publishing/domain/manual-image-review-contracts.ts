import {
  affiliateHash,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  exact,
  hashValue,
  publicText,
  timestamp,
} from './manual-distribution-contracts.js';
import {
  manualImagePackageHash,
  validateManualImageInput,
  type ManualImagePackage,
} from './manual-image-package-contracts.js';
import {
  validateManualImageQcBundle,
  type ManualImageQcBundle,
} from './manual-image-qc-contracts.js';

export const MANUAL_IMAGE_REVIEW_VERSION = 'manual-image-review/1.0.0' as const;
export class ManualImageReviewError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function reviewFail(code: string): never {
  throw new ManualImageReviewError(code);
}
export interface ManualImageReview {
  schemaVersion: typeof MANUAL_IMAGE_REVIEW_VERSION;
  decisionId: string;
  actor: string;
  packageHash: string;
  imageArtifactId: string;
  imageContentHash: string;
  qualityControlHash: string;
  decision: 'APPROVED' | 'REJECTED';
  reviewedAt: string;
  revoked: boolean;
  contentHash: string;
}
export interface ImageReviewSnapshot {
  package: ManualImagePackage;
  qc: ManualImageQcBundle;
}
export interface ImageReviewRecord {
  review: ManualImageReview;
  revision: number;
  reason: string | null;
  snapshot: ImageReviewSnapshot;
}
export interface ImageReviewRevocation {
  schemaVersion: 'manual-image-review-revocation/1.0.0';
  revocationId: string;
  decisionId: string;
  decisionHash: string;
  actor: string;
  revokedAt: string;
  reason: string;
  contentHash: string;
}
export function validateImageReview(raw: unknown): ManualImageReview {
  exact(raw, [
    'schemaVersion',
    'decisionId',
    'actor',
    'packageHash',
    'imageArtifactId',
    'imageContentHash',
    'qualityControlHash',
    'decision',
    'reviewedAt',
    'revoked',
    'contentHash',
  ]);
  const r = raw as Record<string, unknown>;
  if (
    r.schemaVersion !== MANUAL_IMAGE_REVIEW_VERSION ||
    !['APPROVED', 'REJECTED'].includes(r.decision as string) ||
    typeof r.revoked !== 'boolean'
  )
    reviewFail('IMAGE_REVIEW_INVALID');
  for (const key of ['decisionId', 'actor', 'imageArtifactId'])
    publicText(r[key], key, 160);
  publicText(r.actor, 'actor', 100);
  for (const key of [
    'packageHash',
    'imageContentHash',
    'qualityControlHash',
    'contentHash',
  ])
    hashValue(r[key], key);
  timestamp(r.reviewedAt, 'reviewedAt');
  if (affiliateHash(r) !== r.contentHash)
    reviewFail('IMAGE_REVIEW_HASH_MISMATCH');
  return immutable(r) as unknown as ManualImageReview;
}
// Structural verification supplements, never replaces, the trusted package/QC producers.
export function validateImageReviewSnapshot(
  raw: ImageReviewSnapshot,
): ImageReviewSnapshot {
  const p = raw.package,
    q = validateManualImageQcBundle(raw.qc);
  const {
    schemaVersion,
    packageHash,
    sizeBytes,
    cta,
    disclosure,
    affiliateUrl,
    rightsReferences,
    qualityControl,
    review,
    ...input
  } = p;
  validateManualImageInput(input);
  if (
    schemaVersion !== 'manual-image-package/1.0.0' ||
    manualImagePackageHash(p) !== packageHash ||
    qualityControl.status !== 'PASS' ||
    qualityControl.contentHash !== q.report.contentHash ||
    qualityControl.reportId !== q.report.reportId ||
    !rightsReferences.length ||
    !cta ||
    !disclosure ||
    !affiliateUrl ||
    !review
  )
    reviewFail('IMAGE_REVIEW_PACKAGE_INVALID');
  for (const key of [
    'imageArtifactId',
    'imageContentHash',
    'productId',
    'productRevision',
    'format',
    'widthPixels',
    'heightPixels',
  ] as const) {
    if (p[key] !== q.report[key]) reviewFail('IMAGE_REVIEW_QC_MISMATCH');
  }
  if (
    p.mediaReference !== q.inspection.mediaReference ||
    sizeBytes !== q.inspection.sizeBytes
  )
    reviewFail('IMAGE_REVIEW_QC_MISMATCH');
  return immutable({
    package: {
      ...p,
      review: { status: 'HUMAN_APPROVAL_REQUIRED', contentHash: null },
    },
    qc: q,
  });
}
export function effectiveImageReview(
  review: ManualImageReview,
  revoked: boolean,
): ManualImageReview {
  const body = { ...validateImageReview(review), revoked };
  return validateImageReview({ ...body, contentHash: affiliateHash(body) });
}
export function reviewReason(raw: unknown, required: boolean): string | null {
  if (raw === null && !required) return null;
  return publicText(raw, 'reason', 2000);
}
