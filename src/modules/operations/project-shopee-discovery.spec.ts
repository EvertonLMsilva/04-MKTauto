import { ProjectShopeeDiscoveryService } from './project-shopee-discovery.service.js';
import { ShopeeCatalogService } from '../affiliate/application/shopee-catalog.service.js';
import { FakeShopeeAffiliate } from '../affiliate/infrastructure/shopee-affiliate.provider.js';
export const input = () => ({
  schemaVersion: 'operations-project-shopee-discovery/1.0.0',
  niche: 'tecnologia',
  queries: [{ keyword: 'fone', limit: 1 }],
  maxPages: 2,
  maxCandidates: 2,
});
function fixture() {
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  const provider = new FakeShopeeAffiliate();
  const catalog = new ShopeeCatalogService(provider);
  const projects = {
    get: vi.fn(async () => ({
      project: { id: 'project_001', version: 1, niche: 'tecnologia' },
    })),
  };
  return {
    provider,
    catalog,
    projects,
    service: new ProjectShopeeDiscoveryService(
      catalog,
      projects as never,
      provider,
    ),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
test('project-only preview reuses discovery, preserves unknown commission and never generates a link', async () => {
  const f = fixture();
  const discover = vi.spyOn(f.catalog, 'discover');
  const link = vi.spyOn(f.provider, 'generateLink');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_FORBIDDEN');
    }),
  );
  const r = await f.service.preview('project_001', input());
  expect(discover).toHaveBeenCalledWith(input().queries, 2);
  expect(r.candidates).toHaveLength(2);
  expect(r.candidates[1].estimatedCommission.rate).toBeNull();
  expect(r.candidates[1].price.amount).toBeNull();
  expect(r.candidates[0].eligibility).toBe('NOT_EVALUATED');
  expect(r.authorizationsGranted).toBe(false);
  expect(r.handoff.next).toBe('REVIEW_RIGHTS_AND_ASSOCIATION');
  expect(link).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
test.each(['live', 'LIVE', 'invalid'])(
  'rejects mode %s before project or transport access',
  async (mode) => {
    const f = fixture();
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', mode);
    const discover = vi.spyOn(f.catalog, 'discover');
    await expect(
      f.service.preview('project_001', input()),
    ).rejects.toMatchObject({ code: 'SHOPEE_PREVIEW_OFFLINE_ONLY' });
    expect(discover).not.toHaveBeenCalled();
    expect(f.projects.get).not.toHaveBeenCalled();
  },
);
test('rejects an unproven provider even if the environment claims fake', async () => {
  const f = fixture();
  const service = new ProjectShopeeDiscoveryService(
    f.catalog,
    f.projects as never,
    {} as never,
  );
  await expect(service.preview('project_001', input())).rejects.toMatchObject({
    code: 'SHOPEE_PREVIEW_OFFLINE_ONLY',
  });
});
test.each([
  { campaignId: 'x' },
  { executionId: 'x' },
  { authorizations: [] },
  { url: 'https://example.com' },
  { maxCandidates: 6 },
  { maxPages: 0 },
  { excludedProductIds: null },
  { queries: [{ keyword: 'x', page: 2 }] },
  { schemaVersion: 'invalid' },
])('rejects invalid or out-of-scope input %j', async (change) => {
  const f = fixture();
  const discover = vi.spyOn(f.catalog, 'discover');
  await expect(
    f.service.preview('project_001', { ...input(), ...change }),
  ).rejects.toThrow();
  expect(discover).not.toHaveBeenCalled();
});
test.each([
  { niche: 'outro' },
  { projectVersion: 2 },
  { projectId: 'project_002' },
])('rejects mismatched canonical identity/niche %j', async (change) => {
  const f = fixture();
  const discover = vi.spyOn(f.catalog, 'discover');
  await expect(
    f.service.preview('project_001', { ...input(), ...change }),
  ).rejects.toThrow();
  expect(discover).not.toHaveBeenCalled();
});

test('a LIVE mode change while the canonical project is read still prevents discovery', async () => {
  const f = fixture();
  const project = await f.projects.get();
  f.projects.get.mockImplementation(async () => {
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
    return project;
  });
  const discover = vi.spyOn(f.catalog, 'discover');
  await expect(f.service.preview('project_001', input())).rejects.toMatchObject(
    { code: 'SHOPEE_PREVIEW_OFFLINE_ONLY' },
  );
  expect(discover).not.toHaveBeenCalled();
});
test('a discovery failure is exposed as unavailable, never an invented empty result', async () => {
  const f = fixture();
  vi.spyOn(f.catalog, 'discover').mockRejectedValue(
    new Error('private transport details'),
  );
  await expect(f.service.preview('project_001', input())).rejects.toMatchObject(
    { code: 'SHOPEE_DISCOVERY_UNAVAILABLE', status: 503 },
  );
});
