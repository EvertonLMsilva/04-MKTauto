import type { ManualDistributionService } from '../manual-distribution.service.js';

export interface InstagramPublicationReservations {
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
