import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { facebookPublicationFixture } from '../../../test/support/facebook-publication.fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { DestinationPublicationController } from './destination-publication.controller.js';
import { DestinationPublicationService } from './application/destination-publication.service.js';
import { SocialPublicationService } from './application/social-publication.service.js';
import { LocalQcGuard } from './application/local-qc.guard.js';
import { provisionQcReviewer } from './application/local-qc-identity.js';

test.each(['published', 'uncertain', 'supersession'])(
  'HTTP evidence %s: guarded, sanitized and read-only across restart/replay',
  async (scenario) => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(Error('NO_REAL_NETWORK'));
    const f = await facebookPublicationFixture(true, 'v27.0', true);
    const directory = mkdtempSync(join(tmpdir(), 'publication-evidence-http-'));
    let app: INestApplication | undefined;
    let now = f.at;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const service = () => f.reopen(() => now);
    const create = async () => {
      const module = await Test.createTestingModule({
        controllers: [DestinationPublicationController],
        providers: [
          { provide: DestinationPublicationService, useValue: service() },
          LocalQcGuard,
        ],
      }).compile();
      const result = module.createNestApplication();
      await result.init();
      return result;
    };
    // Snapshot all fixture tables, including commands, grants, costs and events.
    const data = () =>
      f.f.base.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all()
        .map((row) => ({
          table: row.name,
          rows: f.f.base.db
            .prepare(
              'SELECT * FROM "' + String(row.name).replaceAll('"', '""') + '"',
            )
            .all(),
        }));
    try {
      const config = join(directory, 'identities.json'),
        secret = join(directory, 'credential');
      await provisionQcReviewer(config, 'evidence_reviewer', secret);
      vi.stubEnv('QC_IDENTITIES_FILE', config);
      const token = 'Bearer ' + readFileSync(secret, 'utf8').trim();
      f.campaigns.ownedEvent(
        f.execution.execution_id,
        f.execution.claim_token!,
        f.at,
        'WORKFLOW_FINISHED',
        {},
        'SUCCEEDED',
      );
      app = await create();
      const url = `/publishing/executions/${f.execution.execution_id}/evidence`;
      const get = () =>
        request(app!.getHttpServer()).get(url).set('Authorization', token);
      const baseline = data();
      await request(app.getHttpServer()).get(url).expect(401);
      const first = await get().expect(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.body).toMatchObject({
        schemaVersion: 'publication-evidence/1.0.0',
        publicationComplete: false,
      });
      expect(
        first.body.destinations.find((d: any) => d.network === 'INSTAGRAM')
          .publicationStatus,
      ).toBe('CONFIRMED');
      expect(
        first.body.destinations.find(
          (d: any) => d.network === 'FACEBOOK_REELS',
        ),
      ).toMatchObject({
        publicationStatus: 'NOT_PREPARED',
        approval: { pending: true },
      });
      expect(data()).toEqual(baseline);
      f.approve(f.facebookPackage);
      let originalId: string | undefined;
      if (scenario === 'supersession') {
        // Existing schema-43 operation retained verbatim, superseded at schema 44.
        const session = f.store.openDestination('fake');
        let original: any;
        try {
          const engine = new SocialPublicationService({
            repository: session.social,
            manual: session.manual,
            publisher: f.ports.publisher,
            media: f.ports.media,
            transferVerifier: f.ports.verifier,
            now: () => now,
          });
          original = await engine.prepare(
            {
              packageHash: f.facebookPackage.contentHash,
              accountId: f.ports.publisher.accountId,
            },
            'evidence_original',
            'local',
          );
          session.reservations.reserve(
            f.execution.execution_id,
            original,
            f.facebookPackage,
            f.publishing.packageReview(f.facebookPackage.contentHash)
              .contentHash,
            now,
          );
          original = await engine.createContainer(original.operationId);
        } finally {
          session.close();
        }
        originalId = original.operationId;
        provisionSchema(f.f.base.db, 44);
        const input = {
          originalOperationId: original.operationId,
          expectedVersion: original.version,
          revision: 1,
          decisionId: 'evidence_successor',
          actor: 'fixture_reviewer',
          reason: 'Fixture replacement only',
          remoteObservation: await f.ports.publisher.inspectUploadSession!(
            original.containerId,
          ),
          acceptResidualRisk: true as const,
        };
        const prepared = await service().prepareFacebookSupersession(
          f.execution.execution_id,
          f.facebookPackage.account,
          input,
        );
        now = new Date(Date.parse(f.at) + 1000).toISOString();
        vi.setSystemTime(now);
        const grant = {
          operationId: prepared.operationId,
          packageHash: prepared.packageHash,
          preparationDecisionId: input.decisionId,
          authorizationId: 'evidence_successor_execution',
          actor: 'fixture_reviewer',
          authorizedAt: now,
          expiresAt: new Date(Date.parse(now) + 60000).toISOString(),
          acceptResidualRisk: true as const,
        };
        await service().authorizeFacebookSuccessor(
          f.execution.execution_id,
          f.facebookPackage.account,
          prepared.version,
          grant,
        );
        await service().execute(
          f.execution.execution_id,
          'FACEBOOK_REELS',
          f.facebookPackage.account,
          grant,
        );
      } else {
        provisionSchema(f.f.base.db, 44);
        const prepared = await service().prepareFacebookOccurrence(
          f.execution.execution_id,
          f.facebookPackage.account,
        );
        const grant = {
          executionId: f.execution.execution_id,
          operationId: prepared.operationId,
          packageHash: prepared.packageHash,
          accountId: f.facebookPackage.account,
          campaignRevision: f.execution.campaign_revision,
          expectedVersion: prepared.version,
          authorizationId: 'evidence_occurrence',
          actor: 'fixture_reviewer',
          authorizedAt: now,
          expiresAt: new Date(Date.parse(now) + 60000).toISOString(),
        };
        await service().authorizeFacebookOccurrence(
          f.execution.execution_id,
          f.facebookPackage.account,
          prepared.version,
          grant,
        );
        if (scenario === 'uncertain') f.fail('publish');
        const execution = service().execute(
          f.execution.execution_id,
          'FACEBOOK_REELS',
          f.facebookPackage.account,
          grant,
        );
        if (scenario === 'uncertain')
          await expect(execution).rejects.toMatchObject({
            code: 'SOCIAL_RECONCILIATION_REQUIRED',
          });
        else await execution;
      }
      now = new Date(Date.parse(now) + 120000).toISOString();
      vi.setSystemTime(now);
      const before = data(),
        posts = [...f.posts];
      const response = await get().expect(200);
      const fb = response.body.destinations.find(
        (d: any) => d.network === 'FACEBOOK_REELS',
      );
      expect(response.body.publicationComplete).toBe(scenario !== 'uncertain');
      expect(fb).toMatchObject({
        executionMode: 'fake',
        simulated: true,
        authorization: { status: 'EXPIRED' },
        publicationStatus: scenario === 'uncertain' ? 'UNCERTAIN' : 'CONFIRMED',
      });
      if (scenario === 'supersession') {
        expect(fb.originalOperation).toMatchObject({
          operationId: originalId,
          state: 'PROCESSING',
        });
        expect(fb.activeOperation.operationId).not.toBe(originalId);
        expect(fb.supersessionRevision).toBe(1);
      }
      if (scenario === 'uncertain') {
        expect(fb.receipt).toBeNull();
        expect(fb.nextAction).toBe('AUTHORIZE_RECOVERY_AND_RECONCILE');
      } else expect(fb.receipt.identity).toMatch(/^[a-f0-9]{64}$/);
      const serialized = JSON.stringify(response.body);
      for (const forbidden of [
        'uploadUri',
        'uploadAudit',
        'caption',
        'fixture_page',
        'access_token',
        'remoteObservation',
      ])
        expect(serialized).not.toContain(forbidden);
      await app.close();
      app = await create();
      expect((await get().expect(200)).body).toEqual(response.body);
      expect((await get().expect(200)).body).toEqual(response.body);
      await request(app.getHttpServer())
        .get('/publishing/executions/absent/evidence')
        .set('Authorization', token)
        .expect(409);
      expect(data()).toEqual(before);
      expect(f.posts).toEqual(posts);
      expect(network).not.toHaveBeenCalled();
    } finally {
      await app?.close();
      f.cleanup();
      rmSync(directory, { recursive: true, force: true });
      network.mockRestore();
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  },
  20000,
);
