import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { SqliteAffiliateRepository } from '../affiliate/infrastructure/sqlite-affiliate.repository.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { ContentOperationsService } from './application/content-operations.service.js';
import { OperationsPersistence } from './infrastructure/operations.persistence.js';
import { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import { executionRequest } from './application/campaign-orchestrator.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CampaignOrchestrationModule } from './campaign-orchestration.module.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { EDITORIAL_PROVIDER } from '../content/application/editorial-provider.port.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';

function fixture(count = 3) {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const catalog = new SqliteAffiliateRepository(f.database);
  const template = catalog.getProduct('prod_001', 1)!;
  const campaign = catalog.getCampaign('camp_001', 1)!;
  const register = (
    id: string,
    revision = 1,
    overrides: Record<string, unknown> = {},
  ) => {
    const mediaReference = `media:${id}`;
    const evidence = [
      {
        id: 'ev_media',
        kind: 'MEDIA_USAGE_RIGHT',
        sourceRef: 'fixture:permission',
        recordedAt: '2026-11-01T00:00:00Z',
        mediaAuthorization: {
          mediaRef: mediaReference,
          contentHash: 'a'.repeat(64),
          commercialUse: 'GRANTED',
          processing: 'GRANTED',
          localProcessing: true,
          externalProviders: [],
        },
      },
    ];
    const product = {
      ...template,
      productId: id,
      revision,
      name: id,
      status: 'ACTIVE',
      media: [{ mediaRef: mediaReference, evidenceRef: 'ev_media' }],
      evidence: [
        ...template.evidence.filter((e) => e.kind === 'PRODUCT_SPECIFICATION'),
        ...evidence,
      ],
      localImage: {
        mediaReference,
        contentHash: 'a'.repeat(64),
        origin: 'OPERATOR_OWNED',
        provider: null,
        rights: { usageBasis: 'OWNED', commercialUseAllowed: true, evidence },
      },
      ...overrides,
    };
    if (product.localImage === undefined)
      delete (product as Record<string, unknown>).localImage;
    catalog.registerProduct(product, `register_${id}_${revision}`);
    catalog.registerCampaign(
      {
        ...campaign,
        campaignId: `offer_${id}`,
        revision,
        productId: id,
        productRevision: revision,
      },
      `offer_${id}_${revision}`,
      true,
    );
    return product;
  };
  for (let i = 0; i < count; i++)
    register(`prod_${String.fromCharCode(97 + i)}`);
  const projects = {
    get: async (id: string, version?: number) => f.base.get(id, version),
  };
  const affiliate = new AffiliateService(
    {
      open: (ro) => new SqliteAffiliateRepository(f.database, { readOnly: ro }),
    },
    projects,
  );
  const binding = new AffiliateRunContextService(
    new SqliteAffiliateRunContextPersistence(f.database),
  );
  const operations = new ContentOperationsService(
    new OperationsPersistence(f.database),
    projects,
    binding,
  );
  const workflow = new NativeCampaignWorkflow(
    affiliate,
    binding,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {
      getGlobalUsage: () => ({
        dailyUsd: '0',
        monthlyUsd: '0',
        policy: {
          time_zone: 'America/Sao_Paulo',
          daily_usd: '1',
          monthly_usd: '10',
        },
      }),
      getGlobalOperation: () => null,
    } as any,
    operations,
    { approvals: () => [] } as any,
  );
  // Run the real selection, validation, briefing, run binding and persistence.
  // Stop before editorial transports/media; approval rules are covered by the existing recurrence suite.
  const execute = workflow.execute.bind(workflow);
  vi.spyOn(workflow, 'execute').mockImplementation((step, ...args) => {
    if (step === 'CONTEXT') return execute(step, ...args);
    throw Object.assign(new Error('EDITORIAL_PROVIDER_UNAVAILABLE'), {
      code: 'EDITORIAL_PROVIDER_UNAVAILABLE',
    });
  });
  let at = '2026-11-07T13:00:00.000Z';
  const open = () =>
    new CampaignAdministration(f.database, workflow, false, () => at);
  let admin = open();
  const input = {
    campaignId: 'camp_001',
    campaignRevision: 1,
    projectVersion: 1,
    requestId: 'catalog_enable',
    requestedAt: at,
    selectionMode: 'CATALOG',
    recurrence: { enabled: true },
  };
  const request = (id: string) => executionRequest(admin.history(id));
  return {
    f,
    catalog,
    input,
    register,
    workflow,
    binding,
    open,
    request,
    get admin() {
      return admin;
    },
    setTime(value: string) {
      at = value;
    },
    async restart() {
      await admin.onModuleDestroy();
      admin = open();
    },
    async close() {
      await admin.onModuleDestroy();
      catalog.close();
      f.cleanup();
    },
  };
}

test('CATALOG freezes A/B/C/A across dates, restart, replay and concurrent schedulers; no catch-up', async () => {
  const f = fixture();
  try {
    const first = await f.admin.startLocal(f.input);
    await f.admin.tick();
    expect(f.request(first.execution_id).catalogSelection).toMatchObject({
      productId: 'prod_a',
      productRevision: 1,
      method: 'ROUND_ROBIN_ID_V1',
    });
    expect(await f.admin.startLocal(f.input)).toEqual(
      expect.objectContaining({ execution_id: first.execution_id }),
    );
    f.setTime('2026-11-08T13:00:00.000Z');
    const other = f.open();
    try {
      await Promise.all([f.admin.tick(), other.tick()]);
    } finally {
      await other.onModuleDestroy();
    }
    const second = f.admin
      .list()
      .find((e) => e.production_date === '2026-11-08')!;
    const frozen = f.request(second.execution_id);
    expect(frozen.catalogSelection).toMatchObject({ productId: 'prod_b' });
    await f.restart();
    await f.admin.tick();
    expect(f.request(second.execution_id)).toEqual(frozen);
    f.setTime('2026-11-10T13:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list().some((e) => e.production_date === '2026-11-09')).toBe(
      false,
    );
    expect(
      f.request(
        f.admin.list().find((e) => e.production_date === '2026-11-10')!
          .execution_id,
      ).catalogSelection,
    ).toMatchObject({ productId: 'prod_c' });
    f.setTime('2026-11-11T13:00:00.000Z');
    await f.admin.tick();
    expect(
      f.request(
        f.admin.list().find((e) => e.production_date === '2026-11-11')!
          .execution_id,
      ).catalogSelection,
    ).toMatchObject({ productId: 'prod_a' });
    expect(f.admin.list()).toHaveLength(4);
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    for (const e of f.admin.list()) {
      expect(e.finalization.pending?.code).toBe(
        'EDITORIAL_PROVIDER_UNAVAILABLE',
      );
      expect(f.binding.resolveRunBriefing(e.run_id)?.productId).toBe(
        (f.request(e.execution_id).catalogSelection as any).productId,
      );
      expect(
        f.admin
          .history(e.execution_id)
          .filter((h) => h.event_type === 'PRODUCT_SELECTED'),
      ).toHaveLength(1);
      expect(f.request(e.execution_id).publication).toBeUndefined();
      expect(
        f.admin
          .history(e.execution_id)
          .some((h) => h.event_type === 'HUMAN_APPROVAL'),
      ).toBe(false);
    }
  } finally {
    await f.close();
  }
});

test('single eligible product repeats on future dates; newer revisions never rewrite frozen history', async () => {
  const f = fixture(1);
  try {
    const first = await f.admin.startLocal(f.input);
    const frozen = f.request(first.execution_id);
    f.register('prod_a', 2, { name: 'Revisão nova' });
    await f.restart();
    await f.admin.tick();
    expect(f.request(first.execution_id)).toEqual(frozen);
    expect(f.binding.resolveRunBriefing(first.run_id)?.productRevision).toBe(1);
    f.setTime('2026-11-08T13:00:00.000Z');
    await f.admin.tick();
    const next = f.admin
      .list()
      .find((e) => e.production_date === '2026-11-08')!;
    expect(f.request(next.execution_id).catalogSelection).toMatchObject({
      productId: 'prod_a',
      productRevision: 2,
    });
  } finally {
    await f.close();
  }
});

test('switching from FIXED on a new date excludes the previous fixed product; same-day mode changes conflict', async () => {
  const f = fixture(1);
  try {
    const product = {
      ...f.catalog.getProduct('prod_001', 1)!,
      ...f.catalog.getProduct('prod_a', 1)!,
      productId: 'prod_001',
      revision: 2,
    };
    f.catalog.registerProduct(product, 'legacy_product_current');
    f.catalog.registerCampaign(
      {
        ...f.catalog.getCampaign('camp_001', 1)!,
        campaignId: 'offer_legacy',
        revision: 1,
        productRevision: 2,
      },
      'legacy_current_offer',
      true,
    );
    const { selectionMode: _mode, ...fixed } = f.input;
    await f.admin.startLocal({
      ...fixed,
      localImage: { mediaReference: 'authorized-image-001' },
    });
    await expect(
      f.admin.startLocal({ ...f.input, requestId: 'switch_same_day' }),
    ).rejects.toMatchObject({
      code: 'CAMPAIGN_DAY_CONFLICT',
    });
    const catalog = await f.admin.startLocal({
      ...f.input,
      requestId: 'switch_catalog',
      requestedAt: '2026-11-08T13:00:00.000Z',
    });
    expect(f.request(catalog.execution_id).catalogSelection).toMatchObject({
      productId: 'prod_a',
      previousProductId: 'prod_001',
    });
  } finally {
    await f.close();
  }
});

test.each([undefined, 'FIXED'])(
  'selectionMode=%s keeps historical fixed product despite eligible alternatives',
  async (selectionMode) => {
    const f = fixture();
    try {
      const input = {
        ...f.input,
        localImage: { mediaReference: 'authorized-image-001' },
        ...(selectionMode ? { selectionMode } : {}),
      };
      if (!selectionMode)
        delete (input as Record<string, unknown>).selectionMode;
      const first = await f.admin.startLocal(input);
      await f.admin.tick();
      f.setTime('2026-11-08T13:00:00.000Z');
      await f.admin.tick();
      expect(f.admin.list()).toHaveLength(2);
      for (const e of f.admin.list()) {
        expect(f.admin.get(e.execution_id).selectionMode).toBe('FIXED');
        expect(f.binding.resolveRunBriefing(e.run_id)?.productId).toBe(
          'prod_001',
        );
        expect(f.request(e.execution_id).catalogSelection).toBeUndefined();
      }
      expect(f.request(first.execution_id).localImage).toEqual(
        input.localImage,
      );
    } finally {
      await f.close();
    }
  },
);

test('empty catalog blocks, and a later eligible date resumes rotation without backfilling the blocked occurrence', async () => {
  const f = fixture(0);
  try {
    const first = await f.admin.startLocal(f.input);
    await f.admin.tick();
    expect(f.admin.get(first.execution_id).status).toBe('WAITING_INPUT');
    f.register('prod_a');
    f.register('prod_b');
    await f.admin.tick();
    expect(f.request(first.execution_id).catalogSelection).toBeNull();
    f.setTime('2026-11-08T13:00:00.000Z');
    await f.admin.tick();
    expect(
      f.request(
        f.admin.list().find((e) => e.production_date === '2026-11-08')!
          .execution_id,
      ).catalogSelection,
    ).toMatchObject({ productId: 'prod_a' });
    await f.admin.startLocal({
      ...f.input,
      requestId: 'disable_catalog',
      recurrence: { enabled: false },
    });
    await f.restart();
    f.setTime('2026-11-09T13:00:00.000Z');
    await f.admin.tick();
    expect(f.admin.list()).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test.each([
  'archived',
  'missing-media',
  'invalid-link',
  'missing-evidence',
  'invalid-product',
  'scoped-rights',
])(
  'ineligible %s never reaches production and leaves explicit WAITING_INPUT',
  async (kind) => {
    const f = fixture(1);
    try {
      if (kind === 'archived') f.register('prod_a', 2, { status: 'ARCHIVED' });
      if (kind === 'missing-media')
        f.register('prod_a', 2, { localImage: undefined });
      if (kind === 'invalid-link') {
        const c = {
          ...f.catalog.getCampaign('offer_prod_a', 1)!,
          revision: 2,
          affiliateUrl: 'javascript:bad',
        };
        f.catalog.db
          .prepare(
            'INSERT INTO affiliate_campaign_revisions VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            c.campaignId,
            c.revision,
            c.projectId,
            c.productId,
            c.productRevision,
            affiliateHash(c),
            JSON.stringify(c),
          );
      }
      if (
        kind === 'missing-evidence' ||
        kind === 'invalid-product' ||
        kind === 'scoped-rights'
      ) {
        const p = structuredClone(f.catalog.getProduct('prod_a', 1)!) as any;
        if (kind === 'missing-evidence') p.evidence = [];
        if (kind === 'invalid-product') p.name = '';
        if (kind === 'scoped-rights')
          p.localImage.rights.evidence[0].mediaAuthorization.operationScope =
            'qc_only';
        // Insert an untrusted current revision without changing immutable history.
        p.revision = 2;
        f.catalog.db
          .prepare('INSERT INTO affiliate_product_revisions VALUES(?,?,?,?)')
          .run(p.productId, 2, affiliateHash(p), JSON.stringify(p));
        const c = {
          ...f.catalog.getCampaign('offer_prod_a', 1)!,
          revision: 2,
          productRevision: 2,
        };
        f.catalog.db
          .prepare(
            'INSERT INTO affiliate_campaign_revisions VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            c.campaignId,
            c.revision,
            c.projectId,
            c.productId,
            c.productRevision,
            affiliateHash(c),
            JSON.stringify(c),
          );
      }
      const e = await f.admin.startLocal(f.input);
      await f.admin.tick();
      expect(f.admin.get(e.execution_id)).toMatchObject({
        status: 'WAITING_INPUT',
        finalization: { pending: { code: 'CATALOG_PRODUCT_REQUIRED' } },
      });
      expect(f.request(e.execution_id).catalogSelection).toBeNull();
      expect(
        f.f.base.db
          .prepare('SELECT count(*) n FROM affiliate_run_bindings')
          .get()?.n,
      ).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test('HTTP/Nest E2E: real persisted selection and editorial on three dates, restart preserves B', async () => {
  const f = fixture();
  const offer = {
    ...f.catalog.getCampaign('offer_prod_b', 1)!,
    revision: 2,
    affiliateUrl: 'https://s.shopee.com.br/catalog-fixture',
  };
  f.catalog.registerCampaign(offer, 'offer_b_source', true);
  f.catalog.associateCampaignSource(
    {
      schemaVersion: 'affiliate-campaign-source/1.0.0',
      sourceId: 'source_catalog_b',
      revision: 1,
      source: 'SHOPEE_AFFILIATE_API',
      offer: {
        offerId: 'fixture_b',
        productId: 'fixture_b',
        shopId: null,
        provenance: {
          source: 'FAKE',
          fixtureVersion: 'catalog/1',
          observedAt: null,
        },
      },
      productId: 'prod_b',
      productRevision: 1,
      campaignId: offer.campaignId,
      campaignRevision: 2,
      briefingId: null,
      affiliateUrl: offer.affiliateUrl,
    },
    'source_catalog_b',
    ['media:prod_b'],
  );
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('NO_EXTERNAL_TRANSPORT'));
  const image = vi.fn((_scope, source) => ({
    mediaAssetId: `fixture_${source.mediaReference}`,
    contentHash: source.contentHash,
  }));
  for (const [key, value] of Object.entries({
    PROJECT_API_DATABASE: f.f.database,
    SOCIAL_HISTORY_DATABASE: f.f.database,
    CAMPAIGN_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_PUBLICATION_MODE: 'fake',
    INSTAGRAM_LIVE_POSTS_ENABLED: 'false',
    INSTAGRAM_ACCOUNT_ID: '123456789',
    INSTAGRAM_API_VERSION: 'v25.0',
  }))
    vi.stubEnv(key, value);
  const build = async () => {
    const module = await Test.createTestingModule({
      imports: [CampaignOrchestrationModule],
    })
      .overrideProvider(EDITORIAL_PROVIDER)
      .useValue(new FakeEditorialProvider())
      .overrideProvider(LocalFlowService)
      .useValue({
        prepareImage: image,
        authorizedAudio: () => null,
        automaticAudioReady: () => false,
        automaticAudio: async () => {
          throw Object.assign(new Error('LOCAL_TTS_CONFIGURATION_REQUIRED'), {
            code: 'LOCAL_TTS_CONFIGURATION_REQUIRED',
          });
        },
      })
      .compile();
    const app = module.createNestApplication();
    await app.init();
    return app;
  };
  let app: Awaited<ReturnType<typeof build>> | undefined;
  let admin: CampaignAdministration | undefined;
  try {
    app = await build();
    let now = f.input.requestedAt;
    admin = new CampaignAdministration(
      f.f.database,
      app.get(NativeCampaignWorkflow),
      false,
      () => now,
    );
    const first = await request(app.getHttpServer())
      .post('/content-operations/campaign-executions/local')
      .send(f.input)
      .expect(201);
    await admin.tick();
    now = '2026-11-08T13:00:00.000Z';
    await admin.tick();
    const second = admin
      .list()
      .find((e) => e.production_date === '2026-11-08')!;
    expect(second.productSelection).toMatchObject({ productId: 'prod_b' });
    expect(
      f.catalog.resolveBriefingSource(
        String((second.productSelection as any).briefingId),
      ),
    ).toMatchObject({ sourceId: 'source_catalog_b', revision: 2 });
    await admin.onModuleDestroy();
    await app.close();
    app = await build();
    admin = new CampaignAdministration(
      f.f.database,
      app.get(NativeCampaignWorkflow),
      false,
      () => now,
    );
    await admin.tick();
    expect(admin.get(second.execution_id).productSelection).toEqual(
      second.productSelection,
    );
    now = '2026-11-09T13:00:00.000Z';
    await admin.tick();
    const days = admin
      .list()
      .sort((a, b) => a.production_date.localeCompare(b.production_date));
    expect(days.map((e) => (e.productSelection as any).productId)).toEqual([
      'prod_a',
      'prod_b',
      'prod_c',
    ]);
    expect(days[0].execution_id).toBe(first.body.execution_id);
    for (const e of days) {
      expect(e.finalization.pending?.code).toBe(
        'LOCAL_TTS_CONFIGURATION_REQUIRED',
      );
      expect(
        admin
          .history(e.execution_id)
          .some(
            (h) =>
              h.event_type === 'STEP_DONE' && h.evidence.step === 'EDITORIAL',
          ),
      ).toBe(true);
    }
    expect([
      ...new Set(image.mock.calls.map(([, source]) => source.mediaReference)),
    ]).toEqual(['media:prod_a', 'media:prod_b', 'media:prod_c']);
    expect(
      f.f.base.db
        .prepare('SELECT count(*) n FROM scripts WHERE script_id LIKE ?')
        .get('script:editorial_%')?.n,
    ).toBe(3);
    expect(f.f.base.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(
      1,
    );
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await admin?.onModuleDestroy();
    await app?.close();
    await f.close();
    fetch.mockRestore();
    vi.unstubAllEnvs();
  }
});
