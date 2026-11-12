import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { multiPieceQueueFixture } from './multi-piece-queue.fixture.js';
import { MultiPieceQueueRepository } from './multi-piece-queue.repository.js';

let f: Awaited<ReturnType<typeof multiPieceQueueFixture>>;
beforeEach(async () => {
  f = await multiPieceQueueFixture();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_CALL_FORBIDDEN');
    }),
  );
  vi.stubEnv('PROJECT_API_DATABASE', 'OPERATIONAL_DATABASE_FORBIDDEN');
});
afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    f?.cleanup();
  }
});
const snapshot = () =>
  f.base.db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'operations_multi_piece_queue_%' ORDER BY name",
    )
    .all()
    .map((row) => ({
      ...row,
      rows: f.base.db
        .prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}"`)
        .all(),
    }));
test('persisted 132-piece plan → idempotent queue → offline claim → restart → conservative UNKNOWN without operational effects', async () => {
  f.installExtension();
  f.installQueue();
  const plan = await f.register(3);
  const before = snapshot(),
    schemaVersion = f.base.db.prepare('PRAGMA user_version').get();
  const forbidden = () => {
    throw new Error('TIMER_FORBIDDEN');
  };
  const timers = [
    vi.spyOn(globalThis, 'setInterval').mockImplementation(forbidden),
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(forbidden),
  ];
  try {
    const queue = await f.service.enqueuePlan(plan.planHash);
    expect(queue).toHaveLength(132);
    const entry = queue[0],
      command = {
        planHash: plan.planHash,
        occurrenceId: entry.identity.occurrenceId,
        expectedVersion: 0,
        requestId: 'e2e_offline_claim',
      };
    const claimed = await f.service.claimForOfflineReview(command, f.worker());
    expect(claimed.version).toBe(1);
    expect(
      f.open().getOccurrence(plan.planHash, entry.identity.occurrenceId),
    ).toEqual(claimed);
    const unknown = await f
      .open()
      .markClaimUnknown(
        { ...command, expectedVersion: 1, requestId: 'e2e_record_unknown' },
        f.worker('fixture_worker_1', 'restarted_session'),
      );
    expect(unknown).toMatchObject({
      state: 'UNKNOWN',
      recoveryStatus: 'REVIEW_RECONCILIATION_REQUIRED',
      owner: claimed.owner,
      executionAllowed: false,
      mediaExecutionAllowed: false,
      financeReservationAllowed: false,
      publicationAuthorized: false,
    });
    expect(await f.open().enqueuePlan(plan.planHash)).toHaveLength(132);
    expect(f.counts()).toEqual({ plans: 1, entries: 132, events: 134 });
    for (const timer of timers) expect(timer).not.toHaveBeenCalled();
  } finally {
    for (const timer of timers) timer.mockRestore();
  }
  expect(snapshot()).toEqual(before);
  expect(f.base.db.prepare('PRAGMA user_version').get()).toEqual(schemaVersion);
  expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const digest = () =>
    createHash('sha256').update(readFileSync(f.database)).digest('hex');
  const beforeRead = digest();
  f.repository.listByPlan(plan.planHash);
  f.repository.listByCampaign('camp_001', 1);
  f.repository.listPendingByDestination('destination_camp_001');
  expect(digest()).toBe(beforeRead);
});
test('missing E-009 and E-010 schemas fail closed without provisioning', async () => {
  const before = f.base.db
    .prepare('SELECT name,sql FROM sqlite_master ORDER BY name')
    .all();
  await expect(
    f.service.enqueuePlan(f.command().plan.planHash),
  ).rejects.toThrow('MULTI_PIECE_SCHEMA_NOT_PROVISIONED');
  expect(
    f.base.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),
  ).toEqual(before);
  f.installExtension();
  const plan = await f.register();
  const withPlan = f.base.db
    .prepare('SELECT name,sql FROM sqlite_master ORDER BY name')
    .all();
  await expect(f.service.enqueuePlan(plan.planHash)).rejects.toThrow(
    'MULTI_PIECE_QUEUE_SCHEMA_NOT_PROVISIONED',
  );
  expect(
    f.base.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),
  ).toEqual(withPlan);
});
test('enqueue accepts only an existing revalidated plan and a trusted project reader', async () => {
  f.installExtension();
  f.installQueue();
  const plan = await f.register();
  await expect(f.service.enqueuePlan('bad_hash')).rejects.toThrow(
    'MULTI_PIECE_QUEUE_INPUT_INVALID',
  );
  await expect(f.service.enqueuePlan('f'.repeat(64))).rejects.toThrow(
    'MULTI_PIECE_QUEUE_PLAN_NOT_FOUND',
  );
  await expect(
    new MultiPieceQueueRepository(f.database).enqueuePlan(plan.planHash),
  ).rejects.toThrow('MULTI_PIECE_QUEUE_PROJECT_READER_REQUIRED');
  const project = await f.identities.projects.get('project_001', 1);
  vi.spyOn(f.identities.projects, 'get').mockResolvedValueOnce({
    ...project!,
    project: { ...project!.project, version: 2 },
  });
  await expect(f.service.enqueuePlan(plan.planHash)).rejects.toThrow(
    'MULTI_PIECE_QUEUE_PROJECT_NOT_RESOLVED',
  );
  expect(f.counts()).toEqual({ plans: 0, entries: 0, events: 0 });
});
