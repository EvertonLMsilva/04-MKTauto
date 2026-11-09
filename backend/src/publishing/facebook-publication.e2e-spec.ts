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

async function supersessionHttpFixture() {
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
    provisionSchema(f.f.base.db, 44);
    f.approve(f.facebookPackage);
    f.campaigns.ownedEvent(
      f.execution.execution_id,
      f.execution.claim_token!,
      f.at,
      'WORKFLOW_FINISHED',
      {},
      'SUCCEEDED',
    );
    const store = f.store.openDestination('fake');
    let original: any;
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
    const accountId = '1355505384315575';
    const input = {
      originalOperationId: original.operationId,
      revision: 1,
      expectedVersion: original.version,
      decisionId: 'http_preparation_001',
      reason: 'Explicit replacement with residual risk accepted',
      remoteObservation: await f.ports.publisher.inspectUploadSession!(
        original.containerId,
      ),
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
