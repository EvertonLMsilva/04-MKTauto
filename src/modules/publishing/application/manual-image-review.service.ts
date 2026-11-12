import { randomUUID } from 'node:crypto';
import {
  affiliateHash,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  exact,
  hashValue,
  publicText,
} from '../domain/manual-distribution-contracts.js';
import {
  validateManualImageInput,
  type ManualImageInput,
} from '../domain/manual-image-package-contracts.js';
import {
  MANUAL_IMAGE_REVIEW_VERSION,
  reviewFail,
  reviewReason,
  validateImageReviewSnapshot,
  type ImageReviewRecord,
} from '../domain/manual-image-review-contracts.js';
import type { ManualImagePackageService } from './manual-image-package.service.js';
import type { ManualImageQcService } from './manual-image-qc.service.js';
import type { ManualImageReviewRepository } from '../infrastructure/manual-image-review.repository.js';

export interface ManualImageReviewAuthority {
  // Host-owned adapter must authenticate the opaque principal and check its
  // permission for this exact scope. Neither payload nor actorId is identity.
  authorize(
    principal: unknown,
    scope: {
      action: 'REVIEW' | 'REVOKE';
      projectId: string;
      projectVersion: number;
      packageHash: string;
      decisionId: string | null;
    },
  ):
    | { actorId: string; authenticated: true; authorized: true }
    | Promise<{ actorId: string; authenticated: true; authorized: true }>;
}
export interface ManualImageReviewRequest {
  idempotencyKey: string;
  input: ManualImageInput;
  expectedPackageHash: string;
  expectedReviewRevision: number;
  decision: 'APPROVED' | 'REJECTED';
  reason: string | null;
}
export interface ManualImageRevocationRequest {
  idempotencyKey: string;
  decisionId: string;
  decisionHash: string;
  reason: string;
}
export class ManualImageReviewService {
  constructor(
    private readonly deps: {
      packages: Pick<ManualImagePackageService, 'prepare'>;
      qc: Pick<ManualImageQcService, 'inspect'>;
      repository: ManualImageReviewRepository;
      authority?: ManualImageReviewAuthority;
      now?: () => string;
    },
  ) {}
  private async actor(
    principal: unknown,
    scope: Parameters<ManualImageReviewAuthority['authorize']>[1],
  ) {
    if (!this.deps.authority) reviewFail('HUMAN_REVIEW_AUTHORITY_REQUIRED');
    let identity;
    try {
      identity = await this.deps.authority.authorize(principal, scope);
    } catch {
      reviewFail('HUMAN_REVIEW_AUTHORITY_REQUIRED');
    }
    if (
      !identity ||
      identity.authenticated !== true ||
      identity.authorized !== true
    )
      reviewFail('HUMAN_REVIEW_AUTHORITY_REQUIRED');
    return publicText(identity.actorId, 'actorId', 100) as string;
  }
  private result(record: ImageReviewRecord) {
    const latest = this.deps.repository.getImageApproval(
      record.review.packageHash,
    );
    // The immutable receipt and current package state are distinct. Replay of
    // an older receipt never returns an obsolete effective approval.
    if (!latest) reviewFail('IMAGE_REVIEW_STORAGE_INVALID');
    return immutable({
      record,
      review: latest,
      publicationAuthorized: false as const,
    });
  }
  async decide(raw: ManualImageReviewRequest, principal: unknown) {
    exact(raw, [
      'idempotencyKey',
      'input',
      'expectedPackageHash',
      'expectedReviewRevision',
      'decision',
      'reason',
    ]);
    const request = structuredClone(raw),
      input = validateManualImageInput(request.input) as ManualImageInput;
    publicText(request.idempotencyKey, 'idempotencyKey', 160);
    hashValue(request.expectedPackageHash, 'expectedPackageHash');
    if (
      !Number.isSafeInteger(request.expectedReviewRevision) ||
      request.expectedReviewRevision < 0 ||
      !['APPROVED', 'REJECTED'].includes(request.decision)
    )
      reviewFail('IMAGE_REVIEW_INPUT_INVALID');
    const reason = reviewReason(
      request.reason,
      request.decision === 'REJECTED',
    );
    const actor = await this.actor(principal, {
      action: 'REVIEW',
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      packageHash: request.expectedPackageHash,
      decisionId: null,
    });
    const qc = await this.deps.qc.inspect({
      imageArtifactId: input.imageArtifactId,
      imageContentHash: input.imageContentHash,
      productId: input.productId,
      productRevision: input.productRevision,
    });
    if (qc.status !== 'PASS' || !qc.bundle)
      reviewFail('IMAGE_REVIEW_QC_REQUIRED');
    const prepared = await this.deps.packages.prepare(input);
    if (
      !prepared.package ||
      prepared.package.packageHash !== request.expectedPackageHash ||
      prepared.blockers.some((b) => b.code !== 'HUMAN_APPROVAL_REQUIRED')
    )
      reviewFail('IMAGE_REVIEW_PACKAGE_INVALID');
    const snapshot = validateImageReviewSnapshot({
      package: prepared.package,
      qc: qc.bundle,
    });
    const payloadHash = affiliateHash({
      kind: 'DECIDE',
      request,
      actor,
      qcHash: affiliateHash(snapshot.qc),
    });
    const record = this.deps.repository.decide(
      request.idempotencyKey,
      payloadHash,
      snapshot,
      request.expectedReviewRevision,
      () => {
        const body = {
          schemaVersion: MANUAL_IMAGE_REVIEW_VERSION,
          decisionId: 'image_review_' + randomUUID(),
          actor,
          packageHash: request.expectedPackageHash,
          imageArtifactId: input.imageArtifactId,
          imageContentHash: input.imageContentHash,
          qualityControlHash: snapshot.qc.report.contentHash,
          decision: request.decision,
          reviewedAt: (this.deps.now ?? (() => new Date().toISOString()))(),
          revoked: false,
        };
        return {
          review: { ...body, contentHash: affiliateHash(body) },
          revision: request.expectedReviewRevision + 1,
          reason,
          snapshot,
        };
      },
    );
    return this.result(record);
  }
  async revoke(raw: ManualImageRevocationRequest, principal: unknown) {
    exact(raw, ['idempotencyKey', 'decisionId', 'decisionHash', 'reason']);
    const request = structuredClone(raw);
    publicText(request.idempotencyKey, 'idempotencyKey', 160);
    publicText(request.decisionId, 'decisionId', 160);
    hashValue(request.decisionHash, 'decisionHash');
    reviewReason(request.reason, true);
    const original = this.deps.repository.getRecord(request.decisionId);
    if (!original || original.review.contentHash !== request.decisionHash)
      reviewFail('IMAGE_REVIEW_DECISION_MISMATCH');
    const p = original.snapshot.package;
    const actor = await this.actor(principal, {
      action: 'REVOKE',
      projectId: p.projectId,
      projectVersion: p.projectVersion,
      packageHash: p.packageHash,
      decisionId: request.decisionId,
    });
    const record = this.deps.repository.revoke(
      request.idempotencyKey,
      affiliateHash({ kind: 'REVOKE', request, actor }),
      request.decisionId,
      request.decisionHash,
      () => {
        const body = {
          schemaVersion: 'manual-image-review-revocation/1.0.0' as const,
          revocationId: 'image_review_revocation_' + randomUUID(),
          decisionId: request.decisionId,
          decisionHash: request.decisionHash,
          actor,
          revokedAt: (this.deps.now ?? (() => new Date().toISOString()))(),
          reason: request.reason,
        };
        return { ...body, contentHash: affiliateHash(body) };
      },
    );
    return this.result(record);
  }
}
