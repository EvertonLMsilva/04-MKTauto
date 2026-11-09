import { createHash } from 'node:crypto';
import type { CampaignOperationsSession } from '../../content-operations/application/campaign-operations.port.js';
import type { PublishingOperationsPort } from '../../publishing/application/publishing-operations.port.js';
import type {
  NotificationBaseline,
  NotificationDelivery,
  NotificationIntent,
  OperationalNotificationStore,
} from '../application/operational-notification.port.js';

// Composes public BC contracts; durable notification evidence belongs to campaign audit.
export class OperationalNotificationRepository implements OperationalNotificationStore {
  constructor(
    private readonly campaigns: CampaignOperationsSession,
    private readonly publishing: PublishingOperationsPort,
  ) {}
  close() {
    this.campaigns.close();
  }
  baseline(
    destinationId: string,
    initial: NotificationBaseline | undefined,
    now: string,
  ) {
    return this.campaigns.notificationBaseline(
      destinationId,
      () =>
        initial ?? {
          campaign: this.campaigns.checkpoint(),
          ...this.publishing.checkpoint(),
        },
      now,
    );
  }
  facts(executionId?: string) {
    return this.campaigns.facts(executionId).map((execution) => ({
      execution,
      packages: this.publishing.packages(execution.runId),
    }));
  }
  attempted(key: string) {
    return this.campaigns.hasNotificationAttempt(key);
  }
  claim(intent: NotificationIntent, eligible: () => boolean, now: string) {
    return this.campaigns.claimNotification(
      {
        executionId: intent.executionId,
        key: intent.key,
        kind: intent.kind,
        sourceIdentity: intent.sourceIdentity,
        destinationId: intent.destinationId,
        messageHash: createHash('sha256')
          .update(JSON.stringify(intent.text))
          .digest('hex'),
      },
      eligible,
      now,
    );
  }
  finish(
    intent: NotificationIntent,
    result: NotificationDelivery,
    now: string,
  ) {
    this.campaigns.finishNotification(intent, result, now);
  }
  recover(destinationId: string, now: string) {
    this.campaigns.recoverNotifications(destinationId, now);
  }
}
