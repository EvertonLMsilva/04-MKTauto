import { p2EditorialFixture } from '../../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../../infrastructure/administration/schema-provisioner.js';
import {
  ShopeeDynamicService,
  shopeeOperationalCycleId,
} from './shopee-dynamic.service.js';
import { ShopeeCatalogService } from './shopee-catalog.service.js';
import { AffiliateService } from './affiliate.service.js';
import { ShopeeDynamicJournal } from '../infrastructure/shopee-dynamic-journal.js';
import { SqliteAffiliatePersistence } from '../infrastructure/sqlite-affiliate.persistence.js';
import {
  shopeeAffiliateProvider,
  withShopeeLiveAuthorization,
} from '../infrastructure/shopee-affiliate.provider.js';
import type { ShopeeDynamicConfiguration } from '../domain/shopee-dynamic.js';
import { affiliateHash } from '../domain/affiliate-contracts.js';

let f: ReturnType<typeof p2EditorialFixture>, service: ShopeeDynamicService;
let configuration: ShopeeDynamicConfiguration;
let fetch: ReturnType<typeof vi.fn>;
const scope = () => ({
  authorizationId: 'grant_live_001',
  campaignId: 'camp_001',
  campaignRevision: 1,
  productionDates: ['2026-11-11'],
  notBefore: '2026-11-01T00:00:00Z',
  expiresAt: '2026-12-01T00:00:00Z',
  maxOfferPages: 1,
  maxLinks: 0,
  periodic: false,
  evidenceRef: 'FICTITIOUS_TEST_ONLY:explicit-operator-approval',
  costBasis: 'NO_CHARGE_CONFIRMED' as const,
  costEvidenceRef: 'FICTITIOUS_TEST_ONLY:no-charge-contract',
});
beforeEach(() => {
  vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-11-11T12:00:00Z'));
  f = p2EditorialFixture();
  provisionSchema(f.base.db);
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
  vi.stubEnv('SHOPEE_AFFILIATE_APP_ID', 'synthetic-app');
  vi.stubEnv('SHOPEE_AFFILIATE_SECRET', 'synthetic-secret');
  fetch = vi.fn(async () =>
    Response.json({
      data: {
        productOfferV2: {
          nodes: [
            {
              itemId: '11',
              shopId: '7',
              productName: 'Fone',
              price: '10',
              commissionRate: '0.1',
            },
          ],
          pageInfo: { page: 1, limit: 1, hasNextPage: false },
        },
      },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const projects = { get: async (id: string) => f.base.get(id) };
  service = new ShopeeDynamicService(
    new ShopeeCatalogService(shopeeAffiliateProvider.useFactory()),
    new AffiliateService(new SqliteAffiliatePersistence(f.database), projects),
    new ShopeeDynamicJournal(f.database),
    projects,
  );
  configuration = {
    projectId: 'project_001',
    niche: 'tecnologia',
    queries: [{ keyword: 'fone', limit: 1 }],
    maxPages: 1,
    maxSelected: 1,
    excludedProductIds: [],
    excludedShopIds: [],
    excludedTerms: [],
    subIds: [],
    authorizations: [],
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  f.cleanup();
});
async function approve(s = scope()) {
  const preview = await service.previewLiveAuthorization(configuration, s);
  await service.approveLiveAuthorization(
    configuration,
    s,
    preview.scopeHash,
    'operator_001',
  );
  await service.configure(configuration);
  return s.authorizationId;
}
test('configured LIVE does not authorize HTTP; missing credentials fail without HTTP', async () => {
  await expect(
    shopeeAffiliateProvider.useFactory().queryOffers(),
  ).rejects.toThrow('SHOPEE_LIVE_AUTHORIZATION_REQUIRED');
  vi.stubEnv('SHOPEE_AFFILIATE_SECRET', '');
  expect(() => shopeeAffiliateProvider.useFactory()).toThrow(
    'SHOPEE_LIVE_CREDENTIALS_MISSING',
  );
  expect(fetch).not.toHaveBeenCalled();
});
test('preview is inert; confirmation binds exact reviewed scope, not a changed configuration', async () => {
  const preview = await service.previewLiveAuthorization(
    configuration,
    scope(),
  );
  await expect(
    service.approveLiveAuthorization(
      { ...configuration, subIds: ['changed'] },
      scope(),
      preview.scopeHash,
      'operator_001',
    ),
  ).rejects.toThrow('SHOPEE_LIVE_SCOPE_MISMATCH');
  expect(fetch).not.toHaveBeenCalled();
});
test('one authorized cycle works offline, remains WAITING without rights, and replays after restart without HTTP', async () => {
  const grant = await approve();
  const cycle = shopeeOperationalCycleId('camp_001', '2026-11-11');
  const first = await service.runAuthorizedScheduledCycle(
    'project_001',
    cycle,
    grant,
    'camp_001',
    '2026-11-11',
  );
  expect(first.decisions[0].status).toBe('WAITING');
  expect(fetch).toHaveBeenCalledTimes(1);
  const restarted = new ShopeeDynamicService(
    new ShopeeCatalogService(shopeeAffiliateProvider.useFactory()),
    {} as any,
    new ShopeeDynamicJournal(f.database),
    { get: async (id) => f.base.get(id) },
  );
  expect(
    await restarted.runAuthorizedScheduledCycle(
      'project_001',
      cycle,
      grant,
      'camp_001',
      '2026-11-11',
    ),
  ).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('scope rejects wrong campaign/date/configuration, expiry, missing grant and implicit periodic use before HTTP', async () => {
  const grant = await approve();
  for (const [g, c, d] of [
    [grant, 'other_campaign', '2026-11-11'],
    [grant, 'camp_001', '2026-11-12'],
    ['missing_grant', 'camp_001', '2026-11-11'],
  ])
    await expect(
      service.runAuthorizedScheduledCycle('project_001', 'cycle_bad', g, c, d),
    ).rejects.toThrow('SHOPEE_LIVE_AUTHORIZATION_REQUIRED');
  await service.configure({ ...configuration, subIds: ['changed'] });
  await expect(
    service.runAuthorizedScheduledCycle(
      'project_001',
      shopeeOperationalCycleId('camp_001', '2026-11-11'),
      grant,
      'camp_001',
      '2026-11-11',
    ),
  ).rejects.toThrow('SHOPEE_LIVE_SCOPE_MISMATCH');
  await expect(
    service.previewLiveAuthorization(configuration, {
      ...scope(),
      productionDates: ['2026-11-11', '2026-11-12'],
    }),
  ).rejects.toThrow('SHOPEE_LIVE_AUTHORIZATION_INVALID');
  expect(fetch).not.toHaveBeenCalled();
});

test('expired approval, a FAKE cycle receipt and a different campaign revision cannot authorize transport', async () => {
  const grant = await approve(),
    cycle = shopeeOperationalCycleId('camp_001', '2026-11-11');
  await expect(
    service.runAuthorizedScheduledCycle(
      'project_001',
      cycle,
      grant,
      'camp_001',
      '2026-11-11',
      2,
    ),
  ).rejects.toThrow('SHOPEE_LIVE_AUTHORIZATION_REQUIRED');
  const now = vi
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-12-01T00:00:00Z'));
  try {
    await expect(
      service.runAuthorizedScheduledCycle(
        'project_001',
        cycle,
        grant,
        'camp_001',
        '2026-11-11',
      ),
    ).rejects.toThrow('SHOPEE_LIVE_AUTHORIZATION_REQUIRED');
  } finally {
    now.mockReturnValue(Date.parse('2026-11-11T12:00:00Z'));
  }
  new ShopeeDynamicJournal(f.database).put(
    'CYCLE',
    affiliateHash({ projectId: 'project_001', cycleId: cycle }),
    'CLAIM',
    { executionMode: 'FAKE' },
  );
  await expect(
    service.runAuthorizedScheduledCycle(
      'project_001',
      cycle,
      grant,
      'camp_001',
      '2026-11-11',
    ),
  ).rejects.toThrow('SHOPEE_LIVE_SCOPE_MISMATCH');
  expect(fetch).not.toHaveBeenCalled();
});
test('persisted grant is immutable and cannot be broadened under the same identity', async () => {
  await approve();
  const next = { ...scope(), maxLinks: 1 };
  const preview = await service.previewLiveAuthorization(configuration, next);
  await expect(
    service.approveLiveAuthorization(
      configuration,
      next,
      preview.scopeHash,
      'operator_001',
    ),
  ).rejects.toThrow('SHOPEE_LIVE_SCOPE_MISMATCH');
  expect(() =>
    f.base.db.exec(
      "UPDATE affiliate_shopee_dynamic_events_v1 SET content_json='{}' WHERE topic='LIVE_AUTHORIZATION'",
    ),
  ).toThrow('APPEND_ONLY');
  expect(fetch).not.toHaveBeenCalled();
});
test('transport enforces read/link caps and refuses FAKE capabilities before HTTP', async () => {
  const provider = shopeeAffiliateProvider.useFactory();
  const permit = {
    mode: 'SHOPEE_LIVE' as const,
    expiresAt: '2026-12-01T00:00:00Z',
    maxOfferPages: 1,
    maxLinks: 0,
    reserve: vi.fn(),
  };
  await withShopeeLiveAuthorization(permit, async () => {
    await provider.queryOfferPage({ limit: 1 });
    expect(() => provider.queryOfferPage({ limit: 1 })).toThrow(
      'SHOPEE_LIVE_CALL_LIMIT',
    );
    expect(() =>
      provider.generateLink({
        offerId: 'shopee-item-11',
        originUrl: 'https://shopee.com.br/product/7/11',
      }),
    ).toThrow('SHOPEE_LIVE_CALL_LIMIT');
  });
  await withShopeeLiveAuthorization(
    { ...permit, mode: 'FAKE' as any },
    async () => {
      await expect(provider.queryOffers()).rejects.toThrow(
        'SHOPEE_LIVE_AUTHORIZATION_REQUIRED',
      );
    },
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(permit.reserve).toHaveBeenCalledTimes(1);
});
test('concurrent authorized callers share the durable cycle reservation; recovery reuses persisted discovery only', async () => {
  const grant = await approve(),
    cycle = shopeeOperationalCycleId('camp_001', '2026-11-11');
  const results = await Promise.allSettled([
    service.runAuthorizedScheduledCycle(
      'project_001',
      cycle,
      grant,
      'camp_001',
      '2026-11-11',
    ),
    service.runAuthorizedScheduledCycle(
      'project_001',
      cycle,
      grant,
      'camp_001',
      '2026-11-11',
    ),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});
