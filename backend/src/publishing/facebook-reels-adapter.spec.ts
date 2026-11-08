import { FacebookReelsAdapter } from './infrastructure/facebook-reels.adapter.js';

test('official Facebook flow uses returned upload URL, binary bytes and a remote publication receipt', async () => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: any, init: any) => {
    const url = new URL(input);
    calls.push({ url, init });
    const body =
      typeof init.body === 'string' ? new URLSearchParams(init.body) : null;
    const value = url.pathname.endsWith('/me')
      ? { id: '1355505384315575' }
      : url.pathname.endsWith('/debug_token')
        ? {
            data: {
              is_valid: true,
              type: 'PAGE',
              scopes: ['pages_manage_posts'],
            },
          }
        : url.hostname === 'rupload.facebook.com'
          ? { success: true }
          : body?.get('upload_phase') === 'start'
            ? {
                video_id: '987654321',
                upload_url:
                  'https://rupload.facebook.com/video-upload/v25.0/987654321',
              }
            : body?.get('upload_phase') === 'finish'
              ? { success: true }
              : {
                  id: '987654321',
                  created_time: '2026-11-08T12:00:00Z',
                  permalink_url: '/reel/987654321/',
                  status: {
                    video_status: 'ready',
                    uploading_phase: { status: 'complete' },
                    processing_phase: { status: 'complete' },
                    publishing_phase: { status: 'complete' },
                  },
                };
    return new Response(JSON.stringify(value));
  });
  const a = new FacebookReelsAdapter({
    pageId: '1355505384315575',
    apiVersion: 'v25.0',
    mode: 'fake',
    getAccessToken: () => 'fixture_page_token',
    getAppAccessToken: () => 'fixture_app_token',
    fetch,
  });
  await a.verifyConnection();
  const session = await a.createResumableContainer({
    accountId: a.accountId,
    caption: 'Autorizado',
  });
  expect(session.containerId).toBe('987654321');
  await a.uploadResumableBytes(session.uploadUri, Buffer.from('fixture MP4'));
  expect(
    await a.getContainerStatus({ containerId: session.containerId }),
  ).toEqual({ status: 'PUBLISHED' });
  await a.publish({
    accountId: a.accountId,
    containerId: session.containerId,
    caption: 'Autorizado',
  });
  expect(await a.getMedia({ mediaId: session.containerId })).toMatchObject({
    mediaId: '987654321',
    permalink: 'https://www.facebook.com/reel/987654321/',
  });
  expect(
    calls.find((c) => c.url.hostname === 'rupload.facebook.com')?.init.headers,
  ).toMatchObject({ offset: '0', file_size: '11' });
  expect(calls.every((c) => c.init.redirect === 'error')).toBe(true);
  expect(JSON.stringify(a)).not.toContain('fixture_page_token');
});

test.each(['token', 'permission', 'account', 'upload-url', 'timeout'] as const)(
  'Facebook rejects %s without leaking provider secrets',
  async (mode) => {
    const secret = 'PRIVATE_FIXTURE_SECRET';
    let posts = 0;
    const fetch = vi.fn(async (input: any, init: any) => {
      if (init.method === 'POST') posts++;
      if (mode === 'timeout') throw Error(secret);
      const u = new URL(input);
      if (mode === 'token')
        return new Response(
          JSON.stringify({ error: { code: 190, message: secret } }),
          { status: 401 },
        );
      if (u.pathname.endsWith('/me'))
        return new Response(
          JSON.stringify({
            id: mode === 'account' ? '999999999' : '1355505384315575',
          }),
        );
      if (u.pathname.endsWith('/debug_token'))
        return new Response(
          JSON.stringify({
            data: {
              is_valid: true,
              type: 'PAGE',
              scopes: mode === 'permission' ? [] : ['pages_manage_posts'],
            },
          }),
        );
      return new Response(
        JSON.stringify({
          video_id: '987654321',
          upload_url: 'https://private.invalid/upload',
        }),
      );
    });
    const a = new FacebookReelsAdapter({
      pageId: '1355505384315575',
      apiVersion: 'v25.0',
      mode: 'fake',
      getAccessToken: () => secret,
      getAppAccessToken: () => secret,
      fetch,
    });
    let error: any;
    try {
      await a.verifyConnection();
      await a.createResumableContainer({
        accountId: a.accountId,
        caption: 'Fixture',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeTruthy();
    expect(String(error)).not.toContain(secret);
    expect(posts).toBeLessThanOrEqual(1);
  },
);
