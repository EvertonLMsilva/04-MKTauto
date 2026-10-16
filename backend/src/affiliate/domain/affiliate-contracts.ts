import { createHash } from 'node:crypto';
import { ContractValidationError } from './affiliate.errors.js';

export const AFFILIATE_PRODUCT_VERSION = 'affiliate-product/1.0.0';
export const AFFILIATE_PRODUCT_V2_VERSION = 'affiliate-product/2.0.0';
export const AFFILIATE_CAMPAIGN_VERSION = 'affiliate-campaign/1.0.0';
export const AFFILIATE_BRIEFING_VERSION = 'affiliate-briefing/1.0.0';
export interface AffiliateEvidence {
  id: string;
  kind: 'PRODUCT_SPECIFICATION' | 'MEDIA_USAGE_RIGHT';
  sourceRef: string;
  recordedAt: string;
}
export interface AffiliateAttribute {
  name: string;
  value: string;
  evidenceRef: string;
}
export interface AffiliateMedia {
  mediaRef: string;
  evidenceRef: string;
}
export type AffiliateBrand =
  | { status: 'KNOWN'; name: string; evidenceRef: string }
  | {
      status: 'DECLARED_UNBRANDED' | 'NOT_PROVIDED';
      name: null;
      evidenceRef: string;
    };
export interface ProductBody {
  productId: string;
  revision: number;
  name: string;
  attributes: AffiliateAttribute[];
  media: AffiliateMedia[];
  evidence: AffiliateEvidence[];
}
export type AffiliateProduct = ProductBody &
  (
    | { schemaVersion: typeof AFFILIATE_PRODUCT_VERSION; brand: string }
    | {
        schemaVersion: typeof AFFILIATE_PRODUCT_V2_VERSION;
        brand: AffiliateBrand;
      }
  );
export interface AffiliateCampaign {
  schemaVersion: typeof AFFILIATE_CAMPAIGN_VERSION;
  campaignId: string;
  revision: number;
  projectId: string;
  productId: string;
  productRevision: number;
  affiliateUrl: string;
  cta: string;
  disclosure: string;
}
export interface AffiliateBriefing {
  schemaVersion: typeof AFFILIATE_BRIEFING_VERSION;
  briefingId: string;
  campaignId: string;
  campaignRevision: number;
  productId: string;
  productRevision: number;
  productName: string;
  attributes: AffiliateAttribute[];
  mediaRefs: string[];
  cta: string;
  disclosure: string;
  affiliateUrl: string;
  evidence: AffiliateEvidence[];
  contentHash: string;
}
const PRODUCT_FIELDS = [
  'schemaVersion',
  'productId',
  'revision',
  'name',
  'brand',
  'attributes',
  'media',
  'evidence',
];
const CAMPAIGN_FIELDS = [
  'schemaVersion',
  'campaignId',
  'revision',
  'projectId',
  'productId',
  'productRevision',
  'affiliateUrl',
  'cta',
  'disclosure',
];
const BRIEFING_FIELDS = [
  'schemaVersion',
  'briefingId',
  'campaignId',
  'campaignRevision',
  'productId',
  'productRevision',
  'productName',
  'attributes',
  'mediaRefs',
  'cta',
  'disclosure',
  'affiliateUrl',
  'evidence',
  'contentHash',
];

export function affiliateHash(value: unknown): string {
  const { contentHash: _ignored, ...content } = value as Record<
    string,
    unknown
  >;
  return createHash('sha256').update(stableJson(content)!).digest('hex');
}
export function rejectAffiliateDynamicPrice(value: string, field: string) {
  if (
    /(?:R\$|US\$|\bBRL\b|\bUSD\b|[$€£]\s*\d|\d[\d.,]*\s*(?:reais|d[oó]lares|euros))/i.test(
      value,
    )
  )
    fail('AFFILIATE_DYNAMIC_PRICE_UNSUPPORTED', field);
}
export function validateAffiliateProduct(value: unknown): AffiliateProduct {
  exact(value, PRODUCT_FIELDS, 'product');
  const isV2 = value.schemaVersion === AFFILIATE_PRODUCT_V2_VERSION;
  if (!isV2) schema(value.schemaVersion, AFFILIATE_PRODUCT_VERSION);
  affiliateIdentifier(value.productId, 'productId');
  revision(value.revision, 'revision');
  text(value.name, 'name');
  if (!isV2) text(value.brand, 'brand');
  const evidence = validateEvidence(value.evidence);
  if (isV2) validateBrand(value.brand, evidence);
  validateAttributes(value.attributes, evidence);
  list(value.media, 'media');
  const refs = new Set<string>();
  value.media.forEach((media, index) => {
    exact(media, ['mediaRef', 'evidenceRef'], `media.${index}`);
    text(media.mediaRef, 'mediaRef');
    unique(refs, media.mediaRef, 'mediaRef');
    reference(evidence, media.evidenceRef, 'MEDIA_USAGE_RIGHT');
  });
  return immutable(value) as unknown as AffiliateProduct;
}
export function affiliateBrandName(product?: AffiliateProduct | null) {
  return product?.schemaVersion === AFFILIATE_PRODUCT_V2_VERSION
    ? product.brand.status === 'KNOWN'
      ? product.brand.name
      : null
    : product?.brand;
}
function validateBrand(
  value: unknown,
  evidence: Map<string, AffiliateEvidence>,
) {
  exact(value, ['status', 'name', 'evidenceRef'], 'brand');
  if (
    !['KNOWN', 'DECLARED_UNBRANDED', 'NOT_PROVIDED'].includes(
      value.status as string,
    )
  )
    fail('INVALID_AFFILIATE_BRAND_STATUS', 'brand.status');
  if (value.status === 'KNOWN') text(value.name, 'brand.name');
  else if (value.name !== null)
    fail('INVALID_AFFILIATE_BRAND_NAME', 'brand.name');
  reference(evidence, value.evidenceRef, 'PRODUCT_SPECIFICATION');
}
export function validateAffiliateCampaign(value: unknown): AffiliateCampaign {
  exact(value, CAMPAIGN_FIELDS, 'campaign');
  schema(value.schemaVersion, AFFILIATE_CAMPAIGN_VERSION);
  for (const field of ['campaignId', 'projectId', 'productId'])
    affiliateIdentifier(value[field], field);
  revision(value.revision, 'revision');
  revision(value.productRevision, 'productRevision');
  text(value.cta, 'cta', 500);
  text(value.disclosure, 'disclosure', 500);
  rejectAffiliateDynamicPrice(`${value.cta}\n${value.disclosure}`, 'cta');
  https(value.affiliateUrl);
  return immutable(value) as unknown as AffiliateCampaign;
}
export function materializeAffiliateBriefing(
  briefingId: string,
  campaignValue: unknown,
  productValue: unknown,
): AffiliateBriefing {
  affiliateIdentifier(briefingId, 'briefingId');
  const campaign = validateAffiliateCampaign(campaignValue),
    product = validateAffiliateProduct(productValue);
  if (
    campaign.productId !== product.productId ||
    campaign.productRevision !== product.revision
  )
    fail('AFFILIATE_SCOPE_MISMATCH', 'productRevision');
  const briefing = {
    schemaVersion: AFFILIATE_BRIEFING_VERSION,
    briefingId,
    campaignId: campaign.campaignId,
    campaignRevision: campaign.revision,
    productId: product.productId,
    productRevision: product.revision,
    productName: product.name,
    attributes: product.attributes,
    mediaRefs: product.media.map((media) => media.mediaRef),
    cta: campaign.cta,
    disclosure: campaign.disclosure,
    affiliateUrl: campaign.affiliateUrl,
    evidence: product.evidence,
  };
  return validateAffiliateBriefing({
    ...briefing,
    contentHash: affiliateHash(briefing),
  });
}
export function validateAffiliateBriefing(value: unknown): AffiliateBriefing {
  exact(value, BRIEFING_FIELDS, 'briefing');
  schema(value.schemaVersion, AFFILIATE_BRIEFING_VERSION);
  for (const field of ['briefingId', 'campaignId', 'productId'])
    affiliateIdentifier(value[field], field);
  revision(value.campaignRevision, 'campaignRevision');
  revision(value.productRevision, 'productRevision');
  text(value.productName, 'productName');
  text(value.cta, 'cta', 500);
  text(value.disclosure, 'disclosure', 500);
  rejectAffiliateDynamicPrice(`${value.cta}\n${value.disclosure}`, 'cta');
  https(value.affiliateUrl);
  const evidence = validateEvidence(value.evidence);
  validateAttributes(value.attributes, evidence);
  list(value.mediaRefs, 'mediaRefs');
  const refs = new Set<string>();
  value.mediaRefs.forEach((ref) => {
    text(ref, 'mediaRef');
    unique(refs, ref, 'mediaRef');
  });
  if (![...evidence.values()].some((item) => item.kind === 'MEDIA_USAGE_RIGHT'))
    fail('AFFILIATE_EVIDENCE_MISSING', 'mediaRefs');
  if (
    !/^[0-9a-f]{64}$/.test(value.contentHash as string) ||
    affiliateHash(value) !== value.contentHash
  )
    fail('AFFILIATE_HASH_MISMATCH', 'contentHash');
  return immutable(value) as unknown as AffiliateBriefing;
}
export function affiliateIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(value))
    fail('INVALID_AFFILIATE_IDENTIFIER', field);
  return value;
}
export function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(node: unknown) {
    if (node && typeof node === 'object') {
      Object.values(node).forEach(freeze);
      Object.freeze(node);
    }
  }
  freeze(copy);
  return copy;
}
function validateEvidence(value: unknown) {
  list(value, 'evidence');
  const map = new Map<string, AffiliateEvidence>();
  value.forEach((item, index) => {
    exact(item, ['id', 'kind', 'sourceRef', 'recordedAt'], `evidence.${index}`);
    const id = affiliateIdentifier(item.id, 'evidence.id');
    if (map.has(id)) fail('DUPLICATE_AFFILIATE_VALUE', 'evidence.id');
    if (
      !['PRODUCT_SPECIFICATION', 'MEDIA_USAGE_RIGHT'].includes(
        item.kind as string,
      )
    )
      fail('INVALID_AFFILIATE_EVIDENCE_KIND', 'kind');
    text(item.sourceRef, 'sourceRef');
    if (
      typeof item.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        item.recordedAt,
      ) ||
      !Number.isFinite(Date.parse(item.recordedAt))
    )
      fail('INVALID_AFFILIATE_TIMESTAMP', 'recordedAt');
    map.set(id, item as unknown as AffiliateEvidence);
  });
  return map;
}
function validateAttributes(
  value: unknown,
  evidence: Map<string, AffiliateEvidence>,
) {
  list(value, 'attributes');
  const names = new Set<string>();
  value.forEach((item, index) => {
    exact(item, ['name', 'value', 'evidenceRef'], `attributes.${index}`);
    text(item.name, 'attribute.name');
    text(item.value, 'attribute.value');
    unique(names, item.name, 'attribute.name');
    if (/(?:price|pre[çc]o|valor monet[aá]rio)/i.test(item.name))
      fail('AFFILIATE_DYNAMIC_PRICE_UNSUPPORTED', 'attributes');
    rejectAffiliateDynamicPrice(item.value, 'attributes');
    reference(evidence, item.evidenceRef, 'PRODUCT_SPECIFICATION');
  });
}
function reference(
  map: Map<string, AffiliateEvidence>,
  ref: unknown,
  kind: AffiliateEvidence['kind'],
) {
  const id = affiliateIdentifier(ref, 'evidenceRef');
  if (map.get(id)?.kind !== kind)
    fail('AFFILIATE_EVIDENCE_MISSING', 'evidenceRef');
}
function exact(
  value: unknown,
  fields: string[],
  path: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_AFFILIATE_TYPE', path);
  for (const key of Object.keys(value))
    if (!fields.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of fields)
    if (!Object.hasOwn(value, key)) fail('REQUIRED_FIELD', `${path}.${key}`);
}
function text(
  value: unknown,
  field: string,
  max = 4000,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i.test(value)
  )
    fail('INVALID_AFFILIATE_TEXT', field);
}
function https(value: unknown) {
  text(value, 'affiliateUrl');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('INVALID_AFFILIATE_URL', 'affiliateUrl');
  }
  if (
    !value.startsWith('https://') ||
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password
  )
    fail('INVALID_AFFILIATE_URL', 'affiliateUrl');
}
function revision(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    fail('INVALID_AFFILIATE_REVISION', field);
}
function schema(value: unknown, expected: string) {
  if (value !== expected) fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
}
function list(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200)
    fail('INVALID_AFFILIATE_LIST', field);
}
function unique(set: Set<string>, value: string, field: string) {
  if (set.has(value)) fail('DUPLICATE_AFFILIATE_VALUE', field);
  set.add(value);
}
function stableJson(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
function fail(code: string, field: string): never {
  throw new ContractValidationError(code, field, 'contrato afiliado inválido');
}
