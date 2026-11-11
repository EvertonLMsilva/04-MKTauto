import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ShopeeCatalogCommit } from '../affiliate/infrastructure/shopee-catalog-commit.js';
import { SqliteAffiliateRepository } from '../affiliate/infrastructure/sqlite-affiliate.repository.js';
const { png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';
import { executionRequest } from './application/campaign-orchestrator.js';
import { ShopeeDynamicService } from '../affiliate/application/shopee-dynamic.service.js';
import { ShopeeDynamicJournal } from '../affiliate/infrastructure/shopee-dynamic-journal.js';
import { ShopeeCatalogService } from '../affiliate/application/shopee-catalog.service.js';
import { FakeShopeeAffiliate } from '../affiliate/infrastructure/shopee-affiliate.provider.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import type { ShopeeDynamicConfiguration } from '../affiliate/domain/shopee-dynamic.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';

function fixture() {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  let at = '2026-11-11T13:00:00.000Z';
  const configuration: ShopeeDynamicConfiguration = {
    projectId: 'project_001',
    niche: 'tecnologia',
    queries: [{ keyword: 'fone' }],
    maxPages: 1,
    maxSelected: 1,
    excludedProductIds: [],
    excludedShopIds: [],
    excludedTerms: [],
    subIds: [],
    authorizations: [],
  };
  const projects = { get: async (id: string) => f.base.get(id) };
  const affiliate = new AffiliateService(
    new SqliteAffiliatePersistence(f.database),
    projects,
  );
  const journal = new ShopeeDynamicJournal(f.database);
  const source = new FakeShopeeAffiliate();
  const offers = vi.spyOn(source, 'queryOfferPage');
  const dynamic = new ShopeeDynamicService(
    new ShopeeCatalogService(source),
    affiliate,
    journal,
    projects,
  );
  const workflow = new NativeCampaignWorkflow(
    affiliate,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  // The real scheduler, request builder, Shopee fake/service and SQLite execute.
  // Stop before production: no media, commercial grants or publisher are created.
  vi.spyOn(workflow, 'execute').mockRejectedValue(
    Object.assign(new Error('CATALOG_PRODUCT_REQUIRED'), {
      code: 'CATALOG_PRODUCT_REQUIRED',
    }),
  );
  const freeze = vi.spyOn(workflow, 'freezeCatalogRequest');
  const open = () =>
    new CampaignAdministration(
      f.database,
      workflow,
      false,
      () => at,
      undefined,
      dynamic,
    );
  let admin = open();
  const input = {
    campaignId: 'camp_001',
    campaignRevision: 1,
    projectVersion: 1,
    requestId: 'dynamic_enable',
    requestedAt: at,
    selectionMode: 'CATALOG',
    recurrence: { enabled: true },
  };
  return {
    f,
    dynamic,
    journal,
    offers,
    freeze,
    configuration,
    input,
    workflow,
    open,
    get admin() {
      return admin;
    },
    setTime: (value: string) => {
      at = value;
    },
    async restart() {
      await admin.onModuleDestroy();
      admin = open();
    },
    async close() {
      await admin.onModuleDestroy();
      f.cleanup();
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test('dynamic activation cannot replace a controlled FAKE recurrence', async () => {
  const f = fixture();
  const open = vi
    .spyOn(f.admin as any, 'open')
    .mockReturnValue({
      recurrences: () => [
        {
          config: {
            request: {
              campaignId: 'camp_001',
              fakeExecutionPolicy: { mode: 'FAKE' },
            },
          },
        },
      ],
    });
  try {
    await expect(
      f.admin.startDynamicCatalog(f.input, f.configuration, 'operator_001'),
    ).rejects.toThrow('CONTROLLED_FAKE_COMMAND_ENDPOINT_REQUIRED');
    expect(f.offers).not.toHaveBeenCalled();
  } finally {
    open.mockRestore();
    await f.close();
  }
});

test('D1 acquires before reservation; D2 uses the official tick after restart; WAITING never fabricates eligibility', async () => {
  const f = fixture();
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('NETWORK_FORBIDDEN'));
  try {
    const run = vi.spyOn(f.dynamic, 'runScheduledCycle');
    f.freeze.mockImplementation((request) => {
      expect(f.offers).toHaveBeenCalled();
      expect(
        f.admin.list().some((e) => e.scheduled_at === request.scheduledAt),
      ).toBe(false);
      return { ...request, catalogSelection: null };
    });
    const first = await f.admin.startDynamicCatalog(
      f.input,
      f.configuration,
      'operator_001',
    );
    expect(run.mock.results).toHaveLength(1);
    expect(
      (await run.mock.results[0].value).decisions.every(
        (d: any) => d.status === 'WAITING',
      ),
    ).toBe(true);
    expect(
      executionRequest(f.admin.history(first.execution_id)).catalogSelection,
    ).toBeNull();
    expect(
      await f.admin.startDynamicCatalog(
        f.input,
        f.configuration,
        'operator_001',
      ),
    ).toMatchObject({ execution_id: first.execution_id });
    expect(f.offers).toHaveBeenCalledTimes(1);
    await f.restart();
    f.setTime('2026-11-12T13:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(2);
    expect(f.offers).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][1]).not.toBe(run.mock.calls[1][1]);
    await f.admin.tick();
    expect(f.offers).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

test('concurrent scheduler owners do not duplicate acquisition or the frozen occurrence', async () => {
  const f = fixture();
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  try {
    await f.admin.startDynamicCatalog(f.input, f.configuration, 'operator_001');
    f.setTime('2026-11-12T13:00:00.000Z');
    const other = f.open();
    try {
      await Promise.all([f.admin.tick(), other.tick()]);
    } finally {
      await other.onModuleDestroy();
    }
    expect(f.admin.list()).toHaveLength(2);
    expect(f.offers).toHaveBeenCalledTimes(2);
  } finally {
    await f.close();
  }
});

test('changing provider mode cannot promote a persisted FAKE recurrence to LIVE', async () => {
  const f = fixture();
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  try {
    await f.admin.startDynamicCatalog(f.input, f.configuration, 'operator_001');
    await f.restart();
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
    f.setTime('2026-11-12T13:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(1);
    expect(f.offers).toHaveBeenCalledTimes(1);
  } finally {
    await f.close();
  }
});

test('disabled acquisition preserves ordinary CATALOG and FIXED paths; LIVE and mismatched projects fail before acquisition', async () => {
  const f = fixture();
  try {
    await f.admin.startLocal(f.input);
    await f.restart();
    f.setTime('2026-11-12T13:00:00.000Z');
    await f.admin.tick();
    expect(f.offers).not.toHaveBeenCalled();
    await expect(
      f.admin.startDynamicCatalog(
        { ...f.input, selectionMode: 'FIXED', localImage: {} },
        f.configuration,
        'operator_001',
      ),
    ).rejects.toThrow('SHOPEE_DYNAMIC_CATALOG_RECURRENCE_REQUIRED');
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
    await expect(
      f.admin.startDynamicCatalog(f.input, f.configuration, 'operator_001'),
    ).rejects.toThrow('SHOPEE_LIVE_AUTHORIZATION_REQUIRED');
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
    await expect(
      f.admin.startDynamicCatalog(
        f.input,
        { ...f.configuration, projectId: 'other_project' },
        'operator_001',
      ),
    ).rejects.toThrow('SHOPEE_DYNAMIC_PROJECT_MISMATCH');
    expect(f.offers).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

test('a lease prevents recovery of active work; expired persisted discovery resumes without any transport', async () => {
  const f = fixture();
  try {
    await f.dynamic.configure(f.configuration);
    const cycleId = 'cycle_crashed';
    const key = affiliateHash({ projectId: 'project_001', cycleId });
    f.journal.put('CYCLE', key, 'CLAIM', {
      configuration: f.configuration,
      cycleId,
    });
    f.journal.put('CYCLE', key, 'DISCOVERY', {
      offers: [],
      calls: 1,
      truncated: false,
      observations: [],
    });
    f.journal.put('SCHEDULER_LEASE', key, '1', {
      generation: 1,
      expiresAt: 5000,
    });
    await expect(
      f.dynamic.runScheduledCycle('project_001', cycleId, 4000),
    ).rejects.toThrow('SHOPEE_CYCLE_BUSY');
    expect(
      await f.dynamic.runScheduledCycle('project_001', cycleId, 5001),
    ).toMatchObject({ decisions: [] });
    expect(f.offers).not.toHaveBeenCalled();
    const unknown = 'cycle_unknown';
    f.journal.put(
      'CYCLE',
      affiliateHash({ projectId: 'project_001', cycleId: unknown }),
      'CLAIM',
      { configuration: f.configuration, cycleId: unknown },
    );
    await expect(
      f.dynamic.runScheduledCycle('project_001', unknown),
    ).rejects.toThrow('SHOPEE_DISCOVERY_RECOVERY_UNAVAILABLE');
  } finally {
    await f.close();
  }
});

test('official D2 tick recovers a worker stopped after discovery without reserving early or repeating the query', async () => {
  const f = fixture();
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  try {
    await f.admin.startDynamicCatalog(f.input, f.configuration, 'operator_001');
    await f.restart();
    f.setTime('2026-11-12T13:00:00.000Z');
    const prepare = vi
      .spyOn(f.dynamic as any, 'prepareCycle')
      .mockRejectedValueOnce(new Error('WORKER_STOPPED'));
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(1);
    expect(f.offers).toHaveBeenCalledTimes(2);
    prepare.mockRestore();
    const recover = vi.spyOn(f.dynamic, 'recoverCycle');
    await f.admin.tick();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(f.admin.list()).toHaveLength(2);
    expect(f.offers).toHaveBeenCalledTimes(2);
  } finally {
    await f.close();
  }
});

test('PREPARED from an offline Shopee source reaches the unchanged ROUND_ROBIN CATALOG before D1 and D2 reservations', async () => {
  const f = fixture();
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('NETWORK_FORBIDDEN'));
  let admin: CampaignAdministration | undefined;
  try {
    // Synthetic evidence exists only in this disposable fixture, never as an
    // operational grant. Production rights continue through the real validator.
    const bytes = png(),
      hash = createHash('sha256').update(bytes).digest('hex');
    const root = join(dirname(f.f.database), 'dynamic-media');
    const directory = join(root, 'sha256', hash.slice(0, 2));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, hash + '.png'), bytes);
    vi.stubEnv('FFMPEG_MEDIA_ROOT', root);
    const repo = new SqliteAffiliateRepository(f.f.database);
    const template = repo.getProduct('prod_001', 1)!;
    repo.close();
    const mediaRef = 'media:dynamic_fixture';
    const grant = {
      id: 'ev_dynamic_rights',
      kind: 'MEDIA_USAGE_RIGHT' as const,
      sourceRef: 'FICTITIOUS_TEST_ONLY:license',
      recordedAt: f.input.requestedAt,
      mediaAuthorization: {
        mediaRef,
        contentHash: hash,
        commercialUse: 'GRANTED' as const,
        processing: 'GRANTED' as const,
        localProcessing: true,
        externalProviders: [],
      },
    };
    const product = {
      ...template,
      productId: 'shopee_11',
      name: 'Fone 11',
      media: [{ mediaRef, evidenceRef: grant.id }],
      evidence: [
        ...template.evidence.filter((e) => e.kind === 'PRODUCT_SPECIFICATION'),
        grant,
      ],
      localImage: {
        mediaReference: mediaRef,
        contentHash: hash,
        origin: 'AUTHORIZED_THIRD_PARTY' as const,
        provider: null,
        rights: {
          usageBasis: 'LICENSED' as const,
          commercialUseAllowed: true,
          evidence: [grant],
        },
      },
    };
    const provenance = {
      source: 'FAKE' as const,
      fixtureVersion: 'dynamic-hook-test/1',
      observedAt: null,
    };
    const offer = {
      offerId: 'shopee-item-11',
      productId: '11',
      shopId: '7',
      name: product.name,
      price: { amount: '10', currency: null },
      estimatedCommission: { amount: '1', rate: '0.1', currency: null },
      imageUrl: 'https://example.invalid/11.png',
      productUrl: 'https://shopee.com.br/product/7/11',
      affiliateUrl: 'https://s.shopee.com.br/offer11',
      description: null,
      availability: null,
      shopName: null,
      priceRange: {
        min: { amount: null, currency: null },
        max: { amount: null, currency: null },
      },
      discountPercent: null,
      provenance,
    };
    const url = 'https://s.shopee.com.br/fixture11';
    const page = vi.fn(async () => ({
      offers: [offer],
      pageInfo: { page: 1, limit: 10, hasNextPage: false, nextPage: null },
    }));
    const link = vi.fn(async () => ({
      offerId: offer.offerId,
      url,
      originUrl: offer.productUrl,
      subIds: [],
      associationVerified: false as const,
      provenance,
    }));
    const source = {
      queryOfferPage: page,
      queryOffers: async () => [offer],
      generateLink: link,
    } as any;
    const projects = { get: async (id: string) => f.f.base.get(id) };
    const affiliate = new AffiliateService(
      new SqliteAffiliatePersistence(f.f.database),
      projects,
      new ShopeeCatalogCommit(f.f.database),
    );
    const dynamic = new ShopeeDynamicService(
      new ShopeeCatalogService(source),
      affiliate,
      f.journal,
      projects,
    );
    const proof = (subject: unknown) => ({
      subjectHash: affiliateHash(subject),
      sourceRef: 'FICTITIOUS_TEST_ONLY:review',
      recordedAt: f.input.requestedAt,
    });
    const configuration = {
      ...f.configuration,
      authorizations: [
        {
          externalProductId: '11',
          shopId: '7',
          product,
          mediaBinding: proof({
            externalProductId: '11',
            shopId: '7',
            imageUrl: offer.imageUrl,
            mediaRef,
            contentHash: hash,
            faithful: true,
          }),
          commercialApproval: proof({
            projectId: 'project_001',
            externalProductId: '11',
            shopId: '7',
            productHash: affiliateHash(product),
          }),
          association: proof({
            projectId: 'project_001',
            campaignId: 'shopee_project_001_11',
            productId: '11',
            shopId: '7',
            offerId: offer.offerId,
            originUrl: offer.productUrl,
            url,
            subIds: [],
          }),
        },
      ],
    };
    let at = f.input.requestedAt;
    const open = () =>
      new CampaignAdministration(
        f.f.database,
        f.workflow,
        false,
        () => at,
        undefined,
        dynamic,
      );
    admin = open();
    const first = await admin.startDynamicCatalog(
      f.input,
      configuration,
      'operator_001',
    );
    const selected = executionRequest(
      admin.history(first.execution_id),
    ).catalogSelection;
    expect(selected).toMatchObject({
      method: 'ROUND_ROBIN_ID_V1',
      productId: 'shopee_11',
    });
    await admin.onModuleDestroy();
    at = '2026-11-12T13:00:00.000Z';
    admin = open();
    await admin.tick();
    const second = admin
      .list()
      .find((e) => e.production_date === '2026-11-12')!;
    expect(
      executionRequest(admin.history(second.execution_id)).catalogSelection,
    ).toMatchObject({ productId: 'shopee_11' });
    await admin.tick();
    expect(page).toHaveBeenCalledTimes(2);
    expect(link).toHaveBeenCalledTimes(1);
    expect(
      executionRequest(admin.history(first.execution_id)).catalogSelection,
    ).toEqual(selected);
    expect(network).not.toHaveBeenCalled();
  } finally {
    await admin?.onModuleDestroy();
    await f.close();
  }
});
