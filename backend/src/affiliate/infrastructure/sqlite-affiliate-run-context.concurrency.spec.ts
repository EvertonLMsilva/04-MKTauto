import { affiliateRunFixture } from '../../../test/support/affiliate-run-fixture.js';
import { raceRunContext } from '../../../test/support/affiliate-run-concurrency.js';
describe('Affiliate run/context concurrent SQLite sessions', () => {
  let fixture: ReturnType<typeof affiliateRunFixture>;
  beforeEach(() => {
    fixture = affiliateRunFixture();
  });
  afterEach(() => fixture?.cleanup());
  it('serializes simultaneous exact binding retries into one binding and receipt', async () => {
    const input = {
      kind: 'bind' as const,
      briefingId: 'brief_001',
      key: 'bind_one',
    };
    expect(await raceRunContext(fixture.database, [input, input])).toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(
      fixture.base.db
        .prepare('SELECT count(*) n FROM affiliate_run_bindings')
        .get().n,
    ).toBe(1);
    expect(
      fixture.base.db
        .prepare(
          "SELECT count(*) n FROM affiliate_commands WHERE command_type='BIND_RUN'",
        )
        .get().n,
    ).toBe(1);
  });
  it('rejects a competing briefing without persisting its receipt', async () => {
    fixture.catalog.createBriefing(
      { briefingId: 'brief_002', campaignId: 'camp_001', campaignRevision: 1 },
      'brief_two',
    );
    const results = await raceRunContext(fixture.database, [
      { kind: 'bind', briefingId: 'brief_001', key: 'bind_one' },
      { kind: 'bind', briefingId: 'brief_002', key: 'bind_two' },
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.code).toBe(
      'AFFILIATE_RUN_BINDING_CONFLICT',
    );
    expect(
      fixture.base.db
        .prepare(
          "SELECT count(*) n FROM affiliate_commands WHERE command_type='BIND_RUN'",
        )
        .get().n,
    ).toBe(1);
  });
  it('keeps binding/reservation race consistent: generic reservation wins or captures the exact binding', async () => {
    const [binding, reservation] = await raceRunContext(fixture.database, [
      { kind: 'bind', briefingId: 'brief_001', key: 'bind_one' },
      { kind: 'reserve', hash: 'a'.repeat(64) },
    ]);
    expect(reservation.ok).toBe(true);
    const context = fixture.base.db
      .prepare('SELECT briefing_hash FROM affiliate_script_contexts')
      .get();
    const saved = fixture.catalog.getRunBinding('run_001');
    if (saved) {
      expect(binding.ok).toBe(true);
      expect(context.briefing_hash).toBe(saved.briefingHash);
    } else {
      expect(binding).toEqual({
        ok: false,
        code: 'AFFILIATE_RUN_BINDING_TOO_LATE',
      });
      expect(context.briefing_hash).toBeNull();
    }
    expect(reservation.briefingHash).toBe(context.briefing_hash);
  });
  it('reserves a request once and rejects concurrent conflicting hashes', async () => {
    const results = await raceRunContext(fixture.database, [
      { kind: 'reserve', hash: 'a'.repeat(64) },
      { kind: 'reserve', hash: 'b'.repeat(64) },
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.code).toBe(
      'AFFILIATE_SCRIPT_CONTEXT_CONFLICT',
    );
    expect(
      fixture.base.db
        .prepare('SELECT count(*) n FROM affiliate_script_contexts')
        .get().n,
    ).toBe(1);
  });
});
