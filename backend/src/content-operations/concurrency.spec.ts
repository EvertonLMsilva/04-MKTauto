import { affiliateRunFixture } from '../../test/support/affiliate-run-fixture.js';
import { raceOperations } from '../../test/support/content-operations-concurrency.js';
describe('Operations SQLite concurrency', () => {
  let fixture: ReturnType<typeof affiliateRunFixture>;
  beforeEach(() => {
    fixture = affiliateRunFixture();
  });
  afterEach(() => fixture?.cleanup());
  it('serializes identical creation into one initial transition', async () => {
    expect(
      await raceOperations(fixture.database, [
        { kind: 'start' },
        { kind: 'start' },
      ]),
    ).toEqual([{ ok: true }, { ok: true }]);
    expect(
      fixture.base.db
        .prepare(
          "SELECT count(*) n FROM pipeline_run_transitions WHERE pipeline_run_id='run_race'",
        )
        .get().n,
    ).toBe(1);
  });
  it('permits exactly one conflicting terminal transition', async () => {
    const results = await raceOperations(fixture.database, [
      { kind: 'transition', state: 'FAILED' },
      { kind: 'transition', state: 'SUCCEEDED' },
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.code).toBe(
      'INVALID_PIPELINE_RUN_TRANSITION',
    );
    expect(fixture.base.getRun('run_001').transitions).toHaveLength(2);
  });
  it('reserves a stage exclusively across connections', async () => {
    const results = await raceOperations(fixture.database, [
      { kind: 'stage' },
      { kind: 'stage' },
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.code).toBe('STAGE_ALREADY_RUNNING');
    expect(
      fixture.base.db
        .prepare('SELECT count(*) n FROM pipeline_stage_attempts')
        .get().n,
    ).toBe(1);
  });
  it('records one recovery when failed-run resume races', async () => {
    fixture.base.transitionRun({
      pipelineRunId: 'run_001',
      nextState: 'FAILED',
      completedAt: '2026-10-14T12:01:00Z',
    });
    expect(
      await raceOperations(fixture.database, [
        { kind: 'resume' },
        { kind: 'resume' },
      ]),
    ).toEqual([{ ok: true }, { ok: true }]);
    expect(
      fixture.base.db
        .prepare('SELECT count(*) n FROM pipeline_run_recoveries')
        .get().n,
    ).toBe(1);
  });
});
