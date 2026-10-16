import {
  affiliateHash,
  validateAffiliateProduct,
  affiliateBrandName,
} from '../../src/affiliate/domain/affiliate-contracts.js';
import { validateAffiliateDiscovery } from '../../src/affiliate/domain/affiliate-discovery.js';
import { product } from './affiliate-fixture.js';
export const discoveryAt = '2026-10-13T12:00:00Z';
const proof = (subject: unknown) => ({
  sourceRef: 'authorization_fixture',
  recordedAt: discoveryAt,
  subjectHash: affiliateHash(subject),
});
export function discoveryCandidate(id = 'item_001') {
  const p = validateAffiliateProduct(
    product({
      name: 'Organizador de casa',
      media: [1, 2, 3].map((n) => ({
        mediaRef: `media:sha256_${String(n).repeat(64)}`,
        evidenceRef: 'ev_rights',
      })),
    }),
  );
  const materials = [1, 2, 3].map((n) => ({
    assetType: n === 2 ? 'VIDEO' : 'IMAGE',
    technicalProperties: {
      format: n === 2 ? 'mp4' : 'png',
      widthPixels: 90,
      heightPixels: 160,
      durationMilliseconds: n === 2 ? 5000 : null,
    },
    contentHash: String(n).repeat(64),
    mediaReference: p.media[n - 1].mediaRef,
    origin: 'OPERATOR_OWNED',
    provider: null,
    rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
  }));
  const affiliateUrl = `https://s.shopee.com.br/${id}`;
  return validateAffiliateDiscovery({
    schemaVersion: 'affiliate-discovery/1.0.0',
    sourceId: 'shopee_feed',
    sourceType: 'AUTHORIZED_CSV',
    externalProductId: id,
    productName: p.name,
    brand: affiliateBrandName(p),
    category: 'organizacao',
    affiliateUrl,
    affiliateAssociationEvidence: {
      status: 'VERIFIED',
      evidence: proof({ externalProductId: id, affiliateUrl }),
    },
    price: { status: 'UNKNOWN', amount: null, evidence: null },
    currency: null,
    observedAt: null,
    availability: {
      status: 'VERIFIED',
      value: 'AVAILABLE',
      evidence: proof({ externalProductId: id, value: 'AVAILABLE' }),
    },
    mediaRightsEvidence: {
      status: 'VERIFIED',
      materials,
      evidence: proof({ materials, media: p.media }),
    },
    productSpecificationEvidence: {
      status: 'VERIFIED',
      product: p,
      evidence: proof(p),
    },
    provenance: {
      sourceHash: 'a'.repeat(64),
      rowNumber: 2,
      authorizationRef: 'authorized_fixture',
      obtainedAt: discoveryAt,
    },
    eligibilityStatus: 'UNKNOWN',
    eligibilityReasons: [],
  });
}
