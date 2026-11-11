import { assertMediaProcessingRights } from '../domain/media-processing-rights.js';
import type { AffiliateEvidence } from '../../affiliate/domain/affiliate-contracts.js';
import { p4Fail } from '../domain/p4-qc-contracts.js';

// Resolve from persisted run/acquisition bindings; never from the review body.
// Legacy unrestricted rights retain their existing meaning. Operation-only test
// grants still cannot approve final media or escape into a campaign permission.
export function campaignReviewRights(
  repository: any,
  asset: any,
  reference: any,
) {
  const candidates = [asset, reference];
  const scoped = candidates
    .flatMap((candidate) => candidate.rights.evidence ?? [])
    .map((e) => e.mediaAuthorization)
    .find((a) => a?.campaignId !== undefined);
  let scope: {
    campaignId: string;
    operationScope: string;
    purpose: string;
  } | null = null;
  if (scoped) {
    const binding = repository.db
      .prepare(
        'SELECT campaign_id FROM affiliate_run_bindings WHERE pipeline_run_id=?',
      )
      .get(asset.pipelineRunId);
    const acquisition = repository.getMediaAcquisition(scoped.operationScope);
    const acquired = acquisition?.mediaAsset;
    let ancestor = asset;
    const seen = new Set<string>();
    while (ancestor && ancestor.mediaAssetId !== acquired?.mediaAssetId) {
      if (seen.has(ancestor.mediaAssetId))
        p4Fail('HUMAN_APPROVAL_RIGHTS_SCOPE_MISMATCH');
      seen.add(ancestor.mediaAssetId);
      ancestor = ancestor.supersedesMediaAssetId
        ? repository.getMediaAsset(ancestor.supersedesMediaAssetId)
        : null;
    }
    if (
      !binding ||
      !acquired ||
      !ancestor ||
      binding.campaign_id !== scoped.campaignId ||
      acquired.assetType !== 'VIDEO' ||
      [
        'pipelineRunId',
        'projectId',
        'projectVersion',
        'scriptId',
        'scriptContentHash',
        'visualDirectionPosition',
        'contentHash',
      ].some((field) => acquired[field] !== asset[field]) ||
      [
        'pipelineRunId',
        'projectId',
        'projectVersion',
        'scriptId',
        'scriptContentHash',
      ].some((field) => reference[field] !== asset[field])
    )
      p4Fail('HUMAN_APPROVAL_RIGHTS_SCOPE_MISMATCH');
    scope = {
      campaignId: binding.campaign_id,
      operationScope: scoped.operationScope,
      purpose: 'HUMAN_QC_REVIEW',
    };
    for (const candidate of candidates)
      if (
        repository.db
          .prepare(
            'SELECT 1 FROM media_assets WHERE supersedes_media_asset_id=? LIMIT 1',
          )
          .get(candidate.mediaAssetId)
      )
        p4Fail('HUMAN_APPROVAL_REVIEW_STALE');
  }
  for (const candidate of candidates) {
    if (!candidate.rights.commercialUseAllowed)
      p4Fail('COMMERCIAL_USE_REQUIRED');
    const identity = {
      mediaRef: candidate.mediaReference,
      contentHash: candidate.contentHash,
    };
    const matching = candidate.rights.evidence?.filter(
      (e: AffiliateEvidence) =>
        e.mediaAuthorization?.mediaRef === identity.mediaRef &&
        e.mediaAuthorization?.contentHash === identity.contentHash,
    );
    if (
      !matching?.length ||
      matching.some(
        (e: AffiliateEvidence) =>
          e.mediaAuthorization?.operationScope !== undefined &&
          e.mediaAuthorization?.campaignId === undefined,
      )
    )
      p4Fail('MEDIA_PROCESSING_RIGHTS_REQUIRED');
    assertMediaProcessingRights(
      candidate.rights.evidence,
      identity,
      null,
      scope?.operationScope,
      scope ?? undefined,
    );
  }
  assertMediaProcessingRights(
    reference.rights.evidence,
    { mediaRef: reference.mediaReference, contentHash: reference.contentHash },
    'fal_ai',
    scope?.operationScope,
    scope ?? undefined,
  );
  return scope;
}
