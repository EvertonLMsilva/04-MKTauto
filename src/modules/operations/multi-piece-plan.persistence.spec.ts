import { multiPiecePlanFixture } from './multi-piece-plan.fixture.js';
import { MultiPiecePlanRepository } from './multi-piece-plan.repository.js';
import { planMultiPieceCalendar } from './multi-piece-calendar.planner.js';

let f: Awaited<ReturnType<typeof multiPiecePlanFixture>>;
beforeEach(async () => {
  f = await multiPiecePlanFixture();
});
afterEach(() => {
  vi.restoreAllMocks();
  f?.cleanup();
});
test('missing extension fails closed on reads and registration without changing schema', async () => {
  const before = f.base.db
    .prepare('SELECT name,sql FROM sqlite_master ORDER BY name')
    .all();
  await expect(f.service.registerPlan(f.command())).rejects.toThrow(
    'MULTI_PIECE_SCHEMA_NOT_PROVISIONED',
  );
  expect(() => f.repository.getPlanByHash(f.command().plan.planHash)).toThrow(
    'MULTI_PIECE_SCHEMA_NOT_PROVISIONED',
  );
  expect(
    f.base.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),
  ).toEqual(before);
});
test.each([1, 3])(
  'stores and reads %i campaigns with exact E-008 payload and relational identities',
  async (count) => {
    f.installExtension();
    const command = f.command(count);
    const receipt = await f.service.registerPlan(command);
    expect(receipt).toMatchObject({
      schemaVersion: 'operations-multi-piece-plan-receipt/1.0.0',
      planHash: command.plan.planHash,
      createdAt: '2026-11-12T12:00:00.000Z',
      requestIdentity: {
        projectId: 'project_001',
        requestId: command.requestId,
      },
      plan: command.plan,
      executionAllowed: false,
      schedulerStarted: false,
      budgetReserved: false,
      publicationAuthorized: false,
    });
    expect(f.repository.getPlanByHash(command.plan.planHash)?.plan).toEqual(
      command.plan,
    );
    expect(f.repository.listPiecesByPlan(command.plan.planHash)).toEqual(
      command.plan.pieces,
    );
    const occurrences = f.repository.listOccurrencesByPlan(
      command.plan.planHash,
    );
    expect(occurrences).toHaveLength(44 * count);
    expect(
      f.repository
        .listPlansByProject('project_001')
        .map((p) => p.plan.planHash),
    ).toEqual([command.plan.planHash]);
    expect(f.extensionCounts()).toEqual({
      plans: 1,
      pieces: 44 * count,
      occurrences: 44 * count,
      requests: 1,
    });
    expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  },
);
test('same plan replays exactly and new request identities bind to one immutable plan', async () => {
  f.installExtension();
  const command = f.command();
  const first = await f.service.registerPlan(command);
  expect(await f.service.registerPlan(structuredClone(command))).toEqual(first);
  const second = await f.service.registerPlan({
    ...command,
    requestId: 'request_002',
  });
  expect(second.planHash).toBe(first.planHash);
  expect(second.requestIdentity.requestId).toBe('request_002');
  expect(
    await f.service.registerPlan({ ...command, requestId: 'request_002' }),
  ).toEqual(second);
  expect(f.extensionCounts()).toEqual({
    plans: 1,
    pieces: 44,
    occurrences: 44,
    requests: 2,
  });
});
test('request identity cannot be rebound to different content', async () => {
  f.installExtension();
  const command = f.command();
  await f.service.registerPlan(command);
  command.input.campaigns[0].preferredTimes.VIDEO = ['19:00'];
  command.plan = planMultiPieceCalendar(command.input);
  await expect(f.service.registerPlan(command)).rejects.toThrow(
    'MULTI_PIECE_REQUEST_CONFLICT',
  );
  expect(f.extensionCounts()).toEqual({
    plans: 1,
    pieces: 44,
    occurrences: 44,
    requests: 1,
  });
});
test.each(['plan', 'piece', 'occurrence', 'flags', 'extra'])(
  'rejects divergent %s before writing',
  async (kind) => {
    f.installExtension();
    const command = f.command();
    if (kind === 'plan') command.plan.planHash = '0'.repeat(64);
    if (kind === 'piece') command.plan.pieces[0].pieceId += 'corrupt';
    if (kind === 'occurrence')
      command.plan.pieces[0].occurrences[0].destinationId =
        'another_destination';
    if (kind === 'flags') command.plan.executionAllowed = true;
    await expect(
      f.service.registerPlan(
        kind === 'extra' ? { ...command, confirmed: true } : command,
      ),
    ).rejects.toThrow(/MULTI_PIECE_(PLAN_MISMATCH|REQUEST_INVALID)/);
    expect(f.extensionCounts()).toEqual({
      plans: 0,
      pieces: 0,
      occurrences: 0,
      requests: 0,
    });
  },
);
test('registration requires trusted readers, not merely declared identities', async () => {
  f.installExtension();
  await expect(
    new MultiPiecePlanRepository(f.database).registerPlan(f.command()),
  ).rejects.toThrow('MULTI_PIECE_IDENTITY_READER_REQUIRED');
  const command = f.command();
  command.input.campaigns[0].campaignRevision = 999;
  command.plan = planMultiPieceCalendar(command.input);
  await expect(f.service.registerPlan(command)).rejects.toThrow(
    'MULTI_PIECE_CAMPAIGN_NOT_RESOLVED',
  );
  command.input.projectVersion = 999;
  command.plan = planMultiPieceCalendar(command.input);
  await expect(f.service.registerPlan(command)).rejects.toThrow(
    'MULTI_PIECE_PROJECT_NOT_RESOLVED',
  );
  expect(f.extensionCounts().plans).toBe(0);
});
test('late SQL failure rolls back plan, pieces, occurrences and receipt together', async () => {
  f.installExtension();
  f.base.db.exec(
    "CREATE TRIGGER fixture_abort BEFORE INSERT ON operations_multi_piece_plan_occurrences_v1 WHEN NEW.ordinal=17 BEGIN SELECT RAISE(ABORT,'FIXTURE_FAILURE'); END",
  );
  await expect(f.service.registerPlan(f.command(3))).rejects.toThrow(
    'MULTI_PIECE_PERSISTENCE_FAILED',
  );
  expect(f.extensionCounts()).toEqual({
    plans: 0,
    pieces: 0,
    occurrences: 0,
    requests: 0,
  });
  f.base.db.exec('DROP TRIGGER fixture_abort');
  await f.service.registerPlan(f.command(3));
  expect(f.extensionCounts().pieces).toBe(132);
});
test('trusted readers reject mismatched project and campaign identities, not just absence', async () => {
  f.installExtension();
  const reader = vi.spyOn(f.identities.projects, 'get');
  const project = await f.identities.projects.get('project_001', 1);
  reader.mockResolvedValueOnce({
    ...project!,
    project: { ...project!.project, id: 'different_project' },
  });
  await expect(f.service.registerPlan(f.command())).rejects.toThrow(
    'MULTI_PIECE_PROJECT_NOT_RESOLVED',
  );
  reader.mockRestore();
  const campaign = (await f.affiliate.getCampaign('camp_001', 1))!;
  vi.spyOn(f.affiliate, 'getCampaign').mockResolvedValueOnce({
    ...campaign,
    projectId: 'different_project',
  });
  await expect(f.service.registerPlan(f.command())).rejects.toThrow(
    'MULTI_PIECE_CAMPAIGN_NOT_RESOLVED',
  );
  expect(f.extensionCounts().plans).toBe(0);
});
test('unchanged planHash cannot replace its original canonical input', async () => {
  f.installExtension();
  const command = f.command();
  await f.service.registerPlan(command);
  const changed = f.command(1, 'request_alternative');
  // An unused preference leaves E-008 output unchanged; it must not rewrite the stored input.
  changed.input.campaigns[0].preferredTimes.VIDEO.push('19:00');
  changed.plan = planMultiPieceCalendar(changed.input);
  expect(changed.plan.planHash).toBe(command.plan.planHash);
  await expect(f.service.registerPlan(changed)).rejects.toThrow(
    'MULTI_PIECE_PLAN_CONFLICT',
  );
  expect(f.repository.getPlanByHash(command.plan.planHash)?.input).toEqual(
    command.input,
  );
});
