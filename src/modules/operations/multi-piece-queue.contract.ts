import { identifier } from '../content-operations/domain/campaign.js';
import {
  planRecordHash,
  planTimestamp,
  type StoredMultiPiecePlan,
} from './multi-piece-plan.contract.js';

export const MULTI_PIECE_QUEUE_VERSION =
  'operations-multi-piece-queue/1.0.0' as const;
export type QueueState =
  | 'PLANNED'
  | 'BLOCKED'
  | 'CLAIMED_FOR_OFFLINE_REVIEW'
  | 'REVIEW_PENDING'
  | 'UNKNOWN';
export type QueueEventKind =
  'ENQUEUED' | 'CLAIM' | 'REVIEW_PENDING' | 'MARK_UNKNOWN';
export interface OfflineWorkerIdentity {
  workerId: string;
  sessionId: string;
}
// Trusted local composition only. A workerId submitted as data is not a principal.
export interface OfflineWorkerIdentityReader {
  assertActive(principal: unknown): Promise<OfflineWorkerIdentity>;
}
export interface QueueCommand {
  requestId: string;
  planHash: string;
  occurrenceId: string;
  expectedVersion: number;
}
export interface QueueIdentity {
  schemaVersion: typeof MULTI_PIECE_QUEUE_VERSION;
  planHash: string;
  pieceId: string;
  occurrenceId: string;
  destinationId: string;
  contentType: 'VIDEO' | 'IMAGE';
  projectId: string;
  projectVersion: number;
  campaignId: string;
  campaignRevision: number;
  plannedAt: string | null;
  localDate: string;
  localTime: string | null;
  initialState: 'PLANNED' | 'BLOCKED';
  blockers: string[];
}
export interface QueueOwner extends OfflineWorkerIdentity {
  claimId: string;
}
export interface QueueEvent {
  schemaVersion: typeof MULTI_PIECE_QUEUE_VERSION;
  planHash: string;
  occurrenceId: string;
  identityHash: string;
  version: number;
  requestId: string;
  requestHash: string;
  kind: QueueEventKind;
  previousState: QueueState | null;
  state: QueueState;
  previousEventHash: string | null;
  owner: QueueOwner | null;
  actor: OfflineWorkerIdentity | null;
  createdAt: string;
  eventHash: string;
}
export interface QueueEntry {
  schemaVersion: typeof MULTI_PIECE_QUEUE_VERSION;
  identity: QueueIdentity;
  identityHash: string;
  state: QueueState;
  version: number;
  owner: QueueOwner | null;
  createdAt: string;
  updatedAt: string;
  headEventHash: string;
  recoveryStatus: 'REVIEW_RECONCILIATION_REQUIRED' | 'NOT_REQUIRED';
  claimEligible: boolean;
  executionAllowed: false;
  financeReservationAllowed: false;
  mediaExecutionAllowed: false;
  publicationAuthorized: false;
}
export class MultiPieceQueueError extends Error {
  constructor(
    readonly code: string,
    cause?: unknown,
  ) {
    super(code, cause === undefined ? undefined : { cause });
  }
}
export const queueHash = planRecordHash;
export function queuePlanHash(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw))
    throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_INPUT_INVALID');
  return raw;
}
export function queueOccurrenceId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^occ_[a-f0-9]{64}$/.test(raw))
    throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_INPUT_INVALID');
  return raw;
}
export function queueCommand(raw: unknown): QueueCommand {
  try {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).sort().join(',') !==
        'expectedVersion,occurrenceId,planHash,requestId'
    )
      throw new Error('INVALID');
    const value = raw as Record<string, unknown>;
    if (
      !Number.isSafeInteger(value.expectedVersion) ||
      (value.expectedVersion as number) < 0
    )
      throw new Error('INVALID');
    return {
      requestId: identifier(value.requestId),
      planHash: queuePlanHash(value.planHash),
      occurrenceId: queueOccurrenceId(value.occurrenceId),
      expectedVersion: value.expectedVersion as number,
    };
  } catch (error) {
    throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_INPUT_INVALID', error);
  }
}
export function queueWorker(raw: OfflineWorkerIdentity): OfflineWorkerIdentity {
  try {
    return {
      workerId: identifier(raw.workerId),
      sessionId: identifier(raw.sessionId),
    };
  } catch (error) {
    throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_WORKER_REQUIRED', error);
  }
}
export function queueIdentities(source: StoredMultiPiecePlan): QueueIdentity[] {
  const plan = source.plan;
  return plan.pieces.flatMap((piece) =>
    piece.occurrences.map((occurrence) => ({
      schemaVersion: MULTI_PIECE_QUEUE_VERSION,
      planHash: plan.planHash,
      pieceId: piece.pieceId,
      occurrenceId: occurrence.occurrenceId,
      destinationId: occurrence.destinationId,
      contentType: piece.contentType,
      projectId: piece.projectId,
      projectVersion: piece.projectVersion,
      campaignId: piece.campaignId,
      campaignRevision: piece.campaignRevision,
      plannedAt: occurrence.plannedAt,
      localDate: piece.localDate,
      localTime: piece.localTime,
      initialState: occurrence.status,
      blockers: [...occurrence.blockers],
    })),
  );
}
export function queuedEvent(
  identity: QueueIdentity,
  createdAt: string,
): QueueEvent {
  const identityHash = queueHash(identity);
  return hashedEvent({
    schemaVersion: MULTI_PIECE_QUEUE_VERSION,
    planHash: identity.planHash,
    occurrenceId: identity.occurrenceId,
    identityHash,
    version: 0,
    requestId: `queue_enqueue_${identityHash}`,
    requestHash: queueHash({ kind: 'ENQUEUED', identityHash }),
    kind: 'ENQUEUED',
    previousState: null,
    state: identity.initialState,
    previousEventHash: null,
    owner: null,
    actor: null,
    createdAt,
  });
}
export function hashedEvent(body: Omit<QueueEvent, 'eventHash'>): QueueEvent {
  planTimestamp(body.createdAt);
  return { ...body, eventHash: queueHash(body) };
}
export function transitionEvent(
  identity: QueueIdentity,
  previous: QueueEvent,
  kind: Exclude<QueueEventKind, 'ENQUEUED'>,
  command: QueueCommand,
  actor: OfflineWorkerIdentity,
  createdAt: string,
): QueueEvent {
  if (command.expectedVersion !== previous.version)
    throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_VERSION_CONFLICT');
  if (kind === 'CLAIM') {
    if (
      previous.state !== 'PLANNED' ||
      previous.owner ||
      identity.blockers.length ||
      !identity.plannedAt
    )
      throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_NOT_CLAIMABLE');
  } else {
    if (previous.state !== 'CLAIMED_FOR_OFFLINE_REVIEW' || !previous.owner)
      throw new MultiPieceQueueError(
        'MULTI_PIECE_QUEUE_RECONCILIATION_REQUIRED',
      );
    if (
      previous.owner.workerId !== actor.workerId ||
      (kind === 'REVIEW_PENDING' &&
        previous.owner.sessionId !== actor.sessionId)
    )
      throw new MultiPieceQueueError('MULTI_PIECE_QUEUE_WORKER_CONFLICT');
  }
  const requestHash = queueHash({ kind, command, actor });
  return hashedEvent({
    schemaVersion: MULTI_PIECE_QUEUE_VERSION,
    planHash: identity.planHash,
    occurrenceId: identity.occurrenceId,
    identityHash: queueHash(identity),
    version: previous.version + 1,
    requestId: command.requestId,
    requestHash,
    kind,
    previousState: previous.state,
    state:
      kind === 'CLAIM'
        ? 'CLAIMED_FOR_OFFLINE_REVIEW'
        : kind === 'MARK_UNKNOWN'
          ? 'UNKNOWN'
          : 'REVIEW_PENDING',
    previousEventHash: previous.eventHash,
    owner:
      kind === 'CLAIM' ? { ...actor, claimId: requestHash } : previous.owner,
    actor,
    createdAt,
  });
}
export function queueEntry(
  identity: QueueIdentity,
  first: QueueEvent,
  last: QueueEvent,
): QueueEntry {
  return {
    schemaVersion: MULTI_PIECE_QUEUE_VERSION,
    identity,
    identityHash: queueHash(identity),
    state: last.state,
    version: last.version,
    owner: last.owner,
    createdAt: first.createdAt,
    updatedAt: last.createdAt,
    headEventHash: last.eventHash,
    recoveryStatus:
      last.state === 'CLAIMED_FOR_OFFLINE_REVIEW' || last.state === 'UNKNOWN'
        ? 'REVIEW_RECONCILIATION_REQUIRED'
        : 'NOT_REQUIRED',
    claimEligible:
      last.state === 'PLANNED' &&
      !identity.blockers.length &&
      identity.plannedAt !== null,
    executionAllowed: false,
    financeReservationAllowed: false,
    mediaExecutionAllowed: false,
    publicationAuthorized: false,
  };
}
