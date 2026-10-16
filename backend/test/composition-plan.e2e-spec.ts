import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { fixture } from './support/composition-plan-fixture.js';
import { MediaModule } from '../src/media/media.module.js';
import { MediaPersistence } from '../src/media/infrastructure/media.persistence.js';
import { compositionPlanContentHash } from '../src/media/domain/composition-plan-contracts.js';

describe('CompositionPlan HTTP with local fixtures only', () => {
  let f: ReturnType<typeof fixture>, app: INestApplication;
  beforeEach(async () => {
    f = fixture(true);
    const module = await Test.createTestingModule({ imports: [MediaModule] })
      .overrideProvider(MediaPersistence)
      .useValue(f.store)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    f.close();
  });
  it.each([false, true])('registers, replays and queries V2=%s', (mixed) => {
    const value = mixed ? f.value : f.compositionPlan;
    return (async () => {
      const http = app.getHttpServer();
      for (let i = 0; i < 2; i++)
        await request(http)
          .post('/media/composition-plans')
          .send(value)
          .expect(201)
          .expect((r) => expect(r.body).toEqual(value));
      await request(http)
        .get(`/media/composition-plans/${value.compositionPlanId}`)
        .expect(200)
        .expect((r) => expect(r.body).toEqual(value));
      for (const query of [
        { pipelineRunId: value.pipelineRunId },
        { scriptId: value.scriptId },
      ])
        await request(http)
          .get('/media/composition-plans')
          .query(query)
          .expect(200)
          .expect((r) => expect(r.body).toEqual([value]));
      const next = { ...value, createdAt: '2026-09-29T00:00:00.000Z' };
      next.contentHash = compositionPlanContentHash(next);
      await request(http)
        .post('/media/composition-plans')
        .send(next)
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('COMPOSITION_PLAN_ID_REUSED'));
    })();
  });
  it('maps invalid contracts, missing dependencies and invalid queries', async () => {
    const http = app.getHttpServer();
    await request(http).post('/media/composition-plans').send({}).expect(400);
    await request(http)
      .get('/media/composition-plans/composition_missing')
      .expect(404);
    for (const query of [
      {},
      { scriptId: '' },
      { pipelineRunId: f.value.pipelineRunId, scriptId: f.value.scriptId },
    ])
      await request(http)
        .get('/media/composition-plans')
        .query(query)
        .expect(400);
    const value = { ...f.value, voiceTrackId: 'voice_missing' };
    value.contentHash = compositionPlanContentHash(value);
    await request(http)
      .post('/media/composition-plans')
      .send(value)
      .expect(404)
      .expect((r) => expect(r.body.code).toBe('VOICE_TRACK_NOT_FOUND'));
  });
});
