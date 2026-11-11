import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { OperationsModule } from './operations.module.js';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import { NativeCampaignWorkflow } from '../content-operations/application/native-campaign-workflow.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import {
  OPERATIONAL_NOTIFICATION_PORT,
  DISCORD_OPERATIONAL_NOTIFICATION_PORT,
} from '../notifications/application/operational-notification.port.js';
import { NullOperationalNotificationAdapter } from '../notifications/infrastructure/operational-notification.adapter.js';
import { controlledFakeInput } from './fake-campaign-command.contract.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { EDITORIAL_PROVIDER } from '../content/application/editorial-provider.port.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';
import { FakeCampaignCommandService } from './fake-campaign-command.service.js';
import { LocalEvidenceStorage } from '../media/infrastructure/local-evidence-storage.js';

// Real QC credentials are never read. This file creates a disposable identity,
// official schema, repositories, Affiliate service and native workflow.
const route = '/operations/campaign-commands';
let app: INestApplication, fixture: ReturnType<typeof p2EditorialFixture>;
let secret: string;
let imageHash: string;
let noExternal: ReturnType<typeof vi.fn>;
function command() {
  const mediaReference = 'authorized-image-001',
    contentHash = imageHash;
  return {
    mode: 'FAKE',
    confirmation: true,
    request: {
      campaignId: 'camp_001',
      campaignRevision: 1,
      projectVersion: 1,
      requestId: 'controlled_http_test',
      requestedAt: '2026-11-10T12:00:00.000Z',
      localImage: {
        mediaReference,
        contentHash,
        origin: 'OPERATOR_OWNED',
        provider: null,
        rights: {
          usageBasis: 'OWNED',
          commercialUseAllowed: true,
          evidence: [
            {
              id: 'ev_http_test',
              kind: 'MEDIA_USAGE_RIGHT',
              sourceRef: 'fixture:owned',
              recordedAt: '2026-11-10T12:00:00Z',
              mediaAuthorization: {
                mediaRef: mediaReference,
                contentHash,
                commercialUse: 'GRANTED',
                processing: 'GRANTED',
                localProcessing: true,
                externalProviders: [],
              },
            },
          ],
        },
      },
    },
  };
}
async function startApp() {
  const module = await Test.createTestingModule({ imports: [OperationsModule] })
    .overrideProvider(OPERATIONAL_NOTIFICATION_PORT)
    .useValue(new NullOperationalNotificationAdapter())
    .overrideProvider(DISCORD_OPERATIONAL_NOTIFICATION_PORT)
    .useValue(new NullOperationalNotificationAdapter())
    .compile();
  app = module.createNestApplication();
  app.useLogger(false);
  await app.init();
}
beforeEach(async () => {
  fixture = p2EditorialFixture({ productionProfile: 'MIXED_MEDIA_V2' });
  const db = new DatabaseSync(fixture.database);
  try {
    provisionSchema(db, 44);
  } finally {
    db.close();
  }
  secret = randomBytes(32).toString('base64url');
  const salt = 'b'.repeat(32),
    hash = scryptSync(secret, Buffer.from(salt, 'hex'), 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 67108864,
    }).toString('hex');
  const identityPath = join(
    dirname(fixture.database),
    'controlled-identities.json',
  );
  writeFileSync(
    identityPath,
    JSON.stringify({
      version: 1,
      identities: [
        {
          id: 'operator_fake',
          salt,
          hash,
          roles: ['QC_REVIEWER'],
          revoked: false,
        },
        {
          id: 'operator_other',
          salt,
          hash,
          roles: ['QC_REVIEWER'],
          revoked: false,
        },
        { id: 'operator_no_role', salt, hash, roles: [], revoked: false },
      ],
    }),
    { mode: 0o600 },
  );
  for (const [name, value] of Object.entries({
    PROJECT_API_DATABASE: fixture.database,
    CONTENT_EDITORIAL_PROVIDER: 'fake',
    QC_IDENTITIES_FILE: identityPath,
    QC_FAKE_COMMANDS_ENABLED: 'true',
    QC_FAKE_COMMAND_OPERATORS: 'operator_fake',
    CAMPAIGN_SCHEDULER_ENABLED: 'false',
    INSTAGRAM_PUBLICATION_MODE: '',
    FACEBOOK_PUBLICATION_MODE: '',
    INSTAGRAM_SCHEDULER_ENABLED: 'false',
  }))
    vi.stubEnv(name, value);
  for (const name of [
    'FFMPEG_MEDIA_ROOT',
    'FFMPEG_VOICE_ROOT',
    'FFMPEG_RENDER_ROOT',
    'LOCAL_MEDIA_EVIDENCE_ROOT',
  ]) {
    const path = join(dirname(fixture.database), name.toLowerCase());
    mkdirSync(path);
    vi.stubEnv(name, path);
  }
  vi.stubEnv('LOCAL_TTS_MANIFEST', '');
  vi.stubEnv('LOCAL_TTS_MANIFEST_SHA256', '');
  const { png } = await import(
    new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
  );
  imageHash = new LocalEvidenceStorage(process.env.FFMPEG_MEDIA_ROOT!).put(
    png(),
    'png',
  );
  noExternal = vi.fn(() => {
    throw new Error('EXTERNAL_HTTP_FORBIDDEN');
  });
  vi.stubGlobal('fetch', noExternal);
  await startApp();
});
afterEach(async () => {
  await app?.close();
  fixture?.cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function local<T extends { set: (name: string, value: string) => T }>(
  query: T,
): T {
  return query
    .set('Host', 'localhost:3000')
    .set('Origin', 'http://localhost:3000');
}
async function login(operatorId = 'operator_fake') {
  const browser = request.agent(app.getHttpServer());
  const response = await local(browser.post('/operations/session'))
    .send({ operatorId, secret })
    .expect(201);
  return { browser, csrf: response.body.csrfToken as string };
}
test('refuses a missing session and never creates an execution', async () => {
  await local(request(app.getHttpServer()).post(`${route}/executions/fake`))
    .send(command())
    .expect(401)
    .expect('Cache-Control', 'no-store');
  expect(app.get(CampaignAdministration).list()).toHaveLength(0);
  expect(noExternal).not.toHaveBeenCalled();
});
test('requires the legitimate QC role and a separate explicit command grant', async () => {
  await local(request(app.getHttpServer()).post('/operations/session'))
    .send({ operatorId: 'operator_no_role', secret })
    .expect(403);
  const { browser, csrf } = await login('operator_other');
  await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send(command())
    .expect(403);
  expect(app.get(CampaignAdministration).list()).toHaveLength(0);
});
test.each([undefined, 'invalid', 'A'.repeat(43)])(
  'refuses missing or invalid CSRF (%s)',
  async (token) => {
    const { browser } = await login();
    const query = local(browser.post(`${route}/executions/fake`));
    if (token) query.set('x-qc-csrf', token);
    await query.send(command()).expect(403);
    expect(app.get(CampaignAdministration).list()).toHaveLength(0);
  },
);
test('bearer authentication cannot bypass the cookie session or CSRF', async () => {
  await local(request(app.getHttpServer()).post(`${route}/executions/fake`))
    .set('Authorization', `Bearer operator_fake.${secret}`)
    .send(command())
    .expect(401);
  const { browser } = await login();
  await local(browser.post(`${route}/executions/fake`))
    .set('Authorization', `Bearer operator_fake.${secret}`)
    .send(command())
    .expect(403);
});
test('commands fail closed when the private opt-in configuration is missing', async () => {
  const { browser, csrf } = await login();
  vi.stubEnv('QC_FAKE_COMMANDS_ENABLED', 'false');
  await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send(command())
    .expect(503);
  expect(app.get(CampaignAdministration).list()).toHaveLength(0);
});
test('an unproven paid provider is refused before creating a briefing or scheduled execution', async () => {
  const { browser, csrf } = await login();
  const provider = app.get<FakeEditorialProvider>(EDITORIAL_PROVIDER);
  provider.mode = 'PAID';
  const createBriefing = vi.spyOn(app.get(AffiliateService), 'createBriefing');
  await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send(command())
    .expect(503);
  expect(createBriefing).not.toHaveBeenCalled();
  expect(app.get(CampaignAdministration).list()).toHaveLength(0);
  expect(noExternal).not.toHaveBeenCalled();
});
test('registers the official campaign revision and replays without duplication', async () => {
  const { browser, csrf } = await login();
  const input = {
    mode: 'FAKE',
    confirmation: true,
    idempotencyKey: 'http_campaign_registration',
    campaign: {
      schemaVersion: 'affiliate-campaign/1.0.0',
      campaignId: 'camp_http_registered',
      revision: 1,
      projectId: 'project_001',
      productId: 'prod_001',
      productRevision: 1,
      affiliateUrl: 'https://example.com/test-only',
      cta: 'Confira pelo link',
      disclosure: 'Publicidade. Link de afiliado',
    },
  };
  const submit = () =>
    local(browser.post(`${route}/campaigns`))
      .set('x-qc-csrf', csrf)
      .send(input)
      .expect(201);
  const first = await submit(),
    replay = await submit();
  expect(first.body.result).toBe('CAMPAIGN_REGISTERED');
  expect(replay.body).toEqual(first.body);
  expect(first.body.campaign.campaignId).toBe('camp_http_registered');
  expect(noExternal).not.toHaveBeenCalled();
});
test('rejects malformed, unconfirmed, LIVE, injected-policy and external-provider commands before persistence', async () => {
  const { browser, csrf } = await login();
  const base = command();
  for (const body of [
    {},
    { ...base, confirmation: false },
    { ...base, mode: 'LIVE' },
    { ...base, request: { ...base.request, requestId: '../invalid' } },
    { ...base, request: { ...base.request, fakeExecutionPolicy: {} } },
    {
      ...base,
      request: {
        ...base.request,
        localImage: { ...base.request.localImage, provider: 'openai' },
      },
    },
  ])
    await local(browser.post(`${route}/executions/fake`))
      .set('x-qc-csrf', csrf)
      .send(body)
      .expect(400);
  expect(app.get(CampaignAdministration).list()).toHaveLength(0);
  expect(noExternal).not.toHaveBeenCalled();
});
test('concurrent commands and retry after an ambiguous response return the same real execution and policy', async () => {
  const { browser, csrf } = await login();
  const submit = () =>
    local(browser.post(`${route}/executions/fake`))
      .set('x-qc-csrf', csrf)
      .send(command())
      .expect(201);
  const responses = await Promise.all([submit(), submit()]);
  const first = responses[0].body,
    retry = (await submit()).body;
  expect(first.execution.status).toBe('SCHEDULED');
  expect(first.execution.executionId).toMatch(/^[a-f0-9-]{36}$/);
  expect(responses[1].body).toEqual(first);
  expect(retry).toEqual(first);
  const service = app.get(CampaignAdministration),
    id = first.execution.executionId;
  expect(service.list()).toHaveLength(1);
  expect(service.history(id)[0].evidence.fakeExecutionPolicy).toEqual(
    first.policy,
  );
  const detail = await local(browser.get(`${route}/executions/${id}`)).expect(
    200,
  );
  expect(detail.body.policy).toEqual(first.policy);
  expect(noExternal).not.toHaveBeenCalled();
});
test('a changed idempotent payload conflicts without creating a second execution', async () => {
  const { browser, csrf } = await login(),
    base = command();
  await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send(base)
    .expect(201);
  await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send({ ...base, request: { ...base.request, projectVersion: 2 } })
    .expect(409);
  expect(app.get(CampaignAdministration).list()).toHaveLength(1);
});
test('a response failure after the real commit does not duplicate a later confirmed retry', async () => {
  const { browser, csrf } = await login();
  const commands = app.get(FakeCampaignCommandService),
    original = commands.prepare.bind(commands);
  vi.spyOn(commands, 'prepare').mockImplementationOnce(
    async (value, principal) => {
      await original(value, principal);
      throw new Error('SIMULATED_RESPONSE_FAILURE_AFTER_REAL_COMMIT');
    },
  );
  const failure = await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send(command())
    .expect(500);
  expect(failure.body).toEqual({ code: 'FAKE_COMMAND_FAILED' });
  const service = app.get(CampaignAdministration),
    [committed] = service.list();
  const retry = await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send(command())
    .expect(201);
  expect(retry.body.execution.executionId).toBe(committed.execution_id);
  expect(service.list()).toHaveLength(1);
  expect(noExternal).not.toHaveBeenCalled();
});
test('legacy unguarded entry points cannot submit or resume a controlled command', async () => {
  const { browser, csrf } = await login();
  const accepted = await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send(command())
    .expect(201);
  const service = app.get(CampaignAdministration),
    id = accepted.body.execution.executionId;
  const persisted = service.history(id)[0].evidence;
  await local(
    request(app.getHttpServer()).post(
      '/content-operations/campaign-executions',
    ),
  )
    .send(persisted)
    .expect(400);
  await local(
    request(app.getHttpServer()).post(
      `/content-operations/campaign-executions/${id}/resume`,
    ),
  )
    .send({})
    .expect(400);
  expect(service.get(id).status).toBe('SCHEDULED');
  expect(service.list()).toHaveLength(1);
});
test('restart retains the policy and identity; subsequent global LIVE configuration cannot rewrite them', async () => {
  let session = await login();
  const first = await local(session.browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', session.csrf)
    .send(command())
    .expect(201);
  const id = first.body.execution.executionId;
  await app.close();
  await startApp();
  session = await login();
  vi.stubEnv('INSTAGRAM_PUBLICATION_MODE', 'live');
  const detail = await local(
    session.browser.get(`${route}/executions/${id}`),
  ).expect(200);
  expect(detail.body.policy).toEqual(first.body.policy);
  expect(detail.body.mode).toBe('FAKE');
  const administration = app.get(CampaignAdministration);
  await expect(
    administration.resume(id, {
      publication: { accountId: '123456789', packageHash: 'b'.repeat(64) },
    }),
  ).rejects.toThrow('FAKE_EXECUTION_INPUT_FORBIDDEN');
  expect(() => administration.publicationContext(id)).toThrow(
    'FAKE_EXECUTION_PUBLICATION_DISABLED',
  );
  expect(noExternal).not.toHaveBeenCalled();
});
test('the actual native pipeline persists editorial checkpoints and reports missing local resources, never a fabricated completion', async () => {
  const { browser, csrf } = await login();
  const briefing = vi.spyOn(app.get(AffiliateService), 'createBriefing');
  const response = await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send(command())
    .expect(201);
  const service = app.get(CampaignAdministration),
    id = response.body.execution.executionId;
  expect(briefing).not.toHaveBeenCalled();
  expect(service.history(id)[0].evidence.fakeExecutionPolicy).toEqual(
    response.body.policy,
  );
  await service.advanceFinalization(id);
  expect(briefing).toHaveBeenCalledTimes(1);
  const history = service.history(id);
  expect(
    history.some(
      (event) =>
        event.event_type === 'STEP_DONE' && event.evidence.step === 'EDITORIAL',
    ),
  ).toBe(true);
  expect(
    history.some(
      (event) =>
        event.event_type === 'STEP_DONE' && event.evidence.step === 'MEDIA_QC',
    ),
    JSON.stringify(history.at(-1)?.evidence),
  ).toBe(true);
  expect(service.get(id).status).toBe('WAITING_INPUT');
  expect(service.get(id).finalization.pending?.code).toBe(
    'LOCAL_TTS_CONFIGURATION_REQUIRED',
  );
  expect(history.some((event) => event.event_type === 'STEP_FAILED')).toBe(
    true,
  );
  expect(noExternal).not.toHaveBeenCalled();
  expect(
    app
      .get(NativeCampaignWorkflow)
      .assertControlledRuntime({ ...history[0].evidence }),
  ).toEqual(response.body.policy);
  expect(controlledFakeInput(command()).campaignId).toBe('camp_001');
});
test('confirmed recovery uses the persisted policy and version; a stale retry cannot queue a second attempt', async () => {
  const { browser, csrf } = await login();
  const first = await local(browser.post(`${route}/executions/fake`))
    .set('x-qc-csrf', csrf)
    .send(command())
    .expect(201);
  const service = app.get(CampaignAdministration),
    id = first.body.execution.executionId;
  await service.advanceFinalization(id);
  const version = service.get(id).version;
  const input = { mode: 'FAKE', confirmation: true, expectedVersion: version };
  await local(browser.post(`${route}/executions/${id}/resume`))
    .send(input)
    .expect(403);
  vi.stubEnv('INSTAGRAM_PUBLICATION_MODE', 'live');
  const resumed = await local(browser.post(`${route}/executions/${id}/resume`))
    .set('x-qc-csrf', csrf)
    .send(input)
    .expect(201);
  expect(resumed.body.execution.status).toBe('SCHEDULED');
  expect(resumed.body.policy).toEqual(first.body.policy);
  await local(browser.post(`${route}/executions/${id}/resume`))
    .set('x-qc-csrf', csrf)
    .send(input)
    .expect(409);
  expect(
    service.history(id).filter((event) => event.event_type === 'RESUMED'),
  ).toHaveLength(1);
  expect(noExternal).not.toHaveBeenCalled();
});
