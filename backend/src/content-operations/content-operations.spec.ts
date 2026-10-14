import {
  affiliateRunFixture,
  outcome,
} from '../../test/support/affiliate-run-fixture.js';
import { SqliteOperationsRepository } from './infrastructure/sqlite-operations.repository.js';
import {
  validatePipelineRun,
  validateHandoff,
  sanitizePipelineRunError,
} from './domain/operations-contracts.js';
const legacyContracts = await import(
  new URL('../../../src/domain/pipeline-run-contracts.js', import.meta.url).href
);
const legacyHandoff = await import(
  new URL('../../../src/project-pipeline-handoff.js', import.meta.url).href
);

describe('Content Operations legacy parity', () => {
  let fixture: ReturnType<typeof affiliateRunFixture>;
  let repository: SqliteOperationsRepository;
  const at = '2026-10-14T12:01:00.000Z';
  beforeEach(() => {
    fixture = affiliateRunFixture();
    repository = new SqliteOperationsRepository(fixture.database);
  });
  afterEach(() => {
    repository?.close();
    fixture?.cleanup();
  });
  const start = (id: string) => ({
    execution: {
      pipelineRunId: id,
      projectId: 'project_001',
      projectVersion: 1,
      startedAt: '2026-10-14T12:00:00Z',
    },
    projectSnapshot: fixture.base.get('project_001', 1),
  });
  it('preserves creation, identity hash, exact replay and immutable identity', () => {
    const input = start('run_new');
    const actual = repository.startRun(input);
    expect(actual).toEqual(fixture.base.startRun(input));
    expect(repository.startRun(input)).toEqual(actual);
    expect(
      outcome(() =>
        repository.startRun({
          ...input,
          execution: { ...input.execution, startedAt: at },
        }),
      ),
    ).toEqual(
      outcome(() =>
        fixture.base.startRun({
          ...input,
          execution: { ...input.execution, startedAt: at },
        }),
      ),
    );
    expect(repository.listRunsByProjectVersion('project_001', 1)).toEqual(
      fixture.base.listRunsByProjectVersion('project_001', 1),
    );
  });
  it('preserves terminal replay, sanitized errors, recovery and refusal of terminal changes', () => {
    const failure = {
      pipelineRunId: 'run_001',
      nextState: 'FAILED',
      completedAt: at,
      error: { code: 'NETWORK_TIMEOUT', field: 'stage', message: 'secret' },
    };
    expect(repository.transitionRun(failure)).toEqual(
      fixture.base.transitionRun(failure),
    );
    expect(
      outcome(() =>
        repository.transitionRun({ ...failure, nextState: 'SUCCEEDED' }),
      ),
    ).toEqual(
      outcome(() =>
        fixture.base.transitionRun({ ...failure, nextState: 'SUCCEEDED' }),
      ),
    );
    const recovery = {
      pipelineRunId: 'run_001',
      resumedAt: '2026-10-14T12:02:00Z',
    };
    expect(repository.resumeRun(recovery)).toEqual(
      fixture.base.resumeRun(recovery),
    );
    const success = {
      pipelineRunId: 'run_001',
      nextState: 'SUCCEEDED',
      completedAt: '2026-10-14T12:03:00Z',
    };
    expect(repository.transitionRun(success)).toEqual(
      fixture.base.transitionRun(success),
    );
    expect(repository.resumeRun(recovery).state).toBe('SUCCEEDED');
  });
  it('rolls back state and history together when transition insert fails', () => {
    fixture.base.db.exec(
      "CREATE TRIGGER fail_transition BEFORE INSERT ON pipeline_run_transitions WHEN NEW.previous_state IS NOT NULL BEGIN SELECT RAISE(ABORT,'forced'); END",
    );
    expect(() =>
      repository.transitionRun({
        pipelineRunId: 'run_001',
        nextState: 'SUCCEEDED',
        completedAt: at,
      }),
    ).toThrow('forced');
    expect(repository.getRun('run_001')).toEqual(
      fixture.base.getRun('run_001'),
    );
    expect(repository.getRun('run_001')?.state).toBe('RUNNING');
    expect(repository.db.isTransaction).toBe(false);
  });
  it('rejects malformed persisted histories', () => {
    fixture.base.db.exec('DROP TRIGGER pipeline_run_transitions_no_update');
    fixture.base.db
      .prepare(
        "UPDATE pipeline_run_transitions SET changed_at=? WHERE pipeline_run_id='run_001'",
      )
      .run(at);
    expect(outcome(() => repository.getRun('run_001'))).toEqual(
      outcome(() => fixture.base.getRun('run_001')),
    );
  });
  it('matches JS validation codes and paths without relaxing historical contracts', () => {
    const run = fixture.base.getRun('run_001');
    for (const input of [
      null,
      {},
      run,
      { ...run, extra: true },
      { ...run, completedAt: at },
      { ...run, projectVersion: 2 },
      { ...run, state: 'COMPLETE' },
      { ...run, transitions: [] },
      { ...run, startedAt: 'invalid' },
    ])
      expect(outcome(() => validatePipelineRun(input))).toEqual(
        outcome(() => legacyContracts.validatePipelineRun(input)),
      );
    const handoff = {
      schemaVersion: 'pipeline-handoff/1.0.0',
      ...start('run_valid').execution,
    };
    for (const input of [
      null,
      {},
      { ...handoff, extra: true },
      { ...handoff, token: 'secret' },
      { ...handoff, projectVersion: 0 },
    ])
      expect(outcome(() => validateHandoff(input))).toEqual(
        outcome(() => legacyHandoff.validatePipelineHandoffRequest(input)),
      );
    for (const input of [
      null,
      new Error('secret'),
      { code: 'INVALID token', field: '/private/path' },
      { code: 'NETWORK_TIMEOUT', field: 'stage' },
    ])
      expect(sanitizePipelineRunError(input)).toEqual(
        legacyContracts.sanitizePipelineRunError(input),
      );
  });
  it('rolls back creation and recovery when their history insert fails', () => {
    fixture.base.db.exec(
      "CREATE TRIGGER fail_initial BEFORE INSERT ON pipeline_run_transitions WHEN NEW.previous_state IS NULL BEGIN SELECT RAISE(ABORT,'forced initial'); END",
    );
    expect(() => repository.startRun(start('run_rollback'))).toThrow(
      'forced initial',
    );
    expect(repository.getRun('run_rollback')).toBeNull();
    repository.transitionRun({
      pipelineRunId: 'run_001',
      nextState: 'FAILED',
      completedAt: at,
    });
    fixture.base.db.exec(
      "CREATE TRIGGER fail_recovery BEFORE INSERT ON pipeline_run_recoveries BEGIN SELECT RAISE(ABORT,'forced recovery'); END",
    );
    expect(() =>
      repository.resumeRun({
        pipelineRunId: 'run_001',
        resumedAt: '2026-10-14T12:02:00Z',
      }),
    ).toThrow('forced recovery');
    expect(repository.getRun('run_001')?.state).toBe('FAILED');
    expect(
      repository.db
        .prepare('SELECT count(*) n FROM pipeline_run_recoveries')
        .get()?.n,
    ).toBe(0);
  });
});
