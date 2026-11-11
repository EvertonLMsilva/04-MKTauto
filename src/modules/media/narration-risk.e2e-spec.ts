import { Test } from '@nestjs/testing';
import request from 'supertest';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scryptSync } from 'node:crypto';
import {
  ttsRiskFixture,
  TTS_RISK_TIME as now,
} from '../../../test/support/tts-risk-fixture.js';
import { NarrationController } from './narration.controller.js';
import { NarrationService } from './application/narration.service.js';

test('authenticated individual risk approval and one mocked dispatch, with legacy HTTP isolation', async () => {
  const f = ttsRiskFixture();
  const secret = 'R'.repeat(43),
    salt = 'c'.repeat(32),
    file = join(dirname(f.database), 'tts-identities.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      identities: [
        {
          id: 'tts_operator',
          salt,
          hash: scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
            N: 32768,
            r: 8,
            p: 1,
            maxmem: 67108864,
          }).toString('hex'),
          roles: ['QC_REVIEWER'],
          revoked: false,
        },
      ],
    }),
    { mode: 0o600 },
  );
  vi.stubEnv('QC_IDENTITIES_FILE', file);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  const transport = {
    ready: () => true,
    synthesize: vi.fn(async () => ({
      audio: f.audio,
      providerRequestId: 'req_fixture',
    })),
  };
  const service = new NarrationService(f.service(), transport);
  const module = await Test.createTestingModule({
    controllers: [NarrationController],
    providers: [{ provide: NarrationService, useValue: service }],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  const http = app.getHttpServer(),
    base = '/media/narrations',
    auth = `Bearer tts_operator.${secret}`;
  const { approvedBy: _by, approvedAt: _at, ...approval } = f.approval;
  try {
    await request(http)
      .post(`${base}/risk-authorizations`)
      .send({ plan: f.plan, approval })
      .expect(401);
    await request(http)
      .post(`${base}/approvals`)
      .send({ plan: f.plan, approval: f.approval })
      .expect(400);
    await request(http)
      .post(`${base}/risk-authorizations`)
      .set('Authorization', auth)
      .send({ plan: f.plan, approval: { ...approval, approvedBy: 'spoofed' } })
      .expect(400);
    await request(http)
      .post(`${base}/risk-authorizations`)
      .set('Authorization', auth)
      .send({ plan: f.plan, approval })
      .expect(201)
      .expect((r) => {
        expect(r.body.approvedBy).toBe('tts_operator');
        expect(r.body.approvedAt).toBe(new Date(now).toISOString());
      });
    vi.setSystemTime(new Date(Date.parse(now) + 1000));
    await request(http)
      .post(`${base}/risk-authorizations`)
      .set('Authorization', auth)
      .send({ plan: f.plan, approval })
      .expect(201)
      .expect((r) =>
        expect(r.body.approvedAt).toBe(new Date(now).toISOString()),
      );
    await request(http)
      .post(`${base}/risk-executions`)
      .send({ plan: f.plan })
      .expect(401);
    await request(http)
      .post(`${base}/risk-executions`)
      .set('Authorization', auth)
      .send({ plan: f.plan })
      .expect(201)
      .expect((r) => expect(r.body.state).toBe('UNKNOWN'));
    await request(http)
      .post(`${base}/risk-executions`)
      .set('Authorization', auth)
      .send({ plan: f.plan })
      .expect(409);
    expect(transport.synthesize).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    f.close();
  }
});
