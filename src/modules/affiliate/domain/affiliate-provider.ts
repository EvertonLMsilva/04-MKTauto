import { affiliateIdentifier, immutable } from './affiliate-contracts.js';

// Transient provider observations. These are not registered products, evidence,
// approvals or a replacement for the existing Affiliate/Discovery repositories.
export interface AffiliateMoney {
  amount: string | null;
  currency: string | null;
}
export interface AffiliateObservation {
  providerId: string;
  mode: 'LIVE' | 'FAKE' | 'LOCAL';
  observedAt: string | null;
  sourceReference: string | null;
  fixtureVersion: string | null;
}
export interface AffiliateMediaReference {
  providerId: string;
  externalProductId: string;
  kind: 'IMAGE';
  url: string;
  rightsStatus: 'NOT_EVALUATED';
  evidenceReferences: readonly string[];
  provenance: AffiliateObservation;
}
export interface ExternalAffiliateOffer {
  schemaVersion: 'affiliate-external-offer/1.0.0';
  providerId: string;
  // A provider-local correlation, not necessarily a remote offer identifier.
  offerReference: string;
  product: {
    externalProductId: string;
    name: string | null;
    description: string | null;
    url: string | null;
  };
  store: { externalStoreId: string | null; name: string | null };
  price: AffiliateMoney;
  priceRange: { min: AffiliateMoney; max: AffiliateMoney };
  estimatedCommission: AffiliateMoney & {
    rate: string | null;
    classification: 'ESTIMATE';
  };
  availability: 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';
  reportedAffiliateUrl: string | null;
  linkAssociationStatus: 'NOT_VERIFIED';
  mediaReferences: readonly AffiliateMediaReference[];
  provenance: AffiliateObservation;
}
export interface AffiliateLinkInput {
  externalProductId: string;
  offerReference: string;
  originUrl: string;
  subIds?: readonly string[];
}
export interface AffiliateGeneratedLink {
  providerId: string;
  externalProductId: string;
  offerReference: string;
  originUrl: string;
  url: string;
  subIds: readonly string[] | null;
  associationVerified: false;
  evidenceReferences: readonly string[];
  provenance: AffiliateObservation;
}
export type AffiliateCapability =
  | 'offerLookup'
  | 'linkGeneration'
  | 'mediaReferences'
  | 'conversions'
  | 'realizedCommissions';

function responseFail(): never {
  throw new Error('AFFILIATE_PROVIDER_RESPONSE_INVALID');
}
function exact(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    responseFail();
}
const text = (value: unknown) =>
  value === null ||
  (typeof value === 'string' &&
    value.length <= 4096 &&
    !Array.from(value).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    ));
function https(value: unknown, nullable = true) {
  if (value === null && nullable) return;
  if (
    typeof value !== 'string' ||
    !text(value) ||
    !value.startsWith('https://') ||
    /\s|\\/.test(value)
  )
    responseFail();
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password)
      responseFail();
    for (const key of url.searchParams.keys())
      if (
        /^(token|access_token|secret|credential|signature|authorization|password|api_key)$/i.test(
          key,
        )
      )
        responseFail();
  } catch {
    responseFail();
  }
}
function observation(value: AffiliateObservation, providerId: string) {
  exact(value, [
    'providerId',
    'mode',
    'observedAt',
    'sourceReference',
    'fixtureVersion',
  ]);
  if (
    value.providerId !== providerId ||
    !['LIVE', 'FAKE', 'LOCAL'].includes(value.mode) ||
    !(
      value.observedAt === null ||
      (typeof value.observedAt === 'string' &&
        Number.isFinite(Date.parse(value.observedAt)))
    ) ||
    !text(value.sourceReference) ||
    !text(value.fixtureVersion)
  )
    responseFail();
}
function references(value: readonly string[]) {
  if (
    !Array.isArray(value) ||
    new Set(value).size !== value.length ||
    value.some(
      (entry) => typeof entry !== 'string' || !entry.trim() || !text(entry),
    )
  )
    responseFail();
}
export function validateAffiliateProviderLinkInput(
  input: AffiliateLinkInput,
): AffiliateLinkInput {
  const keys = ['externalProductId', 'offerReference', 'originUrl'];
  if (input && Object.hasOwn(input, 'subIds')) keys.push('subIds');
  exact(input, keys);
  externalAffiliateKey('provider_input', 'PRODUCT', input.externalProductId);
  externalAffiliateKey('provider_input', 'OFFER', input.offerReference);
  https(input.originUrl, false);
  if (
    input.subIds !== undefined &&
    (!Array.isArray(input.subIds) ||
      input.subIds.some((value) => typeof value !== 'string' || !text(value)))
  )
    responseFail();
  return immutable(structuredClone(input));
}
export function validateAffiliateProviderLink(
  link: AffiliateGeneratedLink,
  providerId: string,
  input: AffiliateLinkInput,
): AffiliateGeneratedLink {
  exact(link, [
    'providerId',
    'externalProductId',
    'offerReference',
    'originUrl',
    'url',
    'subIds',
    'associationVerified',
    'evidenceReferences',
    'provenance',
  ]);
  if (
    link.providerId !== providerId ||
    link.externalProductId !== input.externalProductId ||
    link.offerReference !== input.offerReference ||
    link.originUrl !== input.originUrl ||
    link.associationVerified !== false ||
    JSON.stringify(link.subIds) !== JSON.stringify(input.subIds ?? null)
  )
    responseFail();
  https(link.url, false);
  observation(link.provenance, providerId);
  references(link.evidenceReferences);
  return immutable(structuredClone(link));
}

export function externalAffiliateKey(
  providerId: string,
  kind: 'PRODUCT' | 'STORE' | 'OFFER',
  externalId: string,
) {
  affiliateIdentifier(providerId, 'providerId');
  if (
    !['PRODUCT', 'STORE', 'OFFER'].includes(kind) ||
    typeof externalId !== 'string' ||
    !externalId.trim() ||
    externalId.length > 1000 ||
    Array.from(externalId).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    )
  )
    throw new Error('AFFILIATE_EXTERNAL_ID_INVALID');
  // Tuple encoding preserves opaque IDs and prevents delimiter/provider collisions.
  return JSON.stringify([providerId, kind, externalId]);
}

export function validateExternalAffiliateOffer(
  offer: ExternalAffiliateOffer,
  providerId: string,
  externalProductId?: string,
): ExternalAffiliateOffer {
  const fail = (): never => {
    throw new Error('AFFILIATE_PROVIDER_RESPONSE_INVALID');
  };
  exact(offer, [
    'schemaVersion',
    'providerId',
    'offerReference',
    'product',
    'store',
    'price',
    'priceRange',
    'estimatedCommission',
    'availability',
    'reportedAffiliateUrl',
    'linkAssociationStatus',
    'mediaReferences',
    'provenance',
  ]);
  if (
    !offer ||
    offer.schemaVersion !== 'affiliate-external-offer/1.0.0' ||
    offer.providerId !== providerId ||
    offer.provenance?.providerId !== providerId ||
    typeof offer.product?.externalProductId !== 'string' ||
    (externalProductId !== undefined &&
      offer.product.externalProductId !== externalProductId) ||
    !['LIVE', 'FAKE', 'LOCAL'].includes(offer.provenance.mode) ||
    !['UNKNOWN', 'AVAILABLE', 'UNAVAILABLE'].includes(offer.availability) ||
    offer.linkAssociationStatus !== 'NOT_VERIFIED' ||
    offer.estimatedCommission?.classification !== 'ESTIMATE' ||
    !Array.isArray(offer.mediaReferences)
  )
    fail();
  observation(offer.provenance, providerId);
  exact(offer.product, ['externalProductId', 'name', 'description', 'url']);
  exact(offer.store, ['externalStoreId', 'name']);
  exact(offer.priceRange, ['min', 'max']);
  if (
    !text(offer.product.name) ||
    !text(offer.product.description) ||
    !text(offer.store.name)
  )
    fail();
  https(offer.product.url);
  https(offer.reportedAffiliateUrl);
  externalAffiliateKey(providerId, 'PRODUCT', offer.product.externalProductId);
  externalAffiliateKey(providerId, 'OFFER', offer.offerReference);
  if (offer.store.externalStoreId !== null) {
    if (typeof offer.store.externalStoreId !== 'string') fail();
    externalAffiliateKey(providerId, 'STORE', offer.store.externalStoreId);
  }
  const decimal = (value: unknown) =>
    value === null ||
    (typeof value === 'string' && /^\d{1,40}(?:\.\d{1,40})?$/.test(value));
  for (const money of [
    offer.price,
    offer.priceRange?.min,
    offer.priceRange?.max,
    offer.estimatedCommission,
  ]) {
    exact(
      money,
      money === offer.estimatedCommission
        ? ['amount', 'currency', 'rate', 'classification']
        : ['amount', 'currency'],
    );
    if (
      !money ||
      !decimal(money.amount) ||
      !(
        money.currency === null ||
        (typeof money.currency === 'string' &&
          /^[A-Z]{3}$/.test(money.currency))
      )
    )
      fail();
  }
  if (!decimal(offer.estimatedCommission.rate)) fail();
  for (const media of offer.mediaReferences) {
    exact(media, [
      'providerId',
      'externalProductId',
      'kind',
      'url',
      'rightsStatus',
      'evidenceReferences',
      'provenance',
    ]);
    if (
      media.providerId !== providerId ||
      media.externalProductId !== offer.product.externalProductId ||
      media.kind !== 'IMAGE' ||
      media.rightsStatus !== 'NOT_EVALUATED' ||
      media.provenance?.providerId !== providerId ||
      !Array.isArray(media.evidenceReferences)
    )
      fail();
    https(media.url, false);
    observation(media.provenance, providerId);
    references(media.evidenceReferences);
  }
  return immutable(structuredClone(offer));
}
