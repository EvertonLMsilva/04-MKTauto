import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PROJECT_DATABASE } from '../src/modules/project/infrastructure/project-database.config.js';
import { AFFILIATE_DATABASE } from '../src/modules/affiliate/infrastructure/affiliate-database.config.js';
import { CONTENT_OPERATIONS_DATABASE } from '../src/modules/content-operations/application/ports/operations.port.js';
import { CONTENT_DATABASE } from '../src/modules/content/infrastructure/content.persistence.js';
import { MEDIA_DATABASE } from '../src/modules/media/infrastructure/media.persistence.js';
import { contentFixture, script } from './support/content-fixture.js';
import { contentStore } from './support/content-store.js';
import { mediaStore } from './support/media-store.js';
import { asset } from './support/media-fixture.js';
import { seedQc } from './support/media-qc-fixture.js';
describe('Media HTTP without providers or real media', () => {
  let f: ReturnType<typeof contentFixture>,
    app: INestApplication<App>,
    s: ReturnType<typeof script>;
  beforeEach(async () => {
    f = contentFixture();
    const c = contentStore(f.database).open();
    s = c.registerScript(script(f.selected));
    c.close();
    let builder = Test.createTestingModule({ imports: [AppModule] });
    for (const token of [
      PROJECT_DATABASE,
      AFFILIATE_DATABASE,
      CONTENT_OPERATIONS_DATABASE,
      CONTENT_DATABASE,
      MEDIA_DATABASE,
    ])
      builder = builder.overrideProvider(token).useValue(f.database);
    const module = await builder.compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    f.close();
  });
  it('registers exact replay, lists assets and rejects conflicting identity', async () => {
    const http = app.getHttpServer(),
      v = asset(s);
    await request(http).post('/media/assets').send(v).expect(201);
    await request(http)
      .post('/media/assets')
      .send(v)
      .expect(201)
      .expect((response) => expect(response.body).toEqual(v));
    await request(http)
      .get(`/media/assets/${v.mediaAssetId}`)
      .expect(200)
      .expect((response) => expect(response.body).toEqual(v));
    await request(http)
      .get('/media/assets')
      .query({ pipelineRunId: s.pipelineRunId })
      .expect(200)
      .expect((response) => expect(response.body).toHaveLength(1));
    await request(http)
      .post('/media/assets')
      .send({ ...v, contentHash: 'b'.repeat(64) })
      .expect(409);
  });
  it('maps rights and missing-artifact errors and exposes only persisted QC', async () => {
    const http = app.getHttpServer();
    await request(http)
      .post('/media/assets')
      .send(
        asset(s, {
          rights: { usageBasis: 'OWNED', commercialUseAllowed: false },
        }),
      )
      .expect(400);
    await request(http).get('/media/assets/media_missing').expect(404);
    await request(http)
      .post('/media/acquisitions')
      .send({ telemetry: {}, costEvent: {} })
      .expect(400)
      .expect((response) =>
        expect(response.body.code).toBe('MEDIA_FINANCE_DEPENDENCY_REQUIRED'),
      );
    const r = mediaStore(f.database).open();
    const qc = seedQc(r.db);
    r.close();
    await request(http)
      .get(`/media/quality-control-reports/${qc.qualityControlReportId}`)
      .expect(200)
      .expect((response) => expect(response.body).toEqual(qc));
    await request(http)
      .get('/media/quality-control-reports')
      .query({
        policyVersion: qc.policyVersion,
        videoRenderId: qc.videoRenderId,
        videoRenderContentHash: qc.videoRenderContentHash,
      })
      .expect(200);
  });
});
