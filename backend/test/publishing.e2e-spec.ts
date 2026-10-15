import {
  provisionSocialContext,
  SocialPublicationRepository,
} from '../src/publishing/infrastructure/social-publication.repository.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { PublishingModule } from '../src/publishing/publishing.module.js';
import {
  PUBLISHING_DATABASE,
  SOCIAL_HISTORY_DATABASE,
} from '../src/publishing/infrastructure/publishing.persistence.js';
import { MediaService } from '../src/media/application/media.service.js';
import { MediaPersistence } from '../src/media/infrastructure/media.persistence.js';
import { AFFILIATE_REPOSITORY } from '../src/affiliate/application/ports/affiliate-repository.port.js';
import { AFFILIATE_RUN_CONTEXT } from '../src/affiliate/application/ports/affiliate-run-context.port.js';
import {
  setup,
  render,
  persistedScript,
} from './support/publishing-render-fixture.js';
import { qcReport, seedQc } from './support/media-qc-fixture.js';
import {
  qualityControlReportContentHash,
  qualityControlReportId,
} from '../src/media/domain/quality-control-contracts.js';
const affiliate = await import(
  new URL('../../src/affiliate-repository.js', import.meta.url).href
);
const fixtures = await import(
  new URL('../../test/affiliate-fixtures.js', import.meta.url).href
);
describe('Publishing HTTP with exact local bytes, no publishers', () => {
  it('prepares, approves, records manual history, blocks altered bytes and exposes no social mutation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'publishing-http-'));
    const path = join(root, 'fixture.sqlite');
    const f = setup(path);
    let app: any;
    try {
      const bytes = Buffer.from('authorized-fixture');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const dir = join(root, 'sha256', hash.slice(0, 2));
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${hash}.mp4`);
      writeFileSync(file, bytes);
      const r = render(f.compositionPlan, {
        contentHash: hash,
        logicalReference: `render:sha256_${hash}`,
      });
      f.repository.registerVideoRender(r);
      const q = qcReport(r.pipelineRunId);
      q.videoRenderId = r.videoRenderId;
      q.videoRenderContentHash = r.contentHash;
      q.qualityControlReportId = qualityControlReportId(
        q.policyVersion,
        r.videoRenderId,
        r.contentHash,
      );
      q.artifacts.videoRender = {
        id: r.videoRenderId,
        contentHash: r.contentHash,
      };
      q.findings = ['MEDIA_RIGHTS_VALID', 'VOICE_RIGHTS_VALID'].map((code) => ({
        code,
        status: 'PASS',
        subjectType: 'VIDEO_RENDER',
        subjectId: r.videoRenderId,
        message: 'Authorized fixture',
        observed: 'true',
        expected: 'true',
      }));
      q.contentHash = qualityControlReportContentHash(q);
      seedQc(f.repository.db, q);
      const catalog = new affiliate.AffiliateRepository(f.repository);
      catalog.registerProduct(fixtures.product(), 'prod');
      catalog.registerCampaign(
        fixtures.campaign({ projectId: r.projectId }),
        'campaign',
      );
      const media = new MediaService(
        new MediaPersistence(
          path,
          { get: (id) => f.repository.getRun(id) },
          { getScript: () => persistedScript() },
          root,
        ),
      );
      provisionSocialContext(f.repository.db);
      const socialRepository = new SocialPublicationRepository(f.repository);
      const operation = socialRepository.prepare(
        {
          packageHash: hash,
          accountId: '123456789',
          mediaHash: hash,
          caption: 'Historical fixture',
        },
        'social_fixture',
        r.createdAt,
      );
      const module = await Test.createTestingModule({
        imports: [PublishingModule],
      })
        .overrideProvider(PUBLISHING_DATABASE)
        .useValue(path)
        .overrideProvider(SOCIAL_HISTORY_DATABASE)
        .useValue(path)
        .overrideProvider(MediaService)
        .useValue(media)
        .overrideProvider(AFFILIATE_REPOSITORY)
        .useValue({
          open: () => ({
            getProduct: (id: string, rev: number) =>
              catalog.getProduct(id, rev),
            getCampaign: (id: string, rev: number) =>
              catalog.getCampaign(id, rev),
            close() {},
          }),
        })
        .overrideProvider(AFFILIATE_RUN_CONTEXT)
        .useValue({
          resolveRunBriefing: () => ({
            campaignId: 'camp_001',
            campaignRevision: 1,
          }),
        })
        .compile();
      app = module.createNestApplication();
      await app.init();
      const http = app.getHttpServer();
      const schemaBefore = f.repository.db
        .prepare('SELECT name,sql FROM sqlite_master ORDER BY name')
        .all();
      expect(
        (
          await request(http)
            .get(
              `/publishing/social-operations/${encodeURIComponent(operation.operationId)}`,
            )
            .expect(200)
        ).body,
      ).toEqual(operation);
      expect(
        (
          await request(http)
            .get(
              `/publishing/social-operations/${encodeURIComponent(operation.operationId)}/history`,
            )
            .expect(200)
        ).body,
      ).toEqual([operation]);
      expect(
        f.repository.db
          .prepare('SELECT name,sql FROM sqlite_master ORDER BY name')
          .all(),
      ).toEqual(schemaBefore);
      const input = {
        campaignId: 'camp_001',
        campaignRevision: 1,
        videoRenderId: r.videoRenderId,
        qualityControlReportId: q.qualityControlReportId,
        platform: 'instagram',
        account: 'operator_account',
        caption: 'Produto autorizado',
      };
      const p = (
        await request(http)
          .post('/publishing/packages')
          .send({ input, idempotencyKey: 'package' })
          .expect(201)
      ).body;
      const review = {
        packageHash: p.contentHash,
        decision: 'APPROVED',
        actor: 'operator',
        justification: null,
      };
      await request(http)
        .post('/publishing/reviews')
        .send({ input: review, idempotencyKey: 'review' })
        .expect(201);
      const approval = {
        ...p.identity,
        decision: 'APPROVED',
        actor: 'operator',
        justification: null,
      };
      const decision = (
        await request(http)
          .post('/publishing/approvals')
          .send(approval)
          .expect(201)
      ).body;
      expect(
        (
          await request(http)
            .post('/publishing/approvals')
            .send(approval)
            .expect(201)
        ).body,
      ).toEqual(decision);
      const receipt = {
        packageHash: p.contentHash,
        actor: 'operator',
        publishedAt: '2026-10-12T18:00:00Z',
        externalId: 'manual_001',
        externalUrl: 'https://instagram.com/p/fixture',
        evidenceReference: 'manual/fixture',
        state: 'PUBLISHED',
      };
      const pub = (
        await request(http)
          .post('/publishing/manual-publications')
          .send({ input: receipt, idempotencyKey: 'publication' })
          .expect(201)
      ).body;
      expect(
        (
          await request(http)
            .get('/publishing/manual-publications')
            .query({ packageHash: p.contentHash })
            .expect(200)
        ).body,
      ).toEqual([pub]);
      writeFileSync(file, 'changed');
      expect(
        (
          await request(http)
            .post('/publishing/approvals')
            .send(approval)
            .expect(400)
        ).body.code,
      ).toBe('DISTRIBUTION_MEDIA_CHANGED');
      expect(
        (
          await request(http)
            .post('/publishing/reviews')
            .send({ input: review, idempotencyKey: 'review' })
            .expect(400)
        ).body.code,
      ).toBe('DISTRIBUTION_MEDIA_CHANGED');
      await request(http)
        .post('/publishing/social-operations')
        .send({})
        .expect(404);
      await request(http)
        .post('/publishing/manual-publications')
        .send({ ...receipt, secret: 'private' })
        .expect(400);
    } finally {
      if (app) await app.close();
      f.repository.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});
