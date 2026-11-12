import {
  queueCommand,
  queueIdentities,
  queuedEvent,
  transitionEvent,
  queueEntry,
  queueHash,
} from './multi-piece-queue.contract.js';
import { planMultiPieceCalendar } from './multi-piece-calendar.planner.js';
import { multiPieceCalendarInput } from './multi-piece-calendar.contract.js';

function identity() {
  const input = multiPieceCalendarInput({
    schemaVersion: 'operations-multi-piece-calendar/1.0.0',
    profile: 'FOUR_WEEK_MULTI_PIECE',
    projectId: 'project_001',
    projectVersion: 1,
    timeZone: 'America/Sao_Paulo',
    startDate: '2026-11-01',
    durationWeeks: 4,
    weeklyGoals: { VIDEO: 1, IMAGE: 10 },
    campaigns: [
      {
        campaignId: 'camp_001',
        campaignRevision: 1,
        destinations: ['destination_001'],
        preferredTimes: { VIDEO: ['18:00'], IMAGE: ['09:00', '15:00'] },
      },
    ],
  });
  return queueIdentities({
    input,
    plan: planMultiPieceCalendar(input),
    createdAt: '2026-11-12T12:00:00.000Z',
    receipts: [],
  })[0];
}
test('queue identity preserves existing plan/piece/occurrence IDs; an administrative claim never authorizes execution', () => {
  const id = identity(),
    first = queuedEvent(id, '2026-11-12T12:00:00.000Z');
  const command = {
    planHash: id.planHash,
    occurrenceId: id.occurrenceId,
    requestId: 'claim_001',
    expectedVersion: 0,
  };
  const event = transitionEvent(
    id,
    first,
    'CLAIM',
    command,
    { workerId: 'worker_001', sessionId: 'session_001' },
    first.createdAt,
  );
  const entry = queueEntry(id, first, event);
  expect(entry.identity).toEqual(id);
  expect(entry.identityHash).toBe(queueHash(id));
  expect(entry).toMatchObject({
    state: 'CLAIMED_FOR_OFFLINE_REVIEW',
    version: 1,
    recoveryStatus: 'REVIEW_RECONCILIATION_REQUIRED',
    executionAllowed: false,
    financeReservationAllowed: false,
    mediaExecutionAllowed: false,
    publicationAuthorized: false,
  });
  expect(() =>
    transitionEvent(
      id,
      event,
      'CLAIM',
      { ...command, expectedVersion: 1 },
      event.actor!,
      first.createdAt,
    ),
  ).toThrow('MULTI_PIECE_QUEUE_NOT_CLAIMABLE');
});
test.each(['extra', 'hash', 'occurrence', 'version'])(
  'strict command rejects %s',
  (kind) => {
    const id = identity(),
      command = {
        planHash: id.planHash,
        occurrenceId: id.occurrenceId,
        expectedVersion: 0,
        requestId: 'claim_001',
      };
    expect(() =>
      queueCommand({
        ...command,
        ...(kind === 'extra' ? { pieceId: 'untrusted_piece' } : {}),
        ...(kind === 'hash' ? { planHash: 'bad' } : {}),
        ...(kind === 'occurrence' ? { occurrenceId: 'bad' } : {}),
        ...(kind === 'version' ? { expectedVersion: -1 } : {}),
      }),
    ).toThrow('MULTI_PIECE_QUEUE_INPUT_INVALID');
  },
);
