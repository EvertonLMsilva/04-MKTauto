import { AffiliateRunContextService } from './affiliate-run-context.service.js';
import { SqliteAffiliateRunContextRepository } from '../infrastructure/sqlite-affiliate-run-context.repository.js';
import {
  affiliateRunFixture,
  outcome,
} from '../../../../test/support/affiliate-run-fixture.js';
import { campaign, product } from '../../../../test/support/affiliate-fixture.js';

describe('Affiliate briefing/run/context JS × TS', () => {
  let fixture: ReturnType<typeof affiliateRunFixture>;
  let ts: AffiliateRunContextService;
  beforeEach(() => {
    fixture = affiliateRunFixture();
    ts = new AffiliateRunContextService({
      open: (readOnly = false) =>
        new SqliteAffiliateRunContextRepository(fixture.database, { readOnly }),
    });
  });
  afterEach(() => fixture?.cleanup());
  const binding = { pipelineRunId: 'run_001', briefingId: 'brief_001' };
  const request = {
    generationRequestId: 'generation:001',
    contentHash: 'a'.repeat(64),
  };
  it('writes TS binding/receipt readable and replayable by JS, with exact history', () => {
    const saved = ts.bindRun(binding, 'bind_one');
    expect(saved).toEqual(fixture.catalog.bindRun(binding, 'bind_one'));
    expect(ts.getRunBinding('run_001')).toEqual(
      fixture.catalog.getRunBinding('run_001'),
    );
    expect(ts.resolveRunBriefing('run_001')).toEqual(
      fixture.catalog.resolveRunBriefing('run_001'),
    );
    expect(Object.isFrozen(saved)).toBe(true);
    const bytes = fixture.base.db
      .prepare(
        'SELECT result_json FROM affiliate_commands WHERE idempotency_key=?',
      )
      .get('bind_one').result_json;
    fixture.base.transitionRun({
      pipelineRunId: 'run_001',
      nextState: 'SUCCEEDED',
      completedAt: '2026-10-14T13:00:00Z',
    });
    expect(ts.bindRun(binding, 'bind_one')).toEqual(saved);
    expect(ts.bindRun(binding, 'bind_again')).toEqual(saved);
    expect(ts.resolveRunBriefing('run_001')).toEqual(
      fixture.catalog.resolveRunBriefing('run_001'),
    );
    expect(
      fixture.base.db
        .prepare(
          'SELECT result_json FROM affiliate_commands WHERE idempotency_key=?',
        )
        .get('bind_one').result_json,
    ).toBe(bytes);
  });
  it('reads/replays a JS binding and preserves command conflicts', () => {
    const saved = fixture.catalog.bindRun(binding, 'bind_one');
    expect(ts.bindRun(binding, 'bind_one')).toEqual(saved);
    expect(outcome(() => ts.bindRun(binding, 'product_one'))).toEqual(
      outcome(() => fixture.catalog.bindRun(binding, 'product_one')),
    );
    expect(
      outcome(() =>
        ts.bindRun({ ...binding, briefingId: 'missing' }, 'bind_one'),
      ),
    ).toEqual(
      outcome(() =>
        fixture.catalog.bindRun(
          { ...binding, briefingId: 'missing' },
          'bind_one',
        ),
      ),
    );
  });
  it.each([
    null,
    {},
    { ...binding, extra: true },
    { ...binding, pipelineRunId: '../bad' },
    { ...binding, briefingId: '' },
    { ...binding, pipelineRunId: 'missing' },
    { ...binding, briefingId: 'missing' },
  ])('preserves binding validation/reference failures %#', (input) => {
    expect(outcome(() => ts.bindRun(input, 'bad_binding'))).toEqual(
      outcome(() => fixture.catalog.bindRun(input, 'bad_binding')),
    );
  });
  it('rejects a run of another project without a receipt', () => {
    fixture.base.create({
      id: 'project_other',
      name: 'Other',
      niche: 'Tecnologia',
      audience: { profile: 'Adultos' },
      channel: { publishing: { networks: ['instagram'] } },
    });
    fixture.start('run_other', 'project_other');
    const input = { ...binding, pipelineRunId: 'run_other' };
    expect(outcome(() => ts.bindRun(input, 'wrong_scope'))).toEqual(
      outcome(() => fixture.catalog.bindRun(input, 'wrong_scope')),
    );
    expect(
      fixture.base.db
        .prepare('SELECT 1 FROM affiliate_commands WHERE idempotency_key=?')
        .get('wrong_scope'),
    ).toBeUndefined();
  });
  it('rejects a new binding on a terminal run', () => {
    fixture.base.transitionRun({
      pipelineRunId: 'run_001',
      nextState: 'SUCCEEDED',
      completedAt: '2026-10-14T13:00:00Z',
    });
    expect(outcome(() => ts.bindRun(binding, 'late'))).toEqual(
      outcome(() => fixture.catalog.bindRun(binding, 'late')),
    );
  });
  it('blocks late binding after persisted script-generation telemetry', () => {
    fixture.base.db
      .prepare(
        `INSERT INTO ai_call_telemetry
      (ai_call_id,logical_call_id,schema_version,identity_hash,request_hash,pipeline_run_id,project_id,project_version,provider,model,task_type,prompt_version,occurred_at,outcome,failure_code,recorded_at)
      VALUES (?,?,?, ?,?, 'run_001','project_001',1,'fixture','offline','script_generation','fixture/1.0.0','2026-10-14T12:01:00Z','FAILURE','FIXTURE_FAILED','2026-10-14T12:01:00Z')`,
      )
      .run(
        'ai_call_fixture',
        'generation:fixture',
        'ai-call-telemetry/1.0.0',
        'a'.repeat(64),
        'b'.repeat(64),
      );
    expect(outcome(() => ts.bindRun(binding, 'late_telemetry'))).toEqual(
      outcome(() => fixture.catalog.bindRun(binding, 'late_telemetry')),
    );
    expect(outcome(() => ts.bindRun(binding, 'late_telemetry'))).toEqual({
      code: 'AFFILIATE_RUN_BINDING_TOO_LATE',
      field: 'pipelineRunId',
    });
  });
  it('validates execution project/version against its stored snapshot', () => {
    fixture.base.db.exec('DROP TRIGGER pipeline_runs_no_identity_update;');
    fixture.base.db
      .prepare(
        'UPDATE pipeline_runs SET project_snapshot_json=? WHERE pipeline_run_id=?',
      )
      .run(
        JSON.stringify(fixture.base.get('project_001', 1)).replace(
          '"version":1',
          '"version":2',
        ),
        'run_001',
      );
    expect(outcome(() => ts.bindRun(binding, 'invalid_version'))).toEqual(
      outcome(() => fixture.catalog.bindRun(binding, 'invalid_version')),
    );
    expect(outcome(() => ts.bindRun(binding, 'invalid_version'))).toEqual({
      code: 'INVALID_PERSISTED_PIPELINE_RUN',
      field: 'pipelineRunId',
    });
  });
  it('preserves historical run versions after Project advances and accepts the next run version', () => {
    fixture.base.createVersion(
      {
        id: 'project_001',
        version: 2,
        name: 'Version two',
        niche: 'Tecnologia',
        audience: { profile: 'Adultos' },
        channel: { publishing: { networks: ['instagram'] } },
      },
      { expectedVersion: 1 },
    );
    expect(ts.bindRun(binding, 'bind_old_version')).toEqual(
      fixture.catalog.bindRun(binding, 'bind_old_version'),
    );
    fixture.start('run_version_two', 'project_001', 2);
    const next = { ...binding, pipelineRunId: 'run_version_two' };
    expect(ts.bindRun(next, 'bind_new_version')).toEqual(
      fixture.catalog.bindRun(next, 'bind_new_version'),
    );
    expect(ts.resolveRunBriefing('run_001')).toEqual(
      fixture.catalog.resolveRunBriefing('run_001'),
    );
  });
  it('keeps bindings and reservations immutable at SQL level', () => {
    ts.bindRun(binding, 'bind_one');
    ts.prepareScriptGeneration(request, 'run_001');
    for (const table of [
      'affiliate_run_bindings',
      'affiliate_script_contexts',
    ]) {
      expect(() => fixture.base.db.exec(`DELETE FROM ${table}`)).toThrow(
        'IMMUTABLE_',
      );
      expect(() =>
        fixture.base.db.exec(`UPDATE ${table} SET briefing_hash=briefing_hash`),
      ).toThrow('IMMUTABLE_');
    }
    expect(
      fixture.base.db.prepare('PRAGMA user_version').get().user_version,
    ).toBe(39);
  });
  it('preserves unbound resolution and optional expected briefing semantics', () => {
    expect(ts.resolveRunBriefing('run_001')).toBeNull();
    for (const expected of ['brief_001', '../bad'])
      expect(outcome(() => ts.resolveRunBriefing('run_001', expected))).toEqual(
        outcome(() => fixture.catalog.resolveRunBriefing('run_001', expected)),
      );
    ts.bindRun(binding, 'bind_one');
    expect(
      outcome(() => ts.resolveRunBriefing('run_001', 'other_brief')),
    ).toEqual(
      outcome(() =>
        fixture.catalog.resolveRunBriefing('run_001', 'other_brief'),
      ),
    );
  });
  it('reserves generic context atomically and blocks a later binding, including null hash', () => {
    expect(ts.prepareScriptGeneration(request, 'run_001')).toBeNull();
    expect(
      fixture.catalog.prepareScriptGeneration(request, 'run_001'),
    ).toBeNull();
    expect(outcome(() => ts.bindRun(binding, 'late'))).toEqual(
      outcome(() => fixture.catalog.bindRun(binding, 'late')),
    );
    expect(
      fixture.base.db
        .prepare('SELECT briefing_hash FROM affiliate_script_contexts')
        .get().briefing_hash,
    ).toBeNull();
    expect(
      fixture.base.db
        .prepare('SELECT count(*) n FROM affiliate_script_contexts')
        .get().n,
    ).toBe(1);
  });
  it('reads JS contexts, reserves bound context in TS, and preserves request/run/hash conflicts', () => {
    fixture.catalog.bindRun(binding, 'bind_one');
    const brief = fixture.catalog.prepareScriptGeneration(request, 'run_001');
    expect(ts.prepareScriptGeneration(request, 'run_001')).toEqual(brief);
    const next = { ...request, generationRequestId: 'generation:002' };
    expect(ts.prepareScriptGeneration(next, 'run_001', 'brief_001')).toEqual(
      fixture.catalog.prepareScriptGeneration(next, 'run_001', 'brief_001'),
    );
    fixture.start('run_other');
    for (const [r, run] of [
      [{ ...request, contentHash: 'b'.repeat(64) }, 'run_001'],
      [request, 'run_other'],
    ] as const)
      expect(outcome(() => ts.prepareScriptGeneration(r, run))).toEqual(
        outcome(() => fixture.catalog.prepareScriptGeneration(r, run)),
      );
    expect(
      outcome(() => ts.verifyScriptGenerationContext(request, 'run_001', null)),
    ).toEqual(
      outcome(() =>
        fixture.catalog.verifyScriptGenerationContext(request, 'run_001', null),
      ),
    );
    expect(
      ts.verifyScriptGenerationContext(request, 'run_001', brief),
    ).toBeUndefined();
    expect(
      ts.verifyScriptGenerationContext(
        { ...request, generationRequestId: 'not_reserved' },
        'run_001',
        null,
      ),
    ).toBeUndefined();
  });
  it('rejects a different briefing for an already-bound run', () => {
    ts.bindRun(binding, 'bind_one');
    fixture.catalog.registerCampaign(
      campaign({ revision: 2, cta: 'Changed' }),
      'campaign_two',
    );
    fixture.catalog.createBriefing(
      { briefingId: 'brief_002', campaignId: 'camp_001', campaignRevision: 2 },
      'brief_two',
    );
    expect(
      outcome(() =>
        ts.bindRun({ ...binding, briefingId: 'brief_002' }, 'new_binding'),
      ),
    ).toEqual(
      outcome(() =>
        fixture.catalog.bindRun(
          { ...binding, briefingId: 'brief_002' },
          'new_binding',
        ),
      ),
    );
  });
  it('detects tampered binding hashes and scope columns', () => {
    fixture.catalog.bindRun(binding, 'bind_one');
    fixture.base.db.exec('DROP TRIGGER affiliate_run_bindings_no_update;');
    fixture.base.db
      .prepare('UPDATE affiliate_run_bindings SET briefing_hash=?')
      .run('f'.repeat(64));
    expect(outcome(() => ts.resolveRunBriefing('run_001'))).toEqual(
      outcome(() => fixture.catalog.resolveRunBriefing('run_001')),
    );
    fixture.catalog.registerProduct(product({ revision: 2 }), 'product_two');
    fixture.base.db
      .prepare(
        'UPDATE affiliate_run_bindings SET briefing_hash=?, product_revision=2',
      )
      .run(fixture.catalog.getBriefing('brief_001').contentHash);
    expect(outcome(() => ts.resolveRunBriefing('run_001'))).toEqual(
      outcome(() => fixture.catalog.resolveRunBriefing('run_001')),
    );
  });
  it('rolls back binding/receipt and context inserts when persistence fails', () => {
    fixture.base.db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON affiliate_commands WHEN NEW.idempotency_key='rollback' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
    );
    expect(() => ts.bindRun(binding, 'rollback')).toThrow('fixture failure');
    expect(ts.getRunBinding('run_001')).toBeNull();
    fixture.base.db.exec(
      "CREATE TRIGGER fail_context AFTER INSERT ON affiliate_script_contexts BEGIN SELECT RAISE(ABORT,'context failure'); END;",
    );
    expect(() => ts.prepareScriptGeneration(request, 'run_001')).toThrow(
      'context failure',
    );
    expect(
      fixture.base.db
        .prepare('SELECT count(*) n FROM affiliate_script_contexts')
        .get().n,
    ).toBe(0);
  });
});
