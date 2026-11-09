import { createHash } from 'node:crypto';
import type { CampaignOperationalFacts } from '../../content-operations/application/campaign-operations.port.js';
import { adaptationHash } from '../../media/domain/media-hash.js';
import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { validateHumanApprovalDecision } from '../domain/human-approval-contracts.js';
import { distributionFail } from '../domain/manual-distribution-contracts.js';
import { socialFail } from '../domain/social-publication-contracts.js';

// The media decision ID identifies media/QC. The immutable review envelope,
// including packageHash, identifies the authorization for copy and destination.
export function assertPackageApprovalBinding(pkg: any, review: any): void {
  try {
    validateHumanApprovalDecision(review.mediaDecision);
    const { contentHash, ...body } = review;
    if (
      review.schemaVersion !== 'manual-package-review/1.0.0' ||
      review.packageHash !== pkg.contentHash ||
      affiliateHash(body) !== contentHash ||
      Object.keys(pkg.identity).some(
        (key) => pkg.identity[key] !== review.mediaDecision[key],
      )
    )
      throw Error('INVALID_PACKAGE_REVIEW');
  } catch {
    distributionFail('DISTRIBUTION_APPROVAL_BINDING_MISMATCH');
  }
}

export function assertPublicationHandoff(
  execution: CampaignOperationalFacts,
  pkg: any,
  currentQc: any,
): void {
  const fail = () => socialFail('SOCIAL_HANDOFF_MISMATCH');
  const approval = execution.stage.approval;
  try {
    validateHumanApprovalDecision(approval);
  } catch {
    fail();
  }
  if (
    !approval ||
    ['CANCELLED', 'FAILED'].includes(execution.status) ||
    approval.decision !== 'APPROVED' ||
    execution.campaignId !== pkg.campaignId ||
    execution.runId !== pkg.identity.pipelineRunId ||
    Object.keys(pkg.identity)
      .filter((key) => key !== 'qualityControlReportContentHash')
      .some((key) => approval[key] !== pkg.identity[key]) ||
    execution.stage.render?.videoRenderId !== pkg.identity.videoRenderId ||
    execution.stage.render?.contentHash !== pkg.identity.videoRenderContentHash
  )
    return fail();
  // Equal contracts retain exact equality. Only the known, versioned local-QC
  // projection below can bridge distinct report identities.
  if (
    approval.qualityControlReportContentHash ===
    pkg.identity.qualityControlReportContentHash
  )
    return;
  const historical = execution.stage.qualityControl;
  if (!historical) return fail();
  const { reportId, ...rawQc } = historical;
  const { contentHash, ...commercialBody } = currentQc;
  const rawHash = adaptationHash(rawQc);
  const findings = historical.findings as
    { code: string; status: string }[] | undefined;
  if (
    historical.policyVersion !== 'local-qc/1' ||
    historical.result !== 'PASS' ||
    historical.approvalBlocked !== false ||
    reportId !== pkg.identity.qualityControlReportId ||
    reportId !== `local_qc:${rawHash}` ||
    historical.videoRenderId !== pkg.identity.videoRenderId ||
    historical.videoRenderContentHash !== pkg.identity.videoRenderContentHash ||
    createHash('sha256').update(JSON.stringify(historical)).digest('hex') !==
      approval.qualityControlReportContentHash ||
    !Array.isArray(findings) ||
    findings.some((f) => f.status !== 'PASS') ||
    [
      'PHYSICAL_HASH',
      'VERIFIED_SUBTITLES_LINEAGE',
      'STREAMS_FORMAT_DURATION',
      'FULL_DECODE',
    ].some(
      (code) => !findings.some((f) => f.code === code && f.status === 'PASS'),
    ) ||
    currentQc.schemaVersion !== 'publication-eligibility/1.0.0' ||
    currentQc.policyVersion !== 'publication-eligibility/1' ||
    currentQc.result !== 'PASS' ||
    currentQc.approvalBlocked !== false ||
    currentQc.qualityControlReportId !== reportId ||
    currentQc.videoRenderId !== pkg.identity.videoRenderId ||
    currentQc.videoRenderContentHash !== pkg.identity.videoRenderContentHash ||
    currentQc.pipelineRunId !== pkg.identity.pipelineRunId ||
    currentQc.projectId !== pkg.identity.projectId ||
    currentQc.projectVersion !== pkg.identity.projectVersion ||
    contentHash !== pkg.identity.qualityControlReportContentHash ||
    adaptationHash(commercialBody) !== contentHash ||
    currentQc.evidence?.localQcHash !== rawHash
  )
    return fail();
}
