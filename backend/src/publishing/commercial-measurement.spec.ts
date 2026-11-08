import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { ContentOperationsService } from '../content-operations/application/content-operations.service.js';
import { OperationsPersistence } from '../content-operations/infrastructure/operations.persistence.js';
import { NativeCampaignWorkflow } from '../content-operations/application/native-campaign-workflow.js';
import { CampaignRepository } from '../content-operations/infrastructure/campaign.repository.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { FinanceSession } from '../finance/infrastructure/finance.session.js';
import { PublishingService } from './application/publishing.service.js';
import { PublishingPersistence } from './infrastructure/publishing.persistence.js';
import { PublishingController } from './publishing.controller.js';
import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { deterministicInstagramPorts } from './infrastructure/instagram-fake.js';

const at = '2026-11-08T13:00:00.000Z';
const unknown = { status: 'UNKNOWN', reason: 'NOT_REPORTED' };
const input = {
  actor: 'operator_001',
  attribution: 'DIRECT_PUBLICATION',
  sourceReference: 'fixture:affiliate-report',
  periodStart: '2026-11-08T00:00:00Z',
  periodEnd: '2026-11-09T00:00:00Z',
};

async function fixture() {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const persistence = new SqliteAffiliatePersistence(f.database);
  const projects = {
    get: async (id: string, version?: number) => f.base.get(id, version),
  };
  const affiliate = new AffiliateService(persistence, projects);
  const binding = new AffiliateRunContextService(
    new SqliteAffiliateRunContextPersistence(f.database),
  );
  const operations = new ContentOperationsService(
    new OperationsPersistence(f.database),
    projects,
    binding,
  );
  const repo = persistence.open();
  try {
    const oldProduct = repo.getProduct('prod_001', 1)!;
    const evidence = {
      id: 'ev_rotation',
      kind: 'MEDIA_USAGE_RIGHT',
      sourceRef: 'fixture:permission',
      recordedAt: at,
      mediaAuthorization: {
        mediaRef: 'media:catalog',
        contentHash: 'a'.repeat(64),
        commercialUse: 'GRANTED',
        processing: 'GRANTED',
        localProcessing: true,
        externalProviders: [],
      },
    };
    const product = {
      ...oldProduct,
      revision: 2,
      status: 'ACTIVE',
      media: [{ mediaRef: 'media:catalog', evidenceRef: 'ev_rotation' }],
      evidence: [
        ...oldProduct.evidence.filter(
          (e) => e.kind === 'PRODUCT_SPECIFICATION',
        ),
        evidence,
      ],
      localImage: {
        mediaReference: 'media:catalog',
        contentHash: 'a'.repeat(64),
        origin: 'OPERATOR_OWNED',
        provider: null,
        rights: {
          usageBasis: 'OWNED',
          commercialUseAllowed: true,
          evidence: [evidence],
        },
      },
    };
    repo.registerProduct(product, 'measurement_product');
    const campaign = {
      ...repo.getCampaign('camp_001', 1)!,
      revision: 2,
      productRevision: 2,
    };
    repo.registerCampaign(campaign, 'measurement_campaign', true);
    repo.registerProduct(
      { ...product, productId: 'prod_002', revision: 1, name: 'Produto B' },
      'measurement_product_b',
    );
    repo.registerCampaign(
      {
        ...campaign,
        campaignId: 'offer_b',
        revision: 1,
        productId: 'prod_002',
        productRevision: 1,
        affiliateUrl: 'https://example.com/affiliate/b',
      },
      'measurement_offer_b',
      true,
    );
  } finally {
    repo.close();
  }
  const renders = new Map<string, any>(),
    reports = new Map<string, any>();
  const media = {
    getVideoRender: (id: string) => renders.get(id),
    report: (id: string) => reports.get(id),
    verifyMedia: (ref: string) => ref.slice('render:sha256_'.length),
  };
  const finance = new FinanceService({
    open: () => new FinanceSession(f.database),
  });
  const store = new PublishingPersistence(
    f.database,
    persistence,
    binding,
    media,
    f.database,
  );
  const publishing = new (PublishingService as any)(
    store,
    media,
    finance,
  ) as PublishingService;
  const workflow = new NativeCampaignWorkflow(
    affiliate,
    binding,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    finance,
    operations,
    publishing,
  );
  const campaigns = new CampaignRepository(f.base.db);
  async function occurrence(day: string) {
    const now = `${day}T13:00:00.000Z`;
    const template = await workflow.localRequest({
      campaignId: 'camp_001',
      campaignRevision: 2,
      projectVersion: 1,
      requestId: `measure_${day.replaceAll('-', '')}`,
      requestedAt: now,
      selectionMode: 'CATALOG',
    });
    const execution = campaigns.scheduleCatalog(template, now, (previous) =>
      workflow.freezeCatalogRequest(template, previous),
    );
    const frozen = campaigns.history(execution.execution_id)[0].evidence as any;
    const selected = frozen.catalogSelection;
    await affiliate.createCatalogBriefing(
      {
        briefingId: frozen.briefingId,
        campaignId: selected.sourceCampaignId,
        campaignRevision: selected.sourceCampaignRevision,
      },
      selected.briefingHash,
    );
    await operations.start(frozen.run);
    binding.bindRun(
      { pipelineRunId: execution.run_id, briefingId: frozen.briefingId },
      `bind_${day.replaceAll('-', '')}`,
    );
    const hash = createHash('sha256').update(execution.run_id).digest('hex');
    const render = {
      videoRenderId: `render_${day.replaceAll('-', '')}`,
      contentHash: hash,
      revision: 1,
      logicalReference: `render:sha256_${hash}`,
      projectId: 'project_001',
      projectVersion: 1,
      pipelineRunId: execution.run_id,
      origin: { rights: { commercialUseAuthorized: true } },
    };
    const report = {
      qualityControlReportId: `qc_${day.replaceAll('-', '')}`,
      contentHash: 'b'.repeat(64),
      videoRenderId: render.videoRenderId,
      videoRenderContentHash: hash,
      projectId: 'project_001',
      projectVersion: 1,
      pipelineRunId: execution.run_id,
      result: 'PASS',
      approvalBlocked: false,
      findings: [
        'COMMERCIAL_RIGHTS',
        'PROCESSING_RIGHTS',
        'NARRATION_RIGHTS',
      ].map((code) => ({ code, status: 'PASS' })),
    };
    renders.set(render.videoRenderId, render);
    reports.set(report.qualityControlReportId, report);
    const pkg = publishing.prepare(
      {
        campaignId: selected.sourceCampaignId,
        campaignRevision: selected.sourceCampaignRevision,
        videoRenderId: render.videoRenderId,
        qualityControlReportId: report.qualityControlReportId,
        platform: 'instagram',
        account: '123456789',
        caption: 'Produto com evidência',
      },
      `package_${day.replaceAll('-', '')}`,
    );
    publishing.review(
      {
        packageHash: pkg.contentHash,
        decision: 'APPROVED',
        actor: 'operator_001',
        justification: null,
      },
      `review_${day.replaceAll('-', '')}`,
    );
    return { execution, pkg, frozen, render, now };
  }
  function manual(
    o: Awaited<ReturnType<typeof occurrence>>,
    state = 'PUBLISHED',
  ) {
    return publishing.recordPublication(
      {
        packageHash: o.pkg.contentHash,
        actor: 'operator_001',
        publishedAt: o.now,
        externalId: `manual_${o.execution.execution_id}`,
        externalUrl: `https://instagram.com/p/${o.execution.execution_id}/`,
        evidenceReference: 'fixture:fake-confirmation',
        state,
      },
      `publication_${o.execution.production_date.replaceAll('-', '')}`,
    );
  }
  function cost(
    o: Awaited<ReturnType<typeof occurrence>>,
    amount = '2.1',
    currency = 'BRL',
  ) {
    return finance.register({
      schemaVersion: 'cost-event/1.0.0',
      costEventId: `cost_${o.execution.execution_id}`,
      category: 'production_cost',
      pipelineRunId: o.execution.run_id,
      projectId: 'project_001',
      projectVersion: 1,
      contentIdentity: null,
      artifactId: null,
      amount,
      currency,
      occurredAt: at,
      recordedAt: at,
      origin: 'fixture_measured',
      attributionRuleVersion: 'fixture/1.0.0',
    });
  }
  return {
    f,
    affiliate,
    binding,
    finance,
    store,
    publishing: publishing as any,
    media,
    campaigns,
    occurrence,
    manual,
    cost,
    close: () => f.cleanup(),
  };
}

test('confirmed publication resolves frozen catalog identity; absent measurements and costs stay UNKNOWN', async () => {
  const f = await fixture();
  try {
    const o = await f.occurrence('2026-11-08');
    const pub = f.manual(o);
    const result = f.publishing.recordCommercialResults(
      { kind: 'execution', id: o.execution.execution_id },
      input,
      'observation_001',
    );
    expect(result.identity).toMatchObject({
      publicationId: pub.publicationId,
      executionId: o.execution.execution_id,
      campaignId: 'camp_001',
      productId: 'prod_001',
      productRevision: 2,
      affiliateLink: { url: o.pkg.link, campaignRevision: 2 },
    });
    const summary = f.publishing.commercialSummary({
      kind: 'execution',
      id: o.execution.execution_id,
    });
    expect(summary.metrics.views.status).toBe('UNKNOWN');
    expect(summary.commission.status).toBe('UNKNOWN');
    expect(summary.knownCost.status).toBe('UNKNOWN');
    expect(summary.knownNetResult.status).toBe('UNKNOWN');
  } finally {
    f.close();
  }
});

test.each(['missing', 'unconfirmed'])(
  'rejects results for %s confirmation',
  async (state) => {
    const f = await fixture();
    try {
      const o = await f.occurrence('2026-11-08');
      if (state === 'unconfirmed') f.manual(o, 'UNCONFIRMED');
      expect(() =>
        f.publishing.recordCommercialResults(
          { kind: 'execution', id: o.execution.execution_id },
          input,
          'unconfirmed_results',
        ),
      ).toThrow(/CONFIRMED_PUBLICATION_REQUIRED/);
    } finally {
      f.close();
    }
  },
);

test('known commission minus Finance costs uses exact decimals; replay, correction and restart preserve history', async () => {
  const f = await fixture();
  try {
    const o = await f.occurrence('2026-11-08');
    f.manual(o);
    f.cost(o);
    const target = { kind: 'execution', id: o.execution.execution_id };
    const observed = {
      ...input,
      metrics: { views: { status: 'KNOWN', value: 123 } },
      commissions: { status: 'KNOWN', amount: '10.2', currency: 'BRL' },
      sales: { status: 'KNOWN', value: 1 },
    };
    const first = f.publishing.recordCommercialResults(
      target,
      observed,
      'known_results',
    );
    expect(
      f.publishing.recordCommercialResults(target, observed, 'known_results'),
    ).toEqual(first);
    expect(
      f.publishing.recordCommercialResults(
        target,
        observed,
        'known_results_retry',
      ),
    ).toEqual(first);
    expect(f.publishing.commercialSummary(target).knownNetResult).toMatchObject(
      { status: 'KNOWN', amount: '8.1', currency: 'BRL' },
    );
    expect(() =>
      f.publishing.recordCommercialResults(
        target,
        {
          ...observed,
          commissions: { status: 'KNOWN', amount: '11.2', currency: 'BRL' },
        },
        'conflicting_results',
      ),
    ).toThrow(/CONFLICT/);
    const corrected = f.publishing.recordCommercialResults(
      target,
      {
        ...observed,
        expectedRevision: 1,
        correctionReason: 'Corrected report',
        commissions: { status: 'KNOWN', amount: '11.2', currency: 'BRL' },
      },
      'corrected_results',
    );
    expect(corrected.revision).toBe(2);
    expect(corrected.previousResultHash).toBe(first.contentHash);
    const reopened = new (PublishingService as any)(
      f.store,
      f.media,
      f.finance,
    );
    expect(reopened.commercialSummary(target).knownNetResult.amount).toBe(
      '9.1',
    );
    expect(reopened.commercialSummary(target).history).toHaveLength(2);
    expect(
      f.f.base.db
        .prepare(
          "SELECT count(*) n FROM manual_distribution_records WHERE kind='RESULTS'",
        )
        .get()?.n,
    ).toBe(2);
  } finally {
    f.close();
  }
});

test('rotated product and repeated product publications keep independent attribution; caller cannot inject identity', async () => {
  const f = await fixture();
  try {
    const a = await f.occurrence('2026-11-08');
    f.manual(a);
    const b = await f.occurrence('2026-11-09');
    f.manual(b);
    const c = await f.occurrence('2026-11-10');
    f.manual(c);
    const value = {
      ...input,
      commissions: { status: 'KNOWN', amount: '3', currency: 'BRL' },
    };
    for (const o of [a, b, c])
      f.publishing.recordCommercialResults(
        { kind: 'execution', id: o.execution.execution_id },
        value,
        `result_${o.execution.production_date.replaceAll('-', '')}`,
      );
    const summaries = [a, b, c].map((o) =>
      f.publishing.commercialSummary({
        kind: 'execution',
        id: o.execution.execution_id,
      }),
    );
    expect(summaries.map((s) => s.identity.productId)).toEqual([
      'prod_001',
      'prod_002',
      'prod_001',
    ]);
    expect(summaries[1].identity.affiliateLink.url).toBe(
      'https://example.com/affiliate/b',
    );
    expect(new Set(summaries.map((s) => s.identity.publicationId)).size).toBe(
      3,
    );
    expect(() =>
      f.publishing.recordCommercialResults(
        { kind: 'execution', id: b.execution.execution_id },
        { ...value, productId: 'prod_001' },
        'wrong_product',
      ),
    ).toThrow(/INVALID_CONTRACT/);
    expect(() =>
      f.publishing.recordCommercialResults(
        { kind: 'execution', id: b.execution.execution_id },
        { ...value, publicationId: summaries[0].identity.publicationId },
        'wrong_publication',
      ),
    ).toThrow(/INVALID_CONTRACT/);
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    f.close();
  }
});

test('later catalog/link revisions cannot change historical identity or observations', async () => {
  const f = await fixture();
  try {
    const o = await f.occurrence('2026-11-08');
    f.manual(o);
    const target = { kind: 'execution', id: o.execution.execution_id };
    const recorded = f.publishing.recordCommercialResults(
      target,
      input,
      'frozen_measurement',
    );
    const repo = new SqliteAffiliatePersistence(f.f.database).open();
    try {
      repo.registerProduct(
        {
          ...repo.getProduct('prod_001', 2)!,
          revision: 3,
          name: 'New catalog name',
        },
        'future_product_revision',
      );
      repo.registerCampaign(
        {
          ...repo.getCampaign('camp_001', 2)!,
          revision: 3,
          productRevision: 3,
          affiliateUrl: 'https://example.com/new-link',
        },
        'future_link_revision',
        true,
      );
    } finally {
      repo.close();
    }
    expect(f.publishing.commercialSummary(target).identity).toEqual(
      recorded.identity,
    );
    expect(f.publishing.commercialSummary(target).history).toEqual([recorded]);
  } finally {
    f.close();
  }
});

test.each(['CAMPAIGN_REPORTED', 'UNATTRIBUTED'])(
  'keeps %s evidence without attributing campaign totals to the publication',
  async (attribution) => {
    const f = await fixture();
    try {
      const o = await f.occurrence('2026-11-08');
      f.manual(o);
      f.cost(o);
      const target = { kind: 'execution', id: o.execution.execution_id };
      f.publishing.recordCommercialResults(
        target,
        {
          ...input,
          attribution,
          commissions: { status: 'KNOWN', amount: '12', currency: 'BRL' },
          sales: { status: 'KNOWN', value: 2 },
        },
        'campaign_report',
      );
      const summary = f.publishing.commercialSummary(target);
      expect(summary.reportedCommission.amount).toBe('12');
      expect(summary.observations[0].sales.value).toBe(2);
      expect(summary.commission.status).toBe('UNKNOWN');
      expect(summary.sales.status).toBe('UNKNOWN');
      expect(summary.knownNetResult.status).toBe('UNKNOWN');
    } finally {
      f.close();
    }
  },
);

test.each(['different-currency', 'explicit-zero', 'negative-net'])(
  'preserves %s monetary semantics without floating point or FX',
  async (scenario) => {
    const f = await fixture();
    try {
      const o = await f.occurrence('2026-11-08');
      f.manual(o);
      f.cost(
        o,
        '0.100000000000000001',
        scenario === 'different-currency' ? 'USD' : 'BRL',
      );
      const target = { kind: 'execution', id: o.execution.execution_id };
      f.publishing.recordCommercialResults(
        target,
        {
          ...input,
          commissions: {
            status: 'KNOWN',
            amount: scenario === 'explicit-zero' ? '0' : '0.1',
            currency: 'BRL',
          },
        },
        'monetary_result',
      );
      const summary = f.publishing.commercialSummary(target);
      if (scenario === 'different-currency')
        expect(summary.knownNetResult).toMatchObject({
          status: 'UNKNOWN',
          reason: 'CURRENCY_MISMATCH',
        });
      if (scenario === 'explicit-zero') {
        expect(summary.commission.amount).toBe('0');
        expect(summary.knownNetResult.amount).toBe('-0.100000000000000001');
      }
      if (scenario === 'negative-net')
        expect(summary.knownNetResult.amount).toBe('-0.000000000000000001');
      expect(summary.unknownCosts).toContainEqual(
        expect.objectContaining({
          component: 'LOCAL_COMPUTE',
          status: 'UNKNOWN',
        }),
      );
    } finally {
      f.close();
    }
  },
);

test('legacy recordResults is included and can be corrected without overwriting the existing record', async () => {
  const f = await fixture();
  try {
    const o = await f.occurrence('2026-11-08'),
      pub = f.manual(o);
    const legacy = f.publishing.recordResults(
      {
        publicationId: pub.publicationId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        sourceReference: input.sourceReference,
        attribution: input.attribution,
        clicks: unknown,
        sales: unknown,
        revenue: unknown,
        commissions: { status: 'KNOWN', amount: '1', currency: 'BRL' },
      },
      'legacy_result',
    );
    const target = { kind: 'publication', id: pub.publicationId };
    expect(f.publishing.commercialSummary(target).commission.amount).toBe('1');
    f.publishing.recordCommercialResults(
      target,
      {
        ...input,
        expectedRevision: 1,
        correctionReason: 'Updated export',
        commissions: { status: 'KNOWN', amount: '2', currency: 'BRL' },
      },
      'legacy_correction',
    );
    expect(f.publishing.commercialSummary(target).history).toHaveLength(2);
    expect(f.publishing.results(pub.publicationId)).toContainEqual(legacy);
    expect(f.publishing.commercialSummary(target).commission.amount).toBe('2');
  } finally {
    f.close();
  }
});

test('E2E HTTP: real CATALOG selection, official fake publication, verifiable result, summary by execution', async () => {
  const f = await fixture();
  let app: any;
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('EXTERNAL_CALL_FORBIDDEN'));
  try {
    const o = await f.occurrence('2026-11-08');
    const claimed = f.campaigns.claim(o.execution.execution_id, at, 60000)!;
    const instagram = new InstagramPublicationService(
      f.store,
      deterministicInstagramPorts(f.publishing, f.media, '123456789', 'v25.0'),
      () => at,
      false,
      f.finance,
    );
    const published = await instagram.execute(
      claimed,
      { packageHash: o.pkg.contentHash, accountId: '123456789' },
      {
        videoRenderId: o.render.videoRenderId,
        contentHash: o.render.contentHash,
      },
    );
    expect(published.receipt.permalink).toContain('/fake_');
    const module = await Test.createTestingModule({
      controllers: [PublishingController],
      providers: [
        { provide: PublishingService, useValue: f.publishing },
        { provide: InstagramPublicationService, useValue: instagram },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    const url = `/publishing/executions/${o.execution.execution_id}/commercial-results`;
    const observed = {
      ...input,
      commissions: { status: 'KNOWN', amount: '5', currency: 'BRL' },
      clicks: { status: 'KNOWN', value: 2 },
    };
    await request(app.getHttpServer())
      .post(url)
      .send({ input: observed, idempotencyKey: 'e2e_measurement' })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/publishing/social-operations/${published.operationId}/commercial-results`,
      )
      .send({ input: observed, idempotencyKey: 'e2e_measurement_other_route' })
      .expect(201);
    await request(app.getHttpServer())
      .get(
        `/publishing/social-operations/${published.operationId}/commercial-results`,
      )
      .expect(200)
      .expect((r) => expect(r.body.history).toHaveLength(1));
    await request(app.getHttpServer())
      .get(url)
      .expect(200)
      .expect((r) => {
        expect(r.body.identity).toMatchObject({
          executionId: o.execution.execution_id,
          productId: 'prod_001',
          executionMode: 'fake',
          operationId: published.operationId,
        });
        expect(r.body.commission.amount).toBe('5');
        expect(r.body.knownCost.status).toBe('UNKNOWN');
        expect(r.body.knownNetResult.status).toBe('UNKNOWN');
      });
    expect(fetch).not.toHaveBeenCalled();
    expect(f.f.base.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(
      1,
    );
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await app?.close();
    fetch.mockRestore();
    f.close();
  }
});
