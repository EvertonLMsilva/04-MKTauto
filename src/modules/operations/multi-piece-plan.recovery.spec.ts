import { Worker } from 'node:worker_threads';
import { multiPiecePlanFixture } from './multi-piece-plan.fixture.js';
import { MultiPiecePlanService } from './multi-piece-plan.service.js';
import { planMultiPieceCalendar } from './multi-piece-calendar.planner.js';

let f: Awaited<ReturnType<typeof multiPiecePlanFixture>>;
beforeEach(async () => {
  f = await multiPiecePlanFixture();
  f.installExtension();
});
afterEach(() => {
  vi.restoreAllMocks();
  f?.cleanup();
});
function corrupt(action: () => void) {
  // Deliberate offline damage only. Restore protections, never repair the data.
  const triggers = f.base.db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'operations_multi_piece_%'",
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
test('restart preserves 132 pieces, multiple destinations, DST blockers and exact replay', async () => {
  const command = f.command(3);
  command.input.timeZone = 'America/New_York';
  command.input.startDate = '2026-11-01';
  for (const campaign of command.input.campaigns) {
    campaign.preferredTimes.VIDEO = ['01:30'];
    campaign.destinations.push(`second_${campaign.campaignId}`);
  }
  command.plan = planMultiPieceCalendar(command.input);
  const receipt = await f.service.registerPlan(command);
  const restarted = new MultiPiecePlanService(f.open());
  expect(restarted.getPlanByHash(command.plan.planHash)?.plan).toEqual(
    command.plan,
  );
  expect(await restarted.registerPlan(command)).toEqual(receipt);
  expect(restarted.listOccurrencesByPlan(command.plan.planHash)).toHaveLength(
    264,
  );
  expect(receipt.plan.status).toBe('BLOCKED');
  expect(
    receipt.plan.blockers.some((b) => b.code === 'AMBIGUOUS_LOCAL_TIME'),
  ).toBe(true);
  expect(f.extensionCounts()).toEqual({
    plans: 1,
    pieces: 132,
    occurrences: 264,
    requests: 1,
  });
});
test('registered campaign revisions, changed time and changed destination append separate historical plans', async () => {
  const original = f.command();
  await f.service.registerPlan(original);
  const firstCampaign = (await f.affiliate.getCampaign('camp_001', 1))!;
  await f.affiliate.registerCampaign({
    idempotencyKey: 'fixture_revision_2',
    campaign: { ...firstCampaign, revision: 2 },
  });
  const revised = f.command(1, 'request_revision_2');
  revised.input.campaigns[0].campaignRevision = 2;
  revised.plan = planMultiPieceCalendar(revised.input);
  await f.service.registerPlan(revised);
  const shifted = f.command(1, 'request_time');
  shifted.input.campaigns[0].preferredTimes.VIDEO = ['19:00'];
  shifted.plan = planMultiPieceCalendar(shifted.input);
  await f.service.registerPlan(shifted);
  const destination = f.command(1, 'request_destination');
  destination.input.campaigns[0].destinations = ['another_destination'];
  destination.plan = planMultiPieceCalendar(destination.input);
  await f.service.registerPlan(destination);
  expect(
    new Set(
      [original, revised, shifted, destination].map((c) => c.plan.planHash),
    ).size,
  ).toBe(4);
  expect(
    original.plan.pieces.some((p) =>
      revised.plan.pieces.some((other) => other.pieceId === p.pieceId),
    ),
  ).toBe(false);
  expect(original.plan.pieces[0].pieceId).toBe(shifted.plan.pieces[0].pieceId);
  expect(original.plan.pieces[0].occurrences[0].occurrenceId).not.toBe(
    destination.plan.pieces[0].occurrences[0].occurrenceId,
  );
  expect(f.open().getPlanByHash(original.plan.planHash)?.plan).toEqual(
    original.plan,
  );
  expect(f.extensionCounts()).toEqual({
    plans: 4,
    pieces: 176,
    occurrences: 176,
    requests: 4,
  });
});
test.each([
  'payload',
  'input',
  'piece',
  'occurrence',
  'missing-occurrence',
  'duplicate-occurrence',
  'order',
  'receipt',
  'partial',
  'orphan',
])('recovery rejects %s corruption without repairs', async (kind) => {
  const command = f.command();
  await f.service.registerPlan(command);
  corrupt(() => {
    if (kind === 'payload')
      f.base.db.exec(
        "UPDATE operations_multi_piece_plans_v1 SET payload_json=json_set(payload_json,'$.totals.pieces',1)",
      );
    if (kind === 'input')
      f.base.db.exec(
        "UPDATE operations_multi_piece_plans_v1 SET input_json=json_set(input_json,'$.projectVersion',2)",
      );
    if (kind === 'piece')
      f.base.db.exec(
        "UPDATE operations_multi_piece_plan_pieces_v1 SET payload_json=json_set(payload_json,'$.contentType','VIDEO') WHERE content_type='IMAGE'",
      );
    if (kind === 'occurrence')
      f.base.db.exec(
        "UPDATE operations_multi_piece_plan_occurrences_v1 SET destination_id='corrupt_destination' WHERE ordinal=0",
      );
    if (kind === 'missing-occurrence')
      f.base.db.exec(
        'DELETE FROM operations_multi_piece_plan_occurrences_v1 WHERE ordinal=0',
      );
    if (kind === 'duplicate-occurrence')
      f.base.db.exec(
        "INSERT INTO operations_multi_piece_plan_occurrences_v1 SELECT plan_hash,'duplicate_id',piece_id,1000,'duplicate_destination',planned_at,status,payload_json FROM operations_multi_piece_plan_occurrences_v1 WHERE ordinal=0",
      );
    if (kind === 'order')
      f.base.db.exec(
        'UPDATE operations_multi_piece_plan_occurrences_v1 SET ordinal=1000 WHERE ordinal=0; UPDATE operations_multi_piece_plan_occurrences_v1 SET ordinal=0 WHERE ordinal=1; UPDATE operations_multi_piece_plan_occurrences_v1 SET ordinal=1 WHERE ordinal=1000;',
      );
    if (kind === 'receipt')
      f.base.db.exec(
        "UPDATE operations_multi_piece_plan_requests_v1 SET created_at='2026-11-13T00:00:00.000Z'",
      );
    if (kind === 'partial')
      f.base.db.exec(
        'DELETE FROM operations_multi_piece_plan_requests_v1; DELETE FROM operations_multi_piece_plan_occurrences_v1; DELETE FROM operations_multi_piece_plan_pieces_v1;',
      );
    if (kind === 'orphan')
      f.base.db.exec(
        "UPDATE operations_multi_piece_plan_occurrences_v1 SET piece_id='absent_piece' WHERE ordinal=0",
      );
  });
  const before = f.extensionCounts();
  const repository = f.open();
  expect(() => repository.getPlanByHash(command.plan.planHash)).toThrow(
    'MULTI_PIECE_PLAN_CORRUPT',
  );
  expect(() => repository.listPlansByProject('project_001')).toThrow(
    'MULTI_PIECE_PLAN_CORRUPT',
  );
  expect(() => repository.listPiecesByPlan(command.plan.planHash)).toThrow(
    'MULTI_PIECE_PLAN_CORRUPT',
  );
  expect(() => repository.listOccurrencesByPlan(command.plan.planHash)).toThrow(
    'MULTI_PIECE_PLAN_CORRUPT',
  );
  await expect(repository.registerPlan(command)).rejects.toThrow(
    'MULTI_PIECE_PLAN_CORRUPT',
  );
  expect(f.extensionCounts()).toEqual(before);
});
test('SQL forbids overwrites, deletion, orphan inserts and appending children to a sealed plan', async () => {
  const command = f.command();
  await f.service.registerPlan(command);
  for (const table of [
    'operations_multi_piece_plans_v1',
    'operations_multi_piece_plan_pieces_v1',
    'operations_multi_piece_plan_occurrences_v1',
    'operations_multi_piece_plan_requests_v1',
  ]) {
    expect(() => f.base.db.exec(`DELETE FROM ${table}`)).toThrow(
      'MULTI_PIECE_APPEND_ONLY',
    );
    const column = table.endsWith('requests_v1')
      ? 'request_id'
      : table.endsWith('pieces_v1')
        ? 'piece_id'
        : table.endsWith('occurrences_v1')
          ? 'occurrence_id'
          : 'plan_hash';
    expect(() =>
      f.base.db.exec(`UPDATE ${table} SET ${column}=${column}`),
    ).toThrow('MULTI_PIECE_APPEND_ONLY');
  }
  expect(() =>
    f.base.db.exec(
      'INSERT INTO operations_multi_piece_plan_pieces_v1 SELECT * FROM operations_multi_piece_plan_pieces_v1 LIMIT 1',
    ),
  ).toThrow('MULTI_PIECE_APPEND_ONLY');
  expect(() =>
    f.base.db.exec(
      "INSERT INTO operations_multi_piece_plan_pieces_v1 SELECT printf('%064d',0),piece_id,ordinal,campaign_id,campaign_revision,content_type,local_date,local_time,planned_at,status,payload_json FROM operations_multi_piece_plan_pieces_v1 LIMIT 1",
    ),
  ).toThrow('FOREIGN KEY');
  expect(() =>
    f.base.db.exec(
      "INSERT INTO operations_multi_piece_plans_v1 SELECT printf('%064d',0),schema_version,project_id,project_version,time_zone,start_date,end_date,profile,status,piece_count,occurrence_count,input_json,json_remove(payload_json,'$.planHash'),created_at FROM operations_multi_piece_plans_v1 LIMIT 1",
    ),
  ).toThrow('CHECK constraint');
});
test('independent connections serialize retries and conflicting request identities', async () => {
  const command = f.command(3);
  const receipts = await Promise.all([
    f.repository.registerPlan(command),
    f.open().registerPlan(command),
  ]);
  expect(receipts[0]).toEqual(receipts[1]);
  const changed = f.command(1, 'concurrent_request');
  const other = structuredClone(changed);
  other.input.startDate = '2027-01-01';
  other.plan = planMultiPieceCalendar(other.input);
  const results = await Promise.allSettled([
    f.open().registerPlan(changed),
    f.open().registerPlan(other),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'MULTI_PIECE_REQUEST_CONFLICT' },
  });
  expect(f.extensionCounts()).toEqual({
    plans: 2,
    pieces: 176,
    occurrences: 176,
    requests: 2,
  });
});
test('BEGIN IMMEDIATE waits for an actual concurrent SQLite writer on another thread', async () => {
  const worker = new Worker(
    `const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(workerData.path);
    db.exec('BEGIN IMMEDIATE'); parentPort.postMessage('LOCKED');
    setTimeout(() => { db.exec('ROLLBACK'); db.close(); parentPort.close(); }, 150);`,
    { eval: true, workerData: { path: f.database } },
  );
  const exited = new Promise<void>((resolve, reject) => {
    worker.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('WORKER_FAILED')),
    );
    worker.once('error', reject);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve());
      worker.once('error', reject);
    });
    const receipt = await f.repository.registerPlan(f.command());
    await exited;
    expect(f.open().getPlanByHash(receipt.planHash)?.plan).toEqual(
      receipt.plan,
    );
    expect(f.extensionCounts()).toEqual({
      plans: 1,
      pieces: 44,
      occurrences: 44,
      requests: 1,
    });
  } finally {
    await worker.terminate();
  }
});
