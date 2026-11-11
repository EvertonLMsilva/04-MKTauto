import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { SocialPublicationRepository } from './infrastructure/social-publication.repository.js';
import { SocialPublicationService } from './application/social-publication.service.js';
import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PublishingModule } from './publishing.module.js';
import { INSTAGRAM_PUBLICATION_PORTS } from './application/ports/instagram-publication.port.js';
import { PublishingService } from './application/publishing.service.js';
import { MediaService } from '../media/application/media.service.js';
import { LocalFlowService } from '../media/application/local-flow.service.js';
import { InstagramConnectionService } from './application/instagram-connection.service.js';
import { InstagramGraphAdapter } from './infrastructure/instagram-graph.adapter.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ig-direct-'));
  const db = new DatabaseSync(join(root, 'test.sqlite'));
  provisionSchema(db);
  db.exec('PRAGMA user_version=41'); // Isolate state transitions from campaign fixture setup.
  const mediaHash = createHash('sha256').update('video').digest('hex');
  const pkg = {
    platform: 'instagram',
    account: '123456789',
    caption: 'Produto autorizado',
    cta: 'Veja os detalhes.',
    disclosure: 'Publicidade.',
    link: 'https://example.test/produto',
    identity: { videoRenderContentHash: mediaHash },
    mediaReference: `render:sha256_${mediaHash}`,
  };
  const manual = {
    repository: { db },
    validateForPublication: () => pkg,
    listPublications: () => [],
  };
  const calls: string[] = [];
  let uploadFails = false;
  let status = 'FINISHED';
  let revoked = false;
  manual.validateForPublication = () => {
    if (revoked)
      throw Object.assign(new Error('SOCIAL_APPROVAL_REVOKED'), {
        code: 'SOCIAL_APPROVAL_REVOKED',
      });
    return pkg;
  };
  const publisher = {
    mode: 'fake',
    accountId: '123456789',
    createContainer: async () => {
      calls.push('url');
      return { containerId: '345678901' };
    },
    createResumableContainer: async () => {
      calls.push('create');
      return {
        containerId: '234567890',
        uploadUri: 'https://rupload.facebook.com/ig-api-upload/v25.0/234567890',
      };
    },
    uploadResumableBytes: async () => {
      calls.push('upload');
      if (uploadFails) throw Error('timeout');
      return { uploaded: true };
    },
    getContainerStatus: async () => ({ status }),
    publish: async () => {
      calls.push('publish');
      return { mediaId: '987654321' };
    },
    getMedia: async () => ({
      mediaId: '987654321',
      permalink: 'https://www.instagram.com/reel/fixture/',
      publishedAt: '2026-11-06T12:00:00Z',
    }),
  };
  const repository = new SocialPublicationRepository({ db });
  const service = new SocialPublicationService({
    repository,
    manual,
    publisher,
    media: {
      inspect: async () => ({
        contentHash: mediaHash,
        result: 'PASS',
        policyVersion: 'instagram-reels-profile/1.0.0',
      }),
    },
    now: () => '2026-11-06T12:00:00Z',
  });
  return {
    root,
    db,
    repository,
    service,
    calls,
    mediaHash,
    failUpload: () => {
      uploadFails = true;
    },
    setStatus: (value: string) => {
      status = value;
    },
    revoke: () => {
      revoked = true;
    },
    close: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('resumable session, upload, processing, publication and receipt survive replay', async () => {
  const f = fixture();
  try {
    const op = await f.service.prepare(
      { packageHash: 'a'.repeat(64), accountId: '123456789' },
      'direct',
      'local',
    );
    expect(op.publicationFlowVersion).toBe(2);
    const session = await f.service.createContainer(op.operationId);
    expect(session.uploadStage).toBe('PENDING');
    expect(f.repository.get(op.operationId).uploadUri).toContain(
      session.containerId,
    );
    await expect(
      f.service.upload(op.operationId, Buffer.from('wrong')),
    ).rejects.toMatchObject({ code: 'SOCIAL_MEDIA_INCOMPATIBLE' });
    expect(f.calls).toEqual(['create']);
    const uploaded = await f.service.upload(
      op.operationId,
      Buffer.from('video'),
    );
    expect(uploaded.state).toBe('PROCESSING');
    expect(uploaded.uploadStage).toBe('ACKNOWLEDGED');
    expect((await f.service.process(op.operationId)).state).toBe('READY');
    expect((await f.service.publish(op.operationId)).state).toBe('PUBLISHED');
    expect(
      (await f.service.receipt(op.operationId)).remoteReceipt.mediaId,
    ).toBe('987654321');
    const reopened = new SocialPublicationRepository({ db: f.db });
    expect(reopened.get(op.operationId).uploadUri).toBe(session.uploadUri);
    expect(
      (
        await f.service.prepare(
          { packageHash: 'a'.repeat(64), accountId: '123456789' },
          'direct',
          'local',
        )
      ).operationId,
    ).toBe(op.operationId);
    expect((await f.service.createContainer(op.operationId)).state).toBe(
      'PUBLISHED',
    );
    expect((await f.service.publish(op.operationId)).state).toBe('PUBLISHED');
    expect(f.calls).toEqual(['create', 'upload', 'publish']);
  } finally {
    f.close();
  }
});

test('uncertain upload never repeats POST and remote status alone does not publish', async () => {
  const f = fixture();
  try {
    const op = await f.service.prepare(
      { packageHash: 'b'.repeat(64), accountId: '123456789' },
      'uncertain',
      'local',
    );
    await f.service.createContainer(op.operationId);
    f.failUpload();
    const uncertain = await f.service.upload(
      op.operationId,
      Buffer.from('video'),
    );
    expect(uncertain.state).toBe('UNCERTAIN');
    expect(uncertain.uncertainStage).toBe('UPLOAD');
    await expect(
      f.service.upload(op.operationId, Buffer.from('video')),
    ).rejects.toMatchObject({ code: 'SOCIAL_MEDIA_INCOMPATIBLE' });
    f.setStatus('IN_PROGRESS');
    expect((await f.service.reconcile(op.operationId)).state).toBe('UNCERTAIN');
    f.setStatus('FINISHED');
    expect((await f.service.reconcile(op.operationId)).state).toBe('READY');
    expect(f.calls).toEqual(['create', 'upload']);
    expect((await f.service.publish(op.operationId)).state).toBe('PUBLISHED');
  } finally {
    f.close();
  }
});

test('pending processing and unexplained remote PUBLISHED cannot claim publication', async () => {
  const f = fixture();
  try {
    const op = await f.service.prepare(
      { packageHash: 'd'.repeat(64), accountId: '123456789' },
      'pending',
      'local',
    );
    await f.service.createContainer(op.operationId);
    f.setStatus('FINISHED');
    expect((await f.service.process(op.operationId)).state).toBe('PROCESSING');
    await f.service.upload(op.operationId, Buffer.from('video'));
    f.setStatus('IN_PROGRESS');
    expect((await f.service.process(op.operationId)).state).toBe('PROCESSING');
    f.setStatus('PUBLISHED');
    const unexplained = await f.service.process(op.operationId);
    expect(unexplained.state).toBe('PROCESSING');
    expect(unexplained.requiresReconciliation).toBe(true);
    expect(f.calls).toEqual(['create', 'upload']);
  } finally {
    f.close();
  }
});

test('revoked approval prevents publishing after confirmed upload', async () => {
  const f = fixture();
  try {
    const op = await f.service.prepare(
      { packageHash: 'e'.repeat(64), accountId: '123456789' },
      'revoked',
      'local',
    );
    await f.service.createContainer(op.operationId);
    await f.service.upload(op.operationId, Buffer.from('video'));
    expect((await f.service.process(op.operationId)).state).toBe('READY');
    f.revoke();
    await expect(f.service.publish(op.operationId)).rejects.toMatchObject({
      code: 'SOCIAL_APPROVAL_REVOKED',
    });
    expect(f.calls).toEqual(['create', 'upload']);
  } finally {
    f.close();
  }
});

test('historical resumable operation without flow version cannot enter publishing', async () => {
  const f = fixture();
  try {
    const old = f.repository.prepare(
      {
        packageHash: 'c'.repeat(64),
        accountId: '123456789',
        mediaHash: f.mediaHash,
        caption: 'Publicidade.',
        uploadStrategy: 'facebook-login-resumable/experimental',
      },
      'historical',
      '2026-11-06T12:00:00Z',
    );
    expect(old.publicationFlowVersion).toBeUndefined();
    await expect(f.service.publish(old.operationId)).rejects.toMatchObject({
      code: 'SOCIAL_EXECUTION_STRATEGY_MISMATCH',
    });
    expect(f.repository.get(old.operationId).state).toBe('PREPARED');
  } finally {
    f.close();
  }
});

test('invalid transition rolls back and concurrent session requests make one POST', async () => {
  const f = fixture();
  try {
    const op = await f.service.prepare(
      { packageHash: 'f'.repeat(64), accountId: '123456789' },
      'concurrent',
      'local',
    );
    expect(() =>
      f.repository.transition(
        op.operationId,
        op.version,
        ['PREPARED'],
        { state: 'PUBLISHING' },
        '2026-11-06T12:00:00Z',
      ),
    ).toThrow();
    expect(f.repository.get(op.operationId).version).toBe(0);
    await Promise.all([
      f.service.createContainer(op.operationId),
      f.service.createContainer(op.operationId),
    ]);
    expect(f.calls).toEqual(['create']);
    expect(f.repository.get(op.operationId).uploadStage).toBe('PENDING');
  } finally {
    f.close();
  }
});

test('Nest DI selects fake or explicit live adapter without transport on bootstrap', async () => {
  const provider = (
    Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PublishingModule) as any[]
  ).find((value) => value.provide === INSTAGRAM_PUBLICATION_PORTS);
  const moduleFor = () =>
    Test.createTestingModule({
      providers: [
        provider,
        { provide: PublishingService, useValue: { package: () => null } },
        { provide: MediaService, useValue: { verifyMedia: () => '' } },
        {
          provide: LocalFlowService,
          useValue: { previewBytes: async () => Buffer.alloc(0) },
        },
        {
          provide: InstagramConnectionService,
          useValue: {
            status: () => ({ missingConfiguration: [] }),
            check: async () => ({ connection: 'BLOCKED' }),
          },
        },
      ],
    }).compile();
  try {
    vi.stubEnv('INSTAGRAM_PUBLICATION_MODE', 'fake');
    vi.stubEnv('INSTAGRAM_ACCOUNT_ID', '123456789');
    vi.stubEnv('INSTAGRAM_API_VERSION', 'v25.0');
    const fake = await moduleFor();
    expect(fake.get(INSTAGRAM_PUBLICATION_PORTS).publisher.mode).toBe('fake');
    await fake.close();
    vi.stubEnv('INSTAGRAM_PUBLICATION_MODE', 'live');
    vi.stubEnv('INSTAGRAM_ACCESS_TOKEN', 'fixture_token');
    const live = await moduleFor();
    expect(live.get(INSTAGRAM_PUBLICATION_PORTS).publisher.mode).toBe('live');
    await live.close();
    vi.stubEnv('INSTAGRAM_PUBLICATION_MODE', 'unknown');
    await expect(moduleFor()).rejects.toMatchObject({
      code: 'SOCIAL_CONFIG_INVALID',
    });
  } finally {
    vi.unstubAllEnvs();
  }
});

test('Nest DI executes SQLite publication through simulated Graph HTTP', async () => {
  const f = fixture();
  const requests: string[] = [];
  const adapter = new InstagramGraphAdapter({
    mode: 'fake',
    accountId: '123456789',
    apiVersion: 'v25.0',
    getAccessToken: () => 'fixture_token',
    fetch: async (input, init) => {
      const url =
        input instanceof URL
          ? input
          : input instanceof Request
            ? new URL(input.url)
            : new URL(input);
      requests.push(`${init?.method}:${url.pathname}`);
      if (url.hostname === 'rupload.facebook.com')
        return new Response(JSON.stringify({ success: true }));
      if (url.pathname.endsWith('/media'))
        return new Response(
          JSON.stringify({
            id: '234567890',
            uri: 'https://rupload.facebook.com/ig-api-upload/v25.0/234567890',
          }),
        );
      if (url.pathname.endsWith('/media_publish'))
        return new Response(JSON.stringify({ id: '987654321' }));
      if (url.searchParams.get('fields') === 'status_code')
        return new Response(JSON.stringify({ status_code: 'FINISHED' }));
      return new Response(
        JSON.stringify({
          id: '987654321',
          permalink: 'https://www.instagram.com/reel/fixture/',
          timestamp: '2026-11-06T12:00:00Z',
        }),
      );
    },
  });
  const module = await Test.createTestingModule({
    providers: [
      { provide: InstagramGraphAdapter, useValue: adapter },
      { provide: SocialPublicationRepository, useValue: f.repository },
      {
        provide: SocialPublicationService,
        inject: [SocialPublicationRepository, InstagramGraphAdapter],
        useFactory: (
          repository: SocialPublicationRepository,
          publisher: InstagramGraphAdapter,
        ) =>
          new SocialPublicationService({
            repository,
            manual: {
              repository: { db: f.db },
              validateForPublication: () => ({
                platform: 'instagram',
                account: '123456789',
                caption: 'Produto autorizado',
                cta: 'Veja os detalhes.',
                disclosure: 'Publicidade.',
                link: 'https://example.test/produto',
                identity: { videoRenderContentHash: f.mediaHash },
                mediaReference: `render:sha256_${f.mediaHash}`,
              }),
              listPublications: () => [],
            },
            publisher,
            media: {
              inspect: async () => ({
                contentHash: f.mediaHash,
                result: 'PASS',
                policyVersion: 'instagram-reels-profile/1.0.0',
              }),
            },
            now: () => '2026-11-06T12:00:00Z',
          }),
      },
    ],
  }).compile();
  try {
    const service = module.get(SocialPublicationService);
    const op = await service.prepare(
      { packageHash: '1'.repeat(64), accountId: '123456789' },
      'di-direct',
      'local',
    );
    await service.createContainer(op.operationId);
    await service.upload(op.operationId, Buffer.from('video'));
    expect((await service.process(op.operationId)).state).toBe('READY');
    expect((await service.publish(op.operationId)).state).toBe('PUBLISHED');
    expect((await service.receipt(op.operationId)).remoteReceipt.mediaId).toBe(
      '987654321',
    );
    expect(requests).toEqual([
      'POST:/v25.0/123456789/media',
      'POST:/ig-api-upload/v25.0/234567890',
      'GET:/v25.0/234567890',
      'POST:/v25.0/123456789/media_publish',
      'GET:/v25.0/987654321',
    ]);
  } finally {
    await module.close();
    f.close();
  }
});
