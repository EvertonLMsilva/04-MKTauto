import { multiPieceQueueFixture } from './multi-piece-queue.fixture.js';
import { planMultiPieceCalendar } from './multi-piece-calendar.planner.js';

let f: Awaited<ReturnType<typeof multiPieceQueueFixture>>;
beforeEach(async () => {
  f = await multiPieceQueueFixture();
  f.installExtension();
  f.installQueue();
});
afterEach(() => {
  vi.restoreAllMocks();
  f?.cleanup();
});
test.each([1, 3])(
  'enqueues persisted %i-campaign plan once without creating pieces',
  async (count) => {
    const receipt = await f.register(count);
    const entries = await f.service.enqueuePlan(receipt.planHash);
    expect(entries).toHaveLength(count * 44);
    expect(
      entries.filter((e) => e.identity.contentType === 'VIDEO'),
    ).toHaveLength(count * 4);
    expect(
      entries.filter((e) => e.identity.contentType === 'IMAGE'),
    ).toHaveLength(count * 40);
    expect(await f.service.enqueuePlan(receipt.planHash)).toEqual(entries);
    expect(f.service.listByPlan(receipt.planHash)).toEqual(entries);
    expect(f.service.listByCampaign('camp_001', 1)).toHaveLength(44);
    expect(
      f.service.listPendingByDestination('destination_camp_001'),
    ).toHaveLength(44);
    expect(f.counts()).toEqual({
      plans: 1,
      entries: count * 44,
      events: count * 44,
    });
    expect(f.extensionCounts().pieces).toBe(count * 44);
  },
);
test.each([
  ['2026-11-01', '01:30', 'AMBIGUOUS_LOCAL_TIME'],
  ['2026-03-08', '02:30', 'NONEXISTENT_LOCAL_TIME'],
])(
  'multiple destinations retain blocked DST occurrences for %s %s',
  async (date, time, reason) => {
    const command = f.command();
    command.input.timeZone = 'America/New_York';
    command.input.startDate = date;
    command.input.campaigns[0].destinations.push('second_destination');
    command.input.campaigns[0].preferredTimes.VIDEO = [time];
    command.plan = planMultiPieceCalendar(command.input);
    const receipt = await f.servicePlanRegister(command);
    const entries = await f.service.enqueuePlan(receipt.planHash);
    expect(entries).toHaveLength(88);
    expect(new Set(entries.map((e) => e.identity.occurrenceId)).size).toBe(88);
    const blocked = entries.filter((e) => e.state === 'BLOCKED');
    expect(blocked).toHaveLength(2);
    expect(blocked.every((e) => e.identity.blockers.includes(reason))).toBe(
      true,
    );
    const entry = blocked[0];
    await expect(
      f.service.claimForOfflineReview(
        {
          planHash: receipt.planHash,
          occurrenceId: entry.identity.occurrenceId,
          expectedVersion: 0,
          requestId: 'blocked_claim',
        },
        f.worker(),
      ),
    ).rejects.toThrow('MULTI_PIECE_QUEUE_NOT_CLAIMABLE');
  },
);
test('claim commits one exclusive owner/event; replay is stable and different payload conflicts', async () => {
  const plan = await f.register();
  const entries = await f.service.enqueuePlan(plan.planHash),
    id = entries[0].identity;
  const command = {
    planHash: plan.planHash,
    occurrenceId: id.occurrenceId,
    expectedVersion: 0,
    requestId: 'claim_001',
  };
  const principal = f.worker();
  const first = await f.service.claimForOfflineReview(command, principal);
  expect(first).toMatchObject({
    state: 'CLAIMED_FOR_OFFLINE_REVIEW',
    version: 1,
    owner: { workerId: 'fixture_worker_1' },
    executionAllowed: false,
  });
  expect(await f.service.claimForOfflineReview(command, principal)).toEqual(
    first,
  );
  expect(
    f.service.getHistory(plan.planHash, id.occurrenceId).map((e) => e.kind),
  ).toEqual(['ENQUEUED', 'CLAIM']);
  await expect(
    f.service.claimForOfflineReview(
      { ...command, expectedVersion: 1 },
      principal,
    ),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_REQUEST_CONFLICT');
  await expect(
    f.service.claimForOfflineReview(command, f.worker('another_worker')),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_REQUEST_CONFLICT');
  await expect(
    f.service.claimForOfflineReview(
      { ...command, expectedVersion: 1, requestId: 'claim_002' },
      f.worker('another_worker'),
    ),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_NOT_CLAIMABLE');
  expect(f.counts().events).toBe(45);
});
test('untrusted or stale workers/occurrences cannot claim', async () => {
  const plan = await f.register();
  const [entry] = await f.service.enqueuePlan(plan.planHash);
  const command = {
    planHash: plan.planHash,
    occurrenceId: entry.identity.occurrenceId,
    expectedVersion: 0,
    requestId: 'claim_001',
  };
  await expect(
    f.service.claimForOfflineReview(command, { workerId: 'fixture_worker_1' }),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_WORKER_REQUIRED');
  await expect(
    f.service.claimForOfflineReview(
      { ...command, expectedVersion: 1 },
      f.worker(),
    ),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_VERSION_CONFLICT');
  await expect(
    f.service.claimForOfflineReview(
      { ...command, occurrenceId: 'occ_' + 'f'.repeat(64) },
      f.worker(),
    ),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_OCCURRENCE_NOT_FOUND');
  expect(f.counts().events).toBe(44);
});
test('rollback prevents both partial enqueue and a claim without its event', async () => {
  const plan = await f.register(3);
  f.base.db.exec(
    "CREATE TRIGGER fixture_abort BEFORE INSERT ON operations_multi_piece_queue_entries_v1 WHEN NEW.ordinal=17 BEGIN SELECT RAISE(ABORT,'FIXTURE_ABORT'); END",
  );
  await expect(f.service.enqueuePlan(plan.planHash)).rejects.toThrow(
    'MULTI_PIECE_QUEUE_PERSISTENCE_FAILED',
  );
  expect(f.counts()).toEqual({ plans: 0, entries: 0, events: 0 });
  f.base.db.exec('DROP TRIGGER fixture_abort');
  const [entry] = await f.service.enqueuePlan(plan.planHash);
  f.base.db.exec(
    "CREATE TRIGGER fixture_abort BEFORE INSERT ON operations_multi_piece_queue_events_v1 WHEN NEW.kind='CLAIM' BEGIN SELECT RAISE(ABORT,'FIXTURE_ABORT'); END",
  );
  await expect(
    f.service.claimForOfflineReview(
      {
        planHash: plan.planHash,
        occurrenceId: entry.identity.occurrenceId,
        expectedVersion: 0,
        requestId: 'aborted_claim',
      },
      f.worker(),
    ),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_PERSISTENCE_FAILED');
  expect(
    f.service.getOccurrence(plan.planHash, entry.identity.occurrenceId),
  ).toEqual(entry);
  expect(f.counts()).toEqual({ plans: 1, entries: 132, events: 132 });
});
