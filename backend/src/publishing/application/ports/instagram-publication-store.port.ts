import type { ManualDistributionService } from '../manual-distribution.service.js';

export interface InstagramPublicationReservations {
  scheduleContext?(id: string): any;
  schedule?(executionId: string, input: any, now: string): unknown;
  scheduled?(id: string): any;
  dueSchedules?(now: string): string[];
  claimSchedule?(id: string, now: string): any;
  finishSchedule?(
    id: string,
    token: string,
    status: string,
    result: unknown,
    now: string,
  ): void;
  cancelSchedule?(id: string, now: string): unknown;
  forExecution(id: string): { operationId: string } | null;
  reserve(
    executionId: string,
    operation: any,
    pkg: any,
    reviewHash: string,
    at: string,
  ): unknown;
  authorize(operation: any, at: string, expectedClaim?: string): unknown;
}
export interface InstagramPublicationStore {
  openInstagram(mode: 'fake' | 'live'): {
    manual: ManualDistributionService;
    social: object;
    reservations: InstagramPublicationReservations;
    close(): void;
  };
}
