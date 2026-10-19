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
    audioMode: vi.fn(async () => execution),
    reviseScript: vi.fn(async () => execution),
    instagramConnection: vi.fn(() => ({
      connection: 'NOT_CONFIGURED',
      missingPermissions: null,
      livePublication: { eligible: false },
    })),
    checkInstagramConnection: vi.fn(async () => ({
      connection: 'READY',
      missingPermissions: [],
      livePublication: { eligible: false },
    })),
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
    const page = await browser
      .get('/operations')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Content-Type', /html/);
    expect(page.text).toContain(
      '<select id="script-revision-select" name="scriptId" required',
    );
    expect(page.text).not.toContain('<input name="scriptId"');
    const script = await browser.get('/operations/app.js').expect(200);
    expect(script.text).toContain('option.value = revision.scriptId');
    expect(script.text).toContain(
      'Uma revisão mais curta precisa estar cadastrada',
    );
    expect(script.text).not.toContain('POST /content/scripts');
    expect(script.text).toContain('action !== "SCRIPT_REVISION_REQUIRED"');
    expect(() => new Script(script.text)).not.toThrow();
    await browser.get('/operations/executions').expect(401);
    await browser.get('/operations/instagram/connection').expect(401);
    await origin(browser.post('/operations/executions/execution_ui/audio-mode'))
      .send({ mode: 'RECORDING' })
      .expect(401);
    await origin(browser.post('/operations/instagram/connection/check'))
      .send({})
      .expect(401);
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
      .get('/operations/instagram/connection')
      .set('Host', 'localhost:3000')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect(({ body }) => expect(body.connection).toBe('NOT_CONFIGURED'));
    expect(mock.checkInstagramConnection).not.toHaveBeenCalled();
    await origin(browser.post('/operations/instagram/connection/check'))
      .send({})
      .expect(403);
    await browser
      .post('/operations/instagram/connection/check')
      .set('Host', 'localhost:3000')
      .set('Origin', 'http://attacker.example')
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(403);
    await origin(browser.post('/operations/instagram/connection/check'))
      .set('x-qc-csrf', login.body.csrfToken)
      .send({})
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          connection: 'READY',
          livePublication: { eligible: false },
        }),
      );
    expect(mock.checkInstagramConnection).toHaveBeenCalledTimes(1);
    await origin(browser.post('/operations/executions/execution_ui/audio-mode'))
      .send({ mode: 'RECORDING' })
      .expect(403);
    await origin(browser.post('/operations/executions/execution_ui/audio-mode'))
      .set('x-qc-csrf', login.body.csrfToken)
      .send({ mode: 'RECORDING' })
      .expect(201);
    expect(mock.audioMode).toHaveBeenCalledTimes(1);
    await origin(
      browser.post('/operations/executions/execution_ui/script-revision'),
    )
      .send({})
      .expect(403);
    await origin(
      browser.post('/operations/executions/execution_ui/script-revision'),
    )
      .set('x-qc-csrf', login.body.csrfToken)
      .send({ scriptId: 'new_script' })
      .expect(201);
    expect(mock.reviseScript).toHaveBeenCalledWith(
      'execution_ui',
      { scriptId: 'new_script' },
      expect.anything(),
    );
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
    await origin(
      browser.post('/operations/executions/execution_ui/script-revision'),
    )
      .send({})
      .expect(401);
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
