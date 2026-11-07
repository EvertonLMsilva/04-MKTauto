import { InstagramGraphAdapter } from './infrastructure/instagram-graph.adapter.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('official Instagram Graph transport (injected HTTP only)', () => {
  const requests: any[] = [];
  const response = (
    body: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) => new Response(JSON.stringify(body), { status, headers });
  const make = (reply = response({ id: '234567890' })) =>
    new InstagramGraphAdapter({
      accountId: '123456789',
      apiVersion: 'v25.0',
      getAccessToken: () => 'PRIVATE_TOKEN',
      fetch: async (url, init) => {
        requests.push({
          url: url instanceof Request ? url.url : url.toString(),
          ...init,
        });
        return reply.clone();
      },
      mode: 'fake',
    });
  beforeEach(() => (requests.length = 0));
  it('uses official endpoints, bearer auth, form body, no secret URL, and returns receipts', async () => {
    const a = make();
    expect(
      await a.createContainer({
        accountId: a.accountId,
        caption: 'approved',
        videoUrl: 'https://media.example/video.mp4',
      }),
    ).toEqual({ containerId: '234567890' });
    expect(
      await a.publish({ accountId: a.accountId, containerId: '234567890' }),
    ).toEqual({ mediaId: '234567890' });
    expect(requests.map((r) => r.url)).toEqual([
      'https://graph.facebook.com/v25.0/123456789/media',
      'https://graph.facebook.com/v25.0/123456789/media_publish',
    ]);
    expect(requests[0].headers.Authorization).toBe('Bearer PRIVATE_TOKEN');
    expect(new URLSearchParams(requests[0].body).get('media_type')).toBe(
      'REELS',
    );
    expect(requests.every((r) => r.redirect === 'error')).toBe(true);
    expect(JSON.stringify(a)).not.toContain('PRIVATE_TOKEN');
  });
  it.each([
    [190, 401, 'SOCIAL_AUTH_REQUIRED'],
    [4, 429, 'SOCIAL_RATE_LIMIT'],
    [10, 403, 'SOCIAL_PERMISSION_REQUIRED'],
  ])(
    'classifies %s without leaking response bodies',
    async (code, status, expected) => {
      const a = make(
        response({ error: { code, message: 'PRIVATE_TOKEN' } }, status, {
          'Retry-After': '60',
        }),
      );
      await expect(
        a.publish({ accountId: a.accountId, containerId: '234567890' }),
      ).rejects.toMatchObject({ code: expected });
      expect(requests).toHaveLength(1);
    },
  );
  it('status and remote receipt are read-only and validated', async () => {
    expect(
      await make(response({ status_code: 'FINISHED' })).getContainerStatus({
        containerId: '234567890',
      }),
    ).toEqual({ status: 'FINISHED' });
    expect(
      await make(
        response({
          id: '987654321',
          permalink: 'https://www.instagram.com/reel/example/',
          timestamp: '2026-10-15T12:00:00+0000',
        }),
      ).getMedia({ mediaId: '987654321' }),
    ).toMatchObject({ mediaId: '987654321' });
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });
  it('does not retry timeout, bad JSON or invalid receipts', async () => {
    let calls = 0;
    const a = new InstagramGraphAdapter({
      mode: 'fake',
      accountId: '123456789',
      apiVersion: 'v25.0',
      getAccessToken: () => 'secret',
      fetch: async () => {
        calls++;
        throw new Error('PRIVATE_TOKEN');
      },
    });
    await expect(
      a.createContainer({
        accountId: a.accountId,
        caption: 'ok',
        videoUrl: 'https://media.example/video.mp4',
      }),
    ).rejects.toMatchObject({ code: 'SOCIAL_NETWORK_UNCERTAIN' });
    expect(calls).toBe(1);
    await expect(
      make(response({ id: 'bad' })).publish({
        accountId: a.accountId,
        containerId: '234567890',
      }),
    ).rejects.toMatchObject({ code: 'SOCIAL_RECEIPT_INVALID' });
  });
  it('blocks live POST by default and validates config before HTTP', async () => {
    const a = new InstagramGraphAdapter({
      mode: 'live',
      accountId: '123456789',
      apiVersion: 'v25.0',
      getAccessToken: () => 'secret',
      fetch: async () => {
        throw new Error('unexpected');
      },
    });
    await expect(
      a.publish({ accountId: a.accountId, containerId: '234567890' }),
    ).rejects.toMatchObject({ code: 'SOCIAL_LIVE_POST_BLOCKED' });
    expect(
      () =>
        new InstagramGraphAdapter({
          mode: 'fake',
          accountId: '01',
          apiVersion: 'bad',
          getAccessToken: () => '',
          fetch: async () => response({}),
        }),
    ).toThrow();
  });
  it('creates a resumable session and uploads exact local bytes with simulated transport', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const a = new InstagramGraphAdapter({
      mode: 'fake', accountId: '123456789', apiVersion: 'v25.0',
      getAccessToken: () => 'PRIVATE_TOKEN',
      fetch: async (url, init) => {
        calls.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, init: init! });
        return response(calls.length === 1
          ? { id: '234567890', uri: 'https://rupload.facebook.com/ig-api-upload/234567890' }
          : calls.length === 2 ? { success: true } : { status_code: 'FINISHED' });
      },
    });
    const session = await a.createResumableContainer({ accountId: a.accountId, caption: 'Publicidade. Produto.' });
    expect(session.containerId).toBe('234567890');
    expect(new URLSearchParams(calls[0].init.body as string).get('upload_type')).toBe('resumable');
    await a.uploadResumableBytes(session.uploadUri, Buffer.from('fixture'));
    expect(calls[1].url).toBe(session.uploadUri);
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'OAuth PRIVATE_TOKEN', offset: '0', file_size: '7' });
    expect(Buffer.from(calls[1].init.body as Uint8Array)).toEqual(Buffer.from('fixture'));
    expect((await a.getContainerStatus({ containerId: session.containerId })).status).toBe('FINISHED');
  });
  it('rejects an untrusted upload URI and never retries an uncertain upload', async () => {
    let calls = 0;
    const a = new InstagramGraphAdapter({ mode: 'fake', accountId: '123456789', apiVersion: 'v25.0',
      getAccessToken: () => 'PRIVATE_TOKEN', fetch: async () => { calls++; throw Error('network'); } });
    await expect(a.uploadResumableBytes('https://example.test/upload', Buffer.from('x'))).rejects.toThrow('SOCIAL_TRANSFER_INVALID');
    expect(calls).toBe(0);
    await expect(a.uploadResumableBytes('https://rupload.facebook.com/ig-api-upload/234567890', Buffer.from('x'))).rejects.toThrow('SOCIAL_NETWORK_UNCERTAIN');
    expect(calls).toBe(1);
  });
  it('checks local file bytes against the exact render hash before transport', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ig-upload-'));
    const path = join(root, 'render.mp4');
    writeFileSync(path, 'fixture');
    let calls = 0;
    const a = new InstagramGraphAdapter({ mode: 'fake', accountId: '123456789', apiVersion: 'v25.0',
      getAccessToken: () => 'PRIVATE_TOKEN', fetch: async () => { calls++; return response({ success: true }); } });
    const uri = 'https://rupload.facebook.com/ig-api-upload/234567890';
    try {
      await expect(a.uploadResumableFile(uri, path, 'a'.repeat(64))).rejects.toThrow('SOCIAL_MEDIA_INCOMPATIBLE');
      expect(calls).toBe(0);
      await a.uploadResumableFile(uri, path, createHash('sha256').update('fixture').digest('hex'));
      expect(calls).toBe(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
