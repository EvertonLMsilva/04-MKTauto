import { createHash } from 'node:crypto';
import { ContractValidationError } from './contracts.js';

export const AFFILIATE_PRODUCT_VERSION = 'affiliate-product/1.0.0';
export const AFFILIATE_CAMPAIGN_VERSION = 'affiliate-campaign/1.0.0';
export const AFFILIATE_BRIEFING_VERSION = 'affiliate-briefing/1.0.0';
const PRODUCT_FIELDS = ['schemaVersion', 'productId', 'revision', 'name', 'brand', 'attributes', 'media', 'evidence'];
const CAMPAIGN_FIELDS = ['schemaVersion', 'campaignId', 'revision', 'projectId', 'productId', 'productRevision', 'affiliateUrl', 'cta', 'disclosure'];
const BRIEFING_FIELDS = ['schemaVersion', 'briefingId', 'campaignId', 'campaignRevision', 'productId', 'productRevision', 'productName', 'attributes', 'mediaRefs', 'cta', 'disclosure', 'affiliateUrl', 'evidence', 'contentHash'];

export function affiliateHash(value) {
  const { contentHash: _ignored, ...content } = value;
  return createHash('sha256').update(stableJson(content)).digest('hex');
}

export function rejectAffiliateDynamicPrice(value, field) {
  if (/(?:R\$|US\$|\bBRL\b|\bUSD\b|[$€£]\s*\d|\d[\d.,]*\s*(?:reais|d[oó]lares|euros))/i.test(value)) fail('AFFILIATE_DYNAMIC_PRICE_UNSUPPORTED', field);
}

export function validateAffiliateProduct(value) {
  exact(value, PRODUCT_FIELDS, 'product');
  schema(value.schemaVersion, AFFILIATE_PRODUCT_VERSION);
  affiliateIdentifier(value.productId, 'productId');
  revision(value.revision, 'revision');
  text(value.name, 'name'); text(value.brand, 'brand');
  const evidence = validateEvidence(value.evidence);
  validateAttributes(value.attributes, evidence);
  list(value.media, 'media');
  const mediaRefs = new Set();
  value.media.forEach((media, index) => {
    exact(media, ['mediaRef', 'evidenceRef'], `media.${index}`);
    text(media.mediaRef, 'mediaRef');
    unique(mediaRefs, media.mediaRef, 'mediaRef');
    reference(evidence, media.evidenceRef, 'MEDIA_USAGE_RIGHT');
  });
  return immutable(value);
}

export function validateAffiliateCampaign(value) {
  exact(value, CAMPAIGN_FIELDS, 'campaign');
  schema(value.schemaVersion, AFFILIATE_CAMPAIGN_VERSION);
  for (const field of ['campaignId', 'projectId', 'productId']) affiliateIdentifier(value[field], field);
  revision(value.revision, 'revision'); revision(value.productRevision, 'productRevision');
  text(value.cta, 'cta', 500); text(value.disclosure, 'disclosure', 500);
  rejectAffiliateDynamicPrice(`${value.cta}\n${value.disclosure}`, 'cta');
  https(value.affiliateUrl);
  return immutable(value);
}

export function materializeAffiliateBriefing(briefingId, campaignValue, productValue) {
  affiliateIdentifier(briefingId, 'briefingId');
  const campaign = validateAffiliateCampaign(campaignValue);
  const product = validateAffiliateProduct(productValue);
  if (campaign.productId !== product.productId || campaign.productRevision !== product.revision) fail('AFFILIATE_SCOPE_MISMATCH', 'productRevision');
  const briefing = {
    schemaVersion: AFFILIATE_BRIEFING_VERSION, briefingId,
    campaignId: campaign.campaignId, campaignRevision: campaign.revision,
    productId: product.productId, productRevision: product.revision, productName: product.name,
    attributes: product.attributes, mediaRefs: product.media.map(media => media.mediaRef),
    cta: campaign.cta, disclosure: campaign.disclosure, affiliateUrl: campaign.affiliateUrl,
    evidence: product.evidence,
  };
  return validateAffiliateBriefing({ ...briefing, contentHash: affiliateHash(briefing) });
}

export function validateAffiliateBriefing(value) {
  exact(value, BRIEFING_FIELDS, 'briefing');
  schema(value.schemaVersion, AFFILIATE_BRIEFING_VERSION);
  for (const field of ['briefingId', 'campaignId', 'productId']) affiliateIdentifier(value[field], field);
  revision(value.campaignRevision, 'campaignRevision'); revision(value.productRevision, 'productRevision');
  text(value.productName, 'productName'); text(value.cta, 'cta', 500); text(value.disclosure, 'disclosure', 500);
  rejectAffiliateDynamicPrice(`${value.cta}\n${value.disclosure}`, 'cta');
  https(value.affiliateUrl);
  const evidence = validateEvidence(value.evidence);
  validateAttributes(value.attributes, evidence);
  list(value.mediaRefs, 'mediaRefs');
  const refs = new Set();
  value.mediaRefs.forEach(ref => { text(ref, 'mediaRef'); unique(refs, ref, 'mediaRef'); });
  if (![...evidence.values()].some(item => item.kind === 'MEDIA_USAGE_RIGHT')) fail('AFFILIATE_EVIDENCE_MISSING', 'mediaRefs');
  if (!/^[0-9a-f]{64}$/.test(value.contentHash) || affiliateHash(value) !== value.contentHash) fail('AFFILIATE_HASH_MISMATCH', 'contentHash');
  return immutable(value);
}

export function affiliateIdentifier(value, field) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(value)) fail('INVALID_AFFILIATE_IDENTIFIER', field);
  return value;
}
export function immutable(value) {
  const copy = structuredClone(value);
  function freeze(node) { if (node && typeof node === 'object') { Object.values(node).forEach(freeze); Object.freeze(node); } }
  freeze(copy); return copy;
}
function validateEvidence(value) {
  list(value, 'evidence');
  const map = new Map();
  value.forEach((item, index) => {
    exact(item, ['id', 'kind', 'sourceRef', 'recordedAt'], `evidence.${index}`);
    affiliateIdentifier(item.id, 'evidence.id');
    if (map.has(item.id)) fail('DUPLICATE_AFFILIATE_VALUE', 'evidence.id');
    if (!['PRODUCT_SPECIFICATION', 'MEDIA_USAGE_RIGHT'].includes(item.kind)) fail('INVALID_AFFILIATE_EVIDENCE_KIND', 'kind');
    text(item.sourceRef, 'sourceRef');
    if (typeof item.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(item.recordedAt) || !Number.isFinite(Date.parse(item.recordedAt))) fail('INVALID_AFFILIATE_TIMESTAMP', 'recordedAt');
    map.set(item.id, item);
  });
  return map;
}
function validateAttributes(value, evidence) {
  list(value, 'attributes');
  const names = new Set();
  value.forEach((item, index) => {
    exact(item, ['name', 'value', 'evidenceRef'], `attributes.${index}`);
    text(item.name, 'attribute.name'); text(item.value, 'attribute.value');
    unique(names, item.name, 'attribute.name');
    // Dynamic prices have no validity contract in P1 and cannot be advertised.
    if (/(?:price|pre[çc]o|valor monet[aá]rio)/i.test(item.name)) fail('AFFILIATE_DYNAMIC_PRICE_UNSUPPORTED', 'attributes');
    rejectAffiliateDynamicPrice(item.value, 'attributes');
    reference(evidence, item.evidenceRef, 'PRODUCT_SPECIFICATION');
  });
}
function reference(map, ref, kind) {
  affiliateIdentifier(ref, 'evidenceRef');
  if (map.get(ref)?.kind !== kind) fail('AFFILIATE_EVIDENCE_MISSING', 'evidenceRef');
}
function exact(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_AFFILIATE_TYPE', path);
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of fields) if (!Object.hasOwn(value, key)) fail('REQUIRED_FIELD', `${path}.${key}`);
}
function text(value, field, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i.test(value)) fail('INVALID_AFFILIATE_TEXT', field);
}
function https(value) {
  text(value, 'affiliateUrl');
  let url;
  try { url = new URL(value); } catch { fail('INVALID_AFFILIATE_URL', 'affiliateUrl'); }
  if (!value.startsWith('https://') || url.protocol !== 'https:' || !url.hostname || url.username || url.password) fail('INVALID_AFFILIATE_URL', 'affiliateUrl');
}
function revision(value, field) { if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_AFFILIATE_REVISION', field); }
function schema(value, expected) { if (value !== expected) fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion'); }
function list(value, field) { if (!Array.isArray(value) || value.length < 1 || value.length > 200) fail('INVALID_AFFILIATE_LIST', field); }
function unique(set, value, field) { if (set.has(value)) fail('DUPLICATE_AFFILIATE_VALUE', field); set.add(value); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function fail(code, field) { throw new ContractValidationError(code, field, 'contrato afiliado inválido'); }
