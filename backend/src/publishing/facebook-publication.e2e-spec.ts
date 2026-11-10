import { MODULE_METADATA } from '@nestjs/common/constants';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { facebookPublicationFixture } from '../../test/support/facebook-publication.fixture.js';
import { openNotificationStore } from '../../test/support/operational-notifications.fixture.js';
import { PublishingModule } from './publishing.module.js';
import { PublishingPersistence } from './infrastructure/publishing.persistence.js';
import { FACEBOOK_PUBLICATION_PORTS } from './application/ports/destination-publication.port.js';
import { INSTAGRAM_PUBLICATION_PORTS } from './application/ports/instagram-publication.port.js';
import { LocalQcGuard } from './application/local-qc.guard.js';
import { MediaService } from '../media/application/media.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { CAMPAIGN_OPERATIONS } from '../content-operations/application/campaign-operations.port.js';
import {
  OPERATIONAL_NOTIFICATION_PORT,
  DISCORD_OPERATIONAL_NOTIFICATION_PORT,
} from '../notifications/application/operational-notification.port.js';
import { FakeOperationalNotificationAdapter } from '../notifications/infrastructure/operational-notification.adapter.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { DestinationPublicationController } from './destination-publication.controller.js';
import { DestinationPublicationService } from './application/destination-publication.service.js';
import { SocialPublicationService } from './application/social-publication.service.js';
import { provisionSchema } from '../administration/schema-provisioner.js';

async function supersessionHttpFixture(withOriginal = true) {
  const f = await facebookPublicationFixture(true, 'v27.0', true);
  const identityDirectory = mkdtempSync(join(tmpdir(), 'supersession-http-'));
  const identityPath = join(identityDirectory, 'identities.json');
  const secret = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const identity = {
    id: 'reviewer_http',
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
  writeFileSync(
    identityPath,
    JSON.stringify({ version: 1, identities: [identity] }),
    { mode: 0o600 },
  );
  vi.stubEnv('QC_IDENTITIES_FILE', identityPath);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(f.at);
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('NO_EXTERNAL_NETWORK'));
  const apps: INestApplication[] = [];
  const service = () => f.reopen(() => new Date().toISOString());
  async function create(): Promise<INestApplication> {
    const module = await Test.createTestingModule({
      controllers: [DestinationPublicationController],
      providers: [
        { provide: DestinationPublicationService, useValue: service() },
        LocalQcGuard,
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    apps.push(app);
    return app;
  }
  const cleanup = async () => {
    for (const app of apps) await app.close();
    network.mockRestore();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    f.cleanup();
    rmSync(identityDirectory, { recursive: true, force: true });
  };
  try {
    provisionSchema(f.f.base.db, 43);
    f.approve(f.facebookPackage);
    f.campaigns.ownedEvent(
      f.execution.execution_id,
      f.execution.claim_token!,
      f.at,
      'WORKFLOW_FINISHED',
      {},
      'SUCCEEDED',
    );
    let original: any;
    if (withOriginal) {
      const store = f.store.openDestination('fake');
      try {
        const engine = new SocialPublicationService({
          repository: store.social,
          manual: store.manual,
          publisher: f.ports.publisher,
          media: f.ports.media,
          transferVerifier: f.ports.verifier,
          now: () => new Date().toISOString(),
        });
        original = await engine.prepare(
          {
            packageHash: f.facebookPackage.contentHash,
            accountId: f.ports.publisher.accountId,
          },
          'http_original',
          'local',
        );
        store.reservations.reserve(
          f.execution.execution_id,
          original,
          f.facebookPackage,
          f.publishing.packageReview(f.facebookPackage.contentHash).contentHash,
          f.at,
        );
        original = await engine.createContainer(original.operationId);
      } finally {
        store.close();
      }
    }
    provisionSchema(f.f.base.db, 44);
    const accountId = '1355505384315575';
    const input = {
      originalOperationId: original?.operationId,
      revision: 1,
      expectedVersion: original?.version,
      decisionId: 'http_preparation_001',
      reason: 'Explicit replacement with residual risk accepted',
      remoteObservation: original
        ? await f.ports.publisher.inspectUploadSession!(original.containerId)
        : null,
      acceptResidualRisk: true,
    };
    const app = await create();
    const url = `/publishing/executions/${f.execution.execution_id}/facebook-reels`;
    const token = `Bearer ${identity.id}.${secret}`;
    const post = (path: string, body: object, target = app) =>
      request(target.getHttpServer())
        .post(url + path)
        .set('Authorization', token)
        .send(body);
    const prepare = (command: unknown = input) =>
      post('/supersession', { accountId, input: command });
    const authorize = (
      successor: any,
      patch: object = {},
      expectedVersion = successor.version,
    ) => {
      vi.setSystemTime(Date.parse(f.at) + 1000);
      return post('/authorization', {
        accountId,
        expectedVersion,
        authorization: {
          operationId: successor.operationId,
          packageHash: successor.packageHash,
          preparationDecisionId: input.decisionId,
          authorizationId: 'http_execution_002',
          authorizedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          acceptResidualRisk: true,
          ...patch,
        },
      });
    };
    return {
      f,
      app,
      create,
      service,
      original,
      accountId,
      input,
      url,
      token,
      post,
      prepare,
      authorize,
      identity,
      identityPath,
      network,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

test('HTTP supersession prepares idempotently without publication or execution authorization', async () => {
  const x = await supersessionHttpFixture();
  try {
    const before = x.f.posts.slice();
    const prepared = await x.prepare().expect(201);
    expect(prepared.body).toMatchObject({
      state: 'PREPARED',
      version: 0,
      supersession: { actor: x.identity.id },
    });
    const replay = await x.prepare().expect(201);
    expect(replay.body).toEqual(prepared.body);
    await x.post('', { accountId: x.accountId }).expect(409);
    expect(x.f.posts).toEqual(before);
    expect(x.network).not.toHaveBeenCalled();
  } finally {
    await x.cleanup();
  }
});

test('HTTP successor authorization is independent, replayable and verified by execution after restart', async () => {
  const x = await supersessionHttpFixture();
  try {
    const successor = (await x.prepare().expect(201)).body;
    const before = x.f.posts.slice();
    const authorized = (await x.authorize(successor).expect(201)).body;
    const duplicate = (await x.authorize(successor).expect(201)).body;
    expect(authorized).toEqual(duplicate);
    expect(authorized).toMatchObject({
      operationId: successor.operationId,
      version: successor.version,
      authorization: {
        operationId: successor.operationId,
        actor: x.identity.id,
      },
    });
    expect(x.f.posts).toEqual(before);
    const store = x.f.store.openDestination('fake');
    try {
      expect(store.social.get(successor.operationId)).toEqual(successor);
    } finally {
      store.close();
    }
    await x.app.close();
    const restarted = await x.create();
    const execution = {
      accountId: x.accountId,
      expectedVersion: authorized.version,
      authorization: authorized.authorization,
    };
    await x.post('', execution, restarted).expect(201);
    await x.post('', execution, restarted).expect(201);
    expect(x.f.posts).toEqual([...before, 'create', 'upload', 'publish']);
    const reopened = x.f.store.openDestination('fake');
    try {
      expect(
        reopened.social.get(successor.operationId).executionAuthorization,
      ).toEqual(authorized.authorization);
    } finally {
      reopened.close();
    }
    expect(x.network).not.toHaveBeenCalled();
  } finally {
    await x.cleanup();
  }
});

test.each([
  'missing',
  'client_actor',
  'no_risk',
  'version',
  'decision_conflict',
  'not_found',
  'remote_progress',
  'client_evidence',
  'published',
])(
  'HTTP supersession rejects %s without further submissions',
  async (variant) => {
    const x = await supersessionHttpFixture();
    try {
      const input: any = structuredClone(x.input);
      let status = 409;
      if (variant === 'missing') {
        delete input.reason;
        status = 400;
      }
      if (variant === 'client_actor') {
        input.actor = 'untrusted_actor';
        status = 400;
      }
      if (variant === 'no_risk') {
        input.acceptResidualRisk = false;
        status = 400;
      }
      if (variant === 'version') input.expectedVersion++;
      if (variant === 'decision_conflict') {
        await x.prepare().expect(201);
        input.decisionId = 'different_decision';
      }
      if (variant === 'not_found')
        input.originalOperationId = 'missing_operation';
      if (variant === 'client_evidence')
        input.remoteObservation.bytesTransferred = 1;
      if (variant === 'published') await x.f.execute(x.service());
      if (variant === 'remote_progress') {
        const inspect = x.f.ports.publisher.inspectUploadSession!.bind(
          x.f.ports.publisher,
        );
        vi.spyOn(
          x.f.ports.publisher,
          'inspectUploadSession',
        ).mockImplementation(async (id) => ({
          ...(await inspect(id)),
          publicationStatus: 'complete',
        }));
      }
      const before = x.f.posts.slice();
      await x.prepare(input).expect(status);
      expect(x.f.posts).toEqual(before);
    } finally {
      await x.cleanup();
    }
  },
);

test.each([
  'version',
  'different_operation',
  'different_decision',
  'different_package',
  'client_actor',
  'expired',
  'no_risk',
  'finance',
  'approval',
  'published',
  'missing_owner',
  'lineage_progress',
])(
  'HTTP successor authorization rejects %s without publishing',
  async (variant) => {
    const x = await supersessionHttpFixture();
    try {
      const successor = (await x.prepare().expect(201)).body;
      const patch: any = {};
      if (variant === 'different_operation')
        patch.operationId = 'different_successor';
      if (variant === 'different_decision')
        patch.preparationDecisionId = 'different_decision';
      if (variant === 'different_package') patch.packageHash = '0'.repeat(64);
      if (variant === 'client_actor') patch.actor = 'untrusted_actor';
      if (variant === 'expired') patch.expiresAt = x.f.at;
      if (variant === 'no_risk') patch.acceptResidualRisk = false;
      if (variant === 'finance')
        vi.spyOn(x.f.finance, 'getGlobalOperation').mockReturnValue({
          state: 'UNKNOWN',
        } as any);
      if (variant === 'approval')
        x.f.publishing.revokeApproval({
          packageHash: x.f.facebookPackage.contentHash,
          reviewHash: x.f.publishing.packageReview(
            x.f.facebookPackage.contentHash,
          ).contentHash,
          actor: 'operator_fixture',
          reason: 'Revocation before successor authorization',
        });
      if (variant === 'missing_owner') {
        const open = x.f.store.openDestination.bind(x.f.store);
        vi.spyOn(x.f.store, 'openDestination').mockImplementation((mode) => {
          const store = open(mode);
          vi.spyOn(store.reservations, 'activeForExecution').mockReturnValue(
            null,
          );
          return store;
        });
      }
      if (variant === 'lineage_progress') {
        const inspect = x.f.ports.publisher.inspectUploadSession!.bind(
          x.f.ports.publisher,
        );
        vi.spyOn(
          x.f.ports.publisher,
          'inspectUploadSession',
        ).mockImplementation(async (id) => ({
          ...(await inspect(id)),
          processingStatus: 'in_progress',
        }));
      }
      if (variant === 'published') {
        const proof = (await x.authorize(successor).expect(201)).body;
        await x
          .post('', {
            accountId: x.accountId,
            expectedVersion: proof.version,
            authorization: proof.authorization,
          })
          .expect(201);
      }
      const before = x.f.posts.slice();
      await x
        .authorize(
          successor,
          patch,
          successor.version + (variant === 'version' ? 1 : 0),
        )
        .expect(variant === 'client_actor' ? 400 : 409);
      expect(x.f.posts).toEqual(before);
    } finally {
      await x.cleanup();
    }
  },
);

test('HTTP supersession requires the authenticated actor and rejects revoked credentials', async () => {
  const x = await supersessionHttpFixture();
  try {
    const successor = (await x.prepare().expect(201)).body;
    const before = x.f.posts.slice();
    for (const path of ['/supersession', '/authorization']) {
      await request(x.app.getHttpServer())
        .post(x.url + path)
        .send({ accountId: x.accountId })
        .expect(401);
    }
    writeFileSync(
      x.identityPath,
      JSON.stringify({
        version: 1,
        identities: [{ ...x.identity, revoked: true }],
      }),
    );
    await x.authorize(successor).expect(401);
    expect(x.f.posts).toEqual(before);
  } finally {
    await x.cleanup();
  }
});

test('HTTP concurrent preparations select one successor and an old operation cannot be authorized', async () => {
  const x = await supersessionHttpFixture();
  try {
    const [a, b] = await Promise.all([x.prepare(), x.prepare()]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body).toEqual(b.body);
    const before = x.f.posts.slice();
    await x.authorize(x.original).expect(409);
    expect(x.f.posts).toEqual(before);
    expect(
      x.f.f.base.db
        .prepare('SELECT count(*) n FROM publication_supersessions')
        .get()?.n,
    ).toBe(1);
  } finally {
    await x.cleanup();
  }
});

test('HTTP execution rejects a proof for another operation or stale version', async () => {
  const x = await supersessionHttpFixture();
  try {
    const successor = (await x.prepare().expect(201)).body;
    const proof = (await x.authorize(successor).expect(201)).body;
    const before = x.f.posts.slice();
    for (const variant of ['operation', 'version', 'actor']) {
      const body = {
        accountId: x.accountId,
        expectedVersion: proof.version + (variant === 'version' ? 1 : 0),
        authorization: { ...proof.authorization },
      };
      if (variant === 'operation')
        body.authorization.operationId = x.original.operationId;
      if (variant === 'actor') body.authorization.actor = 'different_reviewer';
      await x.post('', body).expect(variant === 'actor' ? 403 : 409);
    }
    expect(x.f.posts).toEqual(before);
  } finally {
    await x.cleanup();
  }
});

test('Nest HTTP E2E: existing MP4, independent approvals, two receipts, notifications and restart with zero duplicate submissions', async () => {
  const f = await facebookPublicationFixture(true, 'v27.0');
  const PUBLISHING_EVIDENCE = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    PublishingModule,
  ).find(
    (p: any) =>
      typeof p.provide === 'symbol' &&
      p.provide.description === 'PUBLISHING_EVIDENCE',
  ).provide;
  const telegram = new FakeOperationalNotificationAdapter('telegram:multi-e2e'),
    discord = new FakeOperationalNotificationAdapter('discord:multi-e2e');
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('NO_EXTERNAL_NETWORK'));
  vi.stubEnv('PROJECT_API_DATABASE', f.f.database);
  vi.stubEnv('INSTAGRAM_SCHEDULER_ENABLED', 'false');
  vi.stubEnv('CAMPAIGN_SCHEDULER_ENABLED', 'false');
  const baseline = openNotificationStore(f.f.database);
  try {
    for (const port of [telegram, discord])
      baseline.baseline(
        port.destinationId,
        { campaign: 0, social: 0, manual: 0 },
        f.at,
      );
  } finally {
    baseline.close();
  }
  const create = async () => {
    const module = await Test.createTestingModule({
      imports: [PublishingModule],
    })
      .overrideProvider(PublishingPersistence)
      .useValue(f.store)
      .overrideProvider(PUBLISHING_EVIDENCE)
      .useValue(f.media)
      .overrideProvider(MediaService)
      .useValue(f.media)
      .overrideProvider(LocalFlowService)
      .useValue({})
      .overrideProvider(FinanceService)
      .useValue(f.finance)
      .overrideProvider(CAMPAIGN_OPERATIONS)
      .useValue(f.campaignPort)
      .overrideProvider(FACEBOOK_PUBLICATION_PORTS)
      .useValue(f.ports)
      .overrideProvider(INSTAGRAM_PUBLICATION_PORTS)
      .useValue(null)
      .overrideProvider(OPERATIONAL_NOTIFICATION_PORT)
      .useValue(telegram)
      .overrideProvider(DISCORD_OPERATIONAL_NOTIFICATION_PORT)
      .useValue(discord)
      .overrideGuard(LocalQcGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    await app.init();
    return app;
  };
  let app: Awaited<ReturnType<typeof create>> | undefined;
  try {
    app = await create();
    const url = `/publishing/executions/${f.execution.execution_id}/facebook-reels`;
    await request(app.getHttpServer())
      .post(url)
      .send({ accountId: '1355505384315575' })
      .expect(409);
    expect(f.posts).toEqual([]);
    f.approve(f.facebookPackage);
    const response = await request(app.getHttpServer())
      .post(url)
      .send({ accountId: '1355505384315575' })
      .expect(201);
    expect(response.body.receipt.mediaId).toBe('987654321');
    expect(response.body.receipt.mediaId).not.toBe(f.ig.mediaId);
    const query = await request(app.getHttpServer())
      .get(`/publishing/executions/${f.execution.execution_id}/destinations`)
      .expect(200);
    expect(query.body).toHaveLength(2);
    expect(
      telegram.messages.filter((m) => m.kind === 'PUBLICATION_SUCCEEDED'),
    ).toHaveLength(2);
    expect(discord.messages).toEqual(telegram.messages);
    await app.close();
    app = await create();
    await request(app.getHttpServer())
      .post(url)
      .send({ accountId: '1355505384315575' })
      .expect(201);
    expect(f.posts).toEqual(['create', 'upload', 'publish']);
    expect(telegram.messages).toHaveLength(2);
    expect(discord.messages).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
    expect(f.f.base.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    await app?.close();
    vi.unstubAllEnvs();
    fetch.mockRestore();
    f.cleanup();
  }
}, 20000);

test('schema 44 new Facebook operation blocks execution before remote effects without a scoped grant', async () => {
  const f = await facebookPublicationFixture(true);
  try {
    provisionSchema(f.f.base.db, 44);
    f.approve(f.facebookPackage);
    await expect(f.execute()).rejects.toMatchObject({
      code: 'SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED',
    });
    expect(f.posts).toEqual([]);
  } finally {
    f.cleanup();
  }
});

test('schema 44 Facebook occurrence accepts only its own unexpired grant across restart and replay', async () => {
  const f = await facebookPublicationFixture(true);
  try {
    provisionSchema(f.f.base.db, 44);
    f.approve(f.facebookPackage);
    const service = f.reopen();
    const prepared = await service.prepareFacebookOccurrence(
      f.execution.execution_id,
      '1355505384315575',
    );
    expect(prepared.state).toBe('PREPARED');
    expect(f.posts).toEqual([]);
    f.campaigns.ownedEvent(
      f.execution.execution_id,
      f.execution.claim_token!,
      f.at,
      'PAUSED',
      {
        step: 'PUBLICATION',
        code: 'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
      },
      'WAITING_INPUT',
    );
    const grant = {
      executionId: f.execution.execution_id,
      operationId: prepared.operationId,
      accountId: '1355505384315575',
      packageHash: f.facebookPackage.contentHash,
      campaignRevision: f.execution.campaign_revision,
      expectedVersion: prepared.version,
      authorizationId: 'occurrence_day_1_grant_001',
      actor: 'reviewer_fixture',
      authorizedAt: f.at,
      expiresAt: new Date(Date.parse(f.at) + 600000).toISOString(),
    };
    await expect(
      service.execute(
        f.execution.execution_id,
        'FACEBOOK_REELS',
        grant.accountId,
        {
          ...grant,
          executionId: 'another_execution',
        },
        prepared.version,
      ),
    ).rejects.toMatchObject({ code: 'SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED' });
    await expect(
      service.execute(
        f.execution.execution_id,
        'FACEBOOK_REELS',
        grant.accountId,
        {
          ...grant,
          expiresAt: f.at,
        },
        prepared.version,
      ),
    ).rejects.toMatchObject({ code: 'SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED' });
    await expect(
      service.execute(
        f.execution.execution_id,
        'FACEBOOK_REELS',
        grant.accountId,
        {
          ...grant,
          preparationDecisionId: 'supersession_decision',
          acceptResidualRisk: true,
        } as any,
        prepared.version,
      ),
    ).rejects.toMatchObject({ code: 'SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED' });
    expect(f.posts).toEqual([]);
    const authorized = await service.authorizeFacebookOccurrence(
      f.execution.execution_id,
      grant.accountId,
      prepared.version,
      grant,
    );
    expect(authorized.authorization.actor).toBe(grant.actor);
    const result = await f
      .reopen()
      .execute(
        f.execution.execution_id,
        'FACEBOOK_REELS',
        grant.accountId,
        grant,
        prepared.version,
      );
    expect(result.receipt.mediaId).toBe('987654321');
    expect(f.posts).toEqual(['create', 'upload', 'publish']);
    const replay = await f
      .reopen()
      .execute(f.execution.execution_id, 'FACEBOOK_REELS', grant.accountId);
    expect(replay.receipt).toEqual(result.receipt);
    expect(f.posts).toEqual(['create', 'upload', 'publish']);
  } finally {
    f.cleanup();
  }
});

test('schema 44 persisted CREATE intent rejects a missing Facebook occurrence grant', async () => {
  const f = await facebookPublicationFixture(true);
  try {
    provisionSchema(f.f.base.db, 44);
    f.approve(f.facebookPackage);
    const prepared = await f
      .reopen()
      .prepareFacebookOccurrence(f.execution.execution_id, '1355505384315575');
    const s = f.store.openDestination('fake');
    try {
      expect(() =>
        s.social.transition(
          prepared.operationId,
          prepared.version,
          ['PREPARED'],
          { state: 'CREATING_CONTAINER' },
          f.at,
        ),
      ).toThrow('SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED');
      expect(s.social.get(prepared.operationId).version).toBe(0);
      expect(f.posts).toEqual([]);
    } finally {
      s.close();
    }
  } finally {
    f.cleanup();
  }
});

test('schema 44 persisted UPLOAD and FINISH intents reject a missing occurrence grant', async () => {
  const f = await facebookPublicationFixture(true);
  try {
    provisionSchema(f.f.base.db, 44);
    f.approve(f.facebookPackage);
    const prepared = await f
      .reopen()
      .prepareFacebookOccurrence(f.execution.execution_id, '1355505384315575');
    f.campaigns.ownedEvent(
      f.execution.execution_id,
      f.execution.claim_token!,
      f.at,
      'PAUSED',
      {
        step: 'PUBLICATION',
        code: 'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
      },
      'WAITING_INPUT',
    );
    const grant = {
      executionId: f.execution.execution_id,
      operationId: prepared.operationId,
      accountId: '1355505384315575',
      packageHash: f.facebookPackage.contentHash,
      campaignRevision: f.execution.campaign_revision,
      expectedVersion: 0,
      authorizationId: 'intent_boundary_grant_001',
      actor: 'reviewer_fixture',
      authorizedAt: f.at,
      expiresAt: new Date(Date.parse(f.at) + 600000).toISOString(),
    };
    const s = f.store.openDestination('fake');
    try {
      const engine = new SocialPublicationService({
        repository: s.social,
        manual: s.manual,
        publisher: f.ports.publisher,
        media: f.ports.media,
        transferVerifier: f.ports.verifier,
        operationalAuthorization: grant,
        now: () => f.at,
        authorize: (op: any) => s.reservations.authorize(op, f.at),
      });
      const created = await engine.createContainer(prepared.operationId);
      expect(() =>
        s.social.transition(
          prepared.operationId,
          created.version,
          ['PROCESSING'],
          { uploadStage: 'UPLOADING' },
          f.at,
        ),
      ).toThrow('SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED');
      expect(f.posts).toEqual(['create']);
      const uploaded = await engine.upload(
        prepared.operationId,
        await f.ports.localBytes(
          f.facebookPackage.contentHash,
          f.render.videoRenderId,
          f.hash,
        ),
      );
      expect(uploaded.uploadStage).toBe('ACKNOWLEDGED');
      const ready = await engine.process(prepared.operationId);
      expect(ready.state).toBe('READY');
      expect(() =>
        s.social.transition(
          prepared.operationId,
          ready.version,
          ['READY'],
          { state: 'PUBLISHING' },
          f.at,
        ),
      ).toThrow('SOCIAL_FACEBOOK_AUTHORIZATION_REQUIRED');
      expect(f.posts).toEqual(['create', 'upload']);
    } finally {
      s.close();
    }
  } finally {
    f.cleanup();
  }
});

test('schema 44 concurrent authorized workers do not duplicate Facebook remote posts', async () => {
  const f = await facebookPublicationFixture(true);
  try {
    provisionSchema(f.f.base.db, 44);
    f.approve(f.facebookPackage);
    const prepared = await f
      .reopen()
      .prepareFacebookOccurrence(f.execution.execution_id, '1355505384315575');
    f.campaigns.ownedEvent(
      f.execution.execution_id,
      f.execution.claim_token!,
      f.at,
      'PAUSED',
      {
        step: 'PUBLICATION',
        code: 'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
      },
      'WAITING_INPUT',
    );
    const grant = {
      executionId: f.execution.execution_id,
      operationId: prepared.operationId,
      accountId: '1355505384315575',
      packageHash: f.facebookPackage.contentHash,
      campaignRevision: f.execution.campaign_revision,
      expectedVersion: 0,
      authorizationId: 'concurrent_occurrence_grant_001',
      actor: 'reviewer_fixture',
      authorizedAt: f.at,
      expiresAt: new Date(Date.parse(f.at) + 600000).toISOString(),
    };
    await f
      .reopen()
      .authorizeFacebookOccurrence(
        f.execution.execution_id,
        grant.accountId,
        0,
        grant,
      );
    const results = await Promise.allSettled([
      f
        .reopen()
        .execute(
          f.execution.execution_id,
          'FACEBOOK_REELS',
          grant.accountId,
          grant,
        ),
      f
        .reopen()
        .execute(
          f.execution.execution_id,
          'FACEBOOK_REELS',
          grant.accountId,
          grant,
        ),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(f.posts.filter((p) => p === 'create')).toHaveLength(1);
    expect(f.posts.filter((p) => p === 'upload')).toHaveLength(1);
    expect(f.posts.filter((p) => p === 'publish')).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});

test('schema 44 UNKNOWN CREATE never retries a blind Facebook POST', async () => {
  const f = await facebookPublicationFixture(true);
  try {
    provisionSchema(f.f.base.db, 44);
    f.approve(f.facebookPackage);
    const prepared = await f
      .reopen()
      .prepareFacebookOccurrence(f.execution.execution_id, '1355505384315575');
    f.campaigns.ownedEvent(
      f.execution.execution_id,
      f.execution.claim_token!,
      f.at,
      'PAUSED',
      {
        step: 'PUBLICATION',
        code: 'FACEBOOK_EXECUTION_AUTHORIZATION_REQUIRED',
      },
      'WAITING_INPUT',
    );
    const grant = {
      executionId: f.execution.execution_id,
      operationId: prepared.operationId,
      accountId: '1355505384315575',
      packageHash: f.facebookPackage.contentHash,
      campaignRevision: f.execution.campaign_revision,
      expectedVersion: 0,
      authorizationId: 'unknown_occurrence_grant_001',
      actor: 'reviewer_fixture',
      authorizedAt: f.at,
      expiresAt: new Date(Date.parse(f.at) + 600000).toISOString(),
    };
    f.fail('create');
    await expect(
      f
        .reopen()
        .execute(
          f.execution.execution_id,
          'FACEBOOK_REELS',
          grant.accountId,
          grant,
        ),
    ).rejects.toMatchObject({ code: 'SOCIAL_RECONCILIATION_REQUIRED' });
    expect(f.posts).toEqual(['create']);
    await expect(
      f
        .reopen()
        .execute(
          f.execution.execution_id,
          'FACEBOOK_REELS',
          grant.accountId,
          grant,
        ),
    ).rejects.toMatchObject({ code: 'SOCIAL_RECONCILIATION_REQUIRED' });
    expect(f.posts).toEqual(['create']);
  } finally {
    f.cleanup();
  }
});

test('HTTP recurring Facebook requires an authenticated operation grant before direct execution', async () => {
  const x = await supersessionHttpFixture(false);
  try {
    const prepared = await x
      .post('/prepare', { accountId: x.accountId })
      .expect(201);
    expect(prepared.body.state).toBe('PREPARED');
    await x.post('', { accountId: x.accountId }).expect(409);
    expect(x.f.posts).toEqual([]);
    vi.setSystemTime(Date.parse(x.f.at) + 1000);
    const authorization = {
      executionId: x.f.execution.execution_id,
      operationId: prepared.body.operationId,
      accountId: x.accountId,
      packageHash: x.f.facebookPackage.contentHash,
      campaignRevision: x.f.execution.campaign_revision,
      expectedVersion: prepared.body.version,
      authorizationId: 'http_occurrence_grant_001',
      authorizedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    await x
      .post('/occurrence-authorization', {
        accountId: x.accountId,
        expectedVersion: prepared.body.version,
        authorization: { ...authorization, operationId: 'other_operation' },
      })
      .expect(409);
    await x
      .post('/occurrence-authorization', {
        accountId: x.accountId,
        expectedVersion: prepared.body.version,
        authorization: {
          ...authorization,
          expiresAt: authorization.authorizedAt,
        },
      })
      .expect(409);
    const grant = await x
      .post('/occurrence-authorization', {
        accountId: x.accountId,
        expectedVersion: prepared.body.version,
        authorization,
      })
      .expect(201);
    expect(grant.body.authorization.actor).toBe(x.identity.id);
    expect(x.f.posts).toEqual([]);
    await x
      .post('', {
        accountId: x.accountId,
        expectedVersion: prepared.body.version,
        authorization: {
          ...grant.body.authorization,
          actor: 'another_reviewer',
        },
      })
      .expect(403);
    expect(x.f.posts).toEqual([]);
    const published = await x
      .post('', {
        accountId: x.accountId,
        expectedVersion: prepared.body.version,
        authorization: grant.body.authorization,
      })
      .expect(201);
    expect(published.body.receipt.mediaId).toBe('987654321');
    expect(x.f.posts).toEqual(['create', 'upload', 'publish']);
  } finally {
    await x.cleanup();
  }
});
