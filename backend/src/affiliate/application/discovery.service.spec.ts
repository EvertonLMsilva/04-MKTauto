import { AffiliateDiscoveryService } from './discovery.service.js';
import { affiliateFixture } from '../../../test/support/affiliate-fixture.js';
import {
  discoveryCandidate,
  discoveryAt,
} from '../../../test/support/discovery-fixture.js';
import { SqliteDiscoveryRepository } from '../infrastructure/sqlite-discovery.repository.js';
describe('discovery selection boundary', () => {
  let f: ReturnType<typeof affiliateFixture>;
  beforeEach(() => {
    f = affiliateFixture();
  });
  afterEach(() => f.cleanup());
  it('retains the validated command while dependencies resolve asynchronously', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new AffiliateDiscoveryService(
      {
        open: (readOnly = false) =>
          new SqliteDiscoveryRepository(f.database, { readOnly }),
      },
      {
        open: async () => ({
          scope: 'fixture',
          enumerateCandidates: async () => ({
            candidates: [discoveryCandidate()],
            source: {},
            errors: [],
          }),
        }),
      },
      {
        get: async () => {
          await gate;
          return f.base.get('project_001', 1);
        },
      },
      () => discoveryAt,
    );
    const input = {
      discoveryRunId: 'original_one',
      projectId: 'project_001',
      projectVersion: 1,
    };
    const pending = service.select(input);
    input.discoveryRunId = 'mutated_one';
    release();
    expect((await pending).discoveryRunId).toBe('original_one');
  });
  it('validates project, persists/replays selection without commercial writes', async () => {
    const enumerate = vi.fn(async () => ({
      candidates: [discoveryCandidate()],
      errors: [],
      source: {},
    }));
    const source = { scope: 'fixture_scope', enumerateCandidates: enumerate };
    const projects = { get: vi.fn(async () => f.base.get('project_001', 1)) };
    const service = new AffiliateDiscoveryService(
      {
        open: (readOnly = false) =>
          new SqliteDiscoveryRepository(f.database, { readOnly }),
      },
      { open: async () => source },
      projects,
      () => discoveryAt,
    );
    const input = {
      discoveryRunId: 'discover_one',
      projectId: 'project_001',
      projectVersion: 1,
    };
    const first = await service.select(input);
    expect(first.selection?.externalProductId).toBe('item_001');
    expect(await service.select(input)).toEqual(first);
    expect(enumerate).toHaveBeenCalledTimes(1);
    expect(service.get('discover_one')).toEqual(first);
    await expect(
      service.select({ ...input, projectVersion: 2 }),
    ).rejects.toMatchObject({ code: 'DISCOVERY_IDEMPOTENCY_CONFLICT' });
    const second = await service.select({
      ...input,
      discoveryRunId: 'discover_two',
    });
    expect(second.selection).toBeNull();
    expect(second.ranking.rejected).toEqual([
      { externalProductId: 'item_001', reasons: ['PRODUCT_ALREADY_USED'] },
    ]);
    expect(
      f.base.db
        .prepare('SELECT count(*) n FROM affiliate_product_revisions')
        .get().n,
    ).toBe(0);
    expect(
      f.base.db
        .prepare('SELECT count(*) n FROM affiliate_campaign_revisions')
        .get().n,
    ).toBe(0);
    projects.get.mockResolvedValueOnce(null);
    await expect(
      service.select({ ...input, discoveryRunId: 'discover_bad' }),
    ).rejects.toMatchObject({ code: 'DISCOVERY_PROJECT_NOT_FOUND' });
    await expect(
      service.select({ ...input, productionDate: 'forbidden' }),
    ).rejects.toMatchObject({ code: 'DISCOVERY_FIELDS_INVALID' });
  });
});
