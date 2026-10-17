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
  mediaAuthorization?: MediaAuthorization;
}
export interface MediaAuthorization {
  mediaRef: string;
  contentHash: string;
  commercialUse: 'GRANTED' | 'DENIED' | 'UNCONFIRMED';
  processing: 'GRANTED' | 'DENIED' | 'UNCONFIRMED';
  localProcessing: boolean;
  // Exact provider identities. Local permission never implies third-party transfer.
  externalProviders: string[];
  // A test-specific permission cannot authorize another operation or final production.
  operationScope?: string;
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
export interface AffiliateProductIssue {
  code: string;
  field: string;
}
type Check = (
  operation: () => void,
  path?: string,
  issueField?: string,
) => void;
const strictCheck: Check = (operation) => operation();

export function collectAffiliateProductIssues(
  value: unknown,
): AffiliateProductIssue[] {
  const issues: AffiliateProductIssue[] = [];
  checkProduct(value, (operation, path, issueField) => {
    try {
      operation();
    } catch (error) {
      if (!(error instanceof ContractValidationError)) throw error;
      const leaf = error.path.replace(/^(?:attribute|evidence)\./, '');
      const field = issueField ?? (path ? `${path}.${leaf}` : error.path);
      if (
        !issues.some(
          (issue) => issue.code === error.code && issue.field === field,
        )
      )
        issues.push({ code: error.code, field });
    }
  });
  return issues;
}
export function validateAffiliateProduct(value: unknown): AffiliateProduct {
  checkProduct(value, strictCheck);
  return immutable(value) as AffiliateProduct;
}
function checkProduct(value: unknown, check: Check) {
  check(() => exact(value, PRODUCT_FIELDS, 'product', check));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const product = value as Record<string, unknown>;
  const isV2 = product.schemaVersion === AFFILIATE_PRODUCT_V2_VERSION;
  if (!isV2)
    check(() => schema(product.schemaVersion, AFFILIATE_PRODUCT_VERSION));
  check(() => affiliateIdentifier(product.productId, 'productId'));
  check(() => revision(product.revision, 'revision'));
  check(() => text(product.name, 'name'));
  if (!isV2) check(() => text(product.brand, 'brand'));
  const evidence = validateEvidence(product.evidence, check);
  if (isV2) check(() => validateBrand(product.brand, evidence, check));
  validateAttributes(product.attributes, evidence, check);
  check(() => list(product.media, 'media'));
  const refs = new Set<string>();
  if (Array.isArray(product.media))
    product.media.forEach((media, index) => {
      check(() =>
        exact(media, ['mediaRef', 'evidenceRef'], `media.${index}`, check),
      );
      if (!media || typeof media !== 'object' || Array.isArray(media)) return;
      check(() => text(media.mediaRef, 'mediaRef'), `media.${index}`);
      check(() => unique(refs, media.mediaRef, 'mediaRef'), `media.${index}`);
      check(
        () => reference(evidence, media.evidenceRef, 'MEDIA_USAGE_RIGHT'),
        `media.${index}`,
      );
    });
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
  check: Check = strictCheck,
) {
  exact(value, ['status', 'name', 'evidenceRef'], 'brand', check);
  if (
    !['KNOWN', 'DECLARED_UNBRANDED', 'NOT_PROVIDED'].includes(
      value.status as string,
    )
  )
    check(() => fail('INVALID_AFFILIATE_BRAND_STATUS', 'brand.status'));
  if (value.status === 'KNOWN') check(() => text(value.name, 'brand.name'));
  else if (value.name !== null)
    check(() => fail('INVALID_AFFILIATE_BRAND_NAME', 'brand.name'));
  check(
    () => reference(evidence, value.evidenceRef, 'PRODUCT_SPECIFICATION'),
    'brand',
  );
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
function validateEvidence(value: unknown, check: Check = strictCheck) {
  check(() => list(value, 'evidence'));
  const map = new Map<string, AffiliateEvidence>();
  if (!Array.isArray(value)) return map;
  value.forEach((item, index) => {
    check(() =>
      exact(
        item,
        [
          'id',
          'kind',
          'sourceRef',
          'recordedAt',
          ...(Object.hasOwn(item ?? {}, 'mediaAuthorization')
            ? ['mediaAuthorization']
            : []),
        ],
        `evidence.${index}`,
        check,
      ),
    );
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    let valid = true;
    const entryCheck: Check = (operation) =>
      check(() => {
        try {
          operation();
        } catch (error) {
          valid = false;
          throw error;
        }
      }, `evidence.${index}`);
    entryCheck(() => affiliateIdentifier(item.id, 'evidence.id'));
    entryCheck(() => {
      if (map.has(item.id)) fail('DUPLICATE_AFFILIATE_VALUE', 'evidence.id');
    });
    entryCheck(() => {
      if (!['PRODUCT_SPECIFICATION', 'MEDIA_USAGE_RIGHT'].includes(item.kind))
        fail('INVALID_AFFILIATE_EVIDENCE_KIND', 'kind');
    });
    entryCheck(() => text(item.sourceRef, 'sourceRef'));
    if (Object.hasOwn(item, 'mediaAuthorization'))
      entryCheck(() => {
        if (item.kind !== 'MEDIA_USAGE_RIGHT')
          fail('INVALID_MEDIA_AUTHORIZATION', 'kind');
        const a = item.mediaAuthorization as MediaAuthorization;
        exact(
          a,
          [
            'mediaRef',
            'contentHash',
            'commercialUse',
            'processing',
            'localProcessing',
            'externalProviders',
            ...(Object.hasOwn(a ?? {}, 'operationScope') ? ['operationScope'] : []),
          ],
          'mediaAuthorization',
        );
        text(a.mediaRef, 'mediaAuthorization.mediaRef', 250);
        if (
          typeof a.contentHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(a.contentHash) ||
          !['GRANTED', 'DENIED', 'UNCONFIRMED'].includes(a.commercialUse) ||
          !['GRANTED', 'DENIED', 'UNCONFIRMED'].includes(a.processing) ||
          typeof a.localProcessing !== 'boolean' ||
          !Array.isArray(a.externalProviders) ||
          a.externalProviders.length > 100 ||
          new Set(a.externalProviders).size !== a.externalProviders.length
        )
          fail('INVALID_MEDIA_AUTHORIZATION', 'mediaAuthorization');
        a.externalProviders.forEach((provider) =>
          affiliateIdentifier(provider, 'externalProviders'),
        );
        if (a.operationScope !== undefined)
          affiliateIdentifier(a.operationScope, 'operationScope');
      });
    entryCheck(() => {
      if (
        typeof item.recordedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
          item.recordedAt,
        ) ||
        !Number.isFinite(Date.parse(item.recordedAt))
      )
        fail('INVALID_AFFILIATE_TIMESTAMP', 'recordedAt');
    });
    if (valid) map.set(item.id, item as AffiliateEvidence);
  });
  return map;
}
export function validateAffiliateEvidence(value: unknown): AffiliateEvidence {
  validateEvidence([value]);
  return immutable(value) as AffiliateEvidence;
}
function validateAttributes(
  value: unknown,
  evidence: Map<string, AffiliateEvidence>,
  check: Check = strictCheck,
) {
  check(() => list(value, 'attributes'));
  const names = new Set<string>();
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    check(() =>
      exact(
        item,
        ['name', 'value', 'evidenceRef'],
        `attributes.${index}`,
        check,
      ),
    );
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    check(() => text(item.name, 'attribute.name'), `attributes.${index}`);
    check(() => text(item.value, 'attribute.value'), `attributes.${index}`);
    check(
      () => unique(names, item.name, 'attribute.name'),
      `attributes.${index}`,
    );
    check(
      () => {
        if (
          typeof item.name === 'string' &&
          /(?:price|pre[\u00e7c]o|valor monet[a\u00e1]rio)/i.test(item.name)
        )
          fail('AFFILIATE_DYNAMIC_PRICE_UNSUPPORTED', 'attributes');
      },
      `attributes.${index}`,
      `attributes.${index}.name`,
    );
    check(
      () => {
        if (typeof item.value === 'string')
          rejectAffiliateDynamicPrice(item.value, 'attributes');
      },
      `attributes.${index}`,
      `attributes.${index}.value`,
    );
    check(
      () => reference(evidence, item.evidenceRef, 'PRODUCT_SPECIFICATION'),
      `attributes.${index}`,
    );
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
  check: Check = strictCheck,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_AFFILIATE_TYPE', path);
  for (const key of Object.keys(value))
    if (!fields.includes(key))
      check(() => fail('UNKNOWN_FIELD', `${path}.${key}`));
  for (const key of fields)
    if (!Object.hasOwn(value, key))
      check(() => fail('REQUIRED_FIELD', `${path}.${key}`));
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
