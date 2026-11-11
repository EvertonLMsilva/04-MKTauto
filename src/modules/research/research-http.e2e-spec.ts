import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResearchModule } from './research.module.js';
import { RESEARCH_DATABASE } from './infrastructure/research-database.config.js';
import {
  batch,
  cluster,
  DAY_ONE,
  DAY_TWO,
} from '../../../test/support/research-catalog-fixture.js';
import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';

describe('Research local HTTP boundary', () => {
  let app: INestApplication;
  let directory: string;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'research-http-'));
    const database = join(directory, 'catalog.sqlite');
    const db = new DatabaseSync(database);
    try {
      provisionSchema(db);
    } finally {
      db.close();
    }
    const module = await Test.createTestingModule({ imports: [ResearchModule] })
      .overrideProvider(RESEARCH_DATABASE)
      .useValue(database)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it('persists and retries catalog, analyzes local proposals, reads ranking and history', async () => {
    const value = batch({ key: 'one', at: DAY_ONE, views: 100 });
    const first = await request(app.getHttpServer())
      .post('/research/catalog-operations')
      .send(value)
      .expect(201);
    const retry = await request(app.getHttpServer())
      .post('/research/catalog-operations')
      .send(value)
      .expect(201);
    expect(retry.body).toEqual(first.body);
    await request(app.getHttpServer())
      .post('/research/catalog-operations')
      .send({
        ...value,
        observations: [
          {
            ...value.observations[0],
            snapshot: {
              ...value.observations[0].snapshot,
              metrics: {
                ...value.observations[0].snapshot.metrics,
                views: { availability: 'AVAILABLE', value: 101 },
              },
            },
          },
        ],
      })
      .expect(409);
    const {
      schemaVersion: _v,
      id: _id,
      createdBy: _by,
      ...proposal
    } = cluster();
    const analyzed = await request(app.getHttpServer())
      .post('/research/analyses')
      .send({
        runId: value.run.id,
        idempotencyKey: 'analysis',
        now: DAY_TWO,
        proposals: [proposal],
      })
      .expect(201);
    expect(analyzed.body.catalog.topicClusters).toHaveLength(1);
    await request(app.getHttpServer())
      .post('/research/analyses')
      .send({ runId: value.run.id, idempotencyKey: 'empty', proposals: [] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/research/analyses')
      .send({
        runId: value.run.id,
        idempotencyKey: 'null-config',
        proposals: [proposal],
        config: null,
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/research/analyses')
      .send({
        runId: 'missing',
        idempotencyKey: 'missing',
        proposals: [proposal],
      })
      .expect(404);
    await request(app.getHttpServer())
      .post('/research/analyses')
      .send({
        runId: value.run.id,
        idempotencyKey: 'duplicate-membership',
        proposals: [proposal, proposal],
      })
      .expect(400);
    const rank = await request(app.getHttpServer())
      .get(`/research/catalogs/${value.run.id}/ranking`)
      .expect(200);
    expect(rank.body).toEqual({
      ranked: analyzed.body.ranked,
      top: analyzed.body.top,
      gaps: analyzed.body.gaps,
    });
    await request(app.getHttpServer())
      .get('/research/candidates/candidate-1/history')
      .expect(200);
    await request(app.getHttpServer())
      .get('/research/catalogs/missing')
      .expect(404);
  });
  it('rejects malformed records and missing local proposals; exposes no collection route', async () => {
    await request(app.getHttpServer())
      .post('/research/catalog-operations')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post('/research/analyses')
      .send({ runId: 'missing', idempotencyKey: 'one' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/research/daily')
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .get('/research/shortlists/missing')
      .expect(404);
    await request(app.getHttpServer())
      .get('/research/insights/missing')
      .expect(404);
  });
});
