import { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import { socialFail } from '../domain/social-publication-contracts.js';
import { projectOperationalQueue } from './operational-queue.js';

// Explicit allowlists: no spread of operations, grants, remote payloads or copy.
const id = (value: unknown) =>
  typeof value === 'string' && /^[a-zA-Z0-9_:.-]{1,250}$/.test(value)
    ? value
    : null;
const hash = (value: unknown) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
const time = (value: unknown) =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(
    value,
  ) &&
  Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
const revision = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const mode = (value: unknown) =>
  value === 'fake' || value === 'live' ? value : null;
const code = (value: unknown) =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,99}$/.test(value)
    ? value
    : null;
const states = [
  'PREPARED',
  'CREATING_CONTAINER',
  'PROCESSING',
  'READY',
  'PUBLISHING',
  'PUBLISHED',
  'UNCERTAIN',
  'FAILED',
  'BLOCKED',
  'EXPIRED',
];
function snapshot(op: any) {
  return op
    ? {
        operationId: id(op.operationId),
        version: revision(op.version),
        contentHash: hash(op.contentHash),
        state: states.includes(op.state) ? (op.state as string) : null,
        packageHash: hash(op.packageHash),
        executionMode: mode(op.executionMode),
        updatedAt: time(op.updatedAt),
      }
    : null;
}
function receipt(op: any, network: string, packageHash: string | null) {
  const r = op?.remoteReceipt;
  if (
    !packageHash ||
    op?.packageHash !== packageHash ||
    op.state !== 'PUBLISHED' ||
    op.requiresReconciliation ||
    op.uncertainStage ||
    !id(op.mediaId) ||
    r?.mediaId !== op.mediaId ||
    !time(r?.publishedAt) ||
    !mode(op.executionMode)
  )
    return null;
  let permalink: string | null = null;
  if (!(network === 'FACEBOOK_REELS' && r.permalink === null)) {
    try {
      const u = new URL(r.permalink);
      const domains =
        network === 'INSTAGRAM'
          ? ['instagram.com']
          : ['facebook.com', 'fb.watch'];
      if (
        u.protocol !== 'https:' ||
        u.username ||
        u.password ||
        !domains.some((d) => u.hostname === d || u.hostname.endsWith('.' + d))
      )
        return null;
      u.search = '';
      u.hash = '';
      permalink = u.href;
    } catch {
      return null;
    }
  }
  const value = {
    operationId: id(op.operationId),
    mediaId: id(r.mediaId),
    publishedAt: time(r.publishedAt),
    permalink,
    executionMode: mode(op.executionMode),
  };
  return { ...value, identity: affiliateHash(value) };
}

// Two existing read surfaces are combined. Reject a changed active snapshot;
// retrying this GET is safe and never performs reconciliation or transport.
export function projectPublicationEvidence(
  item: any,
  retained: any[],
  now: string,
) {
  const queue = projectOperationalQueue({ total: 1, items: [item] }, 1, 0, now)
    .items[0];
  const destinations = queue.destinations.map((d) => {
    const raw = item.operations.find(
      (r: any) => r.network === d.network && r.accountId === d.accountId,
    );
    const op = raw?.operation;
    const matching = retained.filter(
      (r) => r.network === d.network && r.accountId === d.accountId,
    );
    const active = matching.find(
      (r) => r.operationId === op?.operationId,
    )?.operation;
    if (
      op &&
      (!active ||
        active.version !== op.version ||
        active.contentHash !== op.contentHash)
    )
      socialFail('SOCIAL_EVIDENCE_CHANGED');
    const original = matching.find(
      (r) => r.operationId === d.originalOperationId,
    )?.operation;
    if (op && d.originalOperationId && !original)
      socialFail('SOCIAL_EVIDENCE_CHANGED');
    const approvedPackage = item.packages.find(
      (p: any) => p.value.contentHash === d.packageHash,
    );
    const approvalMismatch =
      approvedPackage?.review &&
      approvedPackage.review.packageHash !== d.packageHash;
    const approval = {
      ...d.approval,
      pending: d.approval.pending || !!approvalMismatch,
    };
    const confirmed = receipt(op, d.network, hash(d.packageHash));
    const grant = op?.executionAuthorization;
    const required =
      d.network === 'FACEBOOK_REELS' &&
      (!op || op.executionAuthorizationRequired === true || !!op.supersession);
    const grantBound =
      grant &&
      grant.operationId === op.operationId &&
      grant.packageHash === op.packageHash &&
      time(grant.authorizedAt) &&
      time(grant.expiresAt) &&
      Date.parse(grant.authorizedAt) <= Date.parse(now) &&
      Date.parse(grant.expiresAt) > Date.parse(grant.authorizedAt);
    const authorizationStatus = !grant
      ? required
        ? 'REQUIRED'
        : 'NOT_RECORDED'
      : !grantBound
        ? 'INVALID'
        : Date.parse(grant.expiresAt) <= Date.parse(now)
          ? 'EXPIRED'
          : 'RECORDED';
    let pendingCode = d.pendingCode,
      nextAction = d.nextAction;
    if (approvalMismatch) {
      pendingCode = 'DISTRIBUTION_APPROVAL_BINDING_MISMATCH';
      nextAction = 'REVIEW_APPROVAL';
    } else if (op?.state === 'PUBLISHED' && !confirmed && !pendingCode) {
      pendingCode = 'SOCIAL_RECONCILIATION_REQUIRED';
      nextAction = 'VERIFY_RECEIPT';
    }
    return {
      network: d.network,
      accountId: id(d.accountId),
      required: d.required,
      packageHash: hash(d.packageHash),
      packageRevision: revision(d.packageRevision),
      originalOperation: snapshot(original),
      activeOperation: snapshot(op),
      supersessionRevision: revision(d.supersessionRevision),
      approval: {
        decision: ['APPROVED', 'REJECTED'].includes(approval.decision)
          ? (approval.decision as string)
          : null,
        revoked: approval.revoked,
        pending: approval.pending,
      },
      authorization: {
        status: authorizationStatus,
        required,
        expiresAt: time(grant?.expiresAt),
      },
      publicationStatus: confirmed
        ? 'CONFIRMED'
        : op?.state === 'UNCERTAIN'
          ? 'UNCERTAIN'
          : d.requiresReconciliation || op?.state === 'PUBLISHED'
            ? 'RECONCILIATION_REQUIRED'
            : !op
              ? 'NOT_PREPARED'
              : states.includes(op.state)
                ? (op.state as string)
                : 'UNKNOWN',
      executionMode: mode(op?.executionMode),
      simulated: op?.executionMode === 'fake',
      receipt: confirmed,
      pendingCode: code(pendingCode),
      nextAction: code(nextAction),
      requiresReconciliation:
        d.requiresReconciliation || !!(op?.state === 'PUBLISHED' && !confirmed),
    };
  });
  return {
    schemaVersion: 'publication-evidence/1.0.0' as const,
    executionId: id(queue.executionId),
    projectId: id(queue.projectId),
    campaignId: id(queue.campaignId),
    campaignRevision: revision(queue.campaignRevision),
    occurrenceDate:
      typeof queue.occurrenceDate === 'string' &&
      /^\d{4}-\d\d-\d\d$/.test(queue.occurrenceDate)
        ? queue.occurrenceDate
        : null,
    runId: id(queue.runId),
    campaignStatus: id(queue.campaignStatus),
    publicationComplete:
      destinations.some((d) => d.required) &&
      destinations.every(
        (d) => !d.required || (!!d.receipt && !d.approval.pending),
      ),
    destinations,
  };
}
export type PublicationEvidence = ReturnType<typeof projectPublicationEvidence>;
