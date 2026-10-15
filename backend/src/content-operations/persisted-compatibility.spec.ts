import { createHash } from 'node:crypto';
import { affiliateRunFixture } from '../../test/support/affiliate-run-fixture.js';
import { SqliteOperationsRepository } from './infrastructure/sqlite-operations.repository.js';
import { validateProjectSnapshot } from '../project/domain/project-contracts.js';

describe('Persisted pipeline identity compatibility', () => {
  let f: ReturnType<typeof affiliateRunFixture>;
  let repository: SqliteOperationsRepository;
  beforeEach(() => {
    f = affiliateRunFixture();
    repository = new SqliteOperationsRepository(f.database);
  });
  afterEach(() => {
    repository.close();
    f.cleanup();
  });
  const row = () =>
    f.base.db
      .prepare("SELECT * FROM pipeline_runs WHERE pipeline_run_id='run_001'")
      .get()!;
  const replay = (id = 'run_001') => ({
    execution: {
      pipelineRunId: id,
      projectId: 'project_001',
      projectVersion: 1,
      startedAt: '2026-10-14T12:00:00Z',
    },
    projectSnapshot: f.base.get('project_001', 1),
  });
  function rewrite(snapshot: any, hash?: string) {
    f.base.db.exec('DROP TRIGGER pipeline_runs_no_identity_update');
    const r = row();
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          pipelineRunId: r.pipeline_run_id,
          projectId: r.project_id,
          projectVersion: r.project_version,
          startedAt: r.started_at,
          projectSnapshot: snapshot,
        }),
      )
      .digest('hex');
    f.base.db
      .prepare(
        "UPDATE pipeline_runs SET project_snapshot_json=?, identity_hash=? WHERE pipeline_run_id='run_001'",
      )
      .run(JSON.stringify(snapshot), hash ?? digest);
  }
  it('reads and replays historical identity without modifying storage', () => {
    const before = row();
    const expected = f.base.getRun('run_001');
    expect(repository.getRun('run_001')).toEqual(expected);
    expect(repository.startRun(replay())).toEqual(expected);
    expect(row()).toEqual(before);
  });
  it('always creates canonical snapshots and replays them', () => {
    const input = replay('run_new');
    const created = repository.startRun(input);
    expect(created.projectSnapshot.channel).toMatchObject({
      minVideoAssetDurationSeconds: 25,
      maxVideoAssetDurationSeconds: 45,
    });
    expect(repository.startRun(input)).toEqual(created);
    expect(repository.getRun('run_new')).toEqual(created);
  });
  it('preserves explicit canonical asset durations and identity on replay', () => {
    const input = replay('run_custom');
    input.projectSnapshot = structuredClone(
      validateProjectSnapshot(input.projectSnapshot),
    );
    input.projectSnapshot.channel.minVideoAssetDurationSeconds = 12;
    input.projectSnapshot.channel.maxVideoAssetDurationSeconds = 30;
    const created = repository.startRun(input);
    const stored = () =>
      f.base.db
        .prepare(
          "SELECT identity_hash,project_snapshot_json FROM pipeline_runs WHERE pipeline_run_id='run_custom'",
        )
        .get();
    const before = stored();
    expect(created.projectSnapshot.channel).toMatchObject({
      minVideoAssetDurationSeconds: 12,
      maxVideoAssetDurationSeconds: 30,
    });
    expect(repository.startRun(input)).toEqual(created);
    expect(repository.getRun('run_custom')).toEqual(created);
    expect(stored()).toEqual(before);
  });
  it.each([
    'partial',
    'partial-max',
    'wrong-type',
    'changed-snapshot',
    'wrong-hash',
    'unknown-field',
    'canonical-hash',
    'canonical-values',
  ])('rejects %s without fallback', (kind) => {
    let snapshot = JSON.parse(String(row().project_snapshot_json));
    if (kind === 'partial') snapshot.channel.minVideoAssetDurationSeconds = 25;
    if (kind === 'partial-max')
      snapshot.channel.maxVideoAssetDurationSeconds = 45;
    if (kind.startsWith('canonical')) {
      snapshot = structuredClone(validateProjectSnapshot(snapshot));
      Object.assign(snapshot.channel, {
        minVideoAssetDurationSeconds: 25,
        maxVideoAssetDurationSeconds: kind === 'canonical-values' ? 0 : 45,
      });
    }
    if (kind === 'wrong-type')
      Object.assign(snapshot.channel, {
        minVideoAssetDurationSeconds: '25',
        maxVideoAssetDurationSeconds: 45,
      });
    if (kind === 'unknown-field') snapshot.channel.extra = true;
    if (kind === 'changed-snapshot') snapshot.project.name = 'Changed';
    rewrite(
      snapshot,
      ['wrong-hash', 'changed-snapshot', 'canonical-hash'].includes(kind)
        ? '0'.repeat(64)
        : undefined,
    );
    expect(() => repository.getRun('run_001')).toThrow(
      kind.endsWith('hash') || kind === 'changed-snapshot'
        ? 'INVALID_PERSISTED_PIPELINE_RUN'
        : undefined,
    );
    expect(() => repository.startRun(replay())).toThrow();
  });
  it('rejects genuine replay differences for historical records', () => {
    const input = structuredClone(replay());
    input.projectSnapshot.project.name = 'Changed';
    expect(() => repository.startRun(input)).toThrow('PIPELINE_RUN_ID_REUSED');
  });
  it('never accepts a canonical digest for a historical snapshot', () => {
    const snapshot = JSON.parse(String(row().project_snapshot_json));
    const r = row();
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          pipelineRunId: r.pipeline_run_id,
          projectId: r.project_id,
          projectVersion: r.project_version,
          startedAt: r.started_at,
          projectSnapshot: validateProjectSnapshot(snapshot),
        }),
      )
      .digest('hex');
    rewrite(snapshot, digest);
    expect(() => repository.getRun('run_001')).toThrow(
      'INVALID_PERSISTED_PIPELINE_RUN',
    );
    expect(() => repository.startRun(replay())).toThrow(
      'INVALID_PERSISTED_PIPELINE_RUN',
    );
  });
  it('rejects replay that changes the canonical asset duration of a historical run', () => {
    const input = replay();
    input.projectSnapshot = structuredClone(
      validateProjectSnapshot(input.projectSnapshot),
    );
    input.projectSnapshot.channel.minVideoAssetDurationSeconds = 26;
    expect(() => repository.startRun(input)).toThrow('PIPELINE_RUN_ID_REUSED');
  });
});
