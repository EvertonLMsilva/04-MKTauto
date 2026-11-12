import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { facebookPublicationFixture } from '../../../test/support/facebook-publication.fixture.js';
import { PublishingService } from './application/publishing.service.js';
import { PublishingController } from './publishing.controller.js';
import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { LocalQcGuard } from './application/local-qc.guard.js';
import { provisionQcReviewer } from './application/local-qc-identity.js';
import { OperationsController } from '../operations/operations.controller.js';
import { OperationsService } from '../operations/operations.service.js';

test.each([
  'ready',
  'absent',
  'qc-missing',
  'hash',
  'revision',
  'rights',
  'approval',
  'revoked',
  'fake',
  'destination',
])(
  'native SQLite readiness %s reuses exact gates without writes or social HTTP',
  async (kind) => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(Error('EXTERNAL_HTTP_FORBIDDEN'));
    const f = await facebookPublicationFixture();
    try {
      let pkg = f.instagramPackage;
      if (kind === 'qc-missing')
        vi.spyOn(f.media, 'report').mockReturnValue(null);
      if (kind === 'hash')
        vi.spyOn(f.media, 'verifyMedia').mockReturnValue('d'.repeat(64));
      if (kind === 'revision') f.render.revision++;
      if (kind === 'rights')
        f.render.origin.rights.commercialUseAuthorized = false;
      if (kind === 'approval') pkg = f.facebookPackage;
      if (kind === 'revoked')
        f.publishing.revokeApproval({
          packageHash: pkg.contentHash,
          reviewHash: f.publishing.packageReview(pkg.contentHash).contentHash,
          actor: 'fixture_operator',
          reason: 'Fixture revocation',
        });
      if (kind === 'fake') {
        f.media.report().evidence = {
          publicationAuthorization: { grant: { scope: { mode: 'fake' } } },
        };
        pkg = f.prepare('instagram', pkg.account, 'Fake-only fixture');
        f.approve(pkg);
      }
      const before = snapshot(f.f.base.db);
      const expected = {
        ready: 'READY_FOR_OPERATOR_HANDOFF',
        absent: 'PACKAGE_NOT_FOUND',
        'qc-missing': 'QC_BLOCKED',
        hash: 'MEDIA_MISMATCH',
        revision: 'MEDIA_MISMATCH',
        rights: 'RIGHTS_REQUIRED',
        approval: 'APPROVAL_REQUIRED',
        revoked: 'APPROVAL_REVOKED',
        fake: 'FAKE_ONLY',
        destination: 'UNKNOWN',
      }[kind];
      let result;
      if (kind === 'destination') {
        const session = f.store.open(true);
        try {
          vi.spyOn(session.manual, 'getReview').mockReturnValue({
            ...f.publishing.packageReview(pkg.contentHash),
            packageHash: f.facebookPackage.contentHash,
          });
          result = session.manual.manualReadiness(pkg.contentHash);
        } finally {
          session.close();
        }
      } else {
        const hash = kind === 'absent' ? 'f'.repeat(64) : pkg.contentHash;
        result = f.publishing.manualReadiness(hash);
        expect(f.publishing.manualReadiness(hash)).toEqual(result);
      }
      expect(result.status).toBe(expected);
      expect(result.publicationConfirmed).toBe(false);
      expect(result.ready).toBe(kind === 'ready');
      if (kind !== 'ready') {
        expect(result.blockerCodes.length).toBeGreaterThan(0);
        expect(result.checks.physicalEvidence).toBe('UNKNOWN');
      }
      for (const field of [
        'caption',
        'affiliateUrl',
        'grant',
        'uploadUri',
        'actor',
        'rightsEvidence',
      ])
        expect(JSON.stringify(result)).not.toContain('"' + field + '"');
      expect(snapshot(f.f.base.db)).toEqual(before);
      expect(f.posts).toEqual([]);
      expect(network).not.toHaveBeenCalled();
    } finally {
      f.cleanup();
      vi.restoreAllMocks();
    }
  },
);

function snapshot(db: any) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r: any) => ({
      table: r.name,
      rows: db
        .prepare('SELECT * FROM "' + String(r.name).replaceAll('"', '""') + '"')
        .all(),
    }));
}

test('HTTP readiness -> existing handoff/download/manual recording/results is continuous and guarded', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('EXTERNAL_HTTP_FORBIDDEN'));
  const f = await facebookPublicationFixture();
  const directory = mkdtempSync(join(tmpdir(), 'readiness-http-'));
  let app: INestApplication | undefined;
  try {
    const config = join(directory, 'identities.json'),
      secret = join(directory, 'credential');
    await provisionQcReviewer(config, 'readiness_reviewer', secret);
    vi.stubEnv('QC_IDENTITIES_FILE', config);
    const pkg = f.facebookPackage;
    const bytes = await f.ports.localBytes(
      pkg.contentHash,
      f.render.videoRenderId,
      f.hash,
    );
    // Use the existing guarded Operations download controller. Its byte reader is
    // a fixture port here; this does not assert production Operations readiness.
    const module = await Test.createTestingModule({
      controllers: [PublishingController, OperationsController],
      providers: [
        { provide: PublishingService, useValue: f.publishing },
        { provide: InstagramPublicationService, useValue: f.instagram },
        {
          provide: OperationsService,
          useValue: {
            finalBytes: async (id: string) => {
              expect(id).toBe(f.execution.execution_id);
              return bytes;
            },
          },
        },
        LocalQcGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    const token = 'Bearer ' + readFileSync(secret, 'utf8').trim();
    const base = `/publishing/packages/${pkg.contentHash}`;
    const get = (path: string) =>
      request(app!.getHttpServer()).get(path).set('Authorization', token);
    const before = snapshot(f.f.base.db);
    await request(app.getHttpServer())
      .get(base + '/manual-release-readiness')
      .expect(401);
    const blocked = await get(base + '/manual-release-readiness').expect(200);
    expect(blocked.body.status).toBe('APPROVAL_REQUIRED');
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(snapshot(f.f.base.db)).toEqual(before);
    f.approve(pkg);
    const approved = snapshot(f.f.base.db);
    const ready = await get(base + '/manual-release-readiness').expect(200);
    expect(ready.body.status).toBe('READY_FOR_OPERATOR_HANDOFF');
    expect(
      (await get(base + '/manual-release-readiness').expect(200)).body,
    ).toEqual(ready.body);
    const handoff = await get(base + '/manual-handoff').expect(200);
    expect(handoff.body.video.sha256).toBe(f.hash);
    const media = await get(
      `/operations/executions/${f.execution.execution_id}/final.mp4?download=1`,
    ).expect(200);
    expect(
      createHash('sha256')
        .update(media.body as Buffer)
        .digest('hex'),
    ).toBe(handoff.body.video.sha256);
    expect(snapshot(f.f.base.db)).toEqual(approved);
    expect(f.publishing.publications(pkg.contentHash)).toEqual([]);
    const input = {
      packageHash: handoff.body.packageHash,
      actor: 'fixture_operator',
      publishedAt: f.at,
      externalId: 'fixture_manual_fb',
      externalUrl: 'https://www.facebook.com/reel/12345/',
      evidenceReference: 'fixture:manual-confirmation-only',
      state: 'PUBLISHED',
    };
    const record = () =>
      request(app!.getHttpServer())
        .post('/publishing/manual-publications')
        .send({ input, idempotencyKey: 'readiness_manual' });
    const pub = (await record().expect(201)).body;
    expect((await record().expect(201)).body).toEqual(pub);
    const unknown = { status: 'UNKNOWN', reason: 'NOT_REPORTED' };
    const result = {
      publicationId: pub.publicationId,
      periodStart: '2026-11-08T00:00:00Z',
      periodEnd: '2026-11-09T00:00:00Z',
      sourceReference: 'fixture:manual-report',
      attribution: 'DIRECT_PUBLICATION',
      clicks: unknown,
      sales: unknown,
      revenue: unknown,
      commissions: unknown,
    };
    await request(app.getHttpServer())
      .post('/publishing/results')
      .send({ input: result, idempotencyKey: 'readiness_results' })
      .expect(201);
    expect(f.publishing.results(pub.publicationId)).toHaveLength(1);
    expect(f.posts).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  } finally {
    await app?.close();
    f.cleanup();
    rmSync(directory, { recursive: true, force: true });
    network.mockRestore();
    vi.unstubAllEnvs();
  }
});
