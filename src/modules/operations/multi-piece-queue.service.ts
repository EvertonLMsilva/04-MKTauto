import { MultiPieceQueueRepository } from './multi-piece-queue.repository.js';
// Explicit offline calls only. No Nest registration, timer or dispatch capability.
export class MultiPieceQueueService {
  constructor(private readonly repository: MultiPieceQueueRepository) {}
  enqueuePlan(planHash: string) {
    return this.repository.enqueuePlan(planHash);
  }
  claimForOfflineReview(command: unknown, principal: unknown) {
    return this.repository.claimForOfflineReview(command, principal);
  }
  markClaimUnknown(command: unknown, principal: unknown) {
    return this.repository.markClaimUnknown(command, principal);
  }
  markReviewPending(command: unknown, principal: unknown) {
    return this.repository.markReviewPending(command, principal);
  }
  getOccurrence(planHash: string, occurrenceId: string) {
    return this.repository.getOccurrence(planHash, occurrenceId);
  }
  listByPlan(planHash: string) {
    return this.repository.listByPlan(planHash);
  }
  listByCampaign(campaignId: string, campaignRevision: number) {
    return this.repository.listByCampaign(campaignId, campaignRevision);
  }
  listPendingByDestination(destinationId: string) {
    return this.repository.listPendingByDestination(destinationId);
  }
  getHistory(planHash: string, occurrenceId: string) {
    return this.repository.getHistory(planHash, occurrenceId);
  }
}
