import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { SqliteAffiliateRepository } from '../affiliate/infrastructure/sqlite-affiliate.repository.js';
import { PublishingPersistence } from '../publishing/infrastructure/publishing.persistence.js';
import { PublishingService } from '../publishing/application/publishing.service.js';
import { InstagramPublicationService } from '../publishing/application/instagram-publication.service.js';
import { LocalQcGuard } from '../publishing/application/local-qc.guard.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import {
  NativeCampaignWorkflow,
  campaignRequest,
} from './application/native-campaign-workflow.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import { CampaignController } from './campaign.controller.js';

vi.mock(
  '../publishing/application/local-qc.guard.js',
  async (importOriginal) => ({
    ...(await importOriginal<any>()),
    serverApprovalRequest: (body: any, principal: any) => ({
      ...body,
      actor: principal?.id ?? 'operator_001',
    }),
  }),
);

async function fixture() {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db);
  const at = new Date().toISOString();
  let clock = at;
  const bytes = Buffer.from('offline-video-fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const render = {
    videoRenderId: 'render_001',
    revision: 1,
    contentHash: hash,
    logicalReference: `render:sha256_${hash}`,
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    origin: { rights: { commercialUseAuthorized: true } },
  };
  const qc = {
    reportId: 'qc_001',
    videoRenderId: render.videoRenderId,
    videoRenderContentHash: hash,
    result: 'PASS',
    approvalBlocked: false,
    findings: [
      'COMMERCIAL_RIGHTS',
      'PROCESSING_RIGHTS',
      'NARRATION_RIGHTS',
    ].map((code) => ({ code, status: 'PASS' })),
  };
  const media = {
    getVideoRender: () => render,
    verifyMedia: () => render.contentHash,
    report: () => ({
      ...qc,
      qualityControlReportId: qc.reportId,
      contentHash: createHash('sha256')
        .update(JSON.stringify(qc))
        .digest('hex'),
      pipelineRunId: render.pipelineRunId,
      projectId: 'project_001',
      projectVersion: 1,
    }),
  };
  const catalog = {
    open: (readOnly = false) =>
      new SqliteAffiliateRepository(f.database, { readOnly }),
  };
  const context = {
    resolveRunBriefing: () => ({ campaignId: 'camp_001', campaignRevision: 1 }),
  };
  const persistence = new PublishingPersistence(
    f.database,
    catalog as any,
    context as any,
    media as any,
    f.database,
  );
  const publishing = new PublishingService(persistence, media as any);
  const posts: string[] = [];
  let account = '123456789';
  let uncertain = false;
  const publisher = {
    mode: 'fake',
    get accountId() {
      return account;
    },
    createContainer: async () => ({ containerId: '234567890' }),
    createResumableContainer: async () => {
      posts.push('container');
      return {
        containerId: '234567890',
        uploadUri: 'https://rupload.facebook.com/ig-api-upload/v25.0/234567890',
      };
    },
    uploadResumableBytes: async () => {
      posts.push('upload');
      if (uncertain) throw Error('timeout');
      return { uploaded: true };
    },
    getContainerStatus: async () => ({ status: 'FINISHED' }),
    publish: async () => {
      posts.push('publish');
      return { mediaId: '987654321' };
    },
    getMedia: async () => ({
      mediaId: '987654321',
      permalink: 'https://www.instagram.com/reel/fixture/',
      publishedAt: at,
    }),
  };
  const instagram = new InstagramPublicationService(
    persistence,
    {
      publisher,
      localBytes: async () => bytes,
      media: {
        inspect: async () => ({
          contentHash: hash,
          result: 'PASS',
          policyVersion: 'instagram-reels-profile/1.0.0',
        }),
      },
    } as any,
    () => clock,
  );
  const workflow = new NativeCampaignWorkflow(
    {} as any,
    context as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { preview: async () => ({ ready: true, url: 'fixture' }) } as any,
    media as any,
    {
      getGlobalOperation: () => null,
      getGlobalUsage: () => ({
        dailyUsd: '0',
        monthlyUsd: '0',
        policy: {
          time_zone: 'America/Sao_Paulo',
          daily_usd: '1',
          monthly_usd: '20',
        },
      }),
    } as any,
    {} as any,
    publishing,
    instagram,
  );
  const repo = new CampaignRepository(f.base.db);
  let e = repo.schedule(
    {
      campaignId: 'camp_001',
      campaignRevision: 1,
      runId: 'run_001',
      scheduledAt: at,
    },
    {
      campaignId: 'camp_001',
      campaignRevision: 1,
      runId: 'run_001',
      scheduledAt: at,
      briefingId: 'brief_001',
      generationRequestId: 'editorial_001',
      researchShortlistId: null,
      mode: 'LOCAL_VALIDATION',
      videoProduction: { mode: 'LOCAL_IMAGES' },
      localImage: { mediaReference: 'authorized-image-001' },
    },
    at,
  );
  const claimed = repo.claim(e.execution_id, at, 60000)!;
  for (const step of workflow.steps.filter(
    (s) => !['HANDOFF', 'PUBLICATION'].includes(s),
  )) {
    const result =
      step === 'EDITORIAL'
        ? { script: { fullNarration: 'Produto autorizado' } }
        : step === 'BURN'
          ? { videoRenderId: render.videoRenderId, contentHash: hash }
          : step === 'QC'
            ? qc
            : step === 'PREVIEW'
              ? { ready: true, url: 'fixture' }
              : {};
    repo.ownedEvent(e.execution_id, claimed.claim_token!, at, 'STEP_DONE', {
      step,
      result,
    });
  }
  repo.ownedEvent(
    e.execution_id,
    claimed.claim_token!,
    at,
    'PAUSED',
    { step: 'HANDOFF', code: 'EXACT_HUMAN_APPROVAL_REQUIRED' },
    'WAITING_INPUT',
  );
  let admin: CampaignAdministration;
  let app: any;
  const start = async () => {
    admin = new CampaignAdministration(
      f.database,
      workflow,
      false,
      () => clock,
    );
    const module = await Test.createTestingModule({
      controllers: [CampaignController],
      providers: [{ provide: CampaignAdministration, useValue: admin }],
    })
      .overrideGuard(LocalQcGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  };
  await start();
  let path = `/content-operations/campaign-executions/${e.execution_id}`;
  const review = async () =>
    (await request(app.getHttpServer()).get(`${path}/review`).expect(200)).body;
  const decide = (kind: string, reviewId: string) =>
    request(app.getHttpServer())
      .post(`${path}/${kind === 'render' ? 'approvals' : 'package-approvals'}`)
      .send({ reviewId, decision: 'APPROVED', justification: null });
  const resume = async () => {
    await request(app.getHttpServer())
      .post(`${path}/resume`)
      .send({})
      .expect(201);
    await admin.tick();
  };
  return {
    f,
    repo,
    get e() {
      return e;
    },
    render,
    qc,
    publishing,
    posts,
    review,
    decide,
    resume,
    nextOccurrence() {
      const source = repo.history(e.execution_id);
      clock = new Date(Date.parse(at) + 86400000).toISOString();
      render.pipelineRunId = 'run_002';
      render.videoRenderId = 'render_002';
      qc.videoRenderId = render.videoRenderId;
      qc.reportId = 'qc_002';
      e = repo.schedule(
        {
          campaignId: 'camp_001',
          campaignRevision: 1,
          runId: 'run_002',
          scheduledAt: clock,
        },
        { ...source[0].evidence, runId: 'run_002', scheduledAt: clock },
        clock,
      );
      const claim = repo.claim(e.execution_id, clock, 60000)!;
      for (const event of source.filter(
        (h) =>
          h.event_type === 'STEP_DONE' &&
          !['HANDOFF', 'PUBLICATION'].includes(String(h.evidence.step)),
      )) {
        const step = event.evidence.step;
        const result =
          step === 'BURN'
            ? { videoRenderId: render.videoRenderId, contentHash: hash }
            : step === 'QC'
              ? qc
              : event.evidence.result;
        repo.ownedEvent(
          e.execution_id,
          claim.claim_token!,
          clock,
          'STEP_DONE',
          { step, result },
        );
      }
      repo.ownedEvent(
        e.execution_id,
        claim.claim_token!,
        clock,
        'PAUSED',
        { step: 'HANDOFF', code: 'EXACT_HUMAN_APPROVAL_REQUIRED' },
        'WAITING_INPUT',
      );
      path = `/content-operations/campaign-executions/${e.execution_id}`;
    },
    get admin() {
      return admin;
    },
    changeDestination: () => {
      account = '987654321';
    },
    failUpload: () => {
      uncertain = true;
    },
    async restart() {
      await app.close();
      await start();
    },
    async close() {
      await app.close();
      f.cleanup();
    },
  };
}

test('HTTP operator flow: exact reviews survive restart; resume needs no Publishing IDs and produces one receipt', async () => {
  const f = await fixture();
  try {
    const view = await f.review();
    expect(view.render.videoRenderId).toBe(f.render.videoRenderId);
    expect(view.package).toBeNull();
    await f.restart();
    await f.decide('render', view.reviewId).expect(201);
    await f.decide('render', view.reviewId).expect(201);
    await f.resume();
    expect(f.posts).toEqual([]);
    expect(
      f.repo.get(f.e.execution_id).status,
      JSON.stringify(f.repo.history(f.e.execution_id).slice(-4)),
    ).toBe('WAITING_INPUT');
    const pkg = await f.review();
    expect(pkg.package.identity.videoRenderContentHash).toBe(
      view.render.contentHash,
    );
    await f.decide('package', pkg.reviewId).expect(201);
    await f.restart();
    await f.decide('package', pkg.reviewId).expect(201);
    await f.resume();
    expect(f.repo.get(f.e.execution_id).status).toBe('SUCCEEDED');
    expect(f.posts).toEqual(['container', 'upload', 'publish']);
    await f.resume();
    expect(f.posts).toEqual(['container', 'upload', 'publish']);
    expect(
      f.repo
        .history(f.e.execution_id)
        .find(
          (h) =>
            h.event_type === 'STEP_DONE' && h.evidence.step === 'PUBLICATION',
        )?.evidence.result,
    ).toMatchObject({
      mediaId: '987654321',
      receipt: { mediaId: '987654321' },
    });
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await f.close();
  }
});

test.each(['render', 'destination'])(
  'changed %s between presentation and approval is rejected',
  async (change) => {
    const f = await fixture();
    try {
      const view = await f.review();
      if (change === 'render') f.render.revision++;
      else f.changeDestination();
      await f.decide('render', view.reviewId).expect(409);
      expect(f.posts).toEqual([]);
    } finally {
      await f.close();
    }
  },
);

test('revoked package approval blocks publication after restart', async () => {
  const f = await fixture();
  try {
    await f.decide('render', (await f.review()).reviewId).expect(201);
    await f.resume();
    const pkg = await f.review();
    await f.decide('package', pkg.reviewId).expect(201);
    const approval = f.publishing.packageReview(pkg.package.contentHash);
    f.publishing.revokeApproval({
      packageHash: pkg.package.contentHash,
      reviewHash: approval.contentHash,
      actor: 'operator_001',
      reason: 'Revoked in offline test',
    });
    await f.restart();
    await f.resume();
    expect(f.posts).toEqual([]);
    expect(f.repo.get(f.e.execution_id).status).not.toBe('SUCCEEDED');
  } finally {
    await f.close();
  }
});

test('another production date in the same database requires its own render and package approvals', async () => {
  const f = await fixture();
  try {
    const first = await f.review();
    await f.decide('render', first.reviewId).expect(201);
    await f.resume();
    const pkg = await f.review();
    await f.decide('package', pkg.reviewId).expect(201);
    f.nextOccurrence();
    await f.decide('render', first.reviewId).expect(409);
    const next = await f.review();
    expect(next.renderApproval).toBeNull();
    expect(next.package).toBeNull();
    await f.decide('render', next.reviewId).expect(201);
    await f.resume();
    const nextPkg = await f.review();
    expect(nextPkg.package.contentHash).not.toBe(pkg.package.contentHash);
    expect(nextPkg.packageApproval).toBeNull();
    expect(f.posts).toEqual([]);
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a changed package destination blocks the decision; approval cannot silently follow it', async () => {
  const f = await fixture();
  try {
    await f.decide('render', (await f.review()).reviewId).expect(201);
    await f.resume();
    const view = await f.review();
    f.changeDestination();
    const response = await f.decide('package', view.reviewId);
    expect(response.status).not.toBe(201);
    expect(f.posts).toEqual([]);
  } finally {
    await f.close();
  }
});

test('ambiguous packages block both review and publication', async () => {
  const f = await fixture();
  try {
    await f.decide('render', (await f.review()).reviewId).expect(201);
    await f.resume();
    f.publishing.prepare(
      {
        campaignId: 'camp_001',
        campaignRevision: 1,
        videoRenderId: 'render_001',
        qualityControlReportId: 'qc_001',
        platform: 'instagram',
        account: '123456789',
        caption: 'Outra legenda autorizada',
      },
      'second_package',
    );
    await expect(f.review()).rejects.toThrow();
    await f.resume();
    expect(f.posts).toEqual([]);
    expect(f.repo.history(f.e.execution_id).at(-1)?.evidence.code).toBe(
      'DISTRIBUTION_PACKAGE_AMBIGUOUS',
    );
  } finally {
    await f.close();
  }
});

test('uncertain upload resumes the same operation without repeating upload or container creation', async () => {
  const f = await fixture();
  try {
    await f.decide('render', (await f.review()).reviewId).expect(201);
    await f.resume();
    await f.decide('package', (await f.review()).reviewId).expect(201);
    f.failUpload();
    await f.resume();
    expect(f.repo.get(f.e.execution_id).status).toBe('WAITING_RECONCILIATION');
    await f.restart();
    await f.resume();
    expect(f.posts.filter((p) => p === 'container')).toHaveLength(1);
    expect(f.posts.filter((p) => p === 'upload')).toHaveLength(1);
    expect(f.posts.filter((p) => p === 'publish').length).toBeLessThanOrEqual(
      1,
    );
  } finally {
    await f.close();
  }
});

test('recurring destination request freezes distinct Instagram and Facebook intents', () => {
  const base = {
    campaignId: 'camp_001',
    campaignRevision: 1,
    runId: 'run_day_1',
    scheduledAt: '2026-11-08T12:00:00.000Z',
    briefingId: 'brief_001',
    generationRequestId: 'generation_001',
    researchShortlistId: null,
    mode: 'PRODUCTION',
  };
  const instagram = {
    network: 'INSTAGRAM',
    accountId: '123456789',
    packageHash: 'a'.repeat(64),
  };
  const facebook = {
    network: 'FACEBOOK_REELS',
    accountId: '1355505384315575',
    packageHash: 'b'.repeat(64),
  };
  expect(
    campaignRequest({ ...base, publication: [instagram, facebook] })
      .publication,
  ).toEqual([instagram, facebook]);
  expect(() =>
    campaignRequest({ ...base, publication: [facebook, facebook] }),
  ).toThrow('INVALID_PUBLICATION_REQUEST');
});

test('two recurring occurrences keep Facebook pending without repeating or mixing Instagram receipts', async () => {
  const instagram = {
    execute: vi.fn(async (e: any) => ({
      operationId: `ig:${e.execution_id}`,
      mediaId: `ig-media:${e.execution_id}`,
      receipt: { mediaId: `ig-media:${e.execution_id}` },
    })),
    status: () => null,
  };
  const facebookRows = new Map<string, any>();
  const facebook = { status: (id: string) => facebookRows.get(id) ?? [] };
  const workflow = new NativeCampaignWorkflow(
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
    {} as any,
    instagram as any,
    undefined,
    undefined,
    facebook as any,
  );
  const publication = [
    {
      network: 'INSTAGRAM',
      accountId: '123456789',
      packageHash: 'a'.repeat(64),
    },
    {
      network: 'FACEBOOK_REELS',
      accountId: '1355505384315575',
      packageHash: 'b'.repeat(64),
    },
  ];
  const d1 = { execution_id: 'execution_day_1' } as any;
  const d2 = { execution_id: 'execution_day_2' } as any;
  const run = (e: any) =>
    workflow.execute('PUBLICATION', e, { publication }, { HANDOFF: {} });
  await expect(run(d1)).rejects.toThrow(
    'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
  );
  expect(instagram.execute).toHaveBeenCalledTimes(1);
  facebookRows.set(d1.execution_id, [
    {
      network: 'FACEBOOK_REELS',
      accountId: publication[1].accountId,
      operationId: 'fb:day1',
      operation: {
        operationId: 'fb:day1',
        packageHash: publication[1].packageHash,
        state: 'PUBLISHED',
        mediaId: 'fb-media:day1',
        remoteReceipt: { mediaId: 'fb-media:day1' },
      },
    },
  ]);
  const first = (await run(d1)) as any;
  expect(first.destinations.INSTAGRAM.operationId).toBe('ig:execution_day_1');
  expect(first.destinations.FACEBOOK_REELS.operationId).toBe('fb:day1');
  await expect(run(d2)).rejects.toThrow(
    'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
  );
  facebookRows.set(d2.execution_id, [
    {
      network: 'FACEBOOK_REELS',
      accountId: publication[1].accountId,
      operationId: 'fb:day2',
      operation: {
        operationId: 'fb:day2',
        packageHash: publication[1].packageHash,
        state: 'PUBLISHED',
        mediaId: 'fb-media:day2',
        remoteReceipt: { mediaId: 'fb-media:day2' },
      },
    },
  ]);
  const second = (await run(d2)) as any;
  expect(second.destinations.FACEBOOK_REELS.operationId).toBe('fb:day2');
  expect(second.destinations.INSTAGRAM.operationId).toBe('ig:execution_day_2');
  expect(first.destinations.FACEBOOK_REELS.operationId).not.toBe(
    second.destinations.FACEBOOK_REELS.operationId,
  );
});

test('Facebook-only recurrence waits for manual authorization and isolates UNKNOWN or mismatched receipts', async () => {
  const instagram = { execute: vi.fn() };
  let rows: any[] = [];
  const facebook = { status: () => rows };
  const workflow = new NativeCampaignWorkflow(
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
    {} as any,
    instagram as any,
    undefined,
    undefined,
    facebook as any,
  );
  const target = {
    network: 'FACEBOOK_REELS',
    accountId: '1355505384315575',
    packageHash: 'b'.repeat(64),
  };
  const run = () =>
    workflow.execute(
      'PUBLICATION',
      { execution_id: 'execution_day_1' } as any,
      { publication: [target] },
      { HANDOFF: {} },
    );
  await expect(run()).rejects.toThrow(
    'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
  );
  expect(instagram.execute).not.toHaveBeenCalled();
  rows = [
    {
      network: target.network,
      accountId: target.accountId,
      operation: {
        operationId: 'fb:day1',
        packageHash: target.packageHash,
        state: 'UNCERTAIN',
        uncertainStage: 'PUBLISH',
      },
    },
  ];
  await expect(run()).rejects.toThrow('SOCIAL_RECONCILIATION_REQUIRED');
  rows = [
    {
      network: target.network,
      accountId: target.accountId,
      operation: {
        operationId: 'fb:day1',
        packageHash: 'c'.repeat(64),
        state: 'PUBLISHED',
        mediaId: 'media:day1',
        remoteReceipt: { mediaId: 'media:day1' },
      },
    },
  ];
  await expect(run()).rejects.toThrow('SOCIAL_PUBLICATION_IDENTITY_CONFLICT');
  rows[0].operation.packageHash = target.packageHash;
  rows[0].operationId = 'fb:day1';
  rows[0].operation.remoteReceipt.mediaId = 'media:other';
  await expect(run()).rejects.toThrow('SOCIAL_PUBLICATION_IDENTITY_CONFLICT');
  rows[0].operation.remoteReceipt.mediaId = 'media:day1';
  expect(
    ((await run()) as any).destinations.FACEBOOK_REELS.receipt.mediaId,
  ).toBe('media:day1');
  expect(instagram.execute).not.toHaveBeenCalled();
});

test('a reconciled Instagram receipt still leaves Facebook pending', async () => {
  const receipt = {
    operationId: 'ig:day1',
    mediaId: 'ig-media:day1',
    receipt: { mediaId: 'ig-media:day1' },
  };
  const instagram = {
    execute: vi.fn(),
    status: () => ({ operation: { state: 'PUBLISHED' } }),
    reconcile: vi.fn(async () => ({
      verified: true,
      step: 'PUBLICATION',
      result: receipt,
    })),
  };
  const facebook = { status: () => [] };
  const workflow = new NativeCampaignWorkflow(
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
    {} as any,
    instagram as any,
    undefined,
    undefined,
    facebook as any,
  );
  const publication = [
    {
      network: 'INSTAGRAM',
      accountId: '123456789',
      packageHash: 'a'.repeat(64),
    },
    {
      network: 'FACEBOOK_REELS',
      accountId: '1355505384315575',
      packageHash: 'b'.repeat(64),
    },
  ];
  await expect(
    workflow.execute(
      'PUBLICATION',
      { execution_id: 'execution_day_1' } as any,
      { publication },
      { HANDOFF: {} },
    ),
  ).rejects.toThrow('FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED');
  expect(instagram.reconcile).toHaveBeenCalledOnce();
  expect(instagram.execute).not.toHaveBeenCalled();
});
