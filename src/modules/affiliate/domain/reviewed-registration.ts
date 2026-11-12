import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
  validateAffiliateProduct,
  validateAffiliateCampaign,
  type AffiliateProduct,
  type AffiliateCampaign,
} from './affiliate-contracts.js';
import { catalogError } from '../infrastructure/discovery-error.js';

export interface ReviewedRegistrationPayload {
  schemaVersion: 'affiliate-review-registration/1.0.0';
  operation: 'REGISTER_PRODUCT_AND_CAMPAIGN';
  idempotencyKey: string;
  actorId: string;
  decision: 'REGISTER';
  previewPackageHash: string;
  reportId: string;
  provenance: Record<string, unknown>;
  product: AffiliateProduct;
  campaign: AffiliateCampaign;
  affiliateEvidence: unknown;
}
export interface ReviewedRegistrationReceipt extends ReviewedRegistrationPayload {
  status: 'REGISTERED';
  registeredAt: string;
  productHash: string;
  campaignHash: string;
  associationVerified: false;
  liveAuthorized: false;
  publicationAuthorized: false;
  operationalApprovalGranted: false;
}
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function reviewedRegistration(raw: unknown, actorId: string) {
  if (
    !record(raw) ||
    Object.keys(raw).some(
      (k) =>
        ![
          'idempotencyKey',
          'confirmed',
          'decision',
          'expectedPackageHash',
          'preview',
        ].includes(k),
    )
  )
    throw catalogError('AFFILIATE_REVIEW_INVALID_INPUT');
  if (raw.confirmed !== true || raw.decision !== 'REGISTER')
    throw catalogError('AFFILIATE_REVIEW_CONFIRMATION_REQUIRED');
  affiliateIdentifier(raw.idempotencyKey, 'idempotencyKey');
  affiliateIdentifier(actorId, 'actorId');
  const artifact = raw.preview;
  if (
    !record(artifact) ||
    typeof raw.expectedPackageHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.expectedPackageHash) ||
    artifact.packageHash !== raw.expectedPackageHash
  )
    throw catalogError('AFFILIATE_REVIEW_PACKAGE_MISMATCH');
  const { packageHash, ...body } = artifact;
  if (affiliateHash(body) !== packageHash)
    throw catalogError('AFFILIATE_REVIEW_PACKAGE_MISMATCH');
  if (
    artifact.previewVersion !== 'affiliate-qualification-preview/1.0.0' ||
    artifact.status !== 'READY_FOR_OPERATOR_REVIEW' ||
    artifact.registrationAuthorized !== false ||
    artifact.operationallyRegistered !== false ||
    artifact.catalogValidationPassed !== true ||
    !Array.isArray(artifact.pending) ||
    artifact.pending.length ||
    !record(artifact.finalPayload) ||
    !record(artifact.productDraft) ||
    !record(artifact.offerDraft) ||
    !record(artifact.selectedProduct) ||
    !record(artifact.provenance) ||
    typeof artifact.reportId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(artifact.reportId) ||
    affiliateHash(artifact.finalPayload) !==
      affiliateHash({
        product: artifact.productDraft,
        offer: artifact.offerDraft,
      })
  )
    throw catalogError('AFFILIATE_REVIEW_BLOCKED');
  const product = validateAffiliateProduct(artifact.productDraft.product),
    campaign = validateAffiliateCampaign(artifact.offerDraft.campaign);
  const id = artifact.selectedProduct.externalProductId;
  const spec = product.evidence.find(
    (e) => e.id === `ev_feed_${id}` && e.kind === 'PRODUCT_SPECIFICATION',
  );
  if (
    typeof id !== 'string' ||
    !/^[1-9]\d{0,39}$/.test(id) ||
    !spec ||
    typeof artifact.provenance.feedId !== 'string' ||
    !Number.isSafeInteger(artifact.provenance.rowNumber) ||
    artifact.provenance.rowNumber < 2
  )
    throw catalogError('AFFILIATE_REVIEW_INVALID_INPUT');
  const payload: ReviewedRegistrationPayload = {
    schemaVersion: 'affiliate-review-registration/1.0.0',
    operation: 'REGISTER_PRODUCT_AND_CAMPAIGN',
    idempotencyKey: raw.idempotencyKey,
    actorId,
    decision: 'REGISTER',
    previewPackageHash: packageHash,
    reportId: artifact.reportId,
    provenance: artifact.provenance,
    product,
    campaign,
    affiliateEvidence: artifact.affiliateEvidence,
  };
  return immutable({
    payload,
    key: 'review_' + affiliateHash({ idempotencyKey: raw.idempotencyKey }),
    request: {
      reportId: artifact.reportId,
      externalProductId: id,
      projectId: campaign.projectId,
      recordedAt: spec.recordedAt,
      product,
      campaign,
      affiliateEvidence: artifact.affiliateEvidence,
    },
  });
}
