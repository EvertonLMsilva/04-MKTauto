import type {
  CampaignOperationalFacts,
  NotificationBaseline,
} from '../../content-operations/application/campaign-operations.port.js';
import type { OperationalPackage } from '../../publishing/application/publishing-operations.port.js';
export type { NotificationBaseline } from '../../content-operations/application/campaign-operations.port.js';

export interface NotificationIntent extends OperationalNotification {
  key: string;
  executionId: string;
  sourceIdentity: string;
  destinationId: string;
}
export interface OperationalNotificationStore {
  close(): void;
  baseline(
    destinationId: string,
    initial: NotificationBaseline | undefined,
    now: string,
  ): NotificationBaseline;
  facts(
    executionId?: string,
  ): { execution: CampaignOperationalFacts; packages: OperationalPackage[] }[];
  attempted(key: string): boolean;
  claim(
    intent: NotificationIntent,
    eligible: () => boolean,
    now: string,
  ): boolean;
  finish(
    intent: NotificationIntent,
    result: NotificationDelivery,
    now: string,
  ): void;
  recover(destinationId: string, now: string): void;
}
export type OperationalNotificationStoreFactory =
  () => OperationalNotificationStore;
export const OPERATIONAL_NOTIFICATION_STORE = Symbol(
  'OPERATIONAL_NOTIFICATION_STORE',
);

export type OperationalNotificationKind =
  | 'RENDER_READY_FOR_REVIEW'
  | 'PACKAGE_READY_FOR_REVIEW'
  | 'PUBLICATION_SUCCEEDED'
  | 'OPERATION_FAILED'
  | 'NO_ELIGIBLE_PRODUCT'
  | 'PUBLICATION_UNCERTAIN'
  | 'AUTH_CONFIGURATION_REQUIRED';
export interface OperationalNotification {
  kind: OperationalNotificationKind;
  text: string;
}
export type NotificationDelivery =
  | { status: 'DELIVERED'; messageId: string }
  | { status: 'FAILED' | 'UNCERTAIN'; errorCode: string };
export interface OperationalNotificationPort {
  readonly enabled: boolean;
  readonly destinationId: string | null;
  readonly disabledReason?: string;
  send(message: OperationalNotification): Promise<NotificationDelivery>;
}
export const OPERATIONAL_NOTIFICATION_PORT = Symbol(
  'OPERATIONAL_NOTIFICATION_PORT',
);
export const DISCORD_OPERATIONAL_NOTIFICATION_PORT = Symbol(
  'DISCORD_OPERATIONAL_NOTIFICATION_PORT',
);
