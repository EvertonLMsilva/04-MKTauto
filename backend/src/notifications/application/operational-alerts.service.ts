import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  authenticationCodes,
  notificationText,
} from '../domain/operational-notification.js';
import type {
  OperationalNotificationPort,
  NotificationDelivery,
  NotificationBaseline,
  NotificationIntent,
  OperationalNotificationKind,
  OperationalNotificationStore,
  OperationalNotificationStoreFactory,
} from './operational-notification.port.js';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function collectOperationalNotifications(
  store: OperationalNotificationStore,
  destinationId: string,
  baseline: NotificationBaseline,
  executionId?: string,
): NotificationIntent[] {
  const results: NotificationIntent[] = [];
  for (const { execution: e, packages } of store.facts(executionId)) {
    const context = {
      campaign: e.campaignId,
      product: e.productName,
      day: e.day,
    };
    const add = (
      kind: OperationalNotificationKind,
      source: unknown,
      extra: Record<string, unknown> = {},
    ) => {
      const sourceIdentity = hash(source);
      results.push({
        kind,
        text: notificationText(kind, { ...context, ...extra }),
        executionId: e.executionId,
        destinationId,
        sourceIdentity,
        key: hash({
          executionId: e.executionId,
          kind,
          sourceIdentity,
          destinationId,
        }),
      });
    };
    let published = false,
      remoteIntervention = false;
    for (const p of packages) {
      for (const publication of p.publications) {
        const { transition, receipt } = publication;
        const fresh =
          transition && transition.cursor > baseline[transition.stream];
        const extra = {
          destination: publication.destination.label,
          fake: publication.simulated,
        };
        if (publication.confirmed && receipt) {
          published = true;
          if (fresh)
            add(
              'PUBLICATION_SUCCEEDED',
              {
                publication: receipt.publicationId,
                account: receipt.accountId,
              },
              { ...extra, permalink: receipt.permalink },
            );
        } else if (publication.requiresReconciliation) {
          remoteIntervention = true;
          if (fresh)
            add(
              'PUBLICATION_UNCERTAIN',
              {
                operation: publication.operationId,
                episode: transition.version,
              },
              extra,
            );
        } else if (publication.failed) {
          remoteIntervention = true;
          if (fresh)
            add(
              authenticationCodes.has(publication.errorCode ?? '')
                ? 'AUTH_CONFIGURATION_REQUIRED'
                : 'OPERATION_FAILED',
              {
                operation: publication.operationId,
                failed: transition.version,
              },
              { ...extra, step: 'PUBLICATION', code: publication.errorCode },
            );
        }
      }
    }
    if (published || remoteIntervention) continue;
    const { render, qualityControl, approval, previewReady, handedOff } =
      e.stage;
    if (e.pause && e.pause.cursor > baseline.campaign) {
      const { code, step, sequence } = e.pause;
      if (e.status === 'WAITING_RECONCILIATION' && step === 'PUBLICATION')
        add('PUBLICATION_UNCERTAIN', { pause: sequence }, { step });
      else if (
        authenticationCodes.has(code) &&
        ['WAITING_INPUT', 'FAILED'].includes(e.status)
      )
        add('AUTH_CONFIGURATION_REQUIRED', { pause: sequence }, { step });
      else if (e.status === 'FAILED')
        add('OPERATION_FAILED', { pause: sequence }, { code, step });
      else if (
        e.status === 'WAITING_INPUT' &&
        code === 'CATALOG_PRODUCT_REQUIRED'
      )
        add('NO_ELIGIBLE_PRODUCT', { day: e.day, campaign: e.campaignId });
      else if (
        e.status === 'WAITING_INPUT' &&
        code === 'EXACT_HUMAN_APPROVAL_REQUIRED' &&
        render &&
        qualityControl &&
        previewReady &&
        !handedOff &&
        !(
          approval?.decision === 'APPROVED' &&
          approval.videoRenderId === render.videoRenderId
        )
      )
        add(
          'RENDER_READY_FOR_REVIEW',
          { render, qc: qualityControl },
          { step },
        );
    }
    if (approval?.decision === 'APPROVED') {
      for (const p of packages) {
        if (
          !p.review &&
          approval.videoRenderId === p.identity.videoRenderId &&
          approval.videoRenderContentHash ===
            p.identity.videoRenderContentHash &&
          approval.qualityControlReportId ===
            p.identity.qualityControlReportId &&
          approval.qualityControlReportContentHash ===
            p.identity.qualityControlReportContentHash &&
          (p.cursor > baseline.manual || e.approvalCursor > baseline.campaign)
        )
          add(
            'PACKAGE_READY_FOR_REVIEW',
            { package: p.hash },
            { destination: p.destination.label },
          );
      }
    }
  }
  return results.filter((intent) => !store.attempted(intent.key));
}

const deliveryCodes = new Set([
  'TELEGRAM_AUTH_REQUIRED',
  'TELEGRAM_DESTINATION_REJECTED',
  'TELEGRAM_RATE_LIMIT',
  'TELEGRAM_HTTP_ERROR',
  'TELEGRAM_API_REJECTED',
  'TELEGRAM_RESPONSE_UNCERTAIN',
  'TELEGRAM_TIMEOUT',
  'TELEGRAM_NETWORK_UNCERTAIN',
  'DISCORD_AUTH_REQUIRED',
  'DISCORD_DESTINATION_REJECTED',
  'DISCORD_WEBHOOK_UNAVAILABLE',
  'DISCORD_RATE_LIMIT',
  'DISCORD_HTTP_ERROR',
  'DISCORD_RESPONSE_UNCERTAIN',
  'DISCORD_TIMEOUT',
  'DISCORD_NETWORK_UNCERTAIN',
]);
type NotificationChannel = {
  adapter: OperationalNotificationPort;
  baseline: NotificationBaseline;
};
export class OperationalAlertsService {
  private readonly logger = new Logger(OperationalAlertsService.name);
  private channels: NotificationChannel[] = [];
  private pending?: Promise<void>;
  private active = false;
  private warned = false;
  constructor(
    private readonly open: OperationalNotificationStoreFactory,
    private readonly adapters:
      OperationalNotificationPort | readonly OperationalNotificationPort[],
    private readonly now = () => new Date().toISOString(),
  ) {}
  onModuleInit() {
    this.channels = [];
    const adapters = Array.isArray(this.adapters)
      ? this.adapters
      : [this.adapters as OperationalNotificationPort];
    for (const adapter of adapters) {
      if (!adapter.enabled || !adapter.destinationId) {
        this.logger.log(
          adapter.disabledReason ?? 'OPERATIONAL_NOTIFICATIONS_DISABLED',
        );
        continue;
      }
      try {
        const repository = this.open();
        try {
          const baseline = repository.baseline(
            adapter.destinationId,
            undefined,
            this.now(),
          );
          repository.recover(adapter.destinationId, this.now());
          this.channels.push({ adapter, baseline });
        } finally {
          repository.close();
        }
      } catch {
        this.logger.warn('OPERATIONAL_NOTIFICATIONS_DATABASE_UNAVAILABLE');
      }
    }
    this.active = this.channels.length > 0;
  }
  async onModuleDestroy() {
    this.active = false;
    await this.pending;
  }
  async scan() {
    if (!this.active) return;
    if (this.pending) return this.pending;
    this.pending = this.dispatch()
      .catch(() => {
        if (!this.warned) {
          this.logger.warn('OPERATIONAL_NOTIFICATIONS_DISPATCH_UNAVAILABLE');
          this.warned = true;
        }
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  private async dispatch() {
    // Each destination has its own durable intent and receipt. One failed channel
    // cannot short-circuit another channel, including a failed receipt write.
    const results = await Promise.allSettled(
      this.channels.map((channel) => this.dispatchChannel(channel)),
    );
    if (
      results.some((result) => result.status === 'rejected') &&
      !this.warned
    ) {
      this.logger.warn('OPERATIONAL_NOTIFICATIONS_DISPATCH_UNAVAILABLE');
      this.warned = true;
    }
  }
  private async dispatchChannel(channel: NotificationChannel) {
    const destination = channel.adapter.destinationId!;
    const repository = this.open();
    let candidates;
    try {
      channel.baseline = repository.baseline(
        destination,
        channel.baseline,
        this.now(),
      );
      repository.recover(destination, this.now());
      candidates = collectOperationalNotifications(
        repository,
        destination,
        channel.baseline,
      );
    } finally {
      repository.close();
    }
    for (const candidate of candidates.slice(0, 50)) {
      const claim = this.open();
      let claimed = false;
      try {
        claimed = claim.claim(
          candidate,
          () =>
            collectOperationalNotifications(
              claim,
              destination,
              channel.baseline,
              candidate.executionId,
            ).some((current) => current.key === candidate.key),
          this.now(),
        );
      } finally {
        claim.close();
      }
      if (!claimed) continue;
      let result: NotificationDelivery = {
        status: 'UNCERTAIN',
        errorCode: 'NOTIFICATION_TRANSPORT_UNCERTAIN',
      };
      try {
        const sent = await channel.adapter.send({
          kind: candidate.kind,
          text: candidate.text,
        });
        if (
          sent.status === 'DELIVERED' &&
          typeof sent.messageId === 'string' &&
          /^\d{1,20}$/.test(sent.messageId)
        )
          result = { status: 'DELIVERED', messageId: sent.messageId };
        else if (
          (sent.status === 'FAILED' || sent.status === 'UNCERTAIN') &&
          deliveryCodes.has(sent.errorCode)
        )
          result = { status: sent.status, errorCode: sent.errorCode };
      } catch {
        /* The persisted attempt prevents an unsafe second POST. */
      }
      const receipt = this.open();
      try {
        receipt.finish(candidate, result, this.now());
      } finally {
        receipt.close();
      }
    }
  }
}
