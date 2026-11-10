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
  await a.uploadResumableBytes(
    session.uploadUri,
    Buffer.from('fixture MP4'),
    session.containerId,
  );
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

test('completed upload is eligible for FINISH before remote processing starts', async () => {
  const a = new FacebookReelsAdapter({
    pageId: '1355505384315575',
    apiVersion: 'v26.0',
    mode: 'fake',
    getAccessToken: () => 'fixture_page_token',
    getAppAccessToken: () => 'fixture_app_token',
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: '987654321',
          status: {
            video_status: 'upload_complete',
            uploading_phase: { status: 'complete', bytes_transferred: 1319892 },
            processing_phase: { status: 'not_started' },
            publishing_phase: { status: 'not_started' },
          },
        }),
      ),
  });
  expect(await a.getContainerStatus({ containerId: '987654321' })).toEqual({
    status: 'UPLOAD_COMPLETE',
  });
});

test.each([
  ['in_progress', 'not_started'],
  ['complete', 'in_progress'],
])(
  'remote processing %s or publishing %s does not authorize another FINISH',
  async (processing, publishing) => {
    const a = new FacebookReelsAdapter({
      pageId: '1355505384315575',
      apiVersion: 'v26.0',
      mode: 'fake',
      getAccessToken: () => 'fixture_page_token',
      getAppAccessToken: () => 'fixture_app_token',
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: '987654321',
            status: {
              video_status: 'processing',
              uploading_phase: { status: 'complete' },
              processing_phase: { status: processing },
              publishing_phase: { status: publishing },
            },
          }),
        ),
    });
    expect(await a.getContainerStatus({ containerId: '987654321' })).toEqual({
      status: 'IN_PROGRESS',
    });
  },
);

test.each(['v26.0', 'v27.0'])(
  'Graph v26 persists and uses the exact Meta upload endpoint %s',
  async (uploadVersion) => {
    const uri = `https://rupload.facebook.com/video-upload/${uploadVersion}/987654321`;
    const fetch = vi.fn(
      async (_url, init) =>
        new Response(
          JSON.stringify(
            init?.method === 'POST' && typeof init.body === 'string'
              ? { video_id: '987654321', upload_url: uri }
              : { success: true },
          ),
        ),
    );
    const a = new FacebookReelsAdapter({
      pageId: '1355505384315575',
      apiVersion: 'v26.0',
      mode: 'fake',
      getAccessToken: () => 'fixture',
      getAppAccessToken: () => 'fixture',
      fetch,
    });
    const s = await a.createResumableContainer({
      accountId: a.accountId,
      caption: 'fixture',
    });
    expect(s.uploadUri).toBe(uri);
    await a.uploadResumableBytes(uri, Buffer.from('fixture'), '987654321');
    expect(String(fetch.mock.calls[1][0])).toBe(uri);
  },
);

test.each([
  'https://external.invalid/video-upload/v27.0/987654321',
  'https://rupload.facebook.com/video-upload/v27.0/111111111',
  'http://rupload.facebook.com/video-upload/v27.0/987654321',
  'https://user:password@rupload.facebook.com/video-upload/v27.0/987654321',
  'https://rupload.facebook.com/video-upload/v99.0/987654321',
  'https://rupload.facebook.com/video-upload/v27.0/987654321?secret=lost',
  'https://rupload.facebook.com/video-upload/v27.0/987654321#fragment',
  'https://rupload.facebook.com:444/video-upload/v27.0/987654321',
])(
  'untrusted or mismatched upload endpoint is rejected before HTTP: %s',
  async (uri) => {
    const fetch = vi.fn();
    const a = new FacebookReelsAdapter({
      pageId: '1355505384315575',
      apiVersion: 'v26.0',
      mode: 'fake',
      getAccessToken: () => 'fixture',
      getAppAccessToken: () => 'fixture',
      fetch,
    });
    await expect(
      a.uploadResumableBytes(uri, Buffer.from('fixture'), '987654321'),
    ).rejects.toMatchObject({ code: 'SOCIAL_UPLOAD_URI_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  },
);

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
