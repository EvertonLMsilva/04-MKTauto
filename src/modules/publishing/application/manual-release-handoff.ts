import { distributionFail } from '../domain/manual-distribution-contracts.js';
import {
  facebookCaption,
  instagramCaption,
} from '../domain/social-publication-contracts.js';

// The caller reuses ManualDistributionService's exact-package gates. Return only
// operator data, never complete QC, rights evidence, grant or provider payloads.
export function manualReleaseHandoff(pkg: any, review: any) {
  if (
    pkg.qualityControl?.evidence?.publicationAuthorization?.grant?.scope
      ?.mode === 'fake'
  )
    distributionFail('DISTRIBUTION_FAKE_ONLY');
  if (
    typeof pkg.mediaReference !== 'string' ||
    !/^render:sha256_[a-f0-9]{64}$/.test(pkg.mediaReference)
  )
    distributionFail('DISTRIBUTION_MEDIA_REFERENCE_INVALID');
  return {
    schemaVersion: 'manual-release-handoff/1.0.0' as const,
    packageHash: pkg.contentHash as string,
    destination: {
      platform: pkg.platform as string,
      account: pkg.account as string,
    },
    project: {
      projectId: pkg.identity.projectId as string,
      projectVersion: pkg.identity.projectVersion as number,
      pipelineRunId: pkg.identity.pipelineRunId as string,
    },
    offer: {
      campaignId: pkg.campaignId as string,
      campaignRevision: pkg.campaignRevision as number,
      campaignHash: pkg.campaignHash as string,
      productId: pkg.productId as string,
      productRevision: pkg.productRevision as number,
      productHash: pkg.productHash as string,
    },
    video: {
      videoRenderId: pkg.identity.videoRenderId as string,
      revision: pkg.identity.videoRenderRevision as number,
      sha256: pkg.identity.videoRenderContentHash as string,
      mediaReference: pkg.mediaReference as string,
    },
    caption: pkg.caption as string,
    cta: pkg.cta as string,
    disclosure: pkg.disclosure as string,
    affiliateUrl: pkg.link as string,
    // Same deterministic formatter already used by GET package and official
    // publishing. It concatenates the approved fields verbatim, without AI.
    finalCaption: (pkg.platform === 'facebook'
      ? facebookCaption(pkg)
      : instagramCaption(pkg)) as string,
    qualityControl: {
      reportId: pkg.identity.qualityControlReportId as string,
      contentHash: pkg.identity.qualityControlReportContentHash as string,
      result: 'PASS' as const,
    },
    approval: {
      decision: 'APPROVED' as const,
      reviewHash: review.contentHash as string,
      decisionId: review.mediaDecision.humanApprovalDecisionId as string,
      revoked: false,
    },
    eligibility: { status: 'PASS' as const, pending: [] as string[] },
    publicationStatus: 'NOT_CONFIRMED_BY_HANDOFF' as const,
    recording: {
      publicationEndpoint: '/publishing/manual-publications',
      resultsEndpoint: '/publishing/results',
    },
  };
}
export type ManualReleaseHandoff = ReturnType<typeof manualReleaseHandoff>;
