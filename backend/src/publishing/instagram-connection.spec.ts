import { InstagramConnectionService } from './application/instagram-connection.service.js';

const env = {
  INSTAGRAM_ACCOUNT_ID: '123456789',
  INSTAGRAM_API_VERSION: 'v26.0',
  INSTAGRAM_FACEBOOK_PAGE_ID: '234567890',
  INSTAGRAM_META_APP_ID: '345678901',
  INSTAGRAM_ACCESS_TOKEN: 'PRIVATE_PAGE_TOKEN',
  INSTAGRAM_APP_ACCESS_TOKEN: 'PRIVATE_APP_TOKEN',
};
const now = () => '2026-10-18T12:00:00.000Z';
const required = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_read_engagement',
];
const token = () => ({
  data: {
    is_valid: true,
    app_id: env.INSTAGRAM_META_APP_ID,
    type: 'PAGE',
    expires_at: 1800000000,
    data_access_expires_at: 1800000000,
    scopes: required,
  },
});
function fixture(
  replies: unknown[] = [
    token(),
    {
      id: env.INSTAGRAM_FACEBOOK_PAGE_ID,
      instagram_business_account: { id: env.INSTAGRAM_ACCOUNT_ID },
    },
    { id: env.INSTAGRAM_ACCOUNT_ID },
  ],
) {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify(replies.shift())),
  );
  return {
    service: new InstagramConnectionService(env, fetch as any, now),
    fetch,
  };
}
test('configuration never probes Meta or exposes secrets; missing scopes remain unknown until checked', () => {
  const { service, fetch } = fixture();
  expect(service.status()).toMatchObject({
    connection: 'NOT_CHECKED',
    missingPermissions: null,
    livePublication: { eligible: false },
  });
  expect(JSON.stringify(service)).not.toContain('PRIVATE_');
  expect(JSON.stringify(service.status())).not.toContain('PRIVATE_');
  expect(fetch).not.toHaveBeenCalled();
});
test('official read-only probes verify app, token, permissions, Page linkage and professional account without enabling LIVE', async () => {
  const { service, fetch } = fixture();
  const result = await service.check();
  expect(result).toMatchObject({
    connection: 'READY',
    missingPermissions: [],
    token: { status: 'VALID' },
    livePublication: { eligible: false },
  });
  const calls = fetch.mock.calls as unknown as [URL, RequestInit][];
  expect(calls).toHaveLength(3);
  expect(calls.map(([url]) => url.pathname)).toEqual([
    '/v26.0/debug_token',
    '/v26.0/me',
    '/v26.0/123456789',
  ]);
  expect(
    calls.every(
      ([url, init]) =>
        url.origin === 'https://graph.facebook.com' &&
        init.method === 'GET' &&
        init.redirect === 'error',
    ),
  ).toBe(true);
  expect(calls[0][0].searchParams.get('input_token')).toBe(
    env.INSTAGRAM_ACCESS_TOKEN,
  );
  expect(calls[0][1].headers).toEqual({
    Authorization: 'Bearer PRIVATE_APP_TOKEN',
  });
  expect(calls[1][1].headers).toEqual({
    Authorization: 'Bearer PRIVATE_PAGE_TOKEN',
  });
  expect(calls[2][0].searchParams.get('fields')).toBe('id');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  // A successful previous check is not cached as current authorization.
  expect(service.status().connection).toBe('NOT_CHECKED');
});
test('reports precisely missing scopes and stops before probing account', async () => {
  const reply = token();
  reply.data.scopes = ['instagram_basic'];
  const { service, fetch } = fixture([reply]);
  expect(await service.check()).toMatchObject({
    connection: 'BLOCKED',
    missingPermissions: ['instagram_content_publish', 'pages_read_engagement'],
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('permissions granted for another destination remain missing for the configured account', async () => {
  const reply = token();
  Object.assign(reply.data, {
    granular_scopes: [
      { scope: 'instagram_content_publish', target_ids: ['999999999'] },
    ],
  });
  const { service } = fixture([reply]);
  expect(await service.check()).toMatchObject({
    connection: 'BLOCKED',
    missingPermissions: ['instagram_content_publish'],
    blockers: ['TOKEN_TARGET_MISMATCH'],
  });
});
test.each([
  [{ is_valid: false }, 'TOKEN_INVALID'],
  [{ app_id: '999999999' }, 'TOKEN_APP_MISMATCH'],
  [{ type: 'USER' }, 'PAGE_TOKEN_REQUIRED'],
  [{ expires_at: 1 }, 'TOKEN_EXPIRED'],
  [{ expires_at: -1 }, 'TOKEN_RESPONSE_INVALID'],
  [{ data_access_expires_at: 1 }, 'TOKEN_EXPIRED'],
  [{ scopes: null }, 'TOKEN_RESPONSE_INVALID'],
  [
    {
      granular_scopes: [
        { scope: 'instagram_content_publish', target_ids: ['999999999'] },
      ],
    },
    'TOKEN_TARGET_MISMATCH',
  ],
])('fails closed on invalid or mismatched token %j', async (patch, code) => {
  const reply = token();
  Object.assign(reply.data, patch);
  const { service, fetch } = fixture([reply]);
  const result = await service.check();
  expect(result.connection).toBe('BLOCKED');
  expect(result.blockers).toContain(code);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test.each([
  [{ id: '999999999' }, 'PAGE_TOKEN_MISMATCH'],
  [
    { id: env.INSTAGRAM_FACEBOOK_PAGE_ID },
    'PROFESSIONAL_ACCOUNT_LINK_REQUIRED',
  ],
  [
    {
      id: env.INSTAGRAM_FACEBOOK_PAGE_ID,
      instagram_business_account: { id: '999999999' },
    },
    'INSTAGRAM_ACCOUNT_MISMATCH',
  ],
])('rejects mismatched Page linkage %j', async (page, code) => {
  expect((await fixture([token(), page]).service.check()).blockers).toContain(
    code,
  );
});
test('professional status comes from the verified Page edge; account lookup must match', async () => {
  const page = {
    id: env.INSTAGRAM_FACEBOOK_PAGE_ID,
    instagram_business_account: { id: env.INSTAGRAM_ACCOUNT_ID },
  };
  expect(
    (await fixture([token(), page, { id: '999999999' }]).service.check())
      .blockers,
  ).toContain('INSTAGRAM_ACCOUNT_MISMATCH');
  expect(
    (
      await fixture([
        token(),
        page,
        { id: env.INSTAGRAM_ACCOUNT_ID },
      ]).service.check()
    ).professionalAccount,
  ).toBe(true);
});
test.each([
  [401, 190, 'APP_AUTH_REQUIRED'],
  [403, 10, 'META_PERMISSION_REQUIRED'],
  [429, 4, 'META_RATE_LIMIT'],
  [503, 2, 'META_UNAVAILABLE'],
])(
  'sanitizes Meta errors %s without inventing missing scopes',
  async (status, code, expected) => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code, message: 'PRIVATE_PAGE_TOKEN' } }),
          { status },
        ),
    );
    const result = await new InstagramConnectionService(
      env,
      fetch as any,
      now,
    ).check();
    expect(result.blockers).toContain(expected);
    expect(result.missingPermissions).toBeNull();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
test('transport exceptions and invalid JSON are sanitized without retries', async () => {
  for (const fetch of [
    vi.fn(async () => {
      throw new Error('PRIVATE_PAGE_TOKEN');
    }),
    vi.fn(async () => new Response('PRIVATE_PAGE_TOKEN')),
  ]) {
    const result = await new InstagramConnectionService(
      env,
      fetch as any,
      now,
    ).check();
    expect(result.connection).toBe('UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
test('missing or unsafe configuration never sends credentials to Meta', async () => {
  for (const values of [
    {},
    { ...env, INSTAGRAM_ACCOUNT_ID: '../media' },
    { ...env, INSTAGRAM_ACCESS_TOKEN: 'bad\nsecret' },
  ]) {
    const fetch = vi.fn();
    expect(
      (await new InstagramConnectionService(values, fetch as any, now).check())
        .connection,
    ).toBe('NOT_CONFIGURED');
    expect(fetch).not.toHaveBeenCalled();
  }
});
