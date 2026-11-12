export type ManualReadinessStatus =
  | 'READY_FOR_OPERATOR_HANDOFF'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_REVOKED'
  | 'QC_BLOCKED'
  | 'MEDIA_MISMATCH'
  | 'RIGHTS_REQUIRED'
  | 'FAKE_ONLY'
  | 'PACKAGE_NOT_FOUND'
  | 'UNKNOWN';
type Check = 'PASS' | 'BLOCKED' | 'UNKNOWN';
const initialChecks = () => ({
  integrity: 'UNKNOWN' as Check,
  mediaIntegrity: 'UNKNOWN' as Check,
  qc: 'UNKNOWN' as Check,
  approval: 'UNKNOWN' as Check,
  rights: 'UNKNOWN' as Check,
  physicalEvidence: 'UNKNOWN' as Check,
  eligibility: 'UNKNOWN' as Check,
});
const reasons: Record<
  string,
  {
    status: ManualReadinessStatus;
    check: keyof ReturnType<typeof initialChecks>;
    action: string;
  }
> = {
  DISTRIBUTION_PACKAGE_NOT_FOUND: {
    status: 'PACKAGE_NOT_FOUND',
    check: 'integrity',
    action: 'SELECT_EXISTING_PACKAGE',
  },
  DISTRIBUTION_INVALID_HASH: {
    status: 'UNKNOWN',
    check: 'integrity',
    action: 'SELECT_EXACT_PACKAGE',
  },
  DISTRIBUTION_PERSISTED_INTEGRITY: {
    status: 'UNKNOWN',
    check: 'integrity',
    action: 'REVIEW_PACKAGE_INTEGRITY',
  },
  DISTRIBUTION_CAMPAIGN_CHANGED: {
    status: 'UNKNOWN',
    check: 'eligibility',
    action: 'REVIEW_FROZEN_OFFER',
  },
  DISTRIBUTION_DEMO_INELIGIBLE: {
    status: 'UNKNOWN',
    check: 'eligibility',
    action: 'SELECT_ELIGIBLE_PACKAGE',
  },
  DISTRIBUTION_APPROVAL_REQUIRED: {
    status: 'APPROVAL_REQUIRED',
    check: 'approval',
    action: 'REVIEW_EXACT_ARTIFACT',
  },
  DISTRIBUTION_APPROVAL_REVOKED: {
    status: 'APPROVAL_REVOKED',
    check: 'approval',
    action: 'REVIEW_REVOKED_APPROVAL',
  },
  DISTRIBUTION_APPROVAL_BINDING_MISMATCH: {
    status: 'UNKNOWN',
    check: 'approval',
    action: 'REVIEW_EXACT_APPROVAL_BINDING',
  },
  DISTRIBUTION_QC_FAILED: {
    status: 'QC_BLOCKED',
    check: 'qc',
    action: 'REVIEW_QUALITY_CONTROL',
  },
  DISTRIBUTION_QC_BINDING_MISMATCH: {
    status: 'QC_BLOCKED',
    check: 'qc',
    action: 'REVIEW_EXACT_QUALITY_CONTROL',
  },
  DISTRIBUTION_MEDIA_CHANGED: {
    status: 'MEDIA_MISMATCH',
    check: 'mediaIntegrity',
    action: 'VERIFY_EXACT_MEDIA',
  },
  DISTRIBUTION_MEDIA_REFERENCE_INVALID: {
    status: 'MEDIA_MISMATCH',
    check: 'mediaIntegrity',
    action: 'VERIFY_EXACT_MEDIA',
  },
  DISTRIBUTION_RIGHTS_REQUIRED: {
    status: 'RIGHTS_REQUIRED',
    check: 'rights',
    action: 'DOCUMENT_REQUIRED_RIGHTS',
  },
  DISTRIBUTION_DESTINATION_RIGHTS_REQUIRED: {
    status: 'RIGHTS_REQUIRED',
    check: 'rights',
    action: 'REVIEW_DESTINATION_RIGHTS',
  },
  DISTRIBUTION_FAKE_ONLY: {
    status: 'FAKE_ONLY',
    check: 'eligibility',
    action: 'SELECT_OPERATIONALLY_ELIGIBLE_PACKAGE',
  },
  SOCIAL_CAPTION_INVALID: {
    status: 'UNKNOWN',
    check: 'eligibility',
    action: 'REVIEW_APPROVED_COPY',
  },
};
const identifier = (v: unknown) =>
  typeof v === 'string' && /^[a-zA-Z0-9_:.-]{1,250}$/.test(v) ? v : null;
const digest = (v: unknown) =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : null;
const revision = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;

// Diagnostic orchestration only. All distribution, rights, QC and approval
// decisions come from the existing exact-package handoff; errors are allowlisted.
export function manualReleaseReadiness(
  packageHash: string,
  loadPackage: () => any,
  handoff: () => unknown,
) {
  let pkg: any = null;
  let status: ManualReadinessStatus = 'UNKNOWN';
  let nextAction = 'REVIEW_REQUIRED_EVIDENCE';
  let blockerCodes: string[] = [];
  const checks = initialChecks();
  try {
    pkg = loadPackage();
    if (!pkg)
      throw Object.assign(new Error('DISTRIBUTION_PACKAGE_NOT_FOUND'), {
        code: 'DISTRIBUTION_PACKAGE_NOT_FOUND',
      });
    checks.integrity = 'PASS';
    handoff();
    for (const key of Object.keys(checks) as (keyof typeof checks)[])
      checks[key] = 'PASS';
    status = 'READY_FOR_OPERATOR_HANDOFF';
    nextAction = 'OPEN_MANUAL_HANDOFF';
  } catch (error: unknown) {
    const rawCode =
      error && typeof error === 'object' && 'code' in error ? error.code : null;
    const reason =
      typeof rawCode === 'string' && Object.hasOwn(reasons, rawCode)
        ? reasons[rawCode]
        : null;
    if (reason) {
      status = reason.status;
      nextAction = reason.action;
      checks[reason.check] = 'BLOCKED';
      blockerCodes = [rawCode as string];
    } else blockerCodes = ['DISTRIBUTION_READINESS_UNAVAILABLE'];
    checks.eligibility = 'BLOCKED';
  }
  return {
    schemaVersion: 'manual-release-readiness/1.0.0' as const,
    packageHash: digest(packageHash),
    status,
    ready: status === 'READY_FOR_OPERATOR_HANDOFF',
    identity: pkg
      ? {
          projectId: identifier(pkg.identity?.projectId),
          projectVersion: revision(pkg.identity?.projectVersion),
          campaignId: identifier(pkg.campaignId),
          campaignRevision: revision(pkg.campaignRevision),
          videoRenderId: identifier(pkg.identity?.videoRenderId),
          videoRenderRevision: revision(pkg.identity?.videoRenderRevision),
          videoSha256: digest(pkg.identity?.videoRenderContentHash),
          qcReportId: identifier(pkg.identity?.qualityControlReportId),
        }
      : null,
    destination: pkg
      ? {
          platform: [
            'instagram',
            'facebook',
            'threads',
            'tiktok',
            'youtube',
          ].includes(pkg.platform)
            ? (pkg.platform as string)
            : null,
          account: identifier(pkg.account),
        }
      : null,
    checks,
    requiredRights: ['COMMERCIAL_USE', 'PROCESSING', 'NARRATION'],
    blockerCodes,
    nextAction,
    evaluationScope: 'EXISTING_MANUAL_HANDOFF_GATES_FIRST_BLOCKER' as const,
    // Physical evidence means the existing hash check, not a new codec/decode QC.
    physicalEvidenceScope: 'EXISTING_MEDIA_HASH_VERIFICATION' as const,
    publicationConfirmed: false,
  };
}
export type ManualReleaseReadiness = ReturnType<typeof manualReleaseReadiness>;
