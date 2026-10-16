import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ffmpegFixture } from './support/ffmpeg-composition-fixture.js';
import { MediaModule } from '../src/media/media.module.js';
import { MediaPersistence } from '../src/media/infrastructure/media.persistence.js';
import { FFMPEG_PROCESS_RUNNER } from '../src/media/infrastructure/ffmpeg-process.js';

it('HTTP composes through native adapter and fake FFmpeg, then replays exact receipt', async () => {
  const f = ffmpegFixture();
  for (const [name, value] of Object.entries(f.env as NodeJS.ProcessEnv)) vi.stubEnv(name, value);
  const module = await Test.createTestingModule({ imports: [MediaModule] })
    .overrideProvider(MediaPersistence)
    .useValue(f.store)
    .overrideProvider(FFMPEG_PROCESS_RUNNER)
    .useValue(f.runner)
    .compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const http = app.getHttpServer();
    const first = await request(http)
      .post('/media/compositions')
      .send(f.request())
      .expect(201);
    const calls = f.calls.length;
    await request(http)
      .post('/media/compositions')
      .send(f.request())
      .expect(201)
      .expect((r) => expect(r.body).toEqual(first.body));
    expect(f.calls).toHaveLength(calls);
    await request(http)
      .get('/media/compositions/native_001')
      .expect(200)
      .expect((r) =>
        expect(r.body).toEqual({
          requestHash: f.request().contentHash,
          videoRender: first.body,
        }),
      );
    await request(http)
      .get('/media/renders/video_render:native_001')
      .expect(200)
      .expect((r) => expect(r.body).toEqual(first.body));
    await request(http)
      .post('/media/compositions')
      .send(f.request('native_002'))
      .expect(409);
  } finally {
    await app.close();
    vi.unstubAllEnvs();
    f.close();
  }
});

it('default Nest provider keeps 503 when operational configuration is invalid', async () => {
  const f = ffmpegFixture();
  vi.stubEnv('FFMPEG_PATH', '');
  const module = await Test.createTestingModule({ imports: [MediaModule] })
    .overrideProvider(MediaPersistence)
    .useValue(f.store)
    .compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    await request(app.getHttpServer())
      .post('/media/compositions')
      .send(f.request())
      .expect(503);
    expect(f.calls).toHaveLength(0);
  } finally {
    await app.close();
    vi.unstubAllEnvs();
    f.close();
  }
});
