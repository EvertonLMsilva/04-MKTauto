import { affiliateIdentifier, immutable } from './affiliate-contracts.js';
import { ContractValidationError } from './affiliate.errors.js';
import type { ShopeeAffiliateProvenance } from './shopee-affiliate-contracts.js';
import { validateShopeeUrl } from './shopee-link-url.js';

export interface AffiliateCampaignSourceV1 {
  schemaVersion: 'affiliate-campaign-source/1.0.0';
  sourceId: string;
  revision: number;
  source: 'SHOPEE_AFFILIATE_API';
  offer: {
    offerId: string;
    productId: string;
    shopId: string | null;
    provenance: ShopeeAffiliateProvenance;
  };
  productId: string;
  productRevision: number;
  campaignId: string;
  campaignRevision: number;
  briefingId: string | null;
  affiliateUrl: string;
}
function invalid(path: string): never {
  throw new ContractValidationError(
    'INVALID_AFFILIATE_CAMPAIGN_SOURCE',
    path,
    'contrato inválido',
  );
}
function exact(
  value: unknown,
  keys: string[],
  path: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid(path);
}
function externalId(value: unknown, path: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
  )
    invalid(path);
}
export function validateAffiliateCampaignSource(
  raw: unknown,
): AffiliateCampaignSourceV1 {
  exact(
    raw,
    [
      'schemaVersion',
      'sourceId',
      'revision',
      'source',
      'offer',
      'productId',
      'productRevision',
      'campaignId',
      'campaignRevision',
      'briefingId',
      'affiliateUrl',
    ],
    'source',
  );
  if (
    raw.schemaVersion !== 'affiliate-campaign-source/1.0.0' ||
    raw.source !== 'SHOPEE_AFFILIATE_API'
  )
    invalid('schemaVersion');
  for (const key of ['sourceId', 'productId', 'campaignId'])
    affiliateIdentifier(raw[key], key);
  if (raw.briefingId !== null)
    affiliateIdentifier(raw.briefingId, 'briefingId');
  for (const key of ['revision', 'productRevision', 'campaignRevision'])
    if (!Number.isSafeInteger(raw[key]) || (raw[key] as number) < 1)
      invalid(key);
  exact(raw.offer, ['offerId', 'productId', 'shopId', 'provenance'], 'offer');
  externalId(raw.offer.offerId, 'offer.offerId');
  externalId(raw.offer.productId, 'offer.productId');
  if (raw.offer.shopId !== null) externalId(raw.offer.shopId, 'offer.shopId');
  exact(
    raw.offer.provenance,
    ['source', 'fixtureVersion', 'observedAt'],
    'offer.provenance',
  );
  const p = raw.offer.provenance;
  if (p.source === 'FAKE') {
    if (
      p.observedAt !== null ||
      typeof p.fixtureVersion !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}$/.test(p.fixtureVersion)
    )
      invalid('offer.provenance');
  } else if (p.source === 'SHOPEE_LIVE') {
    if (
      p.fixtureVersion !== null ||
      typeof p.observedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        p.observedAt,
      ) ||
      !Number.isFinite(Date.parse(p.observedAt))
    )
      invalid('offer.provenance');
  } else invalid('offer.provenance');
  // Structural policy only: never claims that an affiliate association was verified.
  // Only the existing FAKE fixture may use its exact non-routable link. Historical
  // FAKE short links keep their policy; LIVE never gains a synthetic host.
  const syntheticFixtureLink =
    p.source === 'FAKE' &&
    p.fixtureVersion === 'shopee-affiliate-fake/1' &&
    raw.affiliateUrl ===
      `https://shopee-affiliate.invalid/link/${raw.offer.offerId}`;
  validateShopeeUrl(
    raw.affiliateUrl,
    new Set(
      syntheticFixtureLink ? ['shopee-affiliate.invalid'] : ['s.shopee.com.br'],
    ),
    'affiliateUrl',
    invalid,
  );
  return immutable(raw) as unknown as AffiliateCampaignSourceV1;
}
