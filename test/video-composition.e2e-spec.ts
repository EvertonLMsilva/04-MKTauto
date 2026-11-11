import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { fixture } from './support/composition-plan-fixture.js';
import { MediaModule } from '../src/modules/media/media.module.js';
import { MediaPersistence } from '../src/modules/media/infrastructure/media.persistence.js';
import { VIDEO_COMPOSER } from '../src/modules/media/application/video-composition.port.js';
import { videoCompositionRequestHash } from '../src/modules/media/domain/video-composition-contracts.js';

describe('initial composition HTTP with fake rendering', () => {
  let f: ReturnType<typeof fixture>, app: INestApplication;
  const compose = vi.fn();
  beforeEach(async () => {
    f = fixture(true);
    f.media.registerCompositionPlan(f.value);
    compose
      .mockReset()
      .mockResolvedValue({
        durationMilliseconds: 10000,
        containerFormat: 'mp4',
        widthPixels: 1080,
        heightPixels: 1920,
        contentHash: 'f'.repeat(64),
        logicalReference: 'render:output_001',
      });
    const module = await Test.createTestingModule({ imports: [MediaModule] })
      .overrideProvider(MediaPersistence)
      .useValue(f.store)
      .overrideProvider(VIDEO_COMPOSER)
      .useValue({ compose })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    f.close();
  });
  function value(overrides: any = {}) {
    const v = {
      schemaVersion: 'video-composition-request/1.0.0',
      videoCompositionRequestId: 'compose_001',
      compositionPlanId: f.value.compositionPlanId,
      compositionPlanContentHash: f.value.contentHash,
      containerFormat: 'mp4',
      widthPixels: 1080,
      heightPixels: 1920,
      requestedAt: '2026-09-28T23:30:00.000Z',
      ...overrides,
    };
    return { ...v, contentHash: videoCompositionRequestHash(v) };
  }
  it('composes, replays and reads exact receipt and render', async () => {
    const http = app.getHttpServer();
    const first = await request(http)
      .post('/media/compositions')
      .send(value())
      .expect(201);
    await request(http)
      .post('/media/compositions')
      .send(value())
      .expect(201)
      .expect((r) => expect(r.body).toEqual(first.body));
    expect(compose).toHaveBeenCalledTimes(1);
    await request(http)
      .get('/media/compositions/compose_001')
      .expect(200)
      .expect((r) =>
        expect(r.body).toEqual({
          requestHash: value().contentHash,
          videoRender: first.body,
        }),
      );
    await request(http)
      .get(`/media/renders/${first.body.videoRenderId}`)
      .expect(200)
      .expect((r) => expect(r.body).toEqual(first.body));
    await request(http)
      .post('/media/compositions')
      .send(value({ requestedAt: '2026-09-29T23:30:00.000Z' }))
      .expect(409);
  });
  it('maps invalid requests, missing plan, unavailable and sanitized failures', async () => {
    const http = app.getHttpServer();
    await request(http).post('/media/compositions').send({}).expect(400);
    await request(http)
      .post('/media/compositions')
      .send(value({ compositionPlanId: 'composition_missing' }))
      .expect(404);
    compose.mockRejectedValueOnce(
      Object.assign(new Error('private'), { code: 'COMPOSER_UNAVAILABLE' }),
    );
    await request(http).post('/media/compositions').send(value()).expect(503);
    compose.mockRejectedValueOnce(new Error('private'));
    await request(http)
      .post('/media/compositions')
      .send(value())
      .expect(400)
      .expect((r) => expect(JSON.stringify(r.body)).not.toContain('private'));
    await request(http).get('/media/compositions/compose_001').expect(404);
  });
});
