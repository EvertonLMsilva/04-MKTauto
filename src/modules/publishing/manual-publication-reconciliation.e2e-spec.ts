import { Test } from '@nestjs/testing';
import request from 'supertest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { facebookPublicationFixture } from '../../../test/support/facebook-publication.fixture.js';
import { PublishingController } from './publishing.controller.js';
import { PublishingService } from './application/publishing.service.js';
import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { LocalQcGuard } from './application/local-qc.guard.js';
import { provisionQcReviewer } from './application/local-qc-identity.js';

test('FICTITIOUS_TEST_ONLY guarded reconciliation preserves receipt, survives restart and releases both commercial consumers', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('NO_EXTERNAL_HTTP'));
  const f = await facebookPublicationFixture();
  const root = mkdtempSync(join(tmpdir(), 'reconcile-FICTITIOUS_TEST_ONLY-'));
  let app: import('@nestjs/common').INestApplication | undefined;
  try {
    const config = join(root, 'fixture-identities.json'),
      secret = join(root, 'fixture-secret');
    await provisionQcReviewer(config, 'fixture_reconciler', secret);
    vi.stubEnv('QC_IDENTITIES_FILE', config);
    const token = 'Bearer ' + readFileSync(secret, 'utf8').trim();
    const start = async () => {
      await app?.close();
      const publishing = new PublishingService(f.store, f.media);
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
    const pkg = f.instagramPackage;
    const original = f.publishing.recordPublication(
      {
        packageHash: pkg.contentHash,
        actor: 'FICTITIOUS_TEST_ONLY',
        publishedAt: f.at,
        externalId: null,
        externalUrl: null,
        evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:uncertain',
        state: 'UNCONFIRMED',
      },
      'reconcile_original',
    );
    const path =
      '/publishing/manual-publications/' +
      encodeURIComponent(original.publicationId);
    const unknown = {
      status: 'UNKNOWN',
      reason: 'FICTITIOUS_TEST_ONLY:NOT_REPORTED',
    };
    const resultInput = {
      publicationId: original.publicationId,
      periodStart: '2026-11-08T00:00:00Z',
      periodEnd: '2026-11-09T00:00:00Z',
      sourceReference: 'fixture:FICTITIOUS_TEST_ONLY:results',
      attribution: 'UNATTRIBUTED',
      clicks: unknown,
      sales: unknown,
      revenue: unknown,
      commissions: unknown,
    };
    await http()
      .post('/publishing/results')
      .send({ input: resultInput, idempotencyKey: 'reconcile_results' })
      .expect(400);
    await start();
    const input = {
      publicationId: original.publicationId,
      packageHash: pkg.contentHash,
      originalReceiptHash: original.contentHash,
      platform: pkg.platform,
      account: pkg.account,
      externalId: 'FICTITIOUS_TEST_ONLY_receipt',
      externalUrl: 'https://www.instagram.com/reel/FICTITIOUS_TEST_ONLY/',
      publishedAt: f.at,
      evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:operator-observation',
      confirmationOrigin: 'OPERATOR_ATTESTED',
    };
    const post = (value = input, key = 'reconcile_confirmation') =>
      http()
        .post(path + '/reconciliations')
        .set('Authorization', token)
        .send({ input: value, idempotencyKey: key });
    await http()
      .post(path + '/reconciliations')
      .send({ input, idempotencyKey: 'reconcile_confirmation' })
      .expect(401);
    await post({ ...input, operatorId: 'forged' } as typeof input).expect(400);
    const event = (await post().expect(201)).body;
    expect(event.operatorId).toBe('fixture_reconciler');
    expect(event.confirmationOrigin).toBe('OPERATOR_ATTESTED');
    expect(event.recordedAt).not.toBe(input.publishedAt);
    expect((await post().expect(201)).body).toEqual(event);
    await start();
    expect((await post().expect(201)).body).toEqual(event);
    expect((await http().get(path).expect(200)).body).toEqual(original);
    const effective = (
      await http()
        .get(path + '/effective')
        .set('Authorization', token)
        .expect(200)
    ).body;
    expect(effective.originalReceipt).toEqual(original);
    expect(effective.effectiveState).toBe('PUBLISHED'); // Test-only operator attestation, never a platform receipt.
    expect(effective.confirmationOrigin).toBe('OPERATOR_ATTESTED');
    expect(effective.reconciliationHistory).toEqual([event]);
    expect(effective.publication.reviewHash).toBe(original.reviewHash);
    expect(
      (
        await http()
          .get(path + '/reconciliations')
          .set('Authorization', token)
          .expect(200)
      ).body,
    ).toEqual([event]);
    const results = (
      await http()
        .post('/publishing/results')
        .send({ input: resultInput, idempotencyKey: 'reconcile_results' })
        .expect(201)
    ).body;
    expect(
      (
        await http()
          .get(path + '/results')
          .expect(200)
      ).body,
    ).toEqual([results]);
    const summary = (
      await http()
        .get(path + '/commercial-results')
        .expect(200)
    ).body;
    expect(summary.identity.packageHash).toBe(pkg.contentHash);
    expect(summary.identity.pipelineRunId).toBe(pkg.identity.pipelineRunId);
    expect(summary.identity.remoteMediaId).toBe(input.externalId);
    const observation = {
      periodStart: resultInput.periodStart,
      periodEnd: resultInput.periodEnd,
      sourceReference: 'fixture:FICTITIOUS_TEST_ONLY:commercial-observation',
      actor: 'FICTITIOUS_TEST_ONLY',
      attribution: 'UNATTRIBUTED',
    };
    const measured = await http()
      .post(path + '/commercial-results')
      .send({
        input: observation,
        idempotencyKey: 'reconciled_commercial_results',
      })
      .expect(201);
    expect(measured.body.identity.packageHash).toBe(pkg.contentHash);
    expect(measured.body.identity.remoteMediaId).toBe(input.externalId);
    expect(network).not.toHaveBeenCalled();
  } finally {
    await app?.close();
    f.cleanup();
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
    network.mockRestore();
  }
}, 30000);
