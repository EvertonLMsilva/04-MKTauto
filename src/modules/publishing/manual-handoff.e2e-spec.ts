import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { PublishingPersistence } from './infrastructure/publishing.persistence.js';
import { PublishingService } from './application/publishing.service.js';
import { PublishingController } from './publishing.controller.js';
import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { LocalQcGuard } from './application/local-qc.guard.js';
import { provisionQcReviewer } from './application/local-qc-identity.js';

function fixture(fakeOnly = false) {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db, 44);
  const directory = mkdtempSync(join(tmpdir(), 'manual-handoff-'));
  const file = join(directory, 'synthetic-fixture.mp4');
  // Authorized synthetic bytes for hash integrity; codec/QC port is a test double.
  writeFileSync(file, Buffer.from('authorized-manual-handoff-fixture'));
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  const render = {
    videoRenderId: 'render_manual',
    revision: 1,
    contentHash: hash,
    logicalReference: `render:sha256_${hash}`,
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    origin: { rights: { commercialUseAuthorized: true } },
  };
  const qc: any = {
    qualityControlReportId: 'qc_manual',
    contentHash: 'b'.repeat(64),
    videoRenderId: render.videoRenderId,
    videoRenderContentHash: hash,
    projectId: render.projectId,
    projectVersion: 1,
    pipelineRunId: render.pipelineRunId,
    result: 'PASS',
    approvalBlocked: false,
    findings: [
      'COMMERCIAL_RIGHTS',
      'PROCESSING_RIGHTS',
      'NARRATION_RIGHTS',
    ].map((code) => ({ code, status: 'PASS' })),
  };
  if (fakeOnly)
    qc.evidence = {
      publicationAuthorization: { grant: { scope: { mode: 'fake' } } },
    };
  const catalog = new SqliteAffiliatePersistence(f.database);
  const repo = catalog.open();
  const link =
    'https://example.com/item?sub_id1=campaign%2B001&sub_id2=video_001';
  try {
    repo.registerCampaign(
      { ...repo.getCampaign('camp_001', 1)!, revision: 2, affiliateUrl: link },
      'manual_offer',
      true,
    );
    repo.createBriefing(
      {
        briefingId: 'brief_manual',
        campaignId: 'camp_001',
        campaignRevision: 2,
      },
      'manual_brief',
      true,
    );
  } finally {
    repo.close();
  }
  const binding = new AffiliateRunContextService(
    new SqliteAffiliateRunContextPersistence(f.database),
  );
  binding.bindRun(
    { pipelineRunId: render.pipelineRunId, briefingId: 'brief_manual' },
    'manual_bind',
  );
  const media: any = {
    getVideoRender: () => render,
    report: () => qc,
    verifyMedia: () =>
      createHash('sha256').update(readFileSync(file)).digest('hex'),
  };
  const store = new PublishingPersistence(
    f.database,
    catalog,
    binding,
    media,
    f.database,
  );
  const publishing = new PublishingService(store, media);
  const packages = ['instagram', 'facebook'].map((platform) =>
    publishing.prepare(
      {
        campaignId: 'camp_001',
        campaignRevision: 2,
        videoRenderId: render.videoRenderId,
        qualityControlReportId: qc.qualityControlReportId,
        platform,
        account: platform === 'instagram' ? '123456789' : '1355505384315575',
        caption: 'Texto exato.\nSegunda linha.',
      },
      `manual_package_${platform}`,
    ),
  );
  const approve = (p = packages[0]) =>
    publishing.review(
      {
        packageHash: p.contentHash,
        decision: 'APPROVED',
        actor: 'fixture_reviewer',
        justification: null,
      },
      `manual_review_${p.platform}`,
    );
  const revoke = (p = packages[0]) =>
    publishing.revokeApproval({
      packageHash: p.contentHash,
      reviewHash: publishing.packageReview(p.contentHash).contentHash,
      actor: 'fixture_reviewer',
      reason: 'Fixture revocation',
    });
  const tables = () =>
    f.base.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => ({
        table: r.name,
        rows: f.base.db
          .prepare(
            'SELECT * FROM "' + String(r.name).replaceAll('"', '""') + '"',
          )
          .all(),
      }));
  return {
    f,
    directory,
    file,
    render,
    qc,
    publishing,
    store,
    packages,
    approve,
    revoke,
    tables,
    link,
    cleanup: () => {
      f.cleanup();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test.each([0, 1])(
  'approved destination %s yields exact read-only handoff with no publication confirmation',
  (index) => {
    const f = fixture();
    try {
      const p = f.packages[index],
        review = f.approve(p),
        before = f.tables();
      const handoff = f.publishing.manualHandoff(p.contentHash);
      expect(handoff).toMatchObject({
        schemaVersion: 'manual-release-handoff/1.0.0',
        packageHash: p.contentHash,
        destination: { platform: p.platform, account: p.account },
        video: {
          videoRenderId: f.render.videoRenderId,
          revision: 1,
          sha256: f.render.contentHash,
        },
        caption: p.caption,
        cta: p.cta,
        disclosure: p.disclosure,
        affiliateUrl: f.link,
        approval: { decision: 'APPROVED', reviewHash: review.contentHash },
        eligibility: { status: 'PASS', pending: [] },
        publicationStatus: 'NOT_CONFIRMED_BY_HANDOFF',
      });
      expect(handoff.finalCaption).toBe(
        [p.caption, p.cta, p.disclosure, f.link].join('\n\n'),
      );
      expect(f.publishing.manualHandoff(p.contentHash)).toEqual(handoff);
      expect(f.tables()).toEqual(before);
      expect(f.publishing.publications(p.contentHash)).toEqual([]);
      for (const forbidden of [
        'rightsEvidence',
        'originRights',
        'uploadUri',
        'grant',
        'actor',
        f.directory,
      ])
        expect(JSON.stringify(handoff)).not.toContain(forbidden);
    } finally {
      f.cleanup();
    }
  },
);

test.each([
  'missing-approval',
  'revoked',
  'revision',
  'bytes',
  'qc',
  'rights',
  'destination',
  'tampered-package',
  'foreign-review',
  'fake-only',
])('manual handoff blocks %s', (kind) => {
  const f = fixture(kind === 'fake-only');
  let session: ReturnType<typeof f.store.open> | undefined;
  try {
    const p = f.packages[0];
    if (kind !== 'missing-approval') f.approve(p);
    if (kind === 'revoked') f.revoke(p);
    if (kind === 'revision') f.render.revision++;
    if (kind === 'bytes') writeFileSync(f.file, 'changed-fixture');
    if (kind === 'qc') f.qc.result = 'FAIL';
    if (kind === 'rights')
      f.render.origin.rights.commercialUseAuthorized = false;
    if (
      kind === 'destination' ||
      kind === 'tampered-package' ||
      kind === 'foreign-review'
    ) {
      if (kind === 'foreign-review') f.approve(f.packages[1]);
      session = f.store.open(true);
      if (kind === 'foreign-review')
        vi.spyOn(session.manual, 'getReview').mockReturnValue(
          f.publishing.packageReview(f.packages[1].contentHash),
        );
      else {
        const get = session.manual.getPackage.bind(session.manual);
        vi.spyOn(session.manual, 'getPackage').mockImplementation(
          (hash: string) => ({
            ...get(hash),
            ...(kind === 'destination'
              ? { platform: 'facebook' }
              : { link: 'https://wrong.invalid/' }),
          }),
        );
      }
      expect(() => session!.manual.manualHandoff(p.contentHash)).toThrow();
    } else expect(() => f.publishing.manualHandoff(p.contentHash)).toThrow();
  } finally {
    session?.close();
    f.cleanup();
  }
});

test('revocation after handoff also blocks the existing manual publication command', () => {
  const f = fixture();
  try {
    const p = f.packages[0];
    f.approve(p);
    f.publishing.manualHandoff(p.contentHash);
    f.revoke(p);
    const before = f.tables();
    expect(() =>
      f.publishing.recordPublication(
        {
          packageHash: p.contentHash,
          actor: 'fixture_operator',
          publishedAt: '2026-11-08T13:00:00Z',
          externalId: 'manual_fixture',
          externalUrl: 'https://instagram.com/p/fixture/',
          evidenceReference: 'fixture:manual-confirmation',
          state: 'PUBLISHED',
        },
        'revoked_manual_record',
      ),
    ).toThrow(/APPROVAL_REVOKED/);
    expect(f.tables()).toEqual(before);
  } finally {
    f.cleanup();
  }
});

test('guarded HTTP handoff then existing manual publication/results commands preserve replay and identity', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('NO_EXTERNAL_NETWORK'));
  const f = fixture();
  let app: INestApplication | undefined;
  try {
    const config = join(f.directory, 'identities.json'),
      secret = join(f.directory, 'credential');
    await provisionQcReviewer(config, 'manual_reviewer', secret);
    vi.stubEnv('QC_IDENTITIES_FILE', config);
    const module = await Test.createTestingModule({
      controllers: [PublishingController],
      providers: [
        { provide: PublishingService, useValue: f.publishing },
        { provide: InstagramPublicationService, useValue: {} },
        LocalQcGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    const p = f.packages[0],
      path = `/publishing/packages/${p.contentHash}/manual-handoff`;
    const authorization = 'Bearer ' + readFileSync(secret, 'utf8').trim();
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', authorization)
      .expect(400);
    f.approve(p);
    const before = f.tables();
    const response = await request(app.getHttpServer())
      .get(path)
      .set('Authorization', authorization)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      (
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', authorization)
          .expect(200)
      ).body,
    ).toEqual(response.body);
    expect(f.tables()).toEqual(before);
    const input = {
      packageHash: response.body.packageHash,
      actor: 'fixture_operator',
      publishedAt: '2026-11-08T13:00:00Z',
      externalId: 'manual_fixture',
      externalUrl: 'https://instagram.com/p/fixture/',
      evidenceReference: 'fixture:manual-confirmation',
      state: 'PUBLISHED',
    };
    const record = () =>
      request(app!.getHttpServer())
        .post('/publishing/manual-publications')
        .send({ input, idempotencyKey: 'manual_http_record' });
    const publication = (await record().expect(201)).body;
    expect((await record().expect(201)).body).toEqual(publication);
    const unknown = { status: 'UNKNOWN', reason: 'NOT_REPORTED' };
    const result = {
      publicationId: publication.publicationId,
      periodStart: '2026-11-08T00:00:00Z',
      periodEnd: '2026-11-09T00:00:00Z',
      sourceReference: 'fixture:manual-report',
      attribution: 'DIRECT_PUBLICATION',
      clicks: unknown,
      sales: unknown,
      revenue: unknown,
      commissions: unknown,
    };
    const post = () =>
      request(app!.getHttpServer())
        .post('/publishing/results')
        .send({ input: result, idempotencyKey: 'manual_http_results' });
    const reported = (await post().expect(201)).body;
    expect((await post().expect(201)).body).toEqual(reported);
    expect(f.publishing.publications(p.contentHash)).toHaveLength(1);
    expect(f.publishing.results(publication.publicationId)).toHaveLength(1);
    expect(reported.packageHash).toBe(p.contentHash);
    expect(network).not.toHaveBeenCalled();
  } finally {
    await app?.close();
    f.cleanup();
    network.mockRestore();
    vi.unstubAllEnvs();
  }
});
