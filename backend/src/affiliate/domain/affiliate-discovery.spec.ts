import {
  discoveryCandidate,
  discoveryAt,
} from '../../../test/support/discovery-fixture.js';
import {
  validateAffiliateDiscovery,
  evaluateAffiliateDiscovery,
  rankAffiliateDiscovery,
  DEFAULT_AFFILIATE_DISCOVERY_POLICY as policy,
} from './affiliate-discovery.js';
import { affiliateHash } from './affiliate-contracts.js';
const legacy = await import(
  new URL(
    '../../../../src/domain/affiliate-discovery-contracts.js',
    import.meta.url,
  ).href
);
const outcome = (fn: () => unknown) => {
  try {
    return fn();
  } catch (e) {
    return { code: (e as { code?: string }).code };
  }
};
describe('discovery JS × TS segment', () => {
  it('preserves validation, UNKNOWN, eligibility, evidence and deterministic ranking', () => {
    const a = discoveryCandidate(),
      b = discoveryCandidate('item_002');
    for (const c of [
      a,
      b,
      { ...a, affiliateUrl: null },
      { ...a, category: 'other' },
      { ...a, price: { status: 'UNKNOWN', amount: '12.00', evidence: null } },
      {
        ...a,
        affiliateAssociationEvidence: { status: 'UNKNOWN', evidence: null },
      },
      {
        ...a,
        mediaRightsEvidence: { ...a.mediaRightsEvidence, status: 'UNKNOWN' },
      },
      {
        ...a,
        availability: { status: 'INVALID', value: null, evidence: null },
      },
    ]) {
      expect(outcome(() => validateAffiliateDiscovery(c))).toEqual(
        outcome(() => legacy.validateAffiliateDiscovery(c)),
      );
      expect(
        outcome(() => evaluateAffiliateDiscovery(c, policy, discoveryAt)),
      ).toEqual(
        outcome(() =>
          legacy.evaluateAffiliateDiscovery(c, policy, discoveryAt),
        ),
      );
    }
    for (const rows of [
      [b, a, a],
      [a, b],
      [a, { ...a, category: 'casa_pratica' }],
      [{ ...a, sourceId: 'another_feed' }, a],
    ]) {
      expect(rankAffiliateDiscovery(rows, policy, discoveryAt)).toEqual(
        legacy.rankAffiliateDiscovery(rows, policy, discoveryAt),
      );
      expect(
        rankAffiliateDiscovery(
          rows,
          policy,
          discoveryAt,
          new Set(['item_001']),
        ),
      ).toEqual(
        legacy.rankAffiliateDiscovery(
          rows,
          policy,
          discoveryAt,
          new Set(['item_001']),
        ),
      );
    }
  });
  it('preserves price freshness, availability, ties and policy validation', () => {
    const c = discoveryCandidate();
    const priceSubject = {
      amount: '29.90',
      currency: 'BRL',
      observedAt: '2026-10-10T12:00:00Z',
    };
    const priced = {
      ...c,
      currency: priceSubject.currency,
      observedAt: priceSubject.observedAt,
      price: {
        status: 'VERIFIED',
        amount: priceSubject.amount,
        evidence: {
          sourceRef: 'price_proof',
          recordedAt: discoveryAt,
          subjectHash: affiliateHash(priceSubject),
        },
      },
    };
    expect(
      evaluateAffiliateDiscovery(
        priced,
        { ...policy, usePriceInScript: true },
        discoveryAt,
      ),
    ).toEqual(
      legacy.evaluateAffiliateDiscovery(
        priced,
        { ...policy, usePriceInScript: true },
        discoveryAt,
      ),
    );
    for (const changed of [
      { ...policy, usePriceInScript: true },
      { ...policy, requireAvailability: false },
      { ...policy, allowedAffiliateHosts: ['example.com'] },
      { ...policy, weights: { relevance: 0, evidence: 0, availability: 0 } },
      { ...policy, maxPriceAgeHours: 0 },
      { ...policy, extra: true },
    ]) {
      expect(
        outcome(() =>
          rankAffiliateDiscovery(
            [c, discoveryCandidate('item_002')],
            changed,
            discoveryAt,
          ),
        ),
      ).toEqual(
        outcome(() =>
          legacy.rankAffiliateDiscovery(
            [c, discoveryCandidate('item_002')],
            changed,
            discoveryAt,
          ),
        ),
      );
    }
  });
  it('rejects altered proofs, future evidence and unsupported policies', () => {
    const c = discoveryCandidate();
    for (const bad of [
      { ...c, schemaVersion: 'invalid' },
      {
        ...c,
        affiliateAssociationEvidence: { status: 'VERIFIED', evidence: null },
      },
      { ...c, provenance: { ...c.provenance, rowNumber: 1 } },
      {
        ...c,
        mediaRightsEvidence: { ...c.mediaRightsEvidence, materials: [] },
      },
    ])
      expect(outcome(() => validateAffiliateDiscovery(bad))).toEqual(
        outcome(() => legacy.validateAffiliateDiscovery(bad)),
      );
    expect(
      evaluateAffiliateDiscovery(c, policy, '2026-10-12T00:00:00Z')
        .eligibilityStatus,
    ).toBe('INVALID');
    expect(
      outcome(() =>
        rankAffiliateDiscovery(
          [c],
          { ...policy, avoidUsed: false },
          discoveryAt,
        ),
      ),
    ).toEqual({ code: 'DISCOVERY_REPETITION_POLICY_UNSUPPORTED' });
    expect(Object.isFrozen(validateAffiliateDiscovery(c))).toBe(true);
  });
});
