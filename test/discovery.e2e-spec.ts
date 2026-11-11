import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PROJECT_DATABASE } from '../src/modules/project/infrastructure/project-database.config.js';
import { PROJECT_SNAPSHOT_READER } from '../src/modules/project/application/ports/project-snapshot-reader.port.js';
import { AFFILIATE_DATABASE } from '../src/modules/affiliate/infrastructure/affiliate-database.config.js';
import { DISCOVERY_SOURCE } from '../src/modules/affiliate/application/ports/discovery.port.js';
import { affiliateFixture } from './support/affiliate-fixture.js';
import { discoveryCandidate } from './support/discovery-fixture.js';
describe('Affiliate discovery HTTP', () => {
  let app: INestApplication<App>, f: ReturnType<typeof affiliateFixture>;
  beforeEach(async () => {
    f = affiliateFixture();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROJECT_DATABASE)
      .useValue(f.database)
      .overrideProvider(AFFILIATE_DATABASE)
      .useValue(f.database)
      .overrideProvider(PROJECT_SNAPSHOT_READER)
      .useValue({ get: async (id: string) => (id === 'proj_001' ? {} : null) })
      .overrideProvider(DISCOVERY_SOURCE)
      .useValue({
        open: async () => ({
          scope: 'fixture',
          enumerateCandidates: async () => ({
            candidates: [discoveryCandidate()],
            errors: [],
            source: {},
          }),
        }),
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    f?.cleanup();
  });
  it('selects, reads, replays and rejects conflicts/unknown fields/missing projects', async () => {
    const http = app.getHttpServer(),
      input = {
        discoveryRunId: 'discovery_one',
        projectId: 'proj_001',
        projectVersion: 1,
      };
    const first = await request(http)
      .post('/affiliate/discovery/selections')
      .send(input)
      .expect(201);
    expect(first.body.selection.externalProductId).toBe('item_001');
    expect(first.body.selection.candidate.price.status).toBe('UNKNOWN');
    expect(
      (
        await request(http)
          .post('/affiliate/discovery/selections')
          .send(input)
          .expect(201)
      ).body,
    ).toEqual(first.body);
    expect(
      (
        await request(http)
          .get('/affiliate/discovery/selections/discovery_one')
          .expect(200)
      ).body,
    ).toEqual(first.body);
    await request(http)
      .post('/affiliate/discovery/selections')
      .send({ ...input, projectVersion: 2 })
      .expect(409);
    await request(http)
      .post('/affiliate/discovery/selections')
      .send({ ...input, commercial: true })
      .expect(400);
    await request(http)
      .post('/affiliate/discovery/selections')
      .send({ ...input, projectId: 'missing_project' })
      .expect(404);
    await request(http)
      .get('/affiliate/discovery/selections/missing_one')
      .expect(404);
    expect(
      f.base.db
        .prepare('SELECT count(*) n FROM affiliate_discovery_events')
        .get().n,
    ).toBe(1);
  });
});
