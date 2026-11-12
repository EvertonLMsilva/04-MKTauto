import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import {
  effectiveImageReview,
  validateImageReview,
} from './domain/manual-image-review-contracts.js';

function fixture() {
  const body = {
    schemaVersion: 'manual-image-review/1.0.0',
    decisionId: 'image_review_fixture',
    actor: 'fixture_reviewer',
    packageHash: 'a'.repeat(64),
    imageArtifactId: 'fixture_image',
    imageContentHash: 'b'.repeat(64),
    qualityControlHash: 'c'.repeat(64),
    decision: 'APPROVED',
    reviewedAt: '2026-11-12T12:00:00Z',
    revoked: false,
  };
  return { ...body, contentHash: affiliateHash(body) };
}
test('exact legacy contract, independent identity, immutable and deterministic effective hash', () => {
  const review = validateImageReview(fixture());
  expect(review.decisionId).not.toBe(review.packageHash);
  expect(Object.isFrozen(review)).toBe(true);
  const revoked = effectiveImageReview(review, true);
  expect(revoked.contentHash).toBe(affiliateHash(revoked));
  expect(revoked.contentHash).not.toBe(review.contentHash);
  expect(effectiveImageReview(review, true)).toEqual(revoked);
  expect(review.revoked).toBe(false);
});
test.each([
  'actor',
  'packageHash',
  'imageArtifactId',
  'imageContentHash',
  'qualityControlHash',
  'decision',
  'reviewedAt',
  'revoked',
])('rejects mutated %s', (field) => {
  expect(() =>
    validateImageReview({ ...fixture(), [field]: 'changed' }),
  ).toThrow();
});
test('rejects extra keys and flag-only revocation retaining stale hash', () => {
  expect(() =>
    validateImageReview({ ...fixture(), actorId: 'self_declared' }),
  ).toThrow();
  expect(() => validateImageReview({ ...fixture(), revoked: true })).toThrow(
    'IMAGE_REVIEW_HASH_MISMATCH',
  );
});
