import {
  affiliateHash,
  affiliateIdentifier,
  affiliateBrandName,
  immutable,
  validateAffiliateProduct,
} from './affiliate-contracts.js';
import { validateDiscoveryMedia } from './discovery-media-evidence.js';
import type { DiscoveryMedia } from './discovery-media-evidence.js';
import type { AffiliateProduct } from './affiliate-contracts.js';

export type DiscoveryState = 'VERIFIED' | 'UNKNOWN' | 'INVALID';
export interface DiscoveryEvidence {
  sourceRef: string;
  recordedAt: string;
  subjectHash: string;
}
interface EvidenceState {
  status: DiscoveryState;
  evidence: DiscoveryEvidence | null;
}
export interface DiscoveryCandidate {
  schemaVersion: string;
  sourceId: string;
  sourceType: string;
  externalProductId: string;
  productName: string;
  brand: string | null;
  category: string;
  affiliateUrl: string | null;
  affiliateAssociationEvidence: EvidenceState;
  price: EvidenceState & { amount: string | null };
  currency: string | null;
  observedAt: string | null;
  availability: EvidenceState & { value: 'AVAILABLE' | 'UNAVAILABLE' | null };
  mediaRightsEvidence: EvidenceState & { materials: DiscoveryMedia[] };
  productSpecificationEvidence: EvidenceState & {
    product: AffiliateProduct | null;
  };
  provenance: {
    sourceHash: string;
    rowNumber: number;
    authorizationRef: string;
    obtainedAt: string;
  };
  eligibilityStatus: DiscoveryState;
  eligibilityReasons: string[];
}
export interface DiscoveryPolicy {
  version: string;
  relevanceByCategory: Record<string, number>;
  requireAvailability: boolean;
  usePriceInScript: boolean;
  maxPriceAgeHours: number;
  weights: { relevance: number; evidence: number; availability: number };
  avoidUsed: boolean;
  allowedAffiliateHosts: readonly string[];
}
export interface RankedDiscovery {
  candidate: DiscoveryCandidate;
  score: number;
  components: { relevance: number; evidence: number; availability: number };
  reasons: string[];
  policyVersion: string;
}
export interface DiscoveryRanking {
  ranked: RankedDiscovery[];
  duplicates: {
    externalProductId: string;
    sourceId: string;
    provenance: DiscoveryCandidate['provenance'];
    reason: string;
  }[];
  rejected: { externalProductId: string; reasons: string[] }[];
}

export const AFFILIATE_DISCOVERY_VERSION = 'affiliate-discovery/1.0.0';
export const DEFAULT_AFFILIATE_DISCOVERY_POLICY: DiscoveryPolicy =
  Object.freeze({
    version: 'affiliate-ranking/1.0.0',
    relevanceByCategory: Object.freeze({ organizacao: 100, casa_pratica: 90 }),
    requireAvailability: true,
    usePriceInScript: false,
    maxPriceAgeHours: 24,
    weights: Object.freeze({ relevance: 5, evidence: 2, availability: 1 }),
    avoidUsed: true,
    allowedAffiliateHosts: Object.freeze(['s.shopee.com.br', 'shopee.com.br']),
  });
export function discoveryFail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
const states = ['VERIFIED', 'UNKNOWN', 'INVALID'];
const text = (value: unknown) =>
  typeof value === 'string' &&
  value.trim() === value &&
  value.length > 0 &&
  value.length <= 1000 &&
  !value
    .split('')
    .some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
  !/(?:bearer\s+|sk-[a-z0-9_-]{8,}|[?&](?:token|secret|credential|signature)=)/i.test(
    value,
  );
function exact(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    discoveryFail('DISCOVERY_FIELDS_INVALID');
}
function instant(value: unknown) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function verified(value: EvidenceState, subject: unknown) {
  if (!states.includes(value.status)) discoveryFail('DISCOVERY_STATE_INVALID');
  if (value.evidence !== null) {
    exact(value.evidence, ['sourceRef', 'recordedAt', 'subjectHash']);
    if (
      !text(value.evidence.sourceRef) ||
      !instant(value.evidence.recordedAt) ||
      !/^[a-f0-9]{64}$/.test(value.evidence.subjectHash ?? '')
    )
      discoveryFail('DISCOVERY_EVIDENCE_INVALID');
  }
  if (
    value.status === 'VERIFIED' &&
    (!value.evidence || value.evidence.subjectHash !== affiliateHash(subject))
  )
    discoveryFail('DISCOVERY_EVIDENCE_REQUIRED');
}
export function validateAffiliateDiscovery(raw: unknown): DiscoveryCandidate {
  const value = raw as DiscoveryCandidate;
  exact(value, [
    'schemaVersion',
    'sourceId',
    'sourceType',
    'externalProductId',
    'productName',
    'brand',
    'category',
    'affiliateUrl',
    'affiliateAssociationEvidence',
    'price',
    'currency',
    'observedAt',
    'availability',
    'mediaRightsEvidence',
    'productSpecificationEvidence',
    'provenance',
    'eligibilityStatus',
    'eligibilityReasons',
  ]);
  if (value.schemaVersion !== AFFILIATE_DISCOVERY_VERSION)
    discoveryFail('DISCOVERY_SCHEMA_INVALID');
  affiliateIdentifier(value.sourceId, 'sourceId');
  if (
    value.sourceType !== 'AUTHORIZED_CSV' ||
    !text(value.externalProductId) ||
    !text(value.productName) ||
    !text(value.category) ||
    (value.brand !== null && !text(value.brand)) ||
    (value.affiliateUrl !== null && !text(value.affiliateUrl))
  )
    discoveryFail('DISCOVERY_IDENTITY_INVALID');
  exact(value.provenance, [
    'sourceHash',
    'rowNumber',
    'authorizationRef',
    'obtainedAt',
  ]);
  if (
    !/^[a-f0-9]{64}$/.test(value.provenance.sourceHash ?? '') ||
    !Number.isSafeInteger(value.provenance.rowNumber) ||
    value.provenance.rowNumber < 2 ||
    !text(value.provenance.authorizationRef) ||
    !instant(value.provenance.obtainedAt)
  )
    discoveryFail('DISCOVERY_PROVENANCE_INVALID');
  exact(value.affiliateAssociationEvidence, ['status', 'evidence']);
  verified(value.affiliateAssociationEvidence, {
    externalProductId: value.externalProductId,
    affiliateUrl: value.affiliateUrl,
  });
  exact(value.price, ['status', 'amount', 'evidence']);
  verified(value.price, {
    amount: value.price.amount,
    currency: value.currency,
    observedAt: value.observedAt,
  });
  if (
    value.price.amount !== null &&
    (typeof value.price.amount !== 'string' ||
      !/^\d{1,10}(?:\.\d{1,2})?$/.test(value.price.amount))
  )
    discoveryFail('DISCOVERY_PRICE_INVALID');
  if (
    (value.currency !== null && !/^[A-Z]{3}$/.test(value.currency)) ||
    (value.observedAt !== null && !instant(value.observedAt)) ||
    (value.price.status === 'VERIFIED' &&
      (value.price.amount === null ||
        value.currency === null ||
        value.observedAt === null))
  )
    discoveryFail('DISCOVERY_PRICE_INVALID');
  exact(value.availability, ['status', 'value', 'evidence']);
  verified(value.availability, {
    externalProductId: value.externalProductId,
    value: value.availability.value,
  });
  if (
    ![null, 'AVAILABLE', 'UNAVAILABLE'].includes(value.availability.value) ||
    (value.availability.status === 'VERIFIED' &&
      value.availability.value === null)
  )
    discoveryFail('DISCOVERY_AVAILABILITY_INVALID');
  exact(value.productSpecificationEvidence, ['status', 'product', 'evidence']);
  verified(
    value.productSpecificationEvidence,
    value.productSpecificationEvidence.product,
  );
  const product =
    value.productSpecificationEvidence.product === null
      ? null
      : validateAffiliateProduct(value.productSpecificationEvidence.product);
  if (
    value.productSpecificationEvidence.status === 'VERIFIED' &&
    (!product ||
      product.name !== value.productName ||
      affiliateBrandName(product) !== value.brand ||
      !product.attributes.length)
  )
    discoveryFail('DISCOVERY_SPECIFICATION_INVALID');
  exact(value.mediaRightsEvidence, ['status', 'materials', 'evidence']);
  if (!Array.isArray(value.mediaRightsEvidence.materials))
    discoveryFail('DISCOVERY_MEDIA_INVALID');
  const materials = value.mediaRightsEvidence.materials.map(
    validateDiscoveryMedia,
  );
  verified(value.mediaRightsEvidence, {
    materials,
    media: product?.media ?? [],
  });
  if (
    value.mediaRightsEvidence.status === 'VERIFIED' &&
    (!product ||
      materials.length !== 3 ||
      materials.some(
        (m, i) =>
          m.assetType !== (i === 1 ? 'VIDEO' : 'IMAGE') ||
          m.provider !== null ||
          !['OPERATOR_OWNED', 'OPERATOR_LICENSED'].includes(m.origin) ||
          !product.media.some(
            (binding) => binding.mediaRef === m.mediaReference,
          ),
      ) ||
      materials[1].technicalProperties.durationMilliseconds! < 5000 ||
      materials[1].technicalProperties.durationMilliseconds! > 6000)
  )
    discoveryFail('DISCOVERY_MEDIA_RIGHTS_INVALID');
  if (
    !states.includes(value.eligibilityStatus) ||
    !Array.isArray(value.eligibilityReasons) ||
    value.eligibilityReasons.some((reason) => !/^\w{2,100}$/.test(reason))
  )
    discoveryFail('DISCOVERY_ELIGIBILITY_INVALID');
  if (
    value.eligibilityStatus === 'VERIFIED' &&
    (value.eligibilityReasons.length ||
      (
        [
          'affiliateAssociationEvidence',
          'mediaRightsEvidence',
          'productSpecificationEvidence',
        ] as const
      ).some((field) => value[field].status !== 'VERIFIED'))
  )
    discoveryFail('DISCOVERY_EVIDENCE_REQUIRED');
  return immutable(value);
}
export function validateDiscoveryPolicy(raw: unknown): DiscoveryPolicy {
  const value = raw as DiscoveryPolicy;
  exact(value, [
    'version',
    'relevanceByCategory',
    'requireAvailability',
    'usePriceInScript',
    'maxPriceAgeHours',
    'weights',
    'avoidUsed',
    'allowedAffiliateHosts',
  ]);
  exact(value.weights, ['relevance', 'evidence', 'availability']);
  if (!/^affiliate-ranking\/\d+\.\d+\.\d+$/.test(value.version ?? ''))
    discoveryFail('DISCOVERY_POLICY_VERSION_INVALID');
  if (value.avoidUsed !== true)
    discoveryFail('DISCOVERY_REPETITION_POLICY_UNSUPPORTED');
  if (
    !text(value.version) ||
    !value.relevanceByCategory ||
    typeof value.relevanceByCategory !== 'object' ||
    Array.isArray(value.relevanceByCategory) ||
    !Object.keys(value.relevanceByCategory).length ||
    Object.values(value.relevanceByCategory).some(
      (n) => !Number.isSafeInteger(n) || n < 0 || n > 100,
    ) ||
    Object.values(value.weights).some(
      (n) => !Number.isSafeInteger(n) || n < 0 || n > 100,
    ) ||
    (['requireAvailability', 'usePriceInScript', 'avoidUsed'] as const).some(
      (k) => typeof value[k] !== 'boolean',
    ) ||
    !Number.isSafeInteger(value.maxPriceAgeHours) ||
    value.maxPriceAgeHours < 1 ||
    !Array.isArray(value.allowedAffiliateHosts) ||
    !value.allowedAffiliateHosts.length ||
    value.allowedAffiliateHosts.some(
      (h) => !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(h),
    )
  )
    discoveryFail('DISCOVERY_POLICY_INVALID');
  return immutable(value);
}
export function evaluateAffiliateDiscovery(
  raw: unknown,
  rawPolicy: unknown,
  now: string,
): DiscoveryCandidate {
  const c = validateAffiliateDiscovery(raw),
    policy = validateDiscoveryPolicy(rawPolicy),
    reasons = [];
  if (!instant(now)) discoveryFail('DISCOVERY_CLOCK_INVALID');
  if (
    (
      [
        'affiliateAssociationEvidence',
        'productSpecificationEvidence',
        'mediaRightsEvidence',
        'price',
        'availability',
      ] as const
    ).some(
      (field) =>
        c[field].evidence &&
        Date.parse(c[field].evidence.recordedAt) > Date.parse(now),
    )
  )
    reasons.push('EVIDENCE_TIMESTAMP_INVALID');
  let url;
  try {
    url = new URL(c.affiliateUrl!);
  } catch {}
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !policy.allowedAffiliateHosts.includes(url.hostname) ||
    url.pathname === '/'
  )
    reasons.push('AFFILIATE_URL_INVALID');
  for (const [field, reason] of [
    ['affiliateAssociationEvidence', 'ASSOCIATION'],
    ['productSpecificationEvidence', 'SPECIFICATION'],
    ['mediaRightsEvidence', 'MEDIA_RIGHTS'],
  ] as const)
    if (c[field].status !== 'VERIFIED')
      reasons.push(`${reason}_${c[field].status}`);
  if (!(policy.relevanceByCategory[c.category] > 0))
    reasons.push('NICHE_MISMATCH');
  if (policy.requireAvailability && c.availability.status !== 'VERIFIED')
    reasons.push(`AVAILABILITY_${c.availability.status}`);
  if (
    c.availability.status === 'INVALID' ||
    (c.availability.status === 'VERIFIED' &&
      c.availability.value === 'UNAVAILABLE')
  )
    reasons.push('PRODUCT_UNAVAILABLE');
  if (policy.usePriceInScript) {
    if (c.price.status !== 'VERIFIED') reasons.push(`PRICE_${c.price.status}`);
    else if (
      Date.parse(now) - Date.parse(c.observedAt!) >
        policy.maxPriceAgeHours * 3600000 ||
      Date.parse(c.observedAt!) > Date.parse(now)
    )
      reasons.push('PRICE_STALE');
  }
  const invalid = reasons.some((reason) =>
    /INVALID|MISMATCH|UNAVAILABLE|STALE/.test(reason),
  );
  return immutable({
    ...c,
    eligibilityStatus: reasons.length
      ? invalid
        ? 'INVALID'
        : 'UNKNOWN'
      : 'VERIFIED',
    eligibilityReasons: reasons,
  });
}
export function rankAffiliateDiscovery(
  candidates: readonly unknown[],
  rawPolicy: unknown,
  now: string,
  used: ReadonlySet<string> = new Set(),
): DiscoveryRanking {
  const policy = validateDiscoveryPolicy(rawPolicy),
    groups = new Map<string, DiscoveryCandidate[]>(),
    duplicates: DiscoveryRanking['duplicates'] = [],
    rejected: DiscoveryRanking['rejected'] = [],
    ranked: RankedDiscovery[] = [];
  for (const raw of candidates) {
    const c = evaluateAffiliateDiscovery(raw, policy, now),
      key = c.externalProductId;
    const group = groups.get(key) ?? [];
    group.push(c);
    groups.set(key, group);
  }
  for (const [externalProductId, group] of groups) {
    const bodies = group.map((c) => {
      const { provenance: _provenance, sourceId: _sourceId, ...body } = c;
      return affiliateHash(body);
    });
    if (new Set(bodies).size > 1) {
      rejected.push({ externalProductId, reasons: ['CONFLICTING_DUPLICATE'] });
      continue;
    }
    const c = group.sort(
      (a, b) =>
        (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0) ||
        a.provenance.rowNumber - b.provenance.rowNumber,
    )[0];
    for (let i = 1; i < group.length; i++)
      duplicates.push({
        externalProductId,
        sourceId: group[i].sourceId,
        provenance: group[i].provenance,
        reason: 'DUPLICATE',
      });
    if (
      c.eligibilityStatus !== 'VERIFIED' ||
      (policy.avoidUsed && used.has(externalProductId))
    ) {
      rejected.push({
        externalProductId,
        reasons:
          c.eligibilityStatus !== 'VERIFIED'
            ? c.eligibilityReasons
            : ['PRODUCT_ALREADY_USED'],
      });
      continue;
    }
    const evidenceQuality = Math.min(
      100,
      new Set(
        c.productSpecificationEvidence.product!.evidence.map(
          (e) => e.sourceRef,
        ),
      ).size * 25,
    );
    const components = {
      relevance: policy.relevanceByCategory[c.category],
      evidence: evidenceQuality,
      availability:
        c.availability.status === 'VERIFIED' &&
        c.availability.value === 'AVAILABLE'
          ? 100
          : 0,
    };
    const score = Object.entries(components).reduce(
      (sum, [key, value]) =>
        sum + value * policy.weights[key as keyof DiscoveryPolicy['weights']],
      0,
    );
    ranked.push({
      candidate: c,
      score,
      components,
      reasons: [
        'NICHE_MATCH',
        'ASSOCIATION_VERIFIED',
        'MEDIA_RIGHTS_VERIFIED',
        'NOT_PREVIOUSLY_USED',
      ],
      policyVersion: policy.version,
    });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      (a.candidate.externalProductId < b.candidate.externalProductId
        ? -1
        : a.candidate.externalProductId > b.candidate.externalProductId
          ? 1
          : 0),
  );
  return immutable({ ranked, duplicates, rejected });
}
