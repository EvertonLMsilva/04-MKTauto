import { assertMediaProcessingRights } from '../../media/domain/media-processing-rights.js';
import {
  materializeAffiliateBriefing,
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
  const image = product.localImage;
  if (
    product.status === 'ARCHIVED' ||
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
  try {
    materializeAffiliateBriefing('catalog_eligibility', campaign, product);
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
