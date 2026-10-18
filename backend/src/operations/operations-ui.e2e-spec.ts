import { Test } from '@nestjs/testing';
import request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { Script } from 'node:vm';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';

test('browser shell, real session lifecycle and guarded actions use local mocks only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p7-ui-'));
  const file = join(root, 'identities.json'),
    secret = 'A'.repeat(43),
    salt = 'b'.repeat(32);
  const record = {
    id: 'operator_ui',
    salt,
    hash: scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 67108864,
    }).toString('hex'),
    roles: ['QC_REVIEWER'],
    revoked: false,
  };
  await writeFile(file, JSON.stringify({ version: 1, identities: [record] }), {
    mode: 0o600,
  });
  vi.stubEnv('QC_IDENTITIES_FILE', file);
  const execution = {
    execution_id: 'execution_ui',
    campaign_id: 'Campanha de teste offline',
    status: 'WAITING_INPUT',
    finalization: {
      step: 'MEDIA_QC',
      completedSteps: [],
      pending: {
        code: 'COMPLETE_TEMPORAL_QC_REQUIRED',
        message: 'Revise a mídia autorizada antes de continuar.',
      },
      availableActions: ['REVIEW_MEDIA'],
    },
  };
  const mock = {
    list: vi.fn(() => [execution]),
    detail: vi.fn(() => ({ execution, media: [], script: null })),
    advance: vi.fn(async () => execution),
    retry: vi.fn(async () => execution),
  };
  const module = await Test.createTestingModule({
    controllers: [OperationsController],
    providers: [{ provide: OperationsService, useValue: mock }],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  const browser = request.agent(app.getHttpServer());
  const origin = (query: ReturnType<typeof browser.post>) =>
    query.set('Host', 'localhost:3000').set('Origin', 'http://localhost:3000');
  try {
    await browser
      .get('/operations')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Content-Type', /html/);
    const script = await browser.get('/operations/app.js').expect(200);
    expect(() => new Script(script.text)).not.toThrow();
    await browser.get('/operations/executions').expect(401);
    await browser
      .post('/operations/session')
      .set('Host', 'evil.example')
      .set('Origin', 'http://evil.example')
      .send({ operatorId: record.id, secret })
      .expect(403);
    const login = await origin(browser.post('/operations/session'))
      .send({ operatorId: record.id, secret })
      .expect(201);
    expect(login.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(login.body).toEqual({
      operatorId: record.id,
      csrfToken: expect.any(String),
    });
    await browser
      .get('/operations/executions')
      .set('Host', 'localhost:3000')
      .expect(200);
    await origin(browser.post('/operations/executions/execution_ui/advance'))
      .send({})
      .expect(403);
    await browser
      .post('/operations/executions/execution_ui/advance')
      .set('Host', 'localhost:3000')
      .set('Origin', 'http://attacker.example')
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(403);
    await origin(browser.post('/operations/executions/execution_ui/advance'))
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(201);
    expect(mock.advance).toHaveBeenCalledTimes(1);
    await origin(browser.post('/operations/logout'))
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(201);
    await browser
      .get('/operations/executions')
      .set('Host', 'localhost:3000')
      .expect(401);
  } finally {
    await app.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
