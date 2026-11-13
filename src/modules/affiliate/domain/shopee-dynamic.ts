import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
  type AffiliateProduct,
} from './affiliate-contracts.js';
import type {
  ShopeeAffiliateOfferDetails,
  ShopeeOfferQuery,
} from './shopee-affiliate-contracts.js';

// These are operator assertions referencing reviewed evidence, not automated legal
// verification. Scope hashes prevent reusing a grant for another item/file/link.
export interface ShopeeScopeEvidence {
  sourceRef: string;
  recordedAt: string;
  subjectHash: string;
}
export interface ShopeeDynamicAuthorization {
  externalProductId: string;
  shopId: string;
  product: AffiliateProduct;
  mediaBinding: ShopeeScopeEvidence;
  commercialApproval?: ShopeeScopeEvidence;
  association?: ShopeeScopeEvidence;
}
export interface ShopeeDynamicConfiguration {
  projectId: string;
  niche: string;
  queries: ShopeeOfferQuery[];
  maxPages: number;
  maxSelected: number;
  minCommissionRate?: string;
  minPrice?: string;
  maxPrice?: string;
  excludedProductIds: string[];
  excludedShopIds: string[];
  excludedTerms: string[];
  subIds: string[];
  authorizations: ShopeeDynamicAuthorization[];
}
export interface ShopeeDynamicDecision {
  productId: string;
  offerId: string;
  status: 'REJECTED' | 'WAITING' | 'PREPARED';
  reasons: string[];
  callId?: string;
  campaignId?: string;
}
export interface ShopeeDynamicResult {
  projectId: string;
  cycleId: string;
  configurationHash: string;
  truncated: boolean;
  decisions: ShopeeDynamicDecision[];
}
export function dynamicCampaignId(projectId: string, productId: string) {
  const readable = `shopee_${projectId}_${productId}`;
  return readable.length <= 80
    ? readable
    : `shopee_${affiliateHash({ projectId, productId }).slice(0, 48)}`;
}
const decimalPattern = /^\d{1,40}(?:\.\d{1,40})?$/;
export function compareDecimal(a: string, b: string) {
  if (!decimalPattern.test(a) || !decimalPattern.test(b))
    throw new Error('SHOPEE_POLICY_DECIMAL_INVALID');
  const [ai, af = ''] = a.split('.'),
    [bi, bf = ''] = b.split('.');
  const size = Math.max(af.length, bf.length);
  const left = BigInt(ai + af.padEnd(size, '0')),
    right = BigInt(bi + bf.padEnd(size, '0'));
  return left < right ? -1 : left > right ? 1 : 0;
}
export function scopeEvidenceMatches(
  proof: ShopeeScopeEvidence | undefined,
  subject: unknown,
) {
  return (
    !!proof &&
    typeof proof.sourceRef === 'string' &&
    !!proof.sourceRef.trim() &&
    proof.sourceRef.length <= 1000 &&
    typeof proof.recordedAt === 'string' &&
    /(?:Z|[+-]\d\d:\d\d)$/.test(proof.recordedAt) &&
    Number.isFinite(Date.parse(proof.recordedAt)) &&
    proof.subjectHash === affiliateHash(subject)
  );
}
export function validateDynamicConfiguration(
  input: ShopeeDynamicConfiguration,
) {
  const fail = (): never => {
    throw new Error('SHOPEE_CONFIGURATION_INVALID');
  };
  if (!input || typeof input !== 'object') fail();
  const allowed = [
    'projectId',
    'niche',
    'queries',
    'maxPages',
    'maxSelected',
    'minCommissionRate',
    'minPrice',
    'maxPrice',
    'excludedProductIds',
    'excludedShopIds',
    'excludedTerms',
    'subIds',
    'authorizations',
  ];
  if (Object.keys(input).some((k) => !allowed.includes(k))) fail();
  affiliateIdentifier(input.projectId, 'projectId');
  if (
    typeof input.niche !== 'string' ||
    !input.niche.trim() ||
    input.niche.length > 200 ||
    !Array.isArray(input.queries) ||
    input.queries.length < 1 ||
    input.queries.length > 5 ||
    !Number.isSafeInteger(input.maxPages) ||
    input.maxPages < input.queries.length ||
    input.maxPages > 10 ||
    !Number.isSafeInteger(input.maxSelected) ||
    input.maxSelected < 1 ||
    input.maxSelected > 5 ||
    !Array.isArray(input.authorizations) ||
    input.authorizations.length > 100
  )
    fail();
  for (const query of input.queries) {
    if (!query || typeof query !== 'object') fail();
    if (
      (query.page !== undefined && query.page !== 1) ||
      (!query.keyword && !query.productCatId && !query.itemId)
    )
      fail();
  }
  for (const list of [
    input.excludedProductIds,
    input.excludedShopIds,
    input.excludedTerms,
  ])
    if (
      !Array.isArray(list) ||
      list.length > 100 ||
      list.some((v) => typeof v !== 'string' || !v.trim() || v.length > 100)
    )
      fail();
  for (const value of [input.minPrice, input.maxPrice, input.minCommissionRate])
    if (
      value !== undefined &&
      (typeof value !== 'string' || !decimalPattern.test(value))
    )
      fail();
  if (
    input.minPrice &&
    input.maxPrice &&
    compareDecimal(input.minPrice, input.maxPrice) > 0
  )
    fail();
  if (
    input.minCommissionRate &&
    compareDecimal(input.minCommissionRate, '1') > 0
  )
    fail();
  if (!Array.isArray(input.subIds)) fail();
  const seen = new Set<string>();
  for (const authorization of input.authorizations) {
    if (
      !authorization ||
      !/^\d{1,20}$/.test(authorization.externalProductId) ||
      !/^\d{1,20}$/.test(authorization.shopId) ||
      seen.has(authorization.externalProductId)
    )
      fail();
    if (
      Object.keys(authorization).some(
        (k) =>
          ![
            'externalProductId',
            'shopId',
            'product',
            'mediaBinding',
            'commercialApproval',
            'association',
          ].includes(k),
      )
    )
      fail();
    seen.add(authorization.externalProductId);
  }
  return immutable(
    JSON.parse(
      JSON.stringify({
        ...input,
        niche: input.niche.trim().toLocaleLowerCase('pt-BR'),
      }),
    ) as ShopeeDynamicConfiguration,
  );
}
export function rankDynamicOffers(
  offers: readonly ShopeeAffiliateOfferDetails[],
) {
  return [...offers].sort((a, b) => {
    const ac = a.estimatedCommission.rate,
      bc = b.estimatedCommission.rate;
    if (ac !== bc) {
      if (ac === null) return 1;
      if (bc === null) return -1;
      const comparison = compareDecimal(bc, ac);
      if (comparison) return comparison;
    }
    return a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;
  });
}
export function dynamicOfferReasons(
  offer: ShopeeAffiliateOfferDetails,
  config: ShopeeDynamicConfiguration,
): { rejected: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (config.excludedProductIds.includes(offer.productId))
    reasons.push('EXCLUDED_PRODUCT');
  if (offer.shopId && config.excludedShopIds.includes(offer.shopId))
    reasons.push('EXCLUDED_SHOP');
  if (
    config.excludedTerms.some((t) =>
      offer.name
        ?.toLocaleLowerCase('pt-BR')
        .includes(t.toLocaleLowerCase('pt-BR')),
    )
  )
    reasons.push('EXCLUDED_TERM');
  if (reasons.length) return { rejected: true, reasons };
  if (
    !offer.shopId ||
    !offer.name?.trim() ||
    !offer.productUrl ||
    !offer.affiliateUrl ||
    !offer.imageUrl
  )
    reasons.push('OFFER_DATA_INCOMPLETE');
  const price = offer.price.amount,
    rate = offer.estimatedCommission.rate;
  if (price === null || compareDecimal(price, '0') <= 0)
    reasons.push('OBSERVED_PRICE_REQUIRED');
  else if (
    (config.minPrice && compareDecimal(price, config.minPrice) < 0) ||
    (config.maxPrice && compareDecimal(price, config.maxPrice) > 0)
  )
    return { rejected: true, reasons: ['PRICE_OUTSIDE_POLICY'] };
  if (rate !== null && compareDecimal(rate, '1') > 0)
    reasons.push('COMMISSION_RATE_INVALID');
  if (config.minCommissionRate && rate === null)
    reasons.push('COMMISSION_ESTIMATE_REQUIRED');
  else if (
    config.minCommissionRate &&
    rate &&
    compareDecimal(rate, config.minCommissionRate) < 0
  )
    return { rejected: true, reasons: ['COMMISSION_BELOW_POLICY'] };
  return { rejected: false, reasons };
}
