import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { NativeCampaignWorkflow } from '../content-operations/application/native-campaign-workflow.js';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { FinanceSession } from '../finance/infrastructure/finance.session.js';
import { PublishingService } from '../publishing/application/publishing.service.js';
import { PublishingPersistence } from '../publishing/infrastructure/publishing.persistence.js';
import { deterministicInstagramPorts } from '../publishing/infrastructure/instagram-fake.js';
import { InstagramPublicationService } from '../publishing/application/instagram-publication.service.js';
import { OperationalAlertsService } from './application/operational-alerts.service.js';
import { openNotificationStore } from '../../test/support/operational-notifications.fixture.js';
import { FakeOperationalNotificationAdapter } from './infrastructure/operational-notification.adapter.js';
import { DiscordOperationalNotificationAdapter } from './infrastructure/discord-operational-notification.adapter.js';

test('Nest/SQLite E2E: render/package/publication reach Telegram and Discord once, restart preserves both receipts', async () => {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const at = '2026-11-08T13:00:00.000Z',
    hash = createHash('sha256').update('simulated render').digest('hex');
  const adapter = new FakeOperationalNotificationAdapter();
  const discordMessages: string[] = [];
  const discord = new DiscordOperationalNotificationAdapter(
    `https://discord.com/api/webhooks/123456789012345678/${'fixture_'.repeat(8)}`,
    async (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('EXPECTED_JSON_BODY');
      const payload = JSON.parse(init.body);
      expect(payload.allowed_mentions).toEqual({ parse: [] });
      discordMessages.push(payload.content);
      return new Response(
        JSON.stringify({ id: String(100000 + discordMessages.length) }),
      );
    },
  );
  const channels = [adapter, discord];
  const alerts = new OperationalAlertsService(
    () => openNotificationStore(f.database),
    channels,
    () => at,
  );
  const catalog = new SqliteAffiliatePersistence(f.database),
    projects = {
      get: async (id: string, version?: number) => f.base.get(id, version),
    };
  const affiliate = new AffiliateService(catalog, projects),
    binding = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
  binding.bindRun(
    { pipelineRunId: 'run_001', briefingId: 'brief_001' },
    'alert_fixture_binding',
  );
  const render = {
    videoRenderId: 'render_alert_e2e',
    revision: 1,
    contentHash: hash,
    logicalReference: `render:sha256_${hash}`,
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    origin: { rights: { commercialUseAuthorized: true } },
  };
  const qc = {
    reportId: 'qc_alert_e2e',
    videoRenderId: render.videoRenderId,
    videoRenderContentHash: hash,
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    result: 'PASS',
    approvalBlocked: false,
    findings: [
      'COMMERCIAL_RIGHTS',
      'PROCESSING_RIGHTS',
      'NARRATION_RIGHTS',
    ].map((code) => ({ code, status: 'PASS' })),
  };
  const report = {
    ...qc,
    qualityControlReportId: qc.reportId,
    contentHash: createHash('sha256').update(JSON.stringify(qc)).digest('hex'),
  };
  const media = {
    getVideoRender: () => render,
    report: () => report,
    verifyMedia: () => hash,
  } as any;
  const finance = new FinanceService({
    open: () => new FinanceSession(f.database),
  });
  const store = new PublishingPersistence(
    f.database,
    catalog,
    binding,
    media,
    f.database,
  );
  const publishing = new PublishingService(store, media, finance, alerts);
  const instagram = new InstagramPublicationService(
    store,
    deterministicInstagramPorts(publishing, media, '123456789', 'v25.0'),
    () => at,
    false,
    finance,
    alerts,
  );
  const workflow = new NativeCampaignWorkflow(
    affiliate,
    binding,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { preview: async () => ({ ready: true, url: '/preview' }) } as any,
    media as any,
    finance,
    {} as any,
    publishing,
    instagram,
  );
  // Only production transports are simulated. HANDOFF, exact render approval,
  // package approval, publication gates/receipt and all persistence remain real.
  const execute = workflow.execute.bind(workflow);
  vi.spyOn(workflow, 'execute').mockImplementation(async (step, ...args) => {
    if (step === 'HANDOFF' || step === 'PUBLICATION')
      return execute(step, ...args);
    if (step === 'EDITORIAL')
      return {
        script: { fullNarration: 'Produto com evidências autorizadas.' },
      };
    if (step === 'BURN')
      return { videoRenderId: render.videoRenderId, contentHash: hash };
    if (step === 'QC') return qc;
    if (step === 'PREVIEW') return { ready: true, url: '/preview' };
    return {};
  });
  const admin = new CampaignAdministration(
    f.database,
    workflow,
    false,
    () => at,
    alerts,
  );
  const module = await Test.createTestingModule({
    providers: [
      { provide: OperationalAlertsService, useValue: alerts },
      { provide: CampaignAdministration, useValue: admin },
    ],
  }).compile();
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('NO_REAL_EXTERNAL_CALLS'));
  try {
    await module.init();
    const e = await admin.schedule({
      campaignId: 'camp_001',
      campaignRevision: 1,
      scheduledAt: at,
      runId: 'run_001',
      briefingId: 'brief_001',
      researchShortlistId: null,
      generationRequestId: 'alert_editorial_e2e',
      mode: 'LOCAL_VALIDATION',
      videoProduction: { mode: 'LOCAL_IMAGES' },
      localImage: { mediaReference: 'authorized-image-001' },
    });
    await admin.tick();
    await alerts.scan();
    expect(admin.get(e.execution_id).status).toBe('WAITING_INPUT');
    expect(adapter.messages.map((m) => m.kind)).toEqual([
      'RENDER_READY_FOR_REVIEW',
    ]);
    const review = await admin.operatorReview(e.execution_id, 'operator_001');
    await admin.approve(e.execution_id, {
      ...review.identity,
      decision: 'APPROVED',
      actor: 'operator_001',
      justification: null,
    });
    await admin.resume(e.execution_id);
    await admin.tick();
    await alerts.scan();
    expect(adapter.messages.map((m) => m.kind)).toEqual([
      'RENDER_READY_FOR_REVIEW',
      'PACKAGE_READY_FOR_REVIEW',
    ]);
    const pendingFacts = openNotificationStore(f.database);
    try {
      const [fact] = pendingFacts.facts(e.execution_id);
      expect(fact.execution.stage.approval?.decision).toBe('APPROVED');
      expect(fact.packages[0].review).toBeNull();
      expect(fact.packages[0].identity.videoRenderRevision).toBe(1);
    } finally {
      pendingFacts.close();
    }
    const packageReview = await admin.operatorReview(
      e.execution_id,
      'operator_001',
    );
    await admin.operatorDecision(e.execution_id, 'package', {
      reviewId: packageReview.reviewId,
      actor: 'operator_001',
      decision: 'APPROVED',
      justification: null,
    });
    await admin.resume(e.execution_id);
    await admin.tick();
    await alerts.scan();
    expect(admin.get(e.execution_id).status).toBe('SUCCEEDED');
    expect(adapter.messages.map((m) => m.kind)).toEqual([
      'RENDER_READY_FOR_REVIEW',
      'PACKAGE_READY_FOR_REVIEW',
      'PUBLICATION_SUCCEEDED',
    ]);
    expect(adapter.messages[2].text).toContain(
      'https://www.instagram.com/reel/fake_',
    );
    expect(adapter.messages[2].text).toContain('SIMULAÇÃO');
    expect(discordMessages).toEqual(
      adapter.messages.map((message) => message.text),
    );
    await alerts.onModuleDestroy();
    const reopened = new OperationalAlertsService(
      () => openNotificationStore(f.database),
      channels,
      () => at,
    );
    reopened.onModuleInit();
    await reopened.scan();
    await reopened.onModuleDestroy();
    expect(adapter.messages).toHaveLength(3);
    expect(discordMessages).toHaveLength(3);
    const facts = openNotificationStore(f.database);
    try {
      const [p] = facts.facts(e.execution_id)[0].packages;
      expect(p.review?.currentApproval).toBe(true);
      expect(p.publications[0]).toMatchObject({
        confirmed: true,
        requiresReconciliation: false,
        destination: { network: 'instagram' },
        simulated: true,
        receipt: {
          permalink: expect.stringContaining(
            'https://www.instagram.com/reel/fake_',
          ),
        },
      });
      publishing.revokeApproval({
        packageHash: p.hash,
        reviewHash: p.review!.hash,
        actor: 'operator_001',
        reason: 'offline revocation check',
      });
      const [revoked] = facts.facts(e.execution_id)[0].packages;
      expect(revoked.review).toMatchObject({
        revoked: true,
        currentApproval: false,
      });
      expect(revoked.publications[0].receipt).toEqual(
        p.publications[0].receipt,
      );
    } finally {
      facts.close();
    }
    expect(
      f.base.db
        .prepare(
          "SELECT count(*) n FROM campaign_execution_events WHERE event_type='OPERATIONAL_NOTIFICATION_DELIVERED'",
        )
        .get()?.n,
    ).toBe(6);
    expect(fetch).not.toHaveBeenCalled();
    expect(f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await module.close();
    fetch.mockRestore();
    f.cleanup();
  }
});
