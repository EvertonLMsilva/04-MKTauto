import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import { PublishingPersistence } from './infrastructure/publishing.persistence.js';
import { PublishingService } from './application/publishing.service.js';
import { PublishingController } from './publishing.controller.js';
import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { LocalQcGuard } from './application/local-qc.guard.js';
import { provisionQcReviewer } from './application/local-qc-identity.js';
const { firstManualPublication } = await import(
  new URL(
    '../../../scripts/ops-local/first-manual-publication.mjs',
    import.meta.url,
  ).href
);

const SCOPE = 'FICTITIOUS_TEST_ONLY';
const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const f = p2EditorialFixture();
  provisionSchema(f.base.db, 44);
  const root = mkdtempSync(
    join(tmpdir(), 'first-manual-FICTITIOUS_TEST_ONLY-'),
  );
  let app: INestApplication | undefined;
  try {
    const file = join(root, 'FICTITIOUS_TEST_ONLY.mp4');
    // Original local color/silence, authorized exclusively as test fixture media.
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
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-xerror',
      '-err_detect',
      'explode',
      '-i',
      file,
      '-f',
      'null',
      '-',
    ]);
    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
        { encoding: 'utf8' },
      ),
    );
    expect(
      probe.streams.some(
        (s: any) =>
          s.codec_type === 'video' &&
          s.codec_name === 'h264' &&
          s.width === 540 &&
          s.height === 960,
      ),
    ).toBe(true);
    expect(
      probe.streams.some(
        (s: any) => s.codec_type === 'audio' && s.codec_name === 'aac',
      ),
    ).toBe(true);
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(4);
    const hash = sha256(readFileSync(file));
    const render = {
      videoRenderId: SCOPE.toLowerCase() + '_render',
      revision: 1,
      contentHash: hash,
      logicalReference: 'render:sha256_' + hash,
      projectId: 'project_001',
      projectVersion: 1,
      pipelineRunId: 'run_001',
      origin: { rights: { commercialUseAuthorized: true } },
    };
    // Media port fixture: physical facts above are real local decode observations;
    // rights are test declarations, not operational QC or commercial authorization.
    const qc = {
      qualityControlReportId: SCOPE.toLowerCase() + '_qc',
      videoRenderId: render.videoRenderId,
      videoRenderContentHash: hash,
      projectId: render.projectId,
      projectVersion: 1,
      pipelineRunId: render.pipelineRunId,
      result: 'PASS',
      approvalBlocked: false,
      contentHash: '',
      findings: [
        'COMMERCIAL_RIGHTS',
        'PROCESSING_RIGHTS',
        'NARRATION_RIGHTS',
        'FULL_DECODE',
        'PHYSICAL_HASH',
      ].map((code) => ({ code, status: 'PASS' })),
      evidence: { scope: SCOPE, probe },
    };
    qc.contentHash = affiliateHash(qc);
    let missingQc = false;
    const media: any = {
      getVideoRender: (id: string) =>
        id === render.videoRenderId ? render : null,
      report: (id: string) =>
        !missingQc && id === qc.qualityControlReportId ? qc : null,
      verifyMedia: (reference: string) =>
        reference === render.logicalReference
          ? sha256(readFileSync(file))
          : null,
    };
    const catalog = new SqliteAffiliatePersistence(f.database),
      c = catalog.open();
    const affiliateUrl =
      'https://example.com/FICTITIOUS_TEST_ONLY?sub_id1=camp%2B001&sub_id2=video_001';
    try {
      c.registerCampaign(
        { ...c.getCampaign('camp_001', 1)!, revision: 2, affiliateUrl },
        'first_manual_offer',
        true,
      );
      c.createBriefing(
        {
          briefingId: 'brief_first_manual',
          campaignId: 'camp_001',
          campaignRevision: 2,
        },
        'first_manual_brief',
        true,
      );
    } finally {
      c.close();
    }
    const binding = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
    binding.bindRun(
      { pipelineRunId: 'run_001', briefingId: 'brief_first_manual' },
      'first_manual_bind',
    );
    const config = join(root, 'fixture-identities.json'),
      secret = join(root, 'fixture-credential');
    await provisionQcReviewer(config, 'fixture_reviewer', secret);
    vi.stubEnv('QC_IDENTITIES_FILE', config);
    // Only the HTTP test adapter handles this disposable fixture secret. The
    // actual tool uses the browser's existing HttpOnly session without reading it.
    const authorization = 'Bearer ' + readFileSync(secret, 'utf8').trim();
    let publishing: PublishingService;
    const start = async () => {
      if (app) await app.close();
      const store = new PublishingPersistence(
        f.database,
        catalog,
        binding,
        media,
        f.database,
      );
      publishing = new PublishingService(store, media);
      const module = await Test.createTestingModule({
        controllers: [PublishingController],
        providers: [
          { provide: PublishingService, useValue: publishing },
          { provide: InstagramPublicationService, useValue: {} },
          LocalQcGuard,
        ],
      }).compile();
      app = module.createNestApplication();
      await app.init();
    };
    await start();
    const http = () => request(app!.getHttpServer());
    const command = (path: string, input: unknown, key: string) =>
      http()
        .post('/publishing/' + path)
        .send({ input, idempotencyKey: key });
    const packageInput = {
      campaignId: 'camp_001',
      campaignRevision: 2,
      videoRenderId: render.videoRenderId,
      qualityControlReportId: qc.qualityControlReportId,
      platform: 'instagram',
      account: '123456789',
      caption: SCOPE + ': vídeo aprovado.\nLegenda exata.',
    };
    const packageResponse = await command(
      'packages',
      packageInput,
      'first_manual_package',
    );
    expect(packageResponse.status, JSON.stringify(packageResponse.body)).toBe(
      201,
    );
    const pkg = packageResponse.body;
    const approve = (packageHash = pkg.contentHash) =>
      command(
        'reviews',
        {
          packageHash,
          decision: 'APPROVED',
          actor: SCOPE + '_reviewer',
          justification: null,
        },
        'review_' + packageHash.slice(0, 40),
      );
    const readCalls: string[] = [];
    const query = (path: string) =>
      http().get(path).set('Authorization', authorization);
    const transport = async (url: string, options: RequestInit) => {
      expect(options.method).toBe('GET');
      const path = new URL(url).pathname + new URL(url).search;
      readCalls.push(path);
      const r = await query(path);
      return new Response(JSON.stringify(r.body), { status: r.status });
    };
    const selection = {
      packageHash: pkg.contentHash as string,
      platform: pkg.platform as string,
      account: pkg.account as string,
    };
    const handoff = () =>
      firstManualPublication(selection, {
        origin: 'http://localhost:3000',
        fetch: transport,
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
      file,
      hash,
      render,
      qc,
      packageInput,
      pkg,
      affiliateUrl,
      command,
      http,
      query,
      authenticatedCommand: (path: string, input: unknown, key: string) =>
        command(path, input, key).set('Authorization', authorization),
      approve,
      selection,
      handoff,
      readCalls,
      tables,
      restart: start,
      publishing: () => publishing,
      omitQc: () => {
        missingQc = true;
      },
      cleanup: async () => {
        await app?.close();
        f.cleanup();
        rmSync(root, { recursive: true, force: true });
        vi.unstubAllEnvs();
      },
    };
  } catch (error) {
    await app?.close();
    f.cleanup();
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
    throw error;
  }
}

test('FICTITIOUS_TEST_ONLY physical MP4 -> QC -> review -> package -> read-only handoff -> UNCONFIRMED record -> restart recovery', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('NO_SOCIAL_HTTP'));
  const f = await fixture();
  try {
    const hash = f.pkg.contentHash,
      base = '/publishing/packages/' + hash;
    expect(
      (
        await f
          .command('packages', f.packageInput, 'first_manual_package')
          .expect(201)
      ).body,
    ).toEqual(f.pkg);
    expect((await f.http().get(base).expect(200)).body.contentHash).toBe(hash);
    await f
      .http()
      .get(base + '/manual-handoff')
      .expect(401);
    expect((await f.handoff()).blockers).toContain(
      'DISTRIBUTION_APPROVAL_REQUIRED',
    );
    const review = (await f.approve().expect(201)).body;
    expect(
      (
        await f
          .http()
          .get(base + '/review')
          .expect(200)
      ).body,
    ).toEqual(review);
    const before = f.tables();
    const handoff = await f.handoff();
    expect(handoff.status).toBe('READY_FOR_OPERATOR_HANDOFF');
    expect(handoff.handoff.video.sha256).toBe(f.hash);
    expect(handoff.handoff.affiliateUrl).toBe(f.affiliateUrl);
    expect(handoff.handoff.finalCaption).toBe(
      [f.pkg.caption, f.pkg.cta, f.pkg.disclosure, f.pkg.link].join('\n\n'),
    );
    expect(await f.handoff()).toEqual(handoff);
    expect(f.tables()).toEqual(before);
    expect(
      (await f.query(base + '/manual-handoff')).headers['cache-control'],
    ).toBe('no-store');
    const input = {
      packageHash: hash,
      actor: SCOPE + '_operator',
      publishedAt: '2026-11-13T12:00:00Z',
      externalId: null,
      externalUrl: null,
      evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:unconfirmed-attempt',
      state: 'UNCONFIRMED',
    };
    // No remote receipt is simulated as a confirmed publication.
    const publication = (
      await f
        .command('manual-publications', input, 'first_manual_record')
        .expect(201)
    ).body;
    expect(publication.state).toBe('UNCONFIRMED');
    expect(
      (
        await f
          .command('manual-publications', input, 'first_manual_record')
          .expect(201)
      ).body,
    ).toEqual(publication);
    expect(
      (
        await f
          .command('manual-publications', input, 'first_manual_same_payload')
          .expect(201)
      ).body,
    ).toEqual(publication);
    const persisted = f.tables();
    await f.restart();
    const recordPath =
      '/publishing/manual-publications/' +
      encodeURIComponent(publication.publicationId);
    expect((await f.http().get(recordPath).expect(200)).body).toEqual(
      publication,
    );
    expect(
      (
        await f
          .http()
          .get('/publishing/manual-publications?packageHash=' + hash)
          .expect(200)
      ).body,
    ).toEqual([publication]);
    expect(
      (
        await f
          .http()
          .get(recordPath + '/results')
          .expect(200)
      ).body,
    ).toEqual([]);
    expect((await f.handoff()).nextAction).toBe(
      'OBSERVE_EXISTING_PUBLICATION_DO_NOT_REPOST',
    );
    expect(f.tables()).toEqual(persisted);
    expect(sha256(readFileSync(f.file))).toBe(f.hash);
    expect(network).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
    network.mockRestore();
  }
}, 30000);

test.each(['different-package', 'revoked', 'missing-qc', 'changed-mp4'])(
  'FICTITIOUS_TEST_ONLY blocks %s without recording or changing history',
  async (kind) => {
    const f = await fixture();
    try {
      await f.approve().expect(201);
      if (kind === 'different-package') {
        const other = (
          await f
            .command(
              'packages',
              { ...f.packageInput, caption: SCOPE + ': outra legenda.' },
              'first_manual_other',
            )
            .expect(201)
        ).body;
        f.selection.packageHash = other.contentHash;
      }
      if (kind === 'revoked')
        f.publishing().revokeApproval({
          packageHash: f.pkg.contentHash,
          reviewHash: f.publishing().packageReview(f.pkg.contentHash)
            .contentHash,
          actor: SCOPE + '_reviewer',
          reason: SCOPE + ': revogada',
        });
      if (kind === 'missing-qc') f.omitQc();
      if (kind === 'changed-mp4') writeFileSync(f.file, SCOPE + ': changed');
      const before = f.tables();
      const result = await f.handoff();
      expect(result.status).toBe('BLOCKED_MANUAL_PUBLICATION');
      expect(result.handoff).toBeNull();
      expect(f.tables()).toEqual(before);
      expect(f.publishing().publications(f.pkg.contentHash)).toEqual([]);
    } finally {
      await f.cleanup();
    }
  },
  30000,
);

test('FICTITIOUS_TEST_ONLY preserves original POST conflict and reconciles the physical MP4 with an explicit immutable observation', async () => {
  const f = await fixture();
  try {
    await f.approve().expect(201);
    const input = {
      packageHash: f.pkg.contentHash,
      actor: SCOPE + '_operator',
      publishedAt: '2026-11-08T12:00:00Z',
      externalId: null,
      externalUrl: null,
      evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:uncertain',
      state: 'UNCONFIRMED',
    };
    const publication = (
      await f
        .command('manual-publications', input, 'first_manual_uncertain')
        .expect(201)
    ).body;
    const before = f.tables();
    const attempted = await f
      .command(
        'manual-publications',
        {
          ...input,
          externalId: 'FICTITIOUS_TEST_ONLY_receipt',
          externalUrl: 'https://www.instagram.com/p/FICTITIOUS_TEST_ONLY/',
          evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:later-observation',
          state: 'PUBLISHED',
        },
        'first_manual_later_observation',
      )
      .expect(409);
    expect(attempted.body.code).toBe('DISTRIBUTION_PUBLICATION_CONFLICT');
    const unknown = { status: 'UNKNOWN', reason: SCOPE + ': not measured' };
    const result = await f
      .command(
        'results',
        {
          publicationId: publication.publicationId,
          periodStart: '2026-11-13T00:00:00Z',
          periodEnd: '2026-11-14T00:00:00Z',
          sourceReference: 'fixture:FICTITIOUS_TEST_ONLY:results',
          attribution: 'UNATTRIBUTED',
          clicks: unknown,
          sales: unknown,
          revenue: unknown,
          commissions: unknown,
        },
        'first_manual_uncertain_results',
      )
      .expect(400);
    expect(result.body.code).toBe(
      'DISTRIBUTION_CONFIRMED_PUBLICATION_REQUIRED',
    );
    expect(f.publishing().publication(publication.publicationId)).toEqual(
      publication,
    );
    expect(f.tables()).toEqual(before);
    await f.restart();
    const reconciliation = {
      publicationId: publication.publicationId,
      packageHash: f.pkg.contentHash,
      originalReceiptHash: publication.contentHash,
      platform: f.pkg.platform,
      account: f.pkg.account,
      externalId: 'FICTITIOUS_TEST_ONLY_receipt',
      externalUrl: 'https://www.instagram.com/p/FICTITIOUS_TEST_ONLY/',
      publishedAt: '2026-11-08T12:00:00Z',
      evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:operator-attestation',
      confirmationOrigin: 'OPERATOR_ATTESTED',
    };
    const route =
      'manual-publications/' +
      encodeURIComponent(publication.publicationId) +
      '/reconciliations';
    const event = (
      await f
        .authenticatedCommand(
          route,
          reconciliation,
          'first_manual_reconciliation',
        )
        .expect(201)
    ).body;
    expect(
      (
        await f
          .authenticatedCommand(
            route,
            reconciliation,
            'first_manual_reconciliation',
          )
          .expect(201)
      ).body,
    ).toEqual(event);
    await f.restart();
    const effective = (
      await f
        .query(
          '/publishing/manual-publications/' +
            encodeURIComponent(publication.publicationId) +
            '/effective',
        )
        .expect(200)
    ).body;
    expect(effective.originalReceipt).toEqual(publication);
    expect(effective.effectiveState).toBe('PUBLISHED');
    expect(effective.confirmationOrigin).toBe('OPERATOR_ATTESTED');
    expect((await f.handoff()).nextAction).toBe(
      'CONSULT_EXISTING_PUBLICATION_AND_RESULTS',
    );
    expect(f.publishing().publication(publication.publicationId)).toEqual(
      publication,
    );
    expect(sha256(readFileSync(f.file))).toBe(f.hash);
  } finally {
    await f.cleanup();
  }
}, 30000);
