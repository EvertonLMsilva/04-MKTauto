import { validateAffiliateEvidence } from '../../affiliate/domain/affiliate-contracts.js';
import { falFailure } from '../../finance/domain/fal-errors.js';

export function validateMediaRightsEvidence(
  evidence: unknown,
  identity: { mediaRef: string; contentHash: string },
): void {
  if (!Array.isArray(evidence) || evidence.length > 300)
    throw falFailure('INVALID_MEDIA_RIGHTS_EVIDENCE');
  const ids = new Set<string>();
  for (const value of evidence) {
    const e = validateAffiliateEvidence(value);
    if (ids.has(e.id)) throw falFailure('INVALID_MEDIA_RIGHTS_EVIDENCE');
    ids.add(e.id);
    if (
      e.mediaAuthorization &&
      (e.mediaAuthorization.mediaRef !== identity.mediaRef ||
        e.mediaAuthorization.contentHash !== identity.contentHash)
    )
      throw falFailure('MEDIA_RIGHTS_IDENTITY_MISMATCH');
  }
}

/** A rights gate only; never authorizes payment, execution or temporal QC.
 * Evidence is an operator assertion backed by sourceRef, not a legal verification.
 */
export function assertMediaProcessingRights(
  evidence: unknown,
  identity: { mediaRef: string; contentHash: string },
  provider: string,
): void {
  if (!Array.isArray(evidence))
    throw falFailure('MEDIA_PROCESSING_RIGHTS_UNCONFIRMED');
  const matching = evidence
    .map(validateAffiliateEvidence)
    .filter(
      (e) =>
        e.kind === 'MEDIA_USAGE_RIGHT' &&
        e.mediaAuthorization?.mediaRef === identity.mediaRef &&
        e.mediaAuthorization.contentHash === identity.contentHash,
    )
    .map((e) => e.mediaAuthorization!);
  // Conflicting/unknown statements fail closed; no precedence is fabricated.
  if (
    !matching.length ||
    matching.some(
      (a) =>
        a.commercialUse !== 'GRANTED' ||
        a.processing !== 'GRANTED' ||
        !a.externalProviders.includes(provider),
    )
  )
    throw falFailure('MEDIA_PROCESSING_RIGHTS_UNCONFIRMED');
}
