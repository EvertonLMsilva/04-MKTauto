import { affiliateIdentifier, immutable } from './affiliate-contracts.js';
import { validateShopeeUrl } from './shopee-link-url.js';

export type ProjectLiveCostBasis =
  | 'NO_CHARGE_CONFIRMED'
  | 'PROVISIONAL_NO_CHARGE_ASSUMPTION_OPERATOR_ACCEPTED'
  | 'UNKNOWN';
export interface ProjectDiscoveryIdentity {
  projectId: string;
  projectVersion: number;
  occurrenceId: string;
}
interface CommonScope extends ProjectDiscoveryIdentity {
  authorizationId: string;
  notBefore: string;
  expiresAt: string;
  evidenceRef: string;
  costBasis: ProjectLiveCostBasis;
  costEvidenceRef: string | null;
}
export interface ProjectDiscoveryAuthorization extends CommonScope {
  schemaVersion: 'shopee-project-discovery-authorization/1.0.0';
  kind: 'PROJECT_DISCOVERY_AUTHORIZATION';
  configurationHash: string;
  maxOfferPages: number;
  maxLinks: 0;
}
export interface SelectedOfferLinkAuthorization extends CommonScope {
  schemaVersion: 'shopee-selected-offer-link-authorization/1.0.0';
  kind: 'SELECTED_OFFER_LINK_AUTHORIZATION';
  configurationHash: string;
  snapshotHash: string;
  productId: string;
  shopId: string;
  offerId: string;
  originUrl: string;
  subIds: string[];
  selectionHash: string;
  requestHash: string;
  productRevision: number;
  productHash: string;
  mediaBindingHash: string;
  commercialApprovalHash: string;
  rightsEvidenceRefs: string[];
  operatorId: string;
  maxOfferPages: 0;
  maxLinks: 1;
}
export type LinkAuthorizationDraft = Pick<
  SelectedOfferLinkAuthorization,
  | 'authorizationId'
  | 'notBefore'
  | 'expiresAt'
  | 'evidenceRef'
  | 'costBasis'
  | 'costEvidenceRef'
  | 'operatorId'
>;

function fail(): never {
  throw new Error('SHOPEE_PROJECT_AUTHORIZATION_INVALID');
}
function exact(
  raw: unknown,
  keys: string[],
): asserts raw is Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join(',') !== [...keys].sort().join(',')
  )
    fail();
}
function text(raw: unknown): asserts raw is string {
  if (
    typeof raw !== 'string' ||
    !raw.trim() ||
    raw.length > 1000 ||
    raw
      .split('')
      .some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
  )
    fail();
}
function revision(raw: unknown) {
  if (!Number.isSafeInteger(raw) || (raw as number) < 1) fail();
}
function hash(raw: unknown) {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) fail();
}
const common = [
  'authorizationId',
  'projectId',
  'projectVersion',
  'occurrenceId',
  'notBefore',
  'expiresAt',
  'evidenceRef',
  'costBasis',
  'costEvidenceRef',
];
function period(raw: Record<string, unknown>) {
  for (const key of ['notBefore', 'expiresAt']) {
    if (
      typeof raw[key] !== 'string' ||
      !/(Z|[+-]\d\d:\d\d)$/.test(raw[key]) ||
      !Number.isFinite(Date.parse(raw[key]))
    )
      fail();
  }
  const duration =
    Date.parse(raw.expiresAt as string) - Date.parse(raw.notBefore as string);
  // Local bound for one controlled occurrence, never a recurring permission.
  if (duration <= 0 || duration > 86400000) fail();
}
function cost(raw: Record<string, unknown>) {
  if (
    ![
      'NO_CHARGE_CONFIRMED',
      'PROVISIONAL_NO_CHARGE_ASSUMPTION_OPERATOR_ACCEPTED',
      'UNKNOWN',
    ].includes(raw.costBasis as string)
  )
    fail();
  if (raw.costEvidenceRef !== null) text(raw.costEvidenceRef);
}
function validateCommon(raw: Record<string, unknown>) {
  for (const key of ['authorizationId', 'projectId', 'occurrenceId'])
    affiliateIdentifier(raw[key], key);
  revision(raw.projectVersion);
  text(raw.evidenceRef);
  period(raw);
  cost(raw);
}
function copy<T>(raw: unknown): T {
  return immutable(JSON.parse(JSON.stringify(raw)) as T);
}
export function validateProjectDiscoveryIdentity(
  raw: unknown,
): ProjectDiscoveryIdentity {
  exact(raw, ['projectId', 'projectVersion', 'occurrenceId']);
  affiliateIdentifier(raw.projectId, 'projectId');
  affiliateIdentifier(raw.occurrenceId, 'occurrenceId');
  revision(raw.projectVersion);
  return copy(raw);
}
export function validateProjectDiscoveryAuthorization(
  raw: unknown,
): ProjectDiscoveryAuthorization {
  exact(raw, [
    ...common,
    'schemaVersion',
    'kind',
    'configurationHash',
    'maxOfferPages',
    'maxLinks',
  ]);
  validateCommon(raw);
  hash(raw.configurationHash);
  if (
    raw.schemaVersion !== 'shopee-project-discovery-authorization/1.0.0' ||
    raw.kind !== 'PROJECT_DISCOVERY_AUTHORIZATION' ||
    !Number.isSafeInteger(raw.maxOfferPages) ||
    (raw.maxOfferPages as number) < 1 ||
    (raw.maxOfferPages as number) > 10 ||
    raw.maxLinks !== 0
  )
    fail();
  return copy(raw);
}
export function validateLinkAuthorizationDraft(
  raw: unknown,
): LinkAuthorizationDraft {
  exact(raw, [
    'authorizationId',
    'notBefore',
    'expiresAt',
    'evidenceRef',
    'costBasis',
    'costEvidenceRef',
    'operatorId',
  ]);
  affiliateIdentifier(raw.authorizationId, 'authorizationId');
  affiliateIdentifier(raw.operatorId, 'operatorId');
  text(raw.evidenceRef);
  period(raw);
  cost(raw);
  return copy(raw);
}
export function validateSelectedOfferLinkAuthorization(
  raw: unknown,
): SelectedOfferLinkAuthorization {
  exact(raw, [
    ...common,
    'schemaVersion',
    'kind',
    'configurationHash',
    'snapshotHash',
    'productId',
    'shopId',
    'offerId',
    'originUrl',
    'subIds',
    'selectionHash',
    'requestHash',
    'productRevision',
    'productHash',
    'mediaBindingHash',
    'commercialApprovalHash',
    'rightsEvidenceRefs',
    'operatorId',
    'maxOfferPages',
    'maxLinks',
  ]);
  validateCommon(raw);
  if (
    raw.schemaVersion !== 'shopee-selected-offer-link-authorization/1.0.0' ||
    raw.kind !== 'SELECTED_OFFER_LINK_AUTHORIZATION' ||
    raw.maxOfferPages !== 0 ||
    raw.maxLinks !== 1
  )
    fail();
  for (const key of [
    'configurationHash',
    'snapshotHash',
    'selectionHash',
    'requestHash',
    'productHash',
    'mediaBindingHash',
    'commercialApprovalHash',
  ])
    hash(raw[key]);
  for (const key of ['productId', 'shopId'])
    if (typeof raw[key] !== 'string' || !/^\d{1,20}$/.test(raw[key])) fail();
  affiliateIdentifier(raw.operatorId, 'operatorId');
  revision(raw.productRevision);
  if (!Array.isArray(raw.subIds)) fail();
  if (
    typeof raw.offerId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(raw.offerId) ||
    raw.subIds.length > 5 ||
    raw.subIds.some(
      (id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(id),
    )
  )
    fail();
  const originUrl = validateShopeeUrl(
    raw.originUrl,
    new Set(['shopee.com.br']),
    'SHOPEE_PROJECT_AUTHORIZATION_INVALID',
    fail,
  );
  const url = new URL(originUrl);
  if (
    url.hostname !== 'shopee.com.br' ||
    url.pathname !== `/product/${String(raw.shopId)}/${String(raw.productId)}`
  )
    fail();
  if (
    !Array.isArray(raw.rightsEvidenceRefs) ||
    raw.rightsEvidenceRefs.length < 1 ||
    raw.rightsEvidenceRefs.length > 100
  )
    fail();
  raw.rightsEvidenceRefs.forEach(text);
  return copy(raw);
}
