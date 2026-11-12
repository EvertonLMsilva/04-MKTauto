import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { CampaignRepository } from '../content-operations/infrastructure/campaign.repository.js';
import { CampaignOperationsService } from '../content-operations/application/campaign-operations.service.js';
import { SqliteCampaignOperationsPersistence } from '../content-operations/infrastructure/campaign-operations.persistence.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { FinanceSession } from '../finance/infrastructure/finance.session.js';
import { PublishingPersistence } from './infrastructure/publishing.persistence.js';
import { PublishingService } from './application/publishing.service.js';
import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { DestinationPublicationService } from './application/destination-publication.service.js';
import { deterministicInstagramPorts } from './infrastructure/instagram-fake.js';
import { FacebookReelsAdapter } from './infrastructure/facebook-reels.adapter.js';
import { assertFacebookReelsProfile } from './domain/facebook-reels-profile.js';

test('FAKE pilot: physical synthetic MP4, independent approvals, durable receipts and queue across restart', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('REAL_HTTP_FORBIDDEN'));
  const root = mkdtempSync(join(tmpdir(), 'publishing-fake-pilot-'));
  const f = p2EditorialFixture();
  try {
    const file = join(root, 'synthetic.mp4');
    // Original generated color/silence, authorized solely for this test fixture.
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=540x960:r=24',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-t',
      '4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      file,
    ]);
    execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
        { encoding: 'utf8' },
      ),
    );
    assertFacebookReelsProfile(probe);
    const bytes = readFileSync(file),
      hash = createHash('sha256').update(bytes).digest('hex');
    const at = '2026-11-08T13:00:00.000Z';
    const render = {
      videoRenderId: 'render_pilot_fixture',
      revision: 1,
      contentHash: hash,
      logicalReference: `render:sha256_${hash}`,
      projectId: 'project_001',
      projectVersion: 1,
      pipelineRunId: 'run_001',
      origin: { rights: { commercialUseAuthorized: true } },
    };
    const report = {
      qualityControlReportId: 'qc_pilot_fixture',
      contentHash: 'b'.repeat(64),
      videoRenderId: render.videoRenderId,
      videoRenderContentHash: hash,
      projectId: render.projectId,
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
    const media: any = {
      getVideoRender: () => render,
      report: () => report,
      verifyMedia: () =>
        createHash('sha256').update(readFileSync(file)).digest('hex'),
    };
    provisionSchema(f.base.db, 44);
    const catalog = new SqliteAffiliatePersistence(f.database);
    // Freeze explicit SubIDs in a new offer revision and briefing, without rewriting history.
    const c = catalog.open();
    const link =
      'https://example.com/item?sub_id1=pilot%2B001&sub_id2=video_001';
    try {
      c.registerCampaign(
        { ...c.getCampaign('camp_001', 1)!, revision: 2, affiliateUrl: link },
        'pilot_offer',
        true,
      );
      c.createBriefing(
        {
          briefingId: 'brief_pilot',
          campaignId: 'camp_001',
          campaignRevision: 2,
        },
        'pilot_brief',
        true,
      );
    } finally {
      c.close();
    }
    const binding = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
    binding.bindRun(
      { pipelineRunId: 'run_001', briefingId: 'brief_pilot' },
      'pilot_bind',
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
    );
    const publishing = new PublishingService(store, media, finance);
    const campaigns = new CampaignRepository(f.base.db);
    const campaignPort = new CampaignOperationsService(
      new SqliteCampaignOperationsPersistence(f.database),
      catalog,
    );
    const packages = ['instagram', 'facebook'].map((platform) =>
      publishing.prepare(
        {
          campaignId: 'camp_001',
          campaignRevision: 2,
          videoRenderId: render.videoRenderId,
          qualityControlReportId: report.qualityControlReportId,
          platform,
          account: platform === 'instagram' ? '123456789' : '1355505384315575',
          caption: 'Vídeo sintético autorizado apenas para teste.',
        },
        `pilot_package_${platform}`,
      ),
    );
    const [igPackage, fbPackage] = packages;
    const execution = campaigns.schedule(
      {
        campaignId: 'camp_001',
        campaignRevision: 2,
        runId: 'run_001',
        scheduledAt: at,
      },
      {
        briefingId: 'brief_pilot',
        publication: packages.map((p) => ({
          network: p.platform === 'instagram' ? 'INSTAGRAM' : 'FACEBOOK_REELS',
          accountId: p.account,
          packageHash: p.contentHash,
        })),
      },
      at,
    );
    const claim = campaigns.claim(execution.execution_id, at, 60000)!;
    const approve = (p: any) =>
      publishing.review(
        {
          packageHash: p.contentHash,
          decision: 'APPROVED',
          actor: 'fixture_reviewer',
          justification: null,
        },
        `pilot_review_${p.platform}`,
      );
    const approval = approve(igPackage);
    for (const [step, result] of [
      ['BURN', { videoRenderId: render.videoRenderId, contentHash: hash }],
      ['QC', report],
      ['PREVIEW', { ready: true }],
    ])
      campaigns.ownedEvent(
        execution.execution_id,
        claim.claim_token!,
        at,
        'STEP_DONE',
        { step, result },
      );
    campaigns.ownedEvent(
      execution.execution_id,
      claim.claim_token!,
      at,
      'HUMAN_APPROVAL',
      approval.mediaDecision,
    );
    const instagram = new InstagramPublicationService(
      store,
      deterministicInstagramPorts(
        publishing,
        media,
        igPackage.account,
        'v25.0',
      ),
      () => at,
      false,
      finance,
    );
    const ig = await instagram.execute(
      claim,
      { packageHash: igPackage.contentHash, accountId: igPackage.account },
      { videoRenderId: render.videoRenderId, contentHash: hash },
    );
    campaigns.ownedEvent(
      execution.execution_id,
      claim.claim_token!,
      at,
      'WORKFLOW_FINISHED',
      {},
      'SUCCEEDED',
    );
    let published = false;
    const posts: string[] = [];
    const publisher = new FacebookReelsAdapter({
      pageId: fbPackage.account,
      apiVersion: 'v25.0',
      mode: 'fake',
      getAccessToken: () => 'FIXTURE_ONLY',
      getAppAccessToken: () => 'FIXTURE_APP_ONLY',
      fetch: async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (init?.method === 'POST') {
          const fields =
            typeof init.body === 'string'
              ? new URLSearchParams(init.body)
              : null;
          const step =
            url.hostname === 'rupload.facebook.com'
              ? 'upload'
              : fields?.get('upload_phase') === 'start'
                ? 'create'
                : 'publish';
          posts.push(step);
          if (step === 'upload')
            expect(Buffer.from(init.body as Uint8Array)).toEqual(bytes);
          if (step === 'publish') {
            published = true;
            expect(fields?.get('description')).toContain(link);
          }
          return new Response(
            JSON.stringify(
              step === 'create'
                ? {
                    video_id: '987654321',
                    upload_url:
                      'https://rupload.facebook.com/video-upload/v25.0/987654321',
                  }
                : { success: true },
            ),
          );
        }
        return new Response(
          JSON.stringify({
            id: '987654321',
            created_time: at,
            permalink_url: 'https://www.facebook.com/reel/987654321/',
            status: {
              video_status: 'ready',
              uploading_phase: { status: 'complete' },
              processing_phase: { status: 'complete' },
              publishing_phase: {
                status: published ? 'complete' : 'not_started',
              },
            },
          }),
        );
      },
    });
    const ports = {
      publisher,
      media: {
        inspect: async () => {
          assertFacebookReelsProfile(probe);
          return {
            contentHash: media.verifyMedia(),
            result: 'PASS',
            policyVersion: 'facebook-reels-profile/1.0.0',
          };
        },
      },
      localBytes: async () => readFileSync(file),
      transfer: async () => {
        throw Error('URL_UPLOAD_FORBIDDEN');
      },
      verifier: {
        mode: 'fake' as const,
        verifyTransfer: async () => {
          throw Error('URL_UPLOAD_FORBIDDEN');
        },
        verifyPublication: async () => {
          throw Error('URL_UPLOAD_FORBIDDEN');
        },
      },
    };
    const reopen = (now = at) =>
      new DestinationPublicationService(
        store,
        campaignPort,
        ports,
        finance,
        undefined,
        () => now,
      );
    const queue = () =>
      reopen()
        .queue()
        .items.find((r) => r.executionId === execution.execution_id)!;
    expect(queue().publicationComplete).toBe(false);
    expect(
      queue().destinations.find((d) => d.network === 'FACEBOOK_REELS')
        ?.nextAction,
    ).toBe('REVIEW_APPROVAL');
    await expect(
      reopen().prepareFacebookOccurrence(
        execution.execution_id,
        fbPackage.account,
      ),
    ).rejects.toMatchObject({ code: 'DISTRIBUTION_APPROVAL_REQUIRED' });
    approve(fbPackage);
    const prepared = await reopen().prepareFacebookOccurrence(
      execution.execution_id,
      fbPackage.account,
    );
    expect(
      queue().destinations.find((d) => d.network === 'FACEBOOK_REELS')
        ?.nextAction,
    ).toBe('AUTHORIZE_FACEBOOK');
    expect(posts).toEqual([]);
    const grant = {
      executionId: execution.execution_id,
      operationId: prepared.operationId,
      accountId: fbPackage.account,
      packageHash: fbPackage.contentHash,
      campaignRevision: 2,
      expectedVersion: prepared.version,
      authorizationId: 'pilot_grant_fixture',
      actor: 'fixture_reviewer',
      authorizedAt: at,
      expiresAt: new Date(Date.parse(at) + 60000).toISOString(),
    };
    await reopen().authorizeFacebookOccurrence(
      execution.execution_id,
      fbPackage.account,
      prepared.version,
      grant,
    );
    const fb = await reopen().execute(
      execution.execution_id,
      'FACEBOOK_REELS',
      fbPackage.account,
      grant,
    );
    expect(fb.operationId).not.toBe(ig.operationId);
    expect(posts).toEqual(['create', 'upload', 'publish']);
    const afterExpiry = reopen(
      new Date(Date.parse(grant.expiresAt) + 1000).toISOString(),
    );
    expect(
      await afterExpiry.execute(
        execution.execution_id,
        'FACEBOOK_REELS',
        fbPackage.account,
        grant,
      ),
    ).toEqual(fb);
    await expect(
      afterExpiry.execute(
        execution.execution_id,
        'FACEBOOK_REELS',
        fbPackage.account,
        { ...grant, packageHash: igPackage.contentHash },
      ),
    ).rejects.toMatchObject({ code: 'SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED' });
    const final = afterExpiry
      .queue()
      .items.find((r) => r.executionId === execution.execution_id)!;
    expect(final.publicationComplete).toBe(true);
    expect(final.destinations).toHaveLength(2);
    for (const d of final.destinations) {
      expect(d).toMatchObject({
        simulated: true,
        executionMode: 'fake',
        pendingCode: null,
        nextAction: 'NONE',
      });
      expect(d.receipt.mediaId).toBe(
        d.network === 'INSTAGRAM' ? ig.mediaId : fb.mediaId,
      );
      const p = publishing.package(d.packageHash!);
      const operation = store.social((repository) =>
        repository.get(d.operationId!),
      );
      expect(operation.mediaHash).toBe(hash);
      expect(operation.caption).toBe(
        [p.caption, p.cta, p.disclosure, link].join('\n\n'),
      );
      expect(publishing.packageReview(p.contentHash)).toMatchObject({
        packageHash: p.contentHash,
        mediaDecision: { decision: 'APPROVED', videoRenderContentHash: hash },
      });
      expect(p).toMatchObject({
        campaignId: 'camp_001',
        campaignRevision: 2,
        productId: 'prod_001',
        link,
        identity: {
          videoRenderContentHash: hash,
          qualityControlReportId: report.qualityControlReportId,
        },
      });
    }
    expect(afterExpiry.queue()).toEqual(afterExpiry.queue());
    expect(posts).toEqual(['create', 'upload', 'publish']);
    expect(network).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
    rmSync(root, { recursive: true, force: true });
    network.mockRestore();
  }
}, 30000);
