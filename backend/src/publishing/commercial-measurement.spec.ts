import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { SocialPublicationRepository } from './infrastructure/social-publication.repository.js';
import { DestinationReservationsRepository } from './infrastructure/destination-reservations.repository.js';
import { InstagramPublicationRepository } from './infrastructure/instagram-publication.repository.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { facebookPublicationFixture } from '../../test/support/facebook-publication.fixture.js';
import { SocialPublicationService } from './application/social-publication.service.js';
import { DestinationPublicationController } from './destination-publication.controller.js';
import { DestinationPublicationService } from './application/destination-publication.service.js';
import { LocalQcGuard } from './application/local-qc.guard.js';
import {
  CommercialMeasurementRepository,
  observationId,
} from './infrastructure/commercial-measurement.repository.js';
import { validateObservation } from './domain/commercial-measurement.js';

const at = '2026-11-08T13:00:00.000Z';
const unknown = { status: 'UNKNOWN', reason: 'NOT_REPORTED' };
const input = {
  actor: 'operator_001',
  attribution: 'DIRECT_PUBLICATION',
  sourceReference: 'fixture:affiliate-report',
  periodStart: '2026-11-08T00:00:00Z',
  periodEnd: '2026-11-09T00:00:00Z',
};

async function fixture(schema = 43, affiliateUrl?: string) {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db, schema);
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
      ...(affiliateUrl ? { affiliateUrl } : {}),
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

test.each([
  'campaignId',
  'campaignRevision',
  'videoRenderId',
  'qualityControlReportId',
])('commercial package rejects empty required reference: %s', async (field) => {
  const f = await fixture();
  try {
    expect(() =>
      f.publishing.prepare(
        {
          campaignId: 'camp_001',
          campaignRevision: 2,
          videoRenderId: 'render_001',
          qualityControlReportId: 'qc_001',
          platform: 'instagram',
          account: '123456789',
          caption: 'Produto autorizado',
          [field]: '',
        },
        'invalid_reference',
      ),
    ).toThrow(/DISTRIBUTION_INVALID/);
  } finally {
    f.close();
  }
});

test.each(['cta', 'disclosure', 'affiliateUrl'])(
  'commercial package rejects missing frozen data before persisting: %s',
  async (field) => {
    const f = await fixture();
    let session: ReturnType<typeof f.store.open> | undefined;
    try {
      const o = await f.occurrence('2026-11-08');
      session = f.store.open(false);
      const catalog = session.manual.repository.catalog;
      const campaign = catalog.getCampaign(
        o.pkg.campaignId,
        o.pkg.campaignRevision,
      );
      vi.spyOn(catalog, 'getCampaign').mockReturnValue({
        ...campaign,
        [field]: '',
      });
      const before = session.manual.repository.list('PACKAGE');
      expect(() =>
        session!.manual.prepare(
          {
            campaignId: o.pkg.campaignId,
            campaignRevision: o.pkg.campaignRevision,
            videoRenderId: o.render.videoRenderId,
            qualityControlReportId: o.pkg.identity.qualityControlReportId,
            platform: 'facebook',
            account: '123456789',
            caption: 'Produto autorizado',
          },
          'invalid_commercial',
        ),
      ).toThrow(/DISTRIBUTION_INVALID/);
      expect(session.manual.repository.list('PACKAGE')).toEqual(before);
    } finally {
      session?.close();
      f.close();
    }
  },
);

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
      projectId: o.pkg.identity.projectId,
      projectVersion: o.pkg.identity.projectVersion,
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

test('historical V2 results expose project scope after restart without rewriting history or replay receipts', async () => {
  const f = await fixture();
  try {
    const o = await f.occurrence('2026-11-08');
    const pub = f.manual(o);
    const target = { kind: 'publication' as const, id: pub.publicationId };
    // Explicitly fictitious pre-COMMERCIAL-001 snapshot in a disposable DB.
    const session = f.store.open();
    const resolved = new CommercialMeasurementRepository(
      session.manual.repository,
    ).resolve(target);
    const {
      projectId: _id,
      projectVersion: _version,
      ...identity
    } = resolved.identity as any;
    const normalized = validateObservation(input, pub.publicationId);
    const id = observationId({
      ...normalized,
      publicationId: pub.publicationId,
    });
    const body = {
      schemaVersion: 'publication-commercial-results/2.0.0',
      ...normalized,
      publicationId: pub.publicationId,
      packageHash: o.pkg.contentHash,
      observationId: id,
      revision: 1,
      previousResultHash: null,
      identity,
      inputHash: affiliateHash(normalized),
      recordedAt: at,
    };
    const historical = { ...body, contentHash: affiliateHash(body) };
    try {
      session.manual.repository.command(
        'RESULTS',
        { target, raw: input },
        'historical_v2',
        () =>
          session.manual.repository.put(
            'RESULTS',
            `commercial:${id}:1`,
            historical,
          ),
      );
    } finally {
      session.close();
    }
    const db = f.f.base.db;
    const snapshot = () => ({
      results: db
        .prepare(
          "SELECT * FROM manual_distribution_records WHERE kind='RESULTS'",
        )
        .all(),
      commands: db.prepare('SELECT * FROM affiliate_commands').all(),
    });
    const before = snapshot();
    const reopened = new (PublishingService as any)(
      f.store,
      f.media,
      f.finance,
    );
    const summary = reopened.commercialSummary(target);
    expect(summary.identity).toMatchObject({
      projectId: o.pkg.identity.projectId,
      projectVersion: o.pkg.identity.projectVersion,
      ...identity,
    });
    expect(summary.history).toEqual([historical]);
    expect(summary.observations).toEqual([historical]);
    expect(
      reopened.recordCommercialResults(target, input, 'historical_v2'),
    ).toEqual(historical);
    expect(snapshot()).toEqual(before);
  } finally {
    f.close();
  }
});

test('reported commission lifecycle requires revisions, survives replay/restart and never upgrades legacy values', async () => {
  const f = await fixture();
  try {
    const o = await f.occurrence('2026-11-08');
    f.manual(o);
    f.cost(o);
    const target = { kind: 'execution', id: o.execution.execution_id };
    const observed = {
      ...input,
      commissions: { status: 'KNOWN', amount: '5', currency: 'BRL' },
    };
    const legacy = f.publishing.recordCommercialResults(
      target,
      observed,
      'profit_legacy',
    );
    expect(
      f.publishing.commercialSummary(target).profitability.confirmedCommission
        .status,
    ).toBe('UNKNOWN');
    const rows = f.f.base.db.prepare('SELECT * FROM cost_events').all();
    const expected = {
      ...observed,
      commissionStatus: 'EXPECTED',
      expectedRevision: 1,
      correctionReason: 'Fictitious pending report',
    };
    const first = f.publishing.recordCommercialResults(
      target,
      expected,
      'profit_expected',
    );
    expect(
      f.publishing.recordCommercialResults(
        target,
        expected,
        'profit_expected_replay',
      ),
    ).toEqual(first);
    const confirmation = {
      ...observed,
      commissionStatus: 'CONFIRMED',
      expectedRevision: 2,
      correctionReason: 'Fictitious confirmed report',
    };
    const confirmed = f.publishing.recordCommercialResults(
      target,
      confirmation,
      'profit_confirmed',
    );
    expect(() =>
      f.publishing.recordCommercialResults(
        target,
        { ...confirmation, commissionStatus: 'CANCELLED' },
        'profit_stale',
      ),
    ).toThrow(/RESULTS_CONFLICT|REVISION_CONFLICT/);
    const reopened = new (PublishingService as any)(
      f.store,
      f.media,
      f.finance,
    );
    const summary = reopened.commercialSummary(target);
    expect(summary.profitability.confirmedCommission).toEqual(
      observed.commissions,
    );
    expect(summary.profitability.costEvidence[0].status).toBe(
      'RECORDED_UNCLASSIFIED',
    );
    expect(summary.profitability.netProfit.status).toBe('UNKNOWN');
    expect(summary.profitability.roi.status).toBe('UNKNOWN');
    const cancelled = {
      ...observed,
      commissionStatus: 'CANCELLED',
      expectedRevision: 3,
      correctionReason: 'Fictitious cancellation',
    };
    reopened.recordCommercialResults(target, cancelled, 'profit_cancelled');
    const after = reopened.commercialSummary(target);
    expect(after.profitability.reportedCommissionStatus).toBe('CANCELLED');
    expect(after.profitability.confirmedCommission.status).toBe('UNKNOWN');
    expect(after.history).toHaveLength(4);
    expect(after.history).toContainEqual(legacy);
    expect(after.history).toContainEqual(confirmed);
    expect(f.f.base.db.prepare('SELECT * FROM cost_events').all()).toEqual(
      rows,
    );
    expect(
      reopened.recordCommercialResults(target, observed, 'profit_legacy'),
    ).toEqual(legacy);
    expect(
      reopened.recordCommercialResults(
        target,
        observed,
        'profit_legacy_other_key',
      ),
    ).toEqual(legacy);
  } finally {
    f.close();
  }
});

test('two publications sharing a link cannot receive confirmed individual campaign totals', async () => {
  const f = await fixture();
  try {
    const a = await f.occurrence('2026-11-08');
    await f.occurrence('2026-11-09');
    const b = await f.occurrence('2026-11-10');
    expect(a.pkg.link).toBe(b.pkg.link);
    for (const o of [a, b]) {
      const pub = f.manual(o);
      const target = { kind: 'publication', id: pub.publicationId };
      f.publishing.recordCommercialResults(
        target,
        {
          ...input,
          attribution: 'CAMPAIGN_REPORTED',
          commissionStatus: 'CONFIRMED',
          commissions: { status: 'KNOWN', amount: '5', currency: 'USD' },
        },
        `shared_report_${o.execution.production_date.replaceAll('-', '')}`,
      );
      const summary = f.publishing.commercialSummary(target);
      expect(summary.reportedCommission.amount).toBe('5');
      expect(summary.profitability.confirmedCommission.status).toBe('UNKNOWN');
      expect(summary.profitability.partialNetResult.status).toBe('UNKNOWN');
      expect(summary.profitability.roi.status).toBe('UNKNOWN');
      expect(summary.history).toHaveLength(1);
    }
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
  const affiliateUrl =
    'https://example.com/item?sub_id1=campaign%2B001&sub_id2=video_001';
  const f = await fixture(43, affiliateUrl);
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
    const persisted = new SocialPublicationRepository(f.f.base).get(
      published.operationId,
    );
    expect(persisted.executionMode).toBe('fake');
    expect(persisted.caption).toBe(
      [o.pkg.caption, o.pkg.cta, o.pkg.disclosure, affiliateUrl].join('\n\n'),
    );
    expect(
      await instagram.execute(
        claimed,
        { packageHash: o.pkg.contentHash, accountId: '123456789' },
        {
          videoRenderId: o.render.videoRenderId,
          contentHash: o.render.contentHash,
        },
      ),
    ).toEqual(published);
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
      commissionStatus: 'CONFIRMED',
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
          projectId: o.pkg.identity.projectId,
          projectVersion: o.pkg.identity.projectVersion,
          executionId: o.execution.execution_id,
          productId: 'prod_001',
          executionMode: 'fake',
          operationId: published.operationId,
        });
        expect(r.body.commission.amount).toBe('5');
        expect(r.body.profitability.confirmedCommission.amount).toBe('5');
        expect(r.body.profitability.status).toBe('NOT_CALCULABLE');
        expect(r.body.profitability.roi.status).toBe('UNKNOWN');
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

// Persisted fake snapshots exercise the commercial reader, not provider behavior.
async function socialSnapshot(
  f: Awaited<ReturnType<typeof fixture>>,
  o: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['occurrence']>>,
  network: 'INSTAGRAM' | 'FACEBOOK_REELS',
  legacy = false,
) {
  const facebook = network === 'FACEBOOK_REELS';
  const pkg = facebook
    ? f.publishing.prepare(
        {
          campaignId: o.pkg.campaignId,
          campaignRevision: o.pkg.campaignRevision,
          videoRenderId: o.render.videoRenderId,
          qualityControlReportId: `qc_${o.execution.production_date.replaceAll('-', '')}`,
          platform: 'facebook',
          account: '123456789',
          caption: o.pkg.caption,
        },
        'facebook_package',
      )
    : o.pkg;
  const review = f.publishing.review(
    {
      packageHash: pkg.contentHash,
      decision: 'APPROVED',
      actor: 'operator_001',
      justification: null,
    },
    facebook ? 'facebook_review' : 'instagram_review',
  );
  const social = new SocialPublicationRepository({ db: f.f.base.db });
  const op = social.prepare(
    {
      packageHash: pkg.contentHash,
      accountId: facebook ? 'facebook_reels:123456789' : '123456789',
      ...(facebook ? { network } : {}),
      mediaHash: o.render.contentHash,
    },
    `commercial_${network}`,
    at,
  );
  if (legacy)
    new InstagramPublicationRepository(f.f.base.db).reserve(
      o.execution.execution_id,
      op,
      pkg,
      review.contentHash,
      at,
    );
  else
    new DestinationReservationsRepository(f.f.base.db).reserve(
      o.execution.execution_id,
      op,
      pkg,
      review.contentHash,
      at,
    );
  const { contentHash: _hash, ...body } = op;
  const snapshot = {
    ...body,
    state: 'PUBLISHED',
    mediaId: facebook ? '987654321' : '876543219',
    requiresReconciliation: false,
    remoteReceipt: {
      mediaId: facebook ? '987654321' : '876543219',
      permalink: facebook ? null : 'https://www.instagram.com/reel/fixture/',
      publishedAt: at,
    },
  };
  function patch(change: Record<string, unknown> = {}) {
    const value = { ...snapshot, ...change };
    f.f.base.db
      .prepare(
        'UPDATE social_publication_operations SET payload_json=? WHERE operation_id=?',
      )
      .run(
        JSON.stringify({ ...value, contentHash: affiliateHash(value) }),
        op.operationId,
      );
  }
  patch();
  return {
    op,
    pkg,
    snapshot,
    patch,
    target: { kind: 'operation', id: op.operationId },
  };
}

async function commercialOccurrenceGrant(
  f: Awaited<ReturnType<typeof facebookPublicationFixture>>,
  original: any,
) {
  // Fictitious QC credentials and an exact occurrence grant, never a LIVE grant.
  const root = mkdtempSync(join(tmpdir(), 'commercial-qc-'));
  const file = join(root, 'identities.json');
  const secret = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  let app: INestApplication | undefined;
  try {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        identities: [
          {
            id: 'commercial_qc_fixture',
            salt,
            hash: scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
              N: 32768,
              r: 8,
              p: 1,
              maxmem: 67108864,
            }).toString('hex'),
            roles: ['QC_REVIEWER'],
            revoked: false,
          },
        ],
      }),
      { mode: 0o600 },
    );
    vi.stubEnv('QC_IDENTITIES_FILE', file);
    const module = await Test.createTestingModule({
      controllers: [DestinationPublicationController],
      providers: [
        {
          provide: DestinationPublicationService,
          useValue: f.reopen(() => f.at),
        },
        LocalQcGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    const authorization = {
      executionId: f.execution.execution_id,
      operationId: original.operationId,
      accountId: f.facebookPackage.account,
      packageHash: original.packageHash,
      campaignRevision: f.execution.campaign_revision,
      expectedVersion: original.version,
      authorizationId: 'commercial_original_occurrence_fixture',
      authorizedAt: f.at,
      expiresAt: new Date(Date.parse(f.at) + 60000).toISOString(),
    };
    const response = await request(app.getHttpServer())
      .post(
        `/publishing/executions/${f.execution.execution_id}/facebook-reels/occurrence-authorization`,
      )
      .set('Authorization', `Bearer commercial_qc_fixture.${secret}`)
      .send({
        accountId: authorization.accountId,
        expectedVersion: original.version,
        authorization,
      })
      .expect(201);
    expect(response.body.authorization).toEqual({
      ...authorization,
      actor: 'commercial_qc_fixture',
    });
    return response.body.authorization;
  } finally {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test.each([false, true])(
  'approved commercial package to original Facebook occurrence and measurement; uncertain create=%s',
  async (uncertain) => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(Error('NO_EXTERNAL_NETWORK'));
    const f = await facebookPublicationFixture(true, 'v27.0');
    try {
      provisionSchema(f.f.base.db, 44);
      f.campaigns.ownedEvent(
        f.execution.execution_id,
        f.execution.claim_token!,
        f.at,
        'WORKFLOW_FINISHED',
        {},
        'SUCCEEDED',
      );
      const service = f.reopen(),
        id = f.execution.execution_id,
        account = f.facebookPackage.account;
      await expect(
        service.prepareFacebookOccurrence(id, account),
      ).rejects.toMatchObject({ code: 'DISTRIBUTION_APPROVAL_REQUIRED' });
      expect(f.posts).toEqual([]);
      f.approve(f.facebookPackage);
      const prepared = await service.prepareFacebookOccurrence(id, account);
      expect(prepared.state).toBe('PREPARED');
      await expect(f.execute(service)).rejects.toMatchObject({
        code: 'SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED',
      });
      expect(f.posts).toEqual([]);
      const grant = await commercialOccurrenceGrant(f, prepared);
      const publish = vi.spyOn(f.ports.publisher, 'publish');
      const run = () =>
        f.reopen().execute(id, 'FACEBOOK_REELS', account, grant);
      if (uncertain) {
        f.fail('create');
        await expect(run()).rejects.toMatchObject({
          code: 'SOCIAL_RECONCILIATION_REQUIRED',
        });
        f.fail(undefined);
        await expect(run()).rejects.toMatchObject({
          code: 'SOCIAL_RECONCILIATION_REQUIRED',
        });
        expect(f.posts).toEqual(['create']);
        const op = new SocialPublicationRepository(f.f.base).get(
          prepared.operationId,
        );
        expect(op.state).toBe('UNCERTAIN');
        expect(op.remoteReceipt).toBeUndefined();
        expect(() =>
          f.publishing.recordCommercialResults(
            { kind: 'operation', id: prepared.operationId },
            input,
            'uncertain_results',
          ),
        ).toThrow(/CONFIRMED_PUBLICATION_REQUIRED/);
      } else {
        const result = await run();
        expect(await run()).toEqual(result);
        expect(f.posts).toEqual(['create', 'upload', 'publish']);
        const op = new SocialPublicationRepository(f.f.base).get(
          result.operationId,
        );
        expect(op).toMatchObject({
          state: 'PUBLISHED',
          executionMode: 'fake',
          packageHash: f.facebookPackage.contentHash,
          remoteReceipt: result.receipt,
        });
        expect(publish.mock.calls[0][0].caption).toBe(
          [
            f.facebookPackage.caption,
            f.facebookPackage.cta,
            f.facebookPackage.disclosure,
            f.facebookPackage.link,
          ].join('\n\n'),
        );
        const target = { kind: 'operation' as const, id: result.operationId };
        const observation = f.publishing.recordCommercialResults(
          target,
          input,
          'original_fb_results',
        );
        expect(observation.identity).toMatchObject({
          productId: f.facebookPackage.productId,
          productRevision: f.facebookPackage.productRevision,
          campaignId: f.facebookPackage.campaignId,
          campaignRevision: f.facebookPackage.campaignRevision,
          packageHash: f.facebookPackage.contentHash,
          executionMode: 'fake',
          affiliateLink: { url: f.facebookPackage.link },
          permalink: result.receipt.permalink,
        });
        expect(
          f.publishing.recordCommercialResults(
            target,
            input,
            'original_fb_results',
          ),
        ).toEqual(observation);
        expect(f.publishing.commercialSummary(target).history).toHaveLength(1);
      }
      expect(
        f
          .reopen()
          .status(id)
          .find((r) => r.network === 'INSTAGRAM')?.operation.remoteReceipt,
      ).toEqual(f.ig.receipt);
      expect(network).not.toHaveBeenCalled();
    } finally {
      f.cleanup();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  },
);

async function commercialSuccessor(withInstagram = false, publish = true) {
  // Isolate Facebook-only reader cases by skipping the fixture's unrelated
  // Instagram publication. Mixed-network cases execute both real services.
  const skipInstagram = withInstagram
    ? null
    : vi
        .spyOn(InstagramPublicationService.prototype, 'execute')
        .mockResolvedValueOnce(undefined as never);
  let f: Awaited<ReturnType<typeof facebookPublicationFixture>>;
  try {
    f = await facebookPublicationFixture(true, 'v27.0', true);
  } finally {
    skipInstagram?.mockRestore();
  }
  try {
    provisionSchema(f.f.base.db, 44);
    f.approve(f.facebookPackage);
    f.campaigns.ownedEvent(
      f.execution.execution_id,
      f.execution.claim_token!,
      f.at,
      'WORKFLOW_FINISHED',
      {},
      'SUCCEEDED',
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(f.at);
    await f.ports.localBytes(
      f.facebookPackage.contentHash,
      f.render.videoRenderId,
      f.hash,
    );
    const store = f.store.openDestination('fake');
    let original: any;
    try {
      const engine = new SocialPublicationService({
        repository: store.social,
        manual: store.manual,
        publisher: f.ports.publisher,
        media: f.ports.media,
        transferVerifier: f.ports.verifier,
        now: () => f.at,
        authorize: (op: any) => store.reservations.authorize(op, f.at),
      });
      original = await engine.prepare(
        {
          packageHash: f.facebookPackage.contentHash,
          accountId: f.ports.publisher.accountId,
        },
        'commercial_original',
        'local',
      );
      store.reservations.reserve(
        f.execution.execution_id,
        original,
        f.facebookPackage,
        f.publishing.packageReview(f.facebookPackage.contentHash).contentHash,
        f.at,
      );
      await expect(
        engine.createContainer(original.operationId),
      ).rejects.toMatchObject({
        code: 'SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED',
      });
      expect(f.posts).toEqual([]);
      const occurrenceGrant = await commercialOccurrenceGrant(f, original);
      original = await new SocialPublicationService({
        repository: store.social,
        manual: store.manual,
        publisher: f.ports.publisher,
        media: f.ports.media,
        transferVerifier: f.ports.verifier,
        operationalAuthorization: occurrenceGrant,
        now: () => f.at,
        authorize: (op: any) => store.reservations.authorize(op, f.at),
      }).createContainer(original.operationId);
    } finally {
      store.close();
    }
    const service = f.reopen(() => new Date().toISOString());
    const decision = {
      originalOperationId: original.operationId,
      revision: 1,
      decisionId: 'commercial_prepare',
      actor: 'operator_fixture',
      reason: 'Explicit fixture acceptance of zero-progress residual risk',
      remoteObservation: await f.ports.publisher.inspectUploadSession!(
        original.containerId,
      ),
      acceptResidualRisk: true as const,
      expectedVersion: original.version,
    };
    const account = '1355505384315575';
    let successor = await service.prepareFacebookSupersession(
      f.execution.execution_id,
      account,
      decision,
    );
    if (publish) {
      const authorizedAt = new Date(Date.parse(f.at) + 1000).toISOString();
      vi.setSystemTime(authorizedAt);
      const grant = {
        operationId: successor.operationId,
        packageHash: successor.packageHash,
        preparationDecisionId: decision.decisionId,
        authorizationId: 'commercial_execute',
        actor: 'operator_fixture',
        authorizedAt,
        expiresAt: new Date(Date.parse(authorizedAt) + 60000).toISOString(),
        acceptResidualRisk: true as const,
      };
      const authorized = await service.authorizeFacebookSuccessor(
        f.execution.execution_id,
        account,
        successor.version,
        grant,
      );
      await service.execute(
        f.execution.execution_id,
        'FACEBOOK_REELS',
        account,
        authorized.authorization,
        successor.version,
      );
      await service.execute(
        f.execution.execution_id,
        'FACEBOOK_REELS',
        account,
        authorized.authorization,
      );
      successor = new SocialPublicationRepository(f.f.base).get(
        successor.operationId,
      );
      expect(successor.state).toBe('PUBLISHED');
      expect(f.posts).toEqual(['create', 'create', 'upload', 'publish']);
    }
    vi.setSystemTime('2026-11-09T01:00:00Z');
    return {
      f,
      original,
      successor,
      execution: { kind: 'execution' as const, id: f.execution.execution_id },
      operation: { kind: 'operation' as const, id: successor.operationId },
    };
  } catch (error) {
    f.cleanup();
    throw error;
  }
}

describe('commercial active Facebook successor resolution', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('EXTERNAL_CALL_FORBIDDEN'),
    );
  });
  afterEach(() => {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test('execution summary selects the published successor and preserves the historical reservation', async () => {
    const x = await commercialSuccessor();
    try {
      const summary = x.f.publishing.commercialSummary(x.execution);
      const direct = x.f.publishing.commercialSummary(x.operation);
      expect(summary.identity).toEqual(direct.identity);
      expect(summary.identity).toMatchObject({
        operationId: x.successor.operationId,
        executionId: x.f.execution.execution_id,
        pipelineRunId: x.f.execution.run_id,
        campaignId: 'camp_001',
        campaignRevision: 1,
        productId: x.f.facebookPackage.productId,
        productRevision: x.f.facebookPackage.productRevision,
        briefingId: 'brief_001',
        packageHash: x.f.facebookPackage.contentHash,
        account: '1355505384315575',
        platform: 'facebook',
        remoteMediaId: x.successor.remoteReceipt.mediaId,
      });
      expect(summary.identity.briefingHash).toMatch(/^[a-f0-9]{64}$/);
      const reservations = new DestinationReservationsRepository(x.f.f.base.db);
      expect(
        reservations.forExecution(
          x.execution.id,
          'FACEBOOK_REELS',
          '1355505384315575',
        )?.operationId,
      ).toBe(x.original.operationId);
      expect(
        reservations.activeForExecution(
          x.execution.id,
          'FACEBOOK_REELS',
          '1355505384315575',
        )?.operationId,
      ).toBe(x.successor.operationId);
      expect(
        new SocialPublicationRepository(x.f.f.base).get(x.original.operationId),
      ).toEqual(x.original);
      expect(() =>
        x.f.publishing.commercialSummary({
          kind: 'operation',
          id: x.original.operationId,
        }),
      ).toThrow(/CONFIRMED_PUBLICATION_REQUIRED/);
    } finally {
      x.f.cleanup();
    }
  });

  test('execution results retain successor identity, replay, corrections, UNKNOWN and restart history', async () => {
    const x = await commercialSuccessor();
    try {
      const empty = x.f.publishing.commercialSummary(x.operation);
      expect(empty.sales.status).toBe('UNKNOWN');
      expect(empty.knownCost.status).toBe('UNKNOWN');
      const first = x.f.publishing.recordCommercialResults(
        x.execution,
        input,
        'successor_results',
      );
      expect(first.identity.operationId).toBe(x.successor.operationId);
      expect(
        x.f.publishing.recordCommercialResults(
          x.execution,
          input,
          'successor_results',
        ),
      ).toEqual(first);
      expect(
        x.f.publishing.recordCommercialResults(
          x.operation,
          input,
          'successor_replay',
        ),
      ).toEqual(first);
      const reopened = new PublishingService(x.f.store, x.f.media, x.f.finance);
      const correction = reopened.recordCommercialResults(
        x.operation,
        {
          ...input,
          expectedRevision: 1,
          correctionReason: 'Corrected authorized fixture report',
          sales: { status: 'KNOWN', value: 0 },
          commissions: { status: 'KNOWN', amount: '0', currency: 'BRL' },
        },
        'successor_correction',
      );
      expect(correction.previousResultHash).toBe(first.contentHash);
      expect(correction.identity).toEqual(first.identity);
      const summary = new PublishingService(
        x.f.store,
        x.f.media,
        x.f.finance,
      ).commercialSummary(x.execution);
      expect(summary.history).toHaveLength(2);
      expect(summary.sales).toEqual({ status: 'KNOWN', value: 0 });
      expect(summary.commission).toEqual({
        status: 'KNOWN',
        amount: '0',
        currency: 'BRL',
      });
      expect(summary.knownCost.status).toBe('UNKNOWN');
      expect(summary.knownNetResult.status).toBe('UNKNOWN');
    } finally {
      x.f.cleanup();
    }
  });

  test('Instagram and successor require explicit selection and share execution costs without duplicating them', async () => {
    const x = await commercialSuccessor(true);
    try {
      expect(() => x.f.publishing.commercialSummary(x.execution)).toThrow(
        /PUBLICATION_AMBIGUOUS/,
      );
      expect(() =>
        x.f.publishing.recordCommercialResults(
          x.execution,
          input,
          'ambiguous_successor',
        ),
      ).toThrow(/PUBLICATION_AMBIGUOUS/);
      x.f.finance.register({
        schemaVersion: 'cost-event/1.0.0',
        costEventId: 'successor_shared_cost',
        category: 'production_cost',
        pipelineRunId: x.f.execution.run_id,
        projectId: 'project_001',
        projectVersion: 1,
        contentIdentity: null,
        artifactId: null,
        amount: '2.1',
        currency: 'BRL',
        occurredAt: at,
        recordedAt: at,
        origin: 'fixture_measured',
        attributionRuleVersion: 'fixture/1.0.0',
      });
      const ig = {
        kind: 'operation' as const,
        id: String(x.f.legacy.reservations[0].operation_id),
      };
      const summaries = [x.operation, ig].map((target, i) => {
        x.f.publishing.recordCommercialResults(
          target,
          {
            ...input,
            commissions: { status: 'KNOWN', amount: '5', currency: 'BRL' },
          },
          `successor_destination_${i}`,
        );
        return x.f.publishing.commercialSummary(target);
      });
      expect(summaries[0].identity.operationId).toBe(x.successor.operationId);
      expect(summaries[1].identity.operationId).toBe(ig.id);
      for (const summary of summaries) {
        expect(summary.knownCost).toEqual({
          status: 'KNOWN',
          amount: '2.1',
          currency: 'BRL',
        });
        expect(summary.knownNetResult).toEqual({
          status: 'KNOWN',
          amount: '2.9',
          currency: 'BRL',
        });
        expect(summary.costLedger).toHaveProperty('events.length', 1);
        expect(summary.costScope.attribution).toBe(
          'PIPELINE_RUN_NOT_ADDITIVE_ACROSS_PUBLICATIONS',
        );
      }
      expect(summaries[0].costLedger).toEqual(summaries[1].costLedger);
      expect(x.f.posts).toEqual(['create', 'create', 'upload', 'publish']);
    } finally {
      x.f.cleanup();
    }
  });

  test.each([
    { state: 'PREPARED', mediaId: null, remoteReceipt: null },
    { state: 'PROCESSING', mediaId: null, remoteReceipt: null },
    { remoteReceipt: null },
    {
      remoteReceipt: {
        mediaId: 'mismatched',
        permalink: null,
        publishedAt: at,
      },
    },
    { requiresReconciliation: true },
  ])(
    'active ownership alone does not confirm a successor: %j',
    async (patch) => {
      const x = await commercialSuccessor(false, patch.state !== 'PREPARED');
      try {
        // Reader corruption/state fixtures; supersession creation above uses its
        // real service and never changes the historical reservation.
        const { contentHash: _hash, ...body } = x.successor;
        const value = { ...body, ...patch };
        x.f.f.base.db
          .prepare(
            'UPDATE social_publication_operations SET payload_json=? WHERE operation_id=?',
          )
          .run(
            JSON.stringify({ ...value, contentHash: affiliateHash(value) }),
            x.successor.operationId,
          );
        for (const target of [x.execution, x.operation]) {
          expect(() => x.f.publishing.commercialSummary(target)).toThrow(
            /CONFIRMED_PUBLICATION_REQUIRED/,
          );
        }
      } finally {
        x.f.cleanup();
      }
    },
  );

  test('published Facebook successor allows a null permalink without inventing one', async () => {
    const x = await commercialSuccessor();
    try {
      const { contentHash: _hash, ...body } = x.successor;
      const value = {
        ...body,
        remoteReceipt: { ...body.remoteReceipt, permalink: null },
      };
      x.f.f.base.db
        .prepare(
          'UPDATE social_publication_operations SET payload_json=? WHERE operation_id=?',
        )
        .run(
          JSON.stringify({ ...value, contentHash: affiliateHash(value) }),
          x.successor.operationId,
        );
      const summary = x.f.publishing.commercialSummary(x.execution);
      expect(summary.identity.permalink).toBeNull();
      expect(summary.publication.permalink.status).toBe('UNKNOWN');
      expect(summary.identity.remoteMediaId).toBe(x.successor.mediaId);
    } finally {
      x.f.cleanup();
    }
  });

  test.each(['missing', 'mismatched'])(
    'schema 44 %s ownership never falls back to the published root',
    async (corruption) => {
      const f = await fixture(44);
      try {
        const o = await f.occurrence('2026-11-08');
        const fb = await socialSnapshot(f, o, 'FACEBOOK_REELS');
        const ig = await socialSnapshot(f, o, 'INSTAGRAM', true);
        // Deliberate corruption confined to this disposable database.
        f.f.base.db.exec('DROP TRIGGER publication_ownership_no_delete');
        if (corruption === 'missing') {
          f.f.base.db
            .prepare(
              'DELETE FROM publication_active_ownership WHERE reservation_operation_id=?',
            )
            .run(fb.op.operationId);
        } else {
          f.f.base.db.exec('DROP TRIGGER publication_ownership_transfer');
          f.f.base.db
            .prepare(
              'DELETE FROM publication_active_ownership WHERE reservation_operation_id=?',
            )
            .run(ig.op.operationId);
          f.f.base.db
            .prepare(
              'UPDATE publication_active_ownership SET reservation_operation_id=? WHERE active_operation_id=?',
            )
            .run(ig.op.operationId, fb.op.operationId);
        }
        const target = {
          kind: 'execution' as const,
          id: o.execution.execution_id,
        };
        expect(() => f.publishing.commercialSummary(target)).toThrow(
          /SOCIAL_RESERVATION_CONFLICT/,
        );
        expect(() =>
          f.publishing.recordCommercialResults(target, input, 'invalid_owner'),
        ).toThrow(/SOCIAL_RESERVATION_CONFLICT/);
        expect(
          f.publishing.commercialSummary(fb.target).identity.operationId,
        ).toBe(fb.op.operationId);
      } finally {
        f.close();
      }
    },
  );
});

describe('commercial social destination resolution', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('EXTERNAL_CALL_FORBIDDEN'),
    );
  });
  afterEach(() => {
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  test.each([42, 43, 44])(
    'schema %s: Instagram legacy reservation with permalink',
    async (schema) => {
      const f = await fixture(schema);
      try {
        const o = await f.occurrence('2026-11-08');
        const s = await socialSnapshot(f, o, 'INSTAGRAM', true);
        const summary = f.publishing.commercialSummary({
          kind: 'execution',
          id: o.execution.execution_id,
        });
        expect(summary.identity.operationId).toBe(s.op.operationId);
        expect(summary.publication.permalink).toBe(
          s.snapshot.remoteReceipt.permalink,
        );
      } finally {
        f.close();
      }
    },
  );

  test.each([43, 44])(
    'schema %s: Facebook-only, null permalink, replay and correction retain identity',
    async (schema) => {
      const f = await fixture(schema);
      try {
        const o = await f.occurrence('2026-11-08');
        const s = await socialSnapshot(f, o, 'FACEBOOK_REELS');
        const target = { kind: 'execution', id: o.execution.execution_id };
        const before = f.f.base.db
          .prepare('SELECT payload_json FROM social_publication_operations')
          .all();
        const first = f.publishing.recordCommercialResults(
          target,
          input,
          'fb_results',
        );
        expect(first.identity).toMatchObject({
          projectId: s.pkg.identity.projectId,
          projectVersion: s.pkg.identity.projectVersion,
          operationId: s.op.operationId,
          executionId: o.execution.execution_id,
          campaignId: o.execution.campaign_id,
          campaignRevision: o.execution.campaign_revision,
          productId: s.pkg.productId,
          productRevision: s.pkg.productRevision,
          briefingId: o.frozen.briefingId,
          briefingHash: o.frozen.catalogSelection.briefingHash,
          packageHash: s.pkg.contentHash,
          account: '123456789',
          platform: 'facebook',
          remoteMediaId: '987654321',
          permalink: null,
        });
        expect(
          f.publishing.recordCommercialResults(target, input, 'fb_results'),
        ).toEqual(first);
        expect(
          f.publishing.recordCommercialResults(s.target, input, 'fb_replay'),
        ).toEqual(first);
        const empty = f.publishing.commercialSummary(target);
        expect(empty.publication.permalink.status).toBe('UNKNOWN');
        expect(empty.knownCost.status).toBe('UNKNOWN');
        expect(empty.sales.status).toBe('UNKNOWN');
        expect(empty.unknownCosts).toContainEqual(
          expect.objectContaining({
            component: s.op.operationId,
            status: 'UNKNOWN',
          }),
        );
        const corrected = f.publishing.recordCommercialResults(
          s.target,
          {
            ...input,
            expectedRevision: 1,
            correctionReason: 'Updated affiliate report',
            sales: { status: 'KNOWN', value: 0 },
            commissions: { status: 'KNOWN', amount: '0', currency: 'BRL' },
          },
          'fb_correction',
        );
        expect(corrected.previousResultHash).toBe(first.contentHash);
        expect(corrected.identity).toEqual(first.identity);
        const reopened = new (PublishingService as any)(
          f.store,
          f.media,
          f.finance,
        );
        expect(reopened.commercialSummary(target).history).toHaveLength(2);
        expect(reopened.commercialSummary(target).sales).toEqual({
          status: 'KNOWN',
          value: 0,
        });
        expect(reopened.commercialSummary(target).commission.amount).toBe('0');
        expect(reopened.commercialSummary(target).knownNetResult.status).toBe(
          'UNKNOWN',
        );
        expect(
          f.f.base.db
            .prepare('SELECT payload_json FROM social_publication_operations')
            .all(),
        ).toEqual(before);
        expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual(
          [],
        );
      } finally {
        f.close();
      }
    },
  );

  test.each([43, 44])(
    'schema %s: multiple destinations require operation selection, costs remain pipeline-scoped',
    async (schema) => {
      const f = await fixture(schema);
      try {
        const o = await f.occurrence('2026-11-08');
        const ig = await socialSnapshot(f, o, 'INSTAGRAM', true);
        const fb = await socialSnapshot(f, o, 'FACEBOOK_REELS');
        const target = { kind: 'execution', id: o.execution.execution_id };
        expect(() => f.publishing.commercialSummary(target)).toThrow(
          /PUBLICATION_AMBIGUOUS/,
        );
        expect(() =>
          f.publishing.recordCommercialResults(target, input, 'ambiguous'),
        ).toThrow(/PUBLICATION_AMBIGUOUS/);
        f.cost(o);
        for (const s of [ig, fb]) {
          f.publishing.recordCommercialResults(
            s.target,
            {
              ...input,
              commissions: { status: 'KNOWN', amount: '5', currency: 'BRL' },
            },
            `results_${s.pkg.platform}`,
          );
          const summary = f.publishing.commercialSummary(s.target);
          expect(summary.identity.operationId).toBe(s.op.operationId);
          expect(summary.history).toHaveLength(1);
          expect(summary.knownCost.amount).toBe('2.1');
          expect(summary.knownNetResult.amount).toBe('2.9');
          expect(summary.costLedger.events).toHaveLength(1);
          expect(summary.costScope.attribution).toBe(
            'PIPELINE_RUN_NOT_ADDITIVE_ACROSS_PUBLICATIONS',
          );
        }
        fb.patch({ state: 'UNCERTAIN' });
        expect(
          f.publishing.commercialSummary(target).identity.operationId,
        ).toBe(ig.op.operationId);
        ig.patch({ state: 'PREPARED' });
        expect(() => f.publishing.commercialSummary(target)).toThrow(
          /CONFIRMED_PUBLICATION_REQUIRED/,
        );
      } finally {
        f.close();
      }
    },
  );

  test.each([
    { state: 'UNCERTAIN' },
    { state: 'PREPARED' },
    { requiresReconciliation: true },
    { remoteReceipt: null },
    { mediaId: null },
    {
      remoteReceipt: { mediaId: '123456789', permalink: null, publishedAt: at },
    },
  ])('rejects unconfirmed or inconsistent operation: %j', async (patch) => {
    const f = await fixture();
    try {
      const o = await f.occurrence('2026-11-08');
      const s = await socialSnapshot(f, o, 'FACEBOOK_REELS');
      s.patch(patch);
      expect(() =>
        f.publishing.recordCommercialResults(
          s.target,
          input,
          'invalid_receipt',
        ),
      ).toThrow(/CONFIRMED_PUBLICATION_REQUIRED/);
    } finally {
      f.close();
    }
  });

  test('multi-network Instagram-only and mixed manual/social publications', async () => {
    const f = await fixture();
    try {
      const o = await f.occurrence('2026-11-08');
      const s = await socialSnapshot(f, o, 'INSTAGRAM');
      const target = { kind: 'execution', id: o.execution.execution_id };
      expect(f.publishing.commercialSummary(target).identity.operationId).toBe(
        s.op.operationId,
      );
      f.manual(o);
      expect(() => f.publishing.commercialSummary(target)).toThrow(
        /PUBLICATION_AMBIGUOUS/,
      );
      expect(
        f.publishing.commercialSummary(s.target).identity.operationId,
      ).toBe(s.op.operationId);
    } finally {
      f.close();
    }
  });

  test('Facebook permalink when present, timestamp and media identity are validated', async () => {
    const f = await fixture();
    try {
      const o = await f.occurrence('2026-11-08');
      const s = await socialSnapshot(f, o, 'FACEBOOK_REELS');
      const remoteReceipt = {
        ...s.snapshot.remoteReceipt,
        permalink: 'https://www.facebook.com/reel/987654321/',
      };
      s.patch({ remoteReceipt });
      expect(
        f.publishing.commercialSummary(s.target).publication.permalink,
      ).toBe(remoteReceipt.permalink);
      s.patch({ remoteReceipt: { ...remoteReceipt, publishedAt: 'invalid' } });
      expect(() => f.publishing.commercialSummary(s.target)).toThrow(
        /INVALID_TIMESTAMP/,
      );
      s.patch({ mediaHash: 'f'.repeat(64) });
      expect(() => f.publishing.commercialSummary(s.target)).toThrow(
        /PUBLICATION_SCOPE_MISMATCH/,
      );
    } finally {
      f.close();
    }
  });

  test('Instagram still requires a permalink; network must match package platform', async () => {
    const f = await fixture();
    try {
      const o = await f.occurrence('2026-11-08');
      const s = await socialSnapshot(f, o, 'INSTAGRAM');
      s.patch({
        remoteReceipt: { ...s.snapshot.remoteReceipt, permalink: null },
      });
      expect(() => f.publishing.commercialSummary(s.target)).toThrow(
        /INVALID_TEXT/,
      );
      s.patch({ network: 'FACEBOOK_REELS' });
      expect(() => f.publishing.commercialSummary(s.target)).toThrow(
        /PUBLICATION_SCOPE_MISMATCH/,
      );
    } finally {
      f.close();
    }
  });
});
