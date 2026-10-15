import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LocalFlowController } from './local-flow.controller.js';
import { LocalFlowService } from './application/local-flow.service.js';
import { localFixture } from '../../test/support/local-flow-fixture.js';
it('serves local audiovisual endpoints, blocked preview and verified MP4 bytes', async () => {
  const f = await localFixture();
  const module = await Test.createTestingModule({
    controllers: [LocalFlowController],
    providers: [
      { provide: LocalFlowService, useValue: new LocalFlowService(f.flow) },
    ],
  }).compile();
  const app = module.createNestApplication();
  try {
    await app.init();
    const http = app.getHttpServer(),
      base = '/media/local';
    await request(http)
      .post(`${base}/audio`)
      .send({
        voiceTrack: {
          ...f.voice,
          audioFormat: 'wav',
          voiceTrackId: 'local_http_voice',
          contentHash: f.plan.voiceTrackContentHash,
          storageReference: `object:voice/sha256/${f.plan.voiceTrackContentHash}`,
          revision: 3,
          supersedesVoiceTrackId: 'voice_native_002',
          origin: 'AUTHORIZED_RECORDING',
          provider: null,
          rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
        },
        authorization: {
          actorId: 'operator_http',
          statement: 'Own recording, commercial use authorized.',
        },
      })
      .expect(201);
    await request(http)
      .post(`${base}/alignments/missing/subtitles`)
      .expect(404);
    await request(http).post(`${base}/alignments`).send(f.evidence).expect(201);
    const sub = await request(http)
      .post(`${base}/alignments/${f.evidence.output.alignmentId}/subtitles`)
      .expect(201);
    const source = await request(http)
      .post(`${base}/compositions`)
      .send(f.request())
      .expect(201);
    await request(http)
      .get(`${base}/previews/${source.body.videoRenderId}`)
      .expect(200)
      .expect((r) => expect(r.body.ready).toBe(false));
    const burned = await request(http)
      .post(
        `${base}/renders/${source.body.videoRenderId}/subtitles/${sub.body.subtitleId}`,
      )
      .expect(201);
    await request(http)
      .post(`${base}/renders/${burned.body.videoRenderId}/qc`)
      .expect(201)
      .expect((r) => expect(r.body.result).toBe('PASS'));
    const preview = await request(http)
      .get(`${base}/previews/${burned.body.videoRenderId}`)
      .expect(200);
    expect(preview.body.ready).toBe(true);
    await request(http)
      .get(preview.body.url)
      .expect(200)
      .expect('Content-Type', 'video/mp4');
    await request(http)
      .post(`${base}/alignments`)
      .send({
        ...f.evidence,
        output: { ...f.evidence.output, evidenceHash: '0'.repeat(64) },
      })
      .expect(400);
  } finally {
    await app.close();
    f.close();
  }
});
