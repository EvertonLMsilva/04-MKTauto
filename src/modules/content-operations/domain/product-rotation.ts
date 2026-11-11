import type { AffiliateCatalogCandidate } from '../../affiliate/domain/affiliate-catalog.js';
import { eligibleCatalogCandidate } from '../../affiliate/domain/affiliate-catalog.js';
import { materializeAffiliateBriefing } from '../../affiliate/domain/affiliate-contracts.js';

export function freezeCatalogRequest(
  request: Record<string, unknown>,
  candidates: AffiliateCatalogCandidate[],
  previousProduct: string | null,
) {
  const eligible = candidates
    .filter(eligibleCatalogCandidate)
    .sort((a, b) =>
      a.product.productId < b.product.productId
        ? -1
        : a.product.productId > b.product.productId
          ? 1
          : a.product.revision - b.product.revision,
    );
  // Product identity, rather than revision, defines the cooldown and the cursor.
  const alternatives = eligible.filter(
    (c) => c.product.productId !== previousProduct,
  );
  const pool = alternatives.length ? alternatives : eligible;
  const selected =
    pool.find(
      (c) => previousProduct === null || c.product.productId > previousProduct,
    ) ?? pool[0];
  if (!selected) return { ...request, catalogSelection: null };
  const briefing = materializeAffiliateBriefing(
    String(request.briefingId),
    selected.campaign,
    selected.product,
  );
  return {
    ...request,
    localImage: selected.product.localImage,
    catalogSelection: {
      method: 'ROUND_ROBIN_ID_V1',
      previousProductId: previousProduct,
      productId: selected.product.productId,
      productRevision: selected.product.revision,
      sourceCampaignId: selected.campaign.campaignId,
      sourceCampaignRevision: selected.campaign.revision,
      affiliateUrl: selected.campaign.affiliateUrl,
      briefingId: briefing.briefingId,
      briefingHash: briefing.contentHash,
      briefing,
    },
  };
}
