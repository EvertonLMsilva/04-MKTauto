import type {
  CampaignEvent,
  CampaignExecution,
  CampaignStatus,
} from '../domain/campaign.js';

// Persisted cursor names and audit fields are part of the historical contract.
export interface NotificationBaseline {
  campaign: number;
  social: number;
  manual: number;
}
export interface NotificationAttempt {
  executionId: string;
  key: string;
  kind: string;
  sourceIdentity: string;
  destinationId: string;
  messageHash: string;
}
export type NotificationReceipt =
  | { status: 'DELIVERED'; messageId: string }
  | { status: 'FAILED' | 'UNCERTAIN'; errorCode: string };
export type NotificationReference = Pick<
  NotificationAttempt,
  'executionId' | 'key' | 'kind' | 'destinationId'
>;
export type CampaignOperationalEvent = CampaignEvent & { cursor: number };
export interface CampaignOperationalFacts {
  executionId: string;
  campaignId: string;
  runId: string;
  day: string;
  status: CampaignStatus;
  productName: string;
  pause?: { cursor: number; sequence: number; code: string; step: string };
  approvalCursor: number;
  stage: {
    render?: Record<string, unknown>;
    qualityControl?: Record<string, unknown>;
    previewReady: boolean;
    handedOff: boolean;
    approval?: Record<string, unknown>;
  };
}
export interface CampaignNotificationAudit {
  checkpoint(): number;
  notificationBaseline(
    destinationId: string,
    initial: () => NotificationBaseline,
    now: string,
  ): NotificationBaseline;
  hasNotificationAttempt(key: string): boolean;
  // Revalidate synchronously under the same writer lock as identity lookup and insert.
  // The callback must be read-only and must not perform external effects.
  claimNotification(
    intent: NotificationAttempt,
    eligible: () => boolean,
    now: string,
  ): boolean;
  finishNotification(
    intent: NotificationReference,
    receipt: NotificationReceipt,
    now: string,
  ): void;
  recoverNotifications(destinationId: string, now: string): void;
}
export interface CampaignOperationsStore extends CampaignNotificationAudit {
  operationalExecutions(id?: string): CampaignExecution[];
  operationalHistory(id: string): CampaignOperationalEvent[];
}
export interface CampaignOperationsPersistence {
  open(): { repository: CampaignOperationsStore; close(): void };
}
export interface CampaignOperationsSession extends CampaignNotificationAudit {
  facts(executionId?: string): CampaignOperationalFacts[];
  audit(executionId: string): CampaignOperationalEvent[];
  close(): void;
}
export interface CampaignOperationsPort {
  open(): CampaignOperationsSession;
}
export const CAMPAIGN_OPERATIONS = Symbol('CAMPAIGN_OPERATIONS');
