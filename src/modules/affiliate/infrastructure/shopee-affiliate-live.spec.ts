import { createHash } from 'node:crypto';
import {
  ShopeeAffiliateLive,
  SHOPEE_OFFERS_QUERY,
  type ShopeeLiveMetadata,
} from './shopee-affiliate-live.js';

// Synthetic credentials only. The real fetch is never passed to this suite.
const credentials = { appId: '123456', secret: 'synthetic-test-secret' };
const success = () =>
  new Response(
    JSON.stringify({
      data: { productOfferV2: { nodes: [{ itemId: '9007199254740993' }] } },
    }),
  );
const setup = (response: () => Promise<Response> = async () => success()) => {
  const fetch = vi.fn(response);
  const live = new ShopeeAffiliateLive(credentials, {
    fetch,
    now: () => 1700000000123,
  });
  return { live, fetch };
};

describe('controlled Shopee read transport (offline)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('REAL_NETWORK_FORBIDDEN');
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('serializes once and signs exactly the UTF-8 JSON body sent to the fixed official endpoint', async () => {
    const { live, fetch } = setup();
    const stringify = vi.spyOn(JSON, 'stringify');
    const offers = await live.queryOffers();
    // Includes one JSON.stringify from the mock response, one from the request.
    expect(
      stringify.mock.calls.filter(
        ([value]) => value?.query === SHOPEE_OFFERS_QUERY,
      ),
    ).toHaveLength(1);
    stringify.mockRestore();
    const [url, options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://open-api.affiliate.shopee.com.br/graphql');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(options.body).toBe(
      '{"query":"query ControlledOffers { productOfferV2(page: 1, limit: 1) { nodes { itemId } } }"}',
    );
    const signature = createHash('sha256')
      .update(
        '1234561700000001' + (options.body as string) + credentials.secret,
        'utf8',
      )
      .digest('hex');
    expect(options.headers).toMatchObject({
      Authorization: `SHA256 Credential=123456, Timestamp=1700000001, Signature=${signature}`,
    });
    expect(offers[0]).toMatchObject({
      productId: '9007199254740993',
      shopId: null,
      price: { amount: null, currency: null },
      estimatedCommission: { amount: null, currency: null, rate: null },
      provenance: { source: 'SHOPEE_LIVE' },
    });
    expect(offers[0]).not.toHaveProperty('eligibilityStatus');
    expect(offers[0]).not.toHaveProperty('mediaRightsEvidence');
    expect(live.metadata()).toEqual({
      requestCount: 1,
      httpStatus: 200,
      authentication: 'SUCCESS',
      operation: 'productOfferV2',
      offersReturned: 1,
      contractFields: ['data', 'productOfferV2', 'nodes', 'itemId'],
      errorCodes: [],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(live.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_ALREADY_ATTEMPTED',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('has no link generation or implicit credential lookup', async () => {
    const { live, fetch } = setup();
    await expect(live.generateLink({ offerId: 'ignored' })).rejects.toThrow(
      'SHOPEE_LIVE_LINKS_UNAVAILABLE',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(
      () => new ShopeeAffiliateLive({ appId: '', secret: '' }, { fetch }),
    ).toThrow('SHOPEE_LIVE_CREDENTIALS_MISSING');
  });

  it.each(['HTTP_429', 'GRAPHQL_10030'])(
    'retains sanitized rate-limit metadata and consumes the sole attempt for %s',
    async (kind) => {
      const { live, fetch } = setup(async () =>
        kind === 'HTTP_429'
          ? new Response('PRIVATE_RATE_LIMIT_BODY', {
              status: 429,
              headers: { 'Retry-After': '60' },
            })
          : Response.json({
              data: { productOfferV2: { nodes: [{ itemId: '1' }] } },
              errors: [
                {
                  message: 'PRIVATE_RATE_LIMIT_BODY',
                  extensions: { code: 10030 },
                },
              ],
            }),
      );
      await expect(live.queryOfferPage({ page: 1, limit: 1 })).rejects.toThrow(
        kind === 'HTTP_429'
          ? 'SHOPEE_LIVE_HTTP_ERROR'
          : 'SHOPEE_LIVE_GRAPHQL_ERROR',
      );
      expect(live.metadata()).toMatchObject({
        requestCount: 1,
        httpStatus: kind === 'HTTP_429' ? 429 : 200,
        offersReturned: null,
        errorCodes:
          kind === 'HTTP_429' ? ['SHOPEE_LIVE_HTTP_ERROR'] : ['10030'],
      });
      expect(JSON.stringify(live.metadata())).not.toContain(
        'PRIVATE_RATE_LIMIT_BODY',
      );
      await expect(live.queryOfferPage({ page: 2, limit: 1 })).rejects.toThrow(
        'SHOPEE_LIVE_ALREADY_ATTEMPTED',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([301, 302, 307, 308])(
    'blocks redirects (%i) without a second call',
    async (status) => {
      const { live, fetch } = setup(
        async () =>
          new Response(null, {
            status,
            headers: { Location: 'https://untrusted.invalid' },
          }),
      );
      await expect(live.queryOffers()).rejects.toThrow(
        'SHOPEE_LIVE_REDIRECT_BLOCKED',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403, 429, 500])(
    'sanitizes HTTP failure %i without retries',
    async (status) => {
      const { live, fetch } = setup(
        async () => new Response('private error body', { status }),
      );
      await expect(live.queryOffers()).rejects.toThrow(
        'SHOPEE_LIVE_HTTP_ERROR',
      );
      expect(live.metadata().httpStatus).toBe(status);
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(live.queryOffers()).rejects.toThrow(
        'SHOPEE_LIVE_ALREADY_ATTEMPTED',
      );
    },
  );

  it('retains only allowlisted GraphQL error codes and never private messages or extension fields', async () => {
    const { live, fetch } = setup(
      async () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                message: credentials.secret,
                extensions: { code: 10020, private: credentials.appId },
              },
              { extensions: { code: credentials.secret } },
            ],
          }),
        ),
    );
    await expect(live.queryOffers()).rejects.toThrow(
      /^SHOPEE_LIVE_GRAPHQL_ERROR$/,
    );
    const meta: ShopeeLiveMetadata = live.metadata();
    expect(meta.authentication).toBe('FAILURE');
    expect(meta.errorCodes).toEqual(['10020', 'SHOPEE_GRAPHQL_ERROR']);
    expect(JSON.stringify(meta)).not.toContain(credentials.secret);
    meta.errorCodes.push('mutated');
    expect(live.metadata().errorCodes).not.toContain('mutated');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    'not JSON',
    '{"data":{}}',
    '{"data":{"productOfferV2":{"nodes":[{"itemId":9007199254740993}]}}}',
    '{"data":{"productOfferV2":{"nodes":[null]}}}',
    '{"data":{"productOfferV2":{"nodes":[{"itemId":"1"},{"itemId":"2"}]}}}',
  ])('fails closed for malformed or imprecise responses', async (body) => {
    const { live } = setup(async () => new Response(body));
    await expect(live.queryOffers()).rejects.toThrow(
      /^SHOPEE_LIVE_RESPONSE_INVALID$/,
    );
    expect(live.metadata().authentication).toBe('UNKNOWN');
  });

  it('accepts an empty offers page', async () => {
    const { live } = setup(
      async () => new Response('{"data":{"productOfferV2":{"nodes":[]}}}'),
    );
    expect(await live.queryOffers()).toEqual([]);
    expect(live.metadata()).toMatchObject({
      authentication: 'SUCCESS',
      offersReturned: 0,
    });
  });

  it('bounds streamed bytes even without Content-Length and cancels the response', async () => {
    const cancel = vi.fn();
    const { live } = setup(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(262145));
            },
            cancel,
          }),
        ),
    );
    await expect(live.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_RESPONSE_TOO_LARGE',
    );
    expect(cancel).toHaveBeenCalled();
  });

  it('bounds advertised response size before reading', async () => {
    const { live } = setup(
      async () =>
        new Response('private', { headers: { 'Content-Length': '262145' } }),
    );
    await expect(live.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_RESPONSE_TOO_LARGE',
    );
  });

  it('enforces a timeout even if transport stalls and consumes the sole attempt', async () => {
    vi.useFakeTimers();
    const { live, fetch } = setup(() => new Promise(() => {}));
    const result = expect(live.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_TIMEOUT',
    );
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal
        ?.aborted,
    ).toBe(true);
    await expect(live.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_ALREADY_ATTEMPTED',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sanitizes network failures without retries or error causes', async () => {
    const { live, fetch } = setup(async () => {
      throw new Error(credentials.secret);
    });
    await expect(live.queryOffers()).rejects.toThrow(
      /^SHOPEE_LIVE_TRANSPORT_ERROR$/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(live.metadata().authentication).toBe('UNKNOWN');
  });

  it('rejects a concurrent query before another fetch can start', async () => {
    const { live, fetch } = setup();
    const first = live.queryOffers();
    await expect(live.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_ALREADY_ATTEMPTED',
    );
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('times out a stalled response body, not just response headers', async () => {
    vi.useFakeTimers();
    const { live, fetch } = setup(
      async () => new Response(new ReadableStream()),
    );
    const result = expect(live.queryOffers()).rejects.toThrow(
      'SHOPEE_LIVE_TIMEOUT',
    );
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
