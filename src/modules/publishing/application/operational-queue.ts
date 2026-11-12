import type { PublicationNetwork } from './ports/destination-publication.port.js';

type Target = {
  network: PublicationNetwork;
  accountId: string;
  packageHash?: string;
  required: boolean;
};

export function projectOperationalQueue(
  page: { total: number; items: any[] },
  limit: number,
  offset: number,
  now: string,
) {
  const currentTime = Date.parse(now);
  return {
    total: page.total,
    limit,
    offset,
    items: page.items.map(
      ({
        execution,
        request,
        latestCampaignEvent,
        blockingEvent,
        packages,
        operations,
      }) => {
        const blockingCode =
          ['WAITING_INPUT', 'WAITING_RECONCILIATION', 'FAILED'].includes(
            execution.status,
          ) && typeof blockingEvent?.evidence?.code === 'string'
            ? blockingEvent.evidence.code
            : null;
        const targets = new Map<string, Target>();
        const key = (network: string, accountId: string) =>
          `${network}:${accountId}`;
        const requested = Array.isArray(request.publication)
          ? request.publication
          : request.publication && typeof request.publication === 'object'
            ? [{ ...request.publication, network: 'INSTAGRAM' }]
            : [];
        for (const value of requested)
          if (
            (value?.network === 'INSTAGRAM' ||
              value?.network === 'FACEBOOK_REELS') &&
            typeof value.accountId === 'string'
          )
            targets.set(key(value.network, value.accountId), {
              network: value.network,
              accountId: value.accountId,
              packageHash: value.packageHash,
              required: true,
            });
        for (const { value: pkg } of packages) {
          const network =
            pkg.platform === 'facebook' ? 'FACEBOOK_REELS' : 'INSTAGRAM';
          const id = key(network, pkg.account);
          if (!requested.length && !targets.has(id))
            targets.set(id, {
              network,
              accountId: pkg.account,
              required: true,
            });
        }
        for (const row of operations) {
          const id = key(row.network, row.accountId);
          if (!targets.has(id))
            targets.set(id, {
              network: row.network,
              accountId: row.accountId,
              required: !requested.length,
            });
        }
        const destinations = [...targets.values()]
          .map((target) => {
            const candidates = packages.filter(
              ({ value: pkg }: any) =>
                (pkg.platform === 'facebook'
                  ? 'FACEBOOK_REELS'
                  : 'INSTAGRAM') === target.network &&
                pkg.account === target.accountId,
            );
            const selected = target.packageHash
              ? candidates.find(
                  ({ value: pkg }: any) =>
                    pkg.contentHash === target.packageHash,
                )
              : candidates.length === 1
                ? candidates[0]
                : null;
            const pkg = selected?.value;
            const review = selected?.review;
            const row = operations.find(
              (value: any) =>
                value.network === target.network &&
                value.accountId === target.accountId,
            );
            const op = row?.operation;
            const receipt =
              pkg &&
              op?.packageHash === pkg.contentHash &&
              op?.state === 'PUBLISHED' &&
              !op.requiresReconciliation &&
              !op.uncertainStage &&
              op.mediaId &&
              op.remoteReceipt?.mediaId === op.mediaId
                ? op.remoteReceipt
                : null;
            const approvalPending =
              !review ||
              review.mediaDecision?.decision !== 'APPROVED' ||
              selected.revoked;
            const expiresAt = op?.executionAuthorization?.expiresAt ?? null;
            const authorizationExpired =
              typeof expiresAt === 'string' &&
              Date.parse(expiresAt) <= currentTime;
            let pendingCode: string | null = null;
            let nextAction = 'NONE';
            if (!pkg) {
              pendingCode =
                blockingCode === 'EXACT_HUMAN_APPROVAL_REQUIRED'
                  ? blockingCode
                  : candidates.length > 1
                    ? 'DISTRIBUTION_PACKAGE_AMBIGUOUS'
                    : 'DISTRIBUTION_PACKAGE_REQUIRED';
              nextAction =
                pendingCode === 'EXACT_HUMAN_APPROVAL_REQUIRED'
                  ? 'REVIEW_HUMAN_APPROVAL'
                  : 'REVIEW_PACKAGE';
            } else if (approvalPending) {
              pendingCode = selected.revoked
                ? 'DISTRIBUTION_APPROVAL_REVOKED'
                : 'DISTRIBUTION_APPROVAL_REQUIRED';
              nextAction = 'REVIEW_APPROVAL';
            } else if (op && op.packageHash !== pkg.contentHash) {
              pendingCode = 'SOCIAL_PUBLICATION_IDENTITY_CONFLICT';
              nextAction = 'REVIEW_FAILURE';
            } else if (!op) {
              pendingCode =
                target.network === 'FACEBOOK_REELS'
                  ? 'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED'
                  : 'SOCIAL_PROCESSING_REQUIRED';
              nextAction =
                target.network === 'FACEBOOK_REELS'
                  ? 'PREPARE_FACEBOOK'
                  : 'CHECK_EXECUTION_GATES';
            } else if (receipt) {
              // A confirmed receipt remains complete even after its grant expires.
            } else if (
              op.state === 'UNCERTAIN' ||
              op.requiresReconciliation ||
              ['CREATING_CONTAINER', 'PUBLISHING'].includes(op.state)
            ) {
              pendingCode = 'SOCIAL_RECONCILIATION_REQUIRED';
              nextAction =
                target.network === 'FACEBOOK_REELS'
                  ? op.supersession
                    ? 'REVIEW_SUPERSESSION_RECOVERY'
                    : 'AUTHORIZE_RECOVERY_AND_RECONCILE'
                  : 'REVIEW_INSTAGRAM_RECONCILIATION';
            } else if (op.state === 'PUBLISHED' && !receipt) {
              pendingCode = 'SOCIAL_RECONCILIATION_REQUIRED';
              nextAction = 'VERIFY_RECEIPT';
            } else if (
              op.state === 'FAILED' ||
              op.state === 'EXPIRED' ||
              op.state === 'BLOCKED'
            ) {
              pendingCode = op.errorCode ?? 'SOCIAL_PUBLICATION_FAILED';
              nextAction = 'REVIEW_FAILURE';
            } else if (
              authorizationExpired &&
              target.network === 'FACEBOOK_REELS'
            ) {
              pendingCode = 'SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED';
              nextAction = 'REQUEST_NEW_AUTHORIZATION';
            } else if (
              op.state === 'PREPARED' &&
              target.network === 'FACEBOOK_REELS'
            ) {
              pendingCode = 'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED';
              nextAction = op.supersession
                ? 'AUTHORIZE_SUCCESSOR'
                : 'AUTHORIZE_FACEBOOK';
            } else if (
              op.state === 'PREPARED' ||
              op.state === 'PROCESSING' ||
              op.state === 'READY'
            ) {
              pendingCode = 'SOCIAL_PROCESSING_REQUIRED';
              nextAction = 'CHECK_PROCESSING';
            }
            const activeClaim = execution.status === 'RUNNING';
            if (
              activeClaim &&
              target.network === 'FACEBOOK_REELS' &&
              pendingCode
            )
              nextAction = 'WAIT_FOR_CLAIM_RELEASE';
            return {
              network: target.network,
              accountId: target.accountId,
              required: target.required,
              operationId: op?.operationId ?? null,
              originalOperationId: row?.originalOperationId ?? null,
              state: op?.state ?? null,
              executionMode: op?.executionMode ?? null,
              simulated: op?.executionMode === 'fake',
              activeClaim,
              version: op?.version ?? null,
              supersessionRevision: op?.supersession?.revision ?? 0,
              packageHash:
                pkg?.contentHash ??
                target.packageHash ??
                op?.packageHash ??
                null,
              packageRevision: pkg?.identity?.videoRenderRevision ?? null,
              approval: {
                decision: review?.mediaDecision?.decision ?? null,
                revoked: !!selected?.revoked,
                pending: !!approvalPending,
              },
              authorizationExpiresAt: expiresAt,
              authorizationExpired: !!authorizationExpired,
              requiresReconciliation:
                !!op?.requiresReconciliation || op?.state === 'UNCERTAIN',
              pendingCode,
              nextAction,
              lastEvidence: op
                ? {
                    at: op.updatedAt,
                    version: op.version,
                    state: op.state,
                    errorCode: op.errorCode ?? null,
                    providerStatus: op.providerStatus ?? null,
                    uncertainStage: op.uncertainStage ?? null,
                  }
                : null,
              receipt,
            };
          })
          .sort((a, b) =>
            key(a.network, a.accountId).localeCompare(
              key(b.network, b.accountId),
            ),
          );
        return {
          projectId: execution.project_id ?? null,
          campaignId: execution.campaign_id,
          campaignRevision: execution.campaign_revision,
          occurrenceDate: execution.production_date,
          executionId: execution.execution_id,
          runId: execution.run_id,
          campaignStatus: execution.status,
          blockingCode,
          publicationComplete:
            destinations.some((value) => value.required) &&
            destinations.every((value) => !value.required || !!value.receipt),
          latestCampaignEvent: latestCampaignEvent
            ? {
                type: latestCampaignEvent.type,
                at: latestCampaignEvent.at,
                code: latestCampaignEvent.evidence?.code ?? null,
                step: latestCampaignEvent.evidence?.step ?? null,
              }
            : null,
          destinations,
        };
      },
    ),
  };
}
