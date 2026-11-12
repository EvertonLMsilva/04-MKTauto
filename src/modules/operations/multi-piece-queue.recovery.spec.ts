import {
  multiPieceQueueFixture,
  queueChildProcess,
} from './multi-piece-queue.fixture.js';

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
async function claimed() {
  const plan = await f.register();
  const [entry] = await f.service.enqueuePlan(plan.planHash);
  const command = {
    planHash: plan.planHash,
    occurrenceId: entry.identity.occurrenceId,
    expectedVersion: 0,
    requestId: 'claim_001',
  };
  const principal = f.worker();
  const result = await f.service.claimForOfflineReview(command, principal);
  return { command, principal, result };
}
function corrupt(action: () => void) {
  const triggers = f.base.db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'operations_multi_piece_queue_%'",
    )
    .all();
  f.base.db.exec(
    'PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON;',
  );
  try {
    for (const trigger of triggers)
      f.base.db.exec(
        `DROP TRIGGER "${String(trigger.name).replaceAll('"', '""')}"`,
      );
    action();
  } finally {
    for (const trigger of triggers) f.base.db.exec(String(trigger.sql));
    f.base.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA ignore_check_constraints=OFF;',
    );
  }
}
test('restart retains claim responsibility; only explicit owner reconciliation records UNKNOWN', async () => {
  const { command, principal, result } = await claimed();
  const restarted = f.open();
  expect(
    restarted.getOccurrence(command.planHash, command.occurrenceId),
  ).toEqual(result);
  expect(result.recoveryStatus).toBe('REVIEW_RECONCILIATION_REQUIRED');
  expect(await restarted.claimForOfflineReview(command, principal)).toEqual(
    result,
  );
  const unknown = { ...command, expectedVersion: 1, requestId: 'unknown_001' };
  await expect(
    restarted.markClaimUnknown(unknown, f.worker('another_worker')),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_WORKER_CONFLICT');
  const ownerAfterRestart = f.worker('fixture_worker_1', 'fixture_session_2');
  const recovered = await restarted.markClaimUnknown(
    unknown,
    ownerAfterRestart,
  );
  expect(recovered).toMatchObject({
    state: 'UNKNOWN',
    version: 2,
    owner: result.owner,
    recoveryStatus: 'REVIEW_RECONCILIATION_REQUIRED',
    claimEligible: false,
  });
  expect(await restarted.markClaimUnknown(unknown, ownerAfterRestart)).toEqual(
    recovered,
  );
  await expect(
    restarted.claimForOfflineReview(
      { ...command, expectedVersion: 2, requestId: 'reclaim_forbidden' },
      ownerAfterRestart,
    ),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_NOT_CLAIMABLE');
  expect(
    (await restarted.enqueuePlan(command.planHash)).find(
      (e) => e.identity.occurrenceId === command.occurrenceId,
    ),
  ).toEqual(recovered);
  expect(
    restarted
      .getHistory(command.planHash, command.occurrenceId)
      .map((e) => e.state),
  ).toEqual(['PLANNED', 'CLAIMED_FOR_OFFLINE_REVIEW', 'UNKNOWN']);
});
test('REVIEW_PENDING is owner-bound metadata, not approval or a second claim', async () => {
  const { command, principal, result } = await claimed();
  const pending = { ...command, requestId: 'pending_001', expectedVersion: 1 };
  await expect(
    f.repository.markReviewPending(
      pending,
      f.worker('fixture_worker_1', 'new_session'),
    ),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_WORKER_CONFLICT');
  const entry = await f.repository.markReviewPending(pending, principal);
  expect(entry).toMatchObject({
    state: 'REVIEW_PENDING',
    owner: result.owner,
    claimEligible: false,
    executionAllowed: false,
    publicationAuthorized: false,
  });
  expect(
    f.repository.listPendingByDestination(entry.identity.destinationId),
  ).toHaveLength(44);
});
test('an altered persisted E-009 occurrence prevents queue recovery and claims', async () => {
  const { command, principal } = await claimed();
  const trigger = f.base.db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE name='operations_multi_piece_plan_occurrences_v1_no_update'",
    )
    .get()!;
  // Deliberately corrupted disposable fixture; never an operational write proof.
  f.base.db.exec(
    'DROP TRIGGER operations_multi_piece_plan_occurrences_v1_no_update',
  );
  try {
    f.base.db.exec(
      "UPDATE operations_multi_piece_plan_occurrences_v1 SET destination_id='altered_source' WHERE ordinal=0",
    );
  } finally {
    f.base.db.exec(String(trigger.sql));
  }
  const before = f.counts();
  expect(() =>
    f.open().getOccurrence(command.planHash, command.occurrenceId),
  ).toThrow('MULTI_PIECE_PLAN_CORRUPT');
  await expect(
    f.repository.claimForOfflineReview(command, principal),
  ).rejects.toThrow('MULTI_PIECE_PLAN_CORRUPT');
  expect(f.counts()).toEqual(before);
});
test.each([
  'piece',
  'occurrence',
  'owner',
  'version',
  'state',
  'event',
  'missing-event',
  'duplicate-event',
  'missing-entry',
  'manifest',
])('rejects %s corruption without reconstructing records', async (kind) => {
  const { command } = await claimed();
  corrupt(() => {
    if (kind === 'piece')
      f.base.db.exec(
        "UPDATE operations_multi_piece_queue_entries_v1 SET piece_id='bad_piece' WHERE ordinal=0",
      );
    if (kind === 'occurrence')
      f.base.db.exec(
        "UPDATE operations_multi_piece_queue_entries_v1 SET identity_json=json_set(identity_json,'$.occurrenceId','bad_occurrence') WHERE ordinal=0",
      );
    if (kind === 'owner')
      f.base.db.exec(
        "UPDATE operations_multi_piece_queue_entries_v1 SET owner_worker_id='bad_worker' WHERE ordinal=0",
      );
    if (kind === 'version')
      f.base.db.exec(
        'UPDATE operations_multi_piece_queue_entries_v1 SET version=7 WHERE ordinal=0',
      );
    if (kind === 'state')
      f.base.db.exec(
        "UPDATE operations_multi_piece_queue_entries_v1 SET state='PLANNED' WHERE ordinal=0",
      );
    if (kind === 'event')
      f.base.db.exec(
        "UPDATE operations_multi_piece_queue_events_v1 SET event_json=json_set(event_json,'$.actor.workerId','bad_actor') WHERE kind='CLAIM'",
      );
    if (kind === 'missing-event')
      f.base.db.exec(
        "DELETE FROM operations_multi_piece_queue_events_v1 WHERE kind='CLAIM'",
      );
    if (kind === 'duplicate-event')
      f.base.db.exec(
        "INSERT INTO operations_multi_piece_queue_events_v1 SELECT plan_hash,occurrence_id,2,'duplicate_event',request_hash,'MARK_UNKNOWN',previous_state,state,previous_event_hash,printf('%064d',0),owner_json,actor_json,created_at,event_json FROM operations_multi_piece_queue_events_v1 WHERE kind='CLAIM'",
      );
    if (kind === 'missing-entry')
      f.base.db.exec(
        'DELETE FROM operations_multi_piece_queue_entries_v1 WHERE ordinal=0',
      );
    if (kind === 'manifest')
      f.base.db.exec(
        "UPDATE operations_multi_piece_queue_plans_v1 SET manifest_hash=printf('%064d',0)",
      );
  });
  const before = f.counts(),
    restarted = f.open();
  expect(() => restarted.listByPlan(command.planHash)).toThrow(
    'MULTI_PIECE_QUEUE_CORRUPT',
  );
  expect(() =>
    restarted.getOccurrence(command.planHash, command.occurrenceId),
  ).toThrow('MULTI_PIECE_QUEUE_CORRUPT');
  expect(() =>
    restarted.getHistory(command.planHash, command.occurrenceId),
  ).toThrow('MULTI_PIECE_QUEUE_CORRUPT');
  await expect(restarted.enqueuePlan(command.planHash)).rejects.toThrow(
    'MULTI_PIECE_QUEUE_CORRUPT',
  );
  expect(f.counts()).toEqual(before);
});
test('SQL forbids identity mutation, unlogged transitions, history deletion, duplicate events and invalid FKs', async () => {
  const { command } = await claimed();
  expect(() =>
    f.base.db.exec(
      "UPDATE operations_multi_piece_queue_entries_v1 SET destination_id='other' WHERE ordinal=0",
    ),
  ).toThrow('MULTI_PIECE_QUEUE_IDENTITY_IMMUTABLE');
  expect(() =>
    f.base.db.exec(
      "UPDATE operations_multi_piece_queue_entries_v1 SET state='UNKNOWN' WHERE ordinal=0",
    ),
  ).toThrow('MULTI_PIECE_QUEUE_INVALID_TRANSITION');
  expect(() =>
    f.base.db.exec('DELETE FROM operations_multi_piece_queue_events_v1'),
  ).toThrow('MULTI_PIECE_QUEUE_IMMUTABLE');
  expect(() =>
    f.base.db.exec(
      "UPDATE operations_multi_piece_queue_events_v1 SET event_json='{}'",
    ),
  ).toThrow('MULTI_PIECE_QUEUE_IMMUTABLE');
  expect(() =>
    f.base.db.exec(
      'INSERT INTO operations_multi_piece_queue_events_v1 SELECT * FROM operations_multi_piece_queue_events_v1 WHERE version=0 LIMIT 1',
    ),
  ).toThrow();
  expect(() =>
    f.base.db.exec(
      "INSERT INTO operations_multi_piece_queue_plans_v1 VALUES(printf('%064d',0),1,printf('%064d',0),'2026-11-12T12:00:00.000Z')",
    ),
  ).toThrow();
  expect(
    f.repository.getHistory(command.planHash, command.occurrenceId),
  ).toHaveLength(2);
  expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
test('two independent processes cannot claim the same occurrence', async () => {
  const plan = await f.register(),
    [entry] = await f.service.enqueuePlan(plan.planHash);
  const command = {
    planHash: plan.planHash,
    occurrenceId: entry.identity.occurrenceId,
    expectedVersion: 0,
    requestId: 'process_1',
  };
  const workers = [
    queueChildProcess(
      f.database,
      command,
      'worker_process_1',
      'session_process_1',
    ),
    queueChildProcess(
      f.database,
      { ...command, requestId: 'process_2' },
      'worker_process_2',
      'session_process_2',
    ),
  ];
  try {
    await Promise.all(workers.map((w) => w.ready));
    for (const worker of workers) worker.go();
    const results = await Promise.all(workers.map((w) => w.done));
    const values = results.map((r) =>
      JSON.parse(r.stdout.trim().split('\n').at(-1)!),
    );
    expect(values.filter((v) => v.ok)).toHaveLength(1);
    expect(values.find((v) => !v.ok).code).toBe(
      'MULTI_PIECE_QUEUE_VERSION_CONFLICT',
    );
    expect(
      f.open().getHistory(plan.planHash, command.occurrenceId),
    ).toHaveLength(2);
  } finally {
    for (const worker of workers) worker.child.kill();
  }
}, 15000);
test('process exit after committed claim and before acknowledgement keeps responsibility for reconciliation', async () => {
  const plan = await f.register(),
    [entry] = await f.service.enqueuePlan(plan.planHash);
  const command = {
    planHash: plan.planHash,
    occurrenceId: entry.identity.occurrenceId,
    expectedVersion: 0,
    requestId: 'lost_ack_claim',
  };
  const worker = queueChildProcess(
    f.database,
    command,
    'fixture_worker_1',
    'fixture_session_1',
    true,
  );
  try {
    await worker.ready;
    worker.go();
    const result = await worker.done;
    expect(result.exitCode).toBe(23);
    const restarted = f.open(),
      claim = restarted.getOccurrence(plan.planHash, command.occurrenceId)!;
    expect(claim).toMatchObject({
      state: 'CLAIMED_FOR_OFFLINE_REVIEW',
      owner: { workerId: 'fixture_worker_1' },
      recoveryStatus: 'REVIEW_RECONCILIATION_REQUIRED',
    });
    expect(
      restarted.getHistory(plan.planHash, command.occurrenceId),
    ).toHaveLength(2);
    const unknown = await restarted.markClaimUnknown(
      { ...command, expectedVersion: 1, requestId: 'record_uncertain_claim' },
      f.worker('fixture_worker_1', 'restarted_session'),
    );
    expect(unknown.state).toBe('UNKNOWN');
    expect(f.counts().events).toBe(46);
  } finally {
    worker.child.kill();
  }
}, 15000);
