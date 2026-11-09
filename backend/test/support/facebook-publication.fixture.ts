import { HumanApprovalService } from '../../src/publishing/application/human-approval.service.js';
import { createHash } from 'node:crypto';
import { p2EditorialFixture } from './p2-editorial-fixture.js';
import { provisionSchema } from '../../src/administration/schema-provisioner.js';
import { SqliteAffiliatePersistence } from '../../src/affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { AffiliateRunContextService } from '../../src/affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../../src/affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { CampaignRepository } from '../../src/content-operations/infrastructure/campaign.repository.js';
import { CampaignOperationsService } from '../../src/content-operations/application/campaign-operations.service.js';
import { SqliteCampaignOperationsPersistence } from '../../src/content-operations/infrastructure/campaign-operations.persistence.js';
import { FinanceService } from '../../src/finance/application/finance.service.js';
import { FinanceSession } from '../../src/finance/infrastructure/finance.session.js';
import { PublishingPersistence } from '../../src/publishing/infrastructure/publishing.persistence.js';
import { PublishingService } from '../../src/publishing/application/publishing.service.js';
import { InstagramPublicationService } from '../../src/publishing/application/instagram-publication.service.js';
import { DestinationPublicationService } from '../../src/publishing/application/destination-publication.service.js';
import { FacebookReelsAdapter } from '../../src/publishing/infrastructure/facebook-reels.adapter.js';
import { deterministicInstagramPorts } from '../../src/publishing/infrastructure/instagram-fake.js';
import type { FacebookPublicationPorts } from '../../src/publishing/application/ports/destination-publication.port.js';
import { publishingEvidence } from '../../src/publishing/application/publication-eligibility.js';
import { adaptationHash } from '../../src/media/domain/media-hash.js';

export async function facebookPublicationFixture(
  localQc = false,
  uploadVersion = 'v25.0',
  distinctSessions = false,
) {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db, 42);
  // A small MP4 container fixture; codec probing is an explicit simulated Media port.
  const bytes = Buffer.from(
    '000000206674797069736f6d0000020069736f6d69736f32617663316d703431000000086d646174',
    'hex',
  );
  const hash = createHash('sha256').update(bytes).digest('hex'),
    at = '2026-11-08T13:00:00.000Z';
  const render = {
    videoRenderId: 'render_multi_fixture',
    revision: 1,
    contentHash: hash,
    logicalReference: `render:sha256_${hash}`,
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    origin: { rights: { commercialUseAuthorized: true } },
  };
  let report: any = {
    qualityControlReportId: 'qc_multi_fixture',
    contentHash: 'b'.repeat(64),
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
  let historicalQc: any;
  if (localQc) {
    const raw = {
      policyVersion: 'local-qc/1',
      videoRenderId: render.videoRenderId,
      videoRenderContentHash: hash,
      findings: [
        'PHYSICAL_HASH',
        'VERIFIED_SUBTITLES_LINEAGE',
        'STREAMS_FORMAT_DURATION',
        'FULL_DECODE',
      ].map((code) => ({ code, status: 'PASS' })),
      facts: { streams: [], format: { duration: '20' } },
      result: 'PASS',
      approvalBlocked: false,
      cost: { status: 'UNKNOWN', amount: null },
    };
    const id = 'local_qc:' + adaptationHash(raw);
    historicalQc = { reportId: id, ...raw };
    report = publishingEvidence(
      {} as any,
      {
        publicationEvidence: () => ({
          qc: raw,
          render,
          planHash: 'c'.repeat(64),
          audio: {
            voiceTrackId: 'voice_fixture',
            contentHash: 'd'.repeat(64),
            rightsHash: 'e'.repeat(64),
            authorizationHash: 'f'.repeat(64),
          },
          assets: [
            {
              id: 'asset_fixture',
              contentHash: '1'.repeat(64),
              rightsHash: '2'.repeat(64),
              reviewHash: '3'.repeat(64),
            },
          ],
          publicationAuthorization: {
            required: false,
            grant: null,
            missing: null,
          },
        }),
      } as any,
    ).report(id);
  }
  const media = {
    getVideoRender: () => render,
    report: () => report,
    verifyMedia: () => hash,
  } as any;
  const catalog = new SqliteAffiliatePersistence(f.database),
    binding = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
  binding.bindRun(
    { pipelineRunId: 'run_001', briefingId: 'brief_001' },
    'multi_binding',
  );
  const finance = new FinanceService({
    open: () => new FinanceSession(f.database),
  });
  const store = new PublishingPersistence(
      f.database,
      catalog,
      binding,
      media,
      f.database,
    ),
    publishing = new PublishingService(store, media, finance);
  const campaigns = new CampaignRepository(f.base.db),
    campaignPort = new CampaignOperationsService(
      new SqliteCampaignOperationsPersistence(f.database),
      catalog,
    );
  const e = campaigns.schedule(
    {
      campaignId: 'camp_001',
      campaignRevision: 1,
      runId: 'run_001',
      scheduledAt: at,
    },
    { briefingId: 'brief_001', generationRequestId: 'multi_finance_fixture' },
    at,
  );
  const execution = campaigns.claim(e.execution_id, at, 60000)!;
  const identity = {
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    videoRenderId: render.videoRenderId,
    videoRenderRevision: 1,
    videoRenderContentHash: hash,
    qualityControlReportId: report.qualityControlReportId,
    qualityControlReportContentHash: localQc
      ? createHash('sha256').update(JSON.stringify(historicalQc)).digest('hex')
      : report.contentHash,
  };
  const approval = new HumanApprovalService({
    repository: {
      getVideoRender: () => render,
      getQualityControlReport: () =>
        localQc
          ? {
              ...historicalQc,
              qualityControlReportId: report.qualityControlReportId,
              contentHash: identity.qualityControlReportContentHash,
              pipelineRunId: render.pipelineRunId,
              projectId: render.projectId,
              projectVersion: render.projectVersion,
            }
          : report,
      getHumanApprovalDecision: () => null,
      findApprovedHumanApprovalDecision: () => null,
      registerHumanApprovalDecision: (decision: any) => decision,
    },
  }).decide({
    ...identity,
    decision: 'APPROVED',
    actor: 'operator_fixture',
    justification: null,
  });
  for (const [step, result] of [
    ['BURN', { videoRenderId: render.videoRenderId, contentHash: hash }],
    ['QC', historicalQc ?? report],
    ['PREVIEW', { ready: true }],
  ])
    campaigns.ownedEvent(
      e.execution_id,
      execution.claim_token!,
      at,
      'STEP_DONE',
      { step, result },
    );
  campaigns.ownedEvent(
    e.execution_id,
    execution.claim_token!,
    at,
    'HUMAN_APPROVAL',
    approval,
  );
  const prepare = (
    platform: string,
    account: string,
    caption = 'Produto autorizado.',
  ) =>
    publishing.prepare(
      {
        campaignId: 'camp_001',
        campaignRevision: 1,
        videoRenderId: render.videoRenderId,
        qualityControlReportId: report.qualityControlReportId,
        platform,
        account,
        caption,
      },
      `multi_package_${platform}_${createHash('sha256').update(caption).digest('hex').slice(0, 12)}`,
    );
  const instagramPackage = prepare('instagram', '123456789'),
    facebookPackage = prepare('facebook', '1355505384315575');
  const approve = (pkg: any) =>
    publishing.review(
      {
        packageHash: pkg.contentHash,
        decision: 'APPROVED',
        actor: 'operator_fixture',
        justification: null,
      },
      `review_${pkg.contentHash}`,
    );
  approve(instagramPackage);
  const instagram = new InstagramPublicationService(
    store,
    deterministicInstagramPorts(publishing, media, '123456789', 'v25.0'),
    () => at,
    false,
    finance,
  );
  const ig = await instagram.execute(
    execution,
    { packageHash: instagramPackage.contentHash, accountId: '123456789' },
    { videoRenderId: render.videoRenderId, contentHash: hash },
  );
  const legacy = {
    operations: f.base.db
      .prepare(
        'SELECT * FROM social_publication_operations ORDER BY operation_id',
      )
      .all(),
    events: f.base.db
      .prepare(
        'SELECT * FROM social_publication_events ORDER BY operation_id,version',
      )
      .all(),
    reservations: f.base.db
      .prepare('SELECT * FROM instagram_publication_reservations')
      .all(),
  };
  provisionSchema(f.base.db, 43);
  const posts: string[] = [];
  let sessionCount = 0,
    latestVideoId = '987654321';
  let processing = true,
    published = false,
    receiptVisible = true,
    fail: 'create' | 'upload' | 'publish' | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    const fields =
      typeof init?.body === 'string' ? new URLSearchParams(init.body) : null;
    if (u.pathname.endsWith('/me'))
      return new Response(JSON.stringify({ id: '1355505384315575' }));
    if (u.pathname.endsWith('/debug_token'))
      return new Response(
        JSON.stringify({
          data: {
            is_valid: true,
            type: 'PAGE',
            scopes: ['pages_manage_posts'],
          },
        }),
      );
    if (init?.method === 'POST') {
      const step =
        u.hostname === 'rupload.facebook.com'
          ? 'upload'
          : fields?.get('upload_phase') === 'start'
            ? 'create'
            : 'publish';
      posts.push(step);
      if (step === 'create')
        latestVideoId = distinctSessions
          ? String(987654321 + sessionCount++)
          : '987654321';
      if (step === 'publish') published = true;
      if (fail === step) throw Error('SIMULATED_UNKNOWN_REMOTE_RESULT');
      return new Response(
        JSON.stringify(
          step === 'create'
            ? {
                video_id: latestVideoId,
                upload_url: `https://rupload.facebook.com/video-upload/${uploadVersion}/${latestVideoId}`,
              }
            : { success: true },
        ),
      );
    }
    return new Response(
      JSON.stringify({
        id: u.pathname.split('/').at(-1),
        from: { id: '1355505384315575' },
        created_time: at,
        permalink_url:
          'https://www.facebook.com/reel/' + u.pathname.split('/').at(-1) + '/',
        status: u.searchParams.get('fields')?.includes('from')
          ? {
              video_status: 'uploading',
              uploading_phase: { status: 'in_progress' },
              processing_phase: { status: 'not_started' },
              publishing_phase: { status: 'not_started' },
            }
          : {
              video_status: processing ? 'ready' : 'processing',
              uploading_phase: { status: 'complete' },
              processing_phase: {
                status: processing ? 'complete' : 'in_progress',
              },
              publishing_phase: {
                status:
                  published && receiptVisible ? 'complete' : 'not_started',
              },
            },
      }),
    );
  };
  const publisher = new FacebookReelsAdapter({
    pageId: '1355505384315575',
    apiVersion: uploadVersion === 'v27.0' ? 'v26.0' : 'v25.0',
    mode: 'fake',
    getAccessToken: () => 'fixture_page',
    getAppAccessToken: () => 'fixture_app',
    fetch,
  });
  const ports: FacebookPublicationPorts = {
    publisher,
    media: {
      inspect: async () => ({
        contentHash: hash,
        result: 'PASS',
        policyVersion: 'facebook-reels-profile/1.0.0',
      }),
    },
    localBytes: async () => bytes,
    transfer: async () => {
      throw Error('NO_URL_UPLOAD');
    },
    verifier: {
      mode: 'fake',
      verifyTransfer: async () => {
        throw Error('NO_URL_UPLOAD');
      },
      verifyPublication: async () => {
        throw Error('NO_URL_UPLOAD');
      },
    },
    verifyConnection: () => publisher.verifyConnection(),
  };
  const reopen = (now = () => at) =>
    new DestinationPublicationService(
      store,
      campaignPort,
      ports,
      finance,
      undefined,
      now,
    );
  return {
    f,
    at,
    hash,
    render,
    media,
    store,
    publishing,
    campaignPort,
    finance,
    campaigns,
    execution,
    instagram,
    instagramPackage,
    facebookPackage,
    ig,
    legacy,
    ports,
    posts,
    prepare,
    approve,
    reopen,
    execute: (service = reopen()) =>
      service.execute(e.execution_id, 'FACEBOOK_REELS', '1355505384315575'),
    setReceiptVisible: (value: boolean) => {
      receiptVisible = value;
    },
    setProcessing: (value: boolean) => {
      processing = value;
    },
    fail: (step: typeof fail) => {
      fail = step;
    },
    cleanup: () => f.cleanup(),
  };
}
