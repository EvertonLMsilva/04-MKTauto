import type {
  OperationalPackage,
  OperationalPublication,
  PublishingOperationsPersistence,
  PublishingOperationsPort,
} from './publishing-operations.port.js';

export class PublishingOperationsService implements PublishingOperationsPort {
  constructor(private readonly persistence: PublishingOperationsPersistence) {}
  checkpoint() {
    const session = this.persistence.open();
    try {
      return session.checkpoint();
    } finally {
      session.close();
    }
  }
  packages(runId: string): OperationalPackage[] {
    const session = this.persistence.open();
    try {
      return session
        .packages(runId)
        .map(({ cursor, value: p, review, revoked }) => {
          const destination = {
            network: String(p.platform),
            account: String(p.account),
            label: `${p.platform} ${p.account}`,
          };
          const publications: OperationalPublication[] = session
            .operations(p.contentHash)
            .map(({ value: op, history, mode }) => {
              const confirmed =
                op.state === 'PUBLISHED' &&
                op.remoteReceipt?.mediaId === op.mediaId &&
                !op.requiresReconciliation;
              const requiresReconciliation =
                !confirmed &&
                (op.state === 'UNCERTAIN' || !!op.requiresReconciliation);
              const failed =
                !confirmed && !requiresReconciliation && op.state === 'FAILED';
              let first = -1;
              if (confirmed)
                first = history.findIndex(
                  ({ value }) =>
                    value.state === 'PUBLISHED' &&
                    value.remoteReceipt?.mediaId === op.mediaId,
                );
              else if (requiresReconciliation) {
                first = history.length - 1;
                while (
                  first > 0 &&
                  (history[first - 1].value.state === 'UNCERTAIN' ||
                    history[first - 1].value.requiresReconciliation)
                )
                  first--;
              } else if (failed)
                first = history.findIndex(
                  ({ value }) => value.state === 'FAILED',
                );
              const transition = history[first];
              return {
                operationId: op.operationId,
                // The existing social adapter is Instagram; destination knowledge stays here.
                destination: {
                  ...destination,
                  label: `${p.platform === 'instagram' ? 'Instagram' : p.platform} ${p.account}`,
                },
                confirmed,
                requiresReconciliation,
                failed,
                errorCode: op.errorCode,
                simulated: mode === 'fake',
                transition: transition
                  ? {
                      stream: 'social',
                      cursor: transition.cursor,
                      version: transition.value.version,
                    }
                  : undefined,
                receipt: confirmed
                  ? {
                      publicationId: op.mediaId,
                      accountId: op.accountId,
                      permalink: op.remoteReceipt.permalink,
                    }
                  : undefined,
              };
            });
          for (const {
            cursor: publicationCursor,
            value,
          } of session.publications(p.contentHash)) {
            if (value.state !== 'PUBLISHED') continue;
            publications.push({
              operationId: value.publicationId,
              destination,
              confirmed: true,
              requiresReconciliation: false,
              failed: false,
              simulated: false,
              transition: {
                stream: 'manual',
                cursor: publicationCursor,
                version: 1,
              },
              receipt: {
                publicationId: value.externalId ?? value.publicationId,
                accountId: p.account,
                permalink: value.externalUrl,
              },
            });
          }
          return {
            hash: p.contentHash,
            cursor,
            destination,
            identity: p.identity,
            review: review
              ? {
                  hash: review.contentHash,
                  decision: review.mediaDecision.decision,
                  revoked,
                  currentApproval:
                    review.mediaDecision.decision === 'APPROVED' && !revoked,
                }
              : null,
            publications,
          };
        });
    } finally {
      session.close();
    }
  }
}
