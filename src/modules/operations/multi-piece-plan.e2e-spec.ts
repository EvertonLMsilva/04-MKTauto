import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { multiPiecePlanFixture } from './multi-piece-plan.fixture.js';
import { MultiPiecePlanService } from './multi-piece-plan.service.js';
import { MultiPiecePlanRepository } from './multi-piece-plan.repository.js';

let f: Awaited<ReturnType<typeof multiPiecePlanFixture>>;
beforeEach(async () => {
  f = await multiPiecePlanFixture();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_HTTP_FORBIDDEN');
    }),
  );
  // A poisoned environment cannot replace the explicit disposable database path.
  vi.stubEnv('PROJECT_API_DATABASE', 'OPERATIONAL_DATABASE_FORBIDDEN');
});
afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    f?.cleanup();
  }
});
function protectedTables() {
  return f.base.db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'operations_multi_piece_%' ORDER BY name",
    )
    .all()
    .map((row) => ({
      ...row,
      rows: f.base.db
        .prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}"`)
        .all(),
    }));
}
test('explicit extension → trusted registration → restart → full recovery preserves 132 pieces and operational isolation', async () => {
  const before = protectedTables(),
    version = f.base.db.prepare('PRAGMA user_version').get();
  f.installExtension();
  const command = JSON.parse(JSON.stringify(f.command(3)));
  const timers = [
    vi.spyOn(globalThis, 'setInterval').mockImplementation(() => {
      throw new Error('SCHEDULER_FORBIDDEN');
    }),
  ];
  let receipt: Awaited<ReturnType<MultiPiecePlanService['registerPlan']>>;
  try {
    receipt = await f.service.registerPlan(command);
    expect(timers[0]).not.toHaveBeenCalled();
  } finally {
    for (const timer of timers) timer.mockRestore();
  }
  expect(receipt!.plan).toEqual(command.plan);
  expect(receipt!.plan.totals).toMatchObject({
    VIDEO: 12,
    IMAGE: 120,
    pieces: 132,
  });
  expect(receipt!).toMatchObject({
    executionAllowed: false,
    schedulerStarted: false,
    budgetReserved: false,
    publicationAuthorized: false,
  });
  const restarted = new MultiPiecePlanService(f.open());
  expect(await restarted.registerPlan(command)).toEqual(receipt!);
  expect(restarted.getPlanByHash(receipt!.planHash)?.plan).toEqual(
    command.plan,
  );
  expect(restarted.listPiecesByPlan(receipt!.planHash)).toHaveLength(132);
  expect(restarted.listOccurrencesByPlan(receipt!.planHash)).toHaveLength(132);
  expect(protectedTables()).toEqual(before);
  expect(f.base.db.prepare('PRAGMA user_version').get()).toEqual(version);
  expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const digest = () =>
    createHash('sha256').update(readFileSync(f.database)).digest('hex');
  const beforeReads = digest();
  for (let i = 0; i < 2; i++) {
    restarted.getPlanByHash(receipt!.planHash);
    restarted.listPlansByProject('project_001');
    restarted.listPiecesByPlan(receipt!.planHash);
    restarted.listOccurrencesByPlan(receipt!.planHash);
  }
  expect(digest()).toBe(beforeReads);
});
test('opening an unprovisioned or missing file cannot install the extension or create a database', async () => {
  const names = f.base.db
    .prepare('SELECT name,sql FROM sqlite_master ORDER BY name')
    .all();
  const digest = createHash('sha256')
    .update(readFileSync(f.database))
    .digest('hex');
  await expect(f.service.registerPlan(f.command())).rejects.toThrow(
    'MULTI_PIECE_SCHEMA_NOT_PROVISIONED',
  );
  expect(
    f.base.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),
  ).toEqual(names);
  expect(
    createHash('sha256').update(readFileSync(f.database)).digest('hex'),
  ).toBe(digest);
  const absent = join(dirname(f.database), 'must-not-be-created.sqlite');
  expect(() =>
    new MultiPiecePlanRepository(absent).getPlanByHash(
      f.command().plan.planHash,
    ),
  ).toThrow('MULTI_PIECE_DATABASE_REQUIRED');
  expect(existsSync(absent)).toBe(false);
});
