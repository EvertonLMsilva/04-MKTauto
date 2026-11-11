import { affiliateFixture } from '../../../../test/support/affiliate-fixture.js';
import { discoveryCandidate } from '../../../../test/support/discovery-fixture.js';
import { raceDiscovery } from '../../../../test/support/discovery-concurrency.js';
import { affiliateHash } from '../domain/affiliate-contracts.js';
describe('discovery SQLite separate executors', () => {
  let f: ReturnType<typeof affiliateFixture>;
  beforeEach(() => {
    f = affiliateFixture();
  });
  afterEach(() => f.cleanup());
  it('serializes exact retries and idempotency conflicts', async () => {
    const input = {
      id: 'discovery_one',
      hash: affiliateHash({ request: 1 }),
      candidate: discoveryCandidate(),
    };
    expect(await raceDiscovery(f.database, [input, input])).toEqual([
      { ok: true, selected: true },
      { ok: true, selected: true },
    ]);
    expect(
      f.base.db
        .prepare('SELECT count(*) n FROM affiliate_discovery_decisions')
        .get().n,
    ).toBe(1);
    expect(
      f.base.db
        .prepare('SELECT count(*) n FROM affiliate_discovery_events')
        .get().n,
    ).toBe(1);
    const conflicts = await raceDiscovery(f.database, [
      input,
      { ...input, hash: affiliateHash({ request: 2 }) },
    ]);
    expect(conflicts).toEqual([
      { ok: true, selected: true },
      { ok: false, code: 'DISCOVERY_IDEMPOTENCY_CONFLICT' },
    ]);
  });
  it('claims a product once across different discovery ids and persists the rejection', async () => {
    const input = {
      id: 'discovery_one',
      hash: affiliateHash({ request: 1 }),
      candidate: discoveryCandidate(),
    };
    const results = await raceDiscovery(f.database, [
      input,
      { ...input, id: 'discovery_two' },
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => r.selected)).toHaveLength(1);
    expect(
      f.base.db
        .prepare(
          'SELECT count(*) n FROM affiliate_discovery_decisions WHERE selected_external_product_id IS NOT NULL',
        )
        .get().n,
    ).toBe(1);
    expect(
      f.base.db
        .prepare(
          "SELECT count(*) n FROM affiliate_discovery_execution WHERE state='BLOCKED'",
        )
        .get().n,
    ).toBe(1);
  });
});
