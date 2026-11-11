import { createHash } from 'node:crypto';
import { ShopeeAffiliateLive } from './shopee-affiliate-live.js';
import {
  FakeShopeeAffiliate,
  shopeeAffiliateProvider,
} from './shopee-affiliate.provider.js';
import {
  buildShopeeLinkMutation,
  normalizeShopeeLink,
} from './shopee-links.js';

const input = () => ({
  offerId: 'offer-9007199254740993',
  originUrl:
    'https://shopee.com.br/product/123/9007199254740993?sp_atk=fixture',
  subIds: ['campaign_1', 'video-2'],
});
const response = () => ({
  data: {
    generateShortLink: { shortLink: 'https://s.shopee.com.br/fixture123' },
  },
});
const credentials = { appId: '123456', secret: 'synthetic-secret-only' };
const setup = (
  respond: () => Promise<Response> = async () =>
    new Response(JSON.stringify(response())),
) => {
  const fetch = vi.fn(respond);
  return {
    fetch,
    live: new ShopeeAffiliateLive(credentials, {
      fetch,
      now: () => 1700000000123,
    }),
  };
};

describe('Shopee link generation (offline only)', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw Error('REAL_NETWORK_FORBIDDEN');
      }),
    ),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses a fixed mutation and JSON variables, preserving the origin and textual local ID', () => {
    const built = buildShopeeLinkMutation(input());
    expect(built.query).toBe(
      'mutation AffiliateShortLink($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }',
    );
    expect(built.variables).toEqual({
      input: {
        originUrl: input().originUrl,
        subIds: ['campaign_1', 'video-2'],
      },
    });
    expect(built.query).not.toContain(input().originUrl);
    expect(built.variables.input).not.toHaveProperty('offerId');
    const link = normalizeShopeeLink(
      response(),
      input(),
      '2026-10-16T00:00:00.000Z',
    );
    expect(link).toEqual({
      offerId: input().offerId,
      originUrl: input().originUrl,
      subIds: input().subIds,
      url: 'https://s.shopee.com.br/fixture123',
      associationVerified: false,
      provenance: {
        source: 'SHOPEE_LIVE',
        fixtureVersion: null,
        observedAt: '2026-10-16T00:00:00.000Z',
      },
    });
    expect(link).not.toHaveProperty('mediaRightsEvidence');
    expect(link).not.toHaveProperty('approved');
    expect(link).not.toHaveProperty('revenue');
  });

  it.each([
    'https://shopee.com.br/product/1/2',
    'https://s.shopee.com.br/fixture123',
  ])(
    'accepts the local exact-host URL policy without resolving redirects: %s',
    (originUrl) => {
      expect(
        buildShopeeLinkMutation({ ...input(), originUrl }).variables.input
          .originUrl,
      ).toBe(originUrl);
    },
  );

  it.each([
    'http://shopee.com.br/product/1/2',
    'javascript:alert(1)',
    'not a url',
    'https://shopee.com.br.evil.invalid/a',
    'https://evilshopee.com.br/a',
    'https://evil.invalid/a',
    'https://user:pass@shopee.com.br/a',
    'https://shopee.com.br:444/a',
    'https://shopee.com.br./a',
    'https://shopee.com.br/a#private',
    ' https://shopee.com.br/a',
    'https://shopee.com.br\\@evil.invalid/a',
    'https://shopee.com.br/a\n',
    'https://shopee.com.br/?token=synthetic-private',
    'https://shopee.com.br/?redirect=https%3A%2F%2Fevil.invalid',
    'https://shopee.com.br/',
  ])('rejects unsafe origins without echoing them', (originUrl) => {
    expect(() => buildShopeeLinkMutation({ ...input(), originUrl })).toThrow(
      /^SHOPEE_LINK_INPUT_INVALID$/,
    );
  });

  it.each([
    null,
    'tracking',
    [null],
    [''],
    ['a'.repeat(51)],
    Array(6).fill('x'),
    ['private@example.invalid'],
    ['x\ny'],
    ['x" } mutation { x'],
  ])('rejects invalid SubIDs safely', (subIds) => {
    expect(() =>
      buildShopeeLinkMutation({ ...input(), subIds } as never),
    ).toThrow(/^SHOPEE_LINK_INPUT_INVALID$/);
  });

  it('preserves absence vs an explicitly empty SubID list and accepts five local bounded values', () => {
    const { subIds: _subIds, ...without } = input();
    expect(buildShopeeLinkMutation(without).variables.input).not.toHaveProperty(
      'subIds',
    );
    expect(
      normalizeShopeeLink(response(), without, '2026-10-16T00:00:00.000Z')
        .subIds,
    ).toBeNull();
    expect(
      buildShopeeLinkMutation({ ...input(), subIds: [] }).variables.input
        .subIds,
    ).toEqual([]);
    expect(
      buildShopeeLinkMutation({
        ...input(),
        subIds: Array(5).fill('x'.repeat(50)),
      }).variables.input.subIds,
    ).toHaveLength(5);
  });

  it.each([
    { query: 'mutation{}' },
    { variables: {} },
    { offerId: '' },
    { originUrl: 'https://shopee.com.br/' + 'a'.repeat(2048) },
  ])(
    'rejects arbitrary fields and out-of-bound identifiers or URLs',
    (patch) => {
      expect(() => buildShopeeLinkMutation({ ...input(), ...patch })).toThrow(
        /^SHOPEE_LINK_INPUT_INVALID$/,
      );
    },
  );

  it.each([
    {},
    { data: null },
    { data: { generateShortLink: null } },
    { data: { generateShortLink: { shortLink: '' } } },
    { data: { generateShortLink: { shortLink: 123 } } },
    {
      data: {
        generateShortLink: { shortLink: 'https://evil.invalid/private' },
      },
    },
    { ...response(), errors: [{ message: 'private' }] },
  ])('rejects empty, malformed or partial link results', (body) => {
    expect(() =>
      normalizeShopeeLink(body, input(), '2026-10-16T00:00:00.000Z'),
    ).toThrow(/^SHOPEE_LINK_RESPONSE_INVALID$/);
  });

  it('serializes once and signs the exact transmitted bytes through the existing transport', async () => {
    const reply = new Response(JSON.stringify(response()));
    const { live, fetch } = setup(async () => reply);
    const stringify = vi.spyOn(JSON, 'stringify');
    const link = await live.generateLink(input());
    expect(
      stringify.mock.calls.filter(([value]) =>
        value?.query?.includes('mutation AffiliateShortLink'),
      ),
    ).toHaveLength(1);
    const [url, options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const payload = options.body as string;
    const signature = createHash('sha256')
      .update('1234561700000001' + payload + credentials.secret, 'utf8')
      .digest('hex');
    expect(url).toBe('https://open-api.affiliate.shopee.com.br/graphql');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        Authorization: `SHA256 Credential=123456, Timestamp=1700000001, Signature=${signature}`,
      },
    });
    expect(JSON.parse(payload)).toEqual(buildShopeeLinkMutation(input()));
    expect(link.originUrl).toBe(input().originUrl);
    expect(live.metadata()).toMatchObject({
      requestCount: 1,
      operation: 'generateShortLink',
      httpStatus: 200,
      authentication: 'SUCCESS',
      offersReturned: null,
      contractFields: ['data', 'generateShortLink', 'shortLink'],
    });
    expect(JSON.stringify(live.metadata())).not.toContain(input().originUrl);
    await expect(live.generateLink(input())).rejects.toThrow(
      'SHOPEE_LIVE_ALREADY_ATTEMPTED',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects input before dispatch and rejects the old ID-only live operation', async () => {
    const { live, fetch } = setup();
    await expect(
      live.generateLink({
        ...input(),
        originUrl: 'https://evil.invalid/private',
      }),
    ).rejects.toThrow('SHOPEE_LINK_INPUT_INVALID');
    await expect(live.generateLink({ offerId: 'old-input' })).rejects.toThrow(
      'SHOPEE_LIVE_LINKS_UNAVAILABLE',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([302, 307, 401, 403, 429, 500])(
    'blocks HTTP/redirect failure %i with no retries',
    async (status) => {
      const { live, fetch } = setup(
        async () => new Response('private response', { status }),
      );
      await expect(live.generateLink(input())).rejects.toThrow(
        status < 400
          ? 'SHOPEE_LIVE_REDIRECT_BLOCKED'
          : 'SHOPEE_LIVE_HTTP_ERROR',
      );
      await expect(live.generateLink(input())).rejects.toThrow(
        'SHOPEE_LIVE_ALREADY_ATTEMPTED',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(live.metadata())).not.toContain('private response');
    },
  );

  it('discards GraphQL partial data and private messages with only sanitized codes retained', async () => {
    const { live, fetch } = setup(
      async () =>
        new Response(
          JSON.stringify({
            ...response(),
            errors: [
              {
                message: input().originUrl + credentials.secret,
                extensions: { code: 11001 },
              },
            ],
          }),
        ),
    );
    await expect(live.generateLink(input())).rejects.toThrow(
      /^SHOPEE_LIVE_GRAPHQL_ERROR$/,
    );
    expect(live.metadata().errorCodes).toEqual(['11001']);
    expect(JSON.stringify(live.metadata())).not.toContain(credentials.secret);
    expect(JSON.stringify(live.metadata())).not.toContain(input().originUrl);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never retries a timed-out mutation and blocks concurrent calls, including reads', async () => {
    vi.useFakeTimers();
    const { live, fetch } = setup(() => new Promise(() => {}));
    const first = expect(live.generateLink(input())).rejects.toThrow(
      'SHOPEE_LIVE_TIMEOUT',
    );
    await expect(live.generateLink(input())).rejects.toThrow(
      'SHOPEE_LIVE_ALREADY_ATTEMPTED',
    );
    await expect(live.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_ALREADY_ATTEMPTED',
    );
    await vi.advanceTimersByTimeAsync(10000);
    await first;
    await expect(live.generateLink(input())).rejects.toThrow(
      'SHOPEE_LIVE_ALREADY_ATTEMPTED',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the 256 KiB response limit and never exposes raw transport failures', async () => {
    const bounded = setup(async () => new Response(new Uint8Array(262145)));
    await expect(bounded.live.generateLink(input())).rejects.toThrow(
      'SHOPEE_LIVE_RESPONSE_TOO_LARGE',
    );
    const failed = setup(async () => {
      throw Error(input().originUrl + credentials.secret);
    });
    await expect(failed.live.generateLink(input())).rejects.toThrow(
      /^SHOPEE_LIVE_TRANSPORT_ERROR$/,
    );
    expect(failed.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps fake as the default and deterministic without changing existing ID-only links', async () => {
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', undefined);
    const fake = shopeeAffiliateProvider.useFactory();
    expect(fake).toBeInstanceOf(FakeShopeeAffiliate);
    const value = { ...input(), offerId: 'fake-offer-001' };
    expect(await fake.generateLink(value)).toEqual(
      await fake.generateLink(value),
    );
    expect(await fake.generateLink(value)).toMatchObject({
      originUrl: value.originUrl,
      subIds: value.subIds,
      associationVerified: false,
      provenance: { source: 'FAKE' },
    });
    expect(
      await fake.generateLink({ offerId: value.offerId }),
    ).not.toHaveProperty('originUrl');
    vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'live');
    vi.stubEnv('SHOPEE_AFFILIATE_APP_ID', 'synthetic-app');
    vi.stubEnv('SHOPEE_AFFILIATE_SECRET', 'synthetic-secret');
    expect(shopeeAffiliateProvider.useFactory()).not.toBeInstanceOf(
      FakeShopeeAffiliate,
    );
  });

  it('snapshots caller input and SubIDs before awaiting the HTTP response', async () => {
    const value = input();
    const { live } = setup(async () => {
      value.offerId = 'changed';
      value.originUrl = 'https://evil.invalid/private';
      value.subIds[0] = 'changed';
      return new Response(JSON.stringify(response()));
    });
    const link = await live.generateLink(value);
    expect(link.offerId).toBe(input().offerId);
    expect(link.originUrl).toBe(input().originUrl);
    expect(link.subIds).toEqual(input().subIds);
  });

  it('rejects a mutation-shaped input through the read entry point without dispatching', async () => {
    const { live, fetch } = setup();
    await expect(live.queryOfferPage(input() as never)).rejects.toThrow(
      'SHOPEE_OFFERS_QUERY_INVALID',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects sparse SubIDs and control characters without dispatching or resolving URLs', async () => {
    const { live, fetch } = setup();
    const sparse: string[] = [];
    sparse.length = 2;
    await expect(
      live.generateLink({ ...input(), subIds: sparse }),
    ).rejects.toThrow('SHOPEE_LINK_INPUT_INVALID');
    await expect(
      live.generateLink({
        ...input(),
        originUrl: 'https://shopee.com.br/a' + String.fromCharCode(0),
      }),
    ).rejects.toThrow('SHOPEE_LINK_INPUT_INVALID');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'not JSON',
    '{}',
    '{"data":{"generateShortLink":{"shortLink":""}}}',
  ])(
    'sanitizes malformed transport responses without retrying',
    async (body) => {
      const { live, fetch } = setup(async () => new Response(body));
      await expect(live.generateLink(input())).rejects.toThrow(
        body === 'not JSON'
          ? 'SHOPEE_LIVE_RESPONSE_INVALID'
          : 'SHOPEE_LINK_RESPONSE_INVALID',
      );
      await expect(live.generateLink(input())).rejects.toThrow(
        'SHOPEE_LIVE_ALREADY_ATTEMPTED',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
