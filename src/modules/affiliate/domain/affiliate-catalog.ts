import { assertMediaProcessingRights } from '../../media/domain/media-processing-rights.js';
import {
  materializeAffiliateBriefing,
  immutable,
  validateAffiliateProduct,
  validateAffiliateCampaign,
  type AffiliateCampaign,
  type AffiliateProduct,
} from './affiliate-contracts.js';
import { ContractValidationError } from './affiliate.errors.js';

export interface AffiliateCatalogCandidate {
  campaign: AffiliateCampaign;
  product: AffiliateProduct;
}

// Only current validated revisions with a persisted offer and reusable production rights.
// A QC-only or operation-specific permission cannot seed recurring production.
export function eligibleCatalogCandidate({
  campaign,
  product,
}: AffiliateCatalogCandidate): boolean {
  if (product.status === 'ARCHIVED') return false;
  return catalogCheck(() => {
    materializeAffiliateBriefing('catalog_eligibility', campaign, product);
    return reusableMediaRights(product);
  });
}

function reusableMediaRights(product: AffiliateProduct): boolean {
  const image = product.localImage;
  if (
    !image ||
    !image.rights.commercialUseAllowed ||
    !product.media.some((m) => m.mediaRef === image.mediaReference) ||
    image.rights.evidence?.some(
      (e) =>
        e.mediaAuthorization?.operationScope !== undefined ||
        e.mediaAuthorization?.campaignId !== undefined,
    )
  )
    return false;
  return catalogCheck(() => {
    // The grant must be part of the product evidence too, not only an unrelated source.
    assertMediaProcessingRights(
      product.evidence,
      { mediaRef: image.mediaReference, contentHash: image.contentHash },
      null,
    );
    assertMediaProcessingRights(
      image.rights.evidence,
      { mediaRef: image.mediaReference, contentHash: image.contentHash },
      null,
    );
    return true;
  });
}

function catalogCheck(check: () => unknown): boolean {
  try {
    return Boolean(check());
  } catch (error) {
    if (
      error instanceof ContractValidationError ||
      (error instanceof Error &&
        'code' in error &&
        error.code === 'MEDIA_PROCESSING_RIGHTS_UNCONFIRMED')
    )
      return false;
    throw error;
  }
}

// Technical production rights are documented assertions, not external license,
// affiliate association or commercial approval verification. No grants are made.
export function evaluateCatalogCandidate(candidate: AffiliateCatalogCandidate) {
  const { product, campaign } = candidate;
  const productValid = catalogCheck(() => validateAffiliateProduct(product));
  const offerValid = catalogCheck(() => validateAffiliateCampaign(campaign));
  const briefingCompatible =
    productValid &&
    offerValid &&
    catalogCheck(() =>
      materializeAffiliateBriefing('catalog_eligibility', campaign, product),
    );
  const rights = productValid && reusableMediaRights(product);
  const blockers: string[] = [];
  if (!productValid) blockers.push('PRODUCT_CONTRACT_INVALID');
  if (!offerValid) blockers.push('OFFER_CONTRACT_INVALID');
  if (product?.status === 'ARCHIVED') blockers.push('PRODUCT_ARCHIVED');
  if (productValid && offerValid && !briefingCompatible)
    blockers.push('BRIEFING_SCOPE_INVALID');
  if (!rights) blockers.push('REUSABLE_MEDIA_RIGHTS_REQUIRED');
  return immutable({
    productValid,
    offerValid,
    briefingCompatible,
    reusableMediaRights: rights,
    affiliateLinkPresent:
      typeof campaign?.affiliateUrl === 'string' &&
      campaign.affiliateUrl.length > 0,
    technicalEligibility: blockers.length
      ? ('BLOCKED' as const)
      : ('ELIGIBLE' as const),
    technicalBlockers: blockers,
    evidenceBasis: 'DOCUMENTED_EVIDENCE_NOT_EXTERNALLY_VERIFIED' as const,
    physicalMediaVerification: 'REQUIRES_EXECUTION_REVALIDATION' as const,
    associationVerified: false as const,
    commercialApprovalVerified: false as const,
    externalRightsVerified: false as const,
    currentShopeeDataVerified: false as const,
    currentCommercialData: {
      price: null,
      availability: null,
      commission: null,
    },
    liveAuthorized: false as const,
    publicationAuthorized: false as const,
    operationallyAuthorized: false as const,
    operationalBlockers: [
      'REAL_OFFER_APPROVAL_REQUIRED',
      'EXTERNAL_MEDIA_RIGHTS_VERIFICATION_REQUIRED',
      'AFFILIATE_ASSOCIATION_UNVERIFIED',
      'CURRENT_SHOPEE_DATA_UNVERIFIED',
      'BLOCKED_COST_UNCONFIRMED',
    ],
  });
}
