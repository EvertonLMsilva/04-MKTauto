import { InstagramGraphAdapter } from './infrastructure/instagram-graph.adapter.js';

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
});
