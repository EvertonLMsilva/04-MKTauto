import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ShopeeAffiliateLive } from './shopee-affiliate-live.js';

const scriptUrl = new URL(
  '../../../../scripts/shopee-affiliate-detailed-once.mjs',
  import.meta.url,
);
const { runDetailedProbe } = await import(scriptUrl.href);
const credentials = {
  appId: 'synthetic-app',
  secret: 'SYNTHETIC_SECRET_MUST_NOT_LEAK',
};
const commit = 'a'.repeat(40),
  at = Date.parse('2026-11-12T12:00:00Z');
const product = () => ({
  itemId: '9007199254740993',
  shopId: '9007199254740995',
  productName: 'SYNTHETIC_PRIVATE_PRODUCT_NAME',
  shopName: 'SYNTHETIC_PRIVATE_SHOP_NAME',
  price: '12345678901234567890.00100',
  priceMin: '12345678901234567890.00100',
  priceMax: '12345678901234567890.00900',
  priceDiscountRate: 7,
  commission: '0.00000001',
  commissionRate: '0.01234500',
  imageUrl: 'https://example.invalid/private-image.png',
  productLink:
    'https://shopee.com.br/product/9007199254740995/9007199254740993',
  offerLink: 'https://s.shopee.com.br/private-fixture',
});
const page = (nodes: unknown[] = [product()], hasNextPage = true) => ({
  data: {
    productOfferV2: { nodes, pageInfo: { page: 1, limit: 1, hasNextPage } },
  },
});
function setup(
  response: () => Promise<Response> = async () => Response.json(page()),
) {
  let normalized: any;
  class ObservedTransport extends ShopeeAffiliateLive {
    override async queryOfferPage(input: any) {
      normalized = await super.queryOfferPage(input);
      return normalized;
    }
  }
  const fetch = vi.fn((_url: unknown, _options?: RequestInit) => response());
  const options = {
    credentials,
    fetch,
    now: () => at,
    getCommit: () => commit,
    Transport: ObservedTransport,
  };
  return {
    fetch,
    options,
    normalized: () => normalized,
    run: () => runDetailedProbe(['--execute-once'], options),
  };
}
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test.each([
  { args: [] },
  { args: ['--execute-once', '--page', '2'] },
  { args: ['--execute-once', '--execute-once'] },
])(
  'requires the exact execution flag before reading configuration or creating a transport (%j)',
  async ({ args }) => {
    const options = {
      get credentials() {
        throw new Error('CREDENTIAL_READ_FORBIDDEN');
      },
      get Transport() {
        throw new Error('TRANSPORT_FORBIDDEN');
      },
    };
    const result = await runDetailedProbe(args, options);
    expect(result).toMatchObject({
      requestCount: 0,
      errorCodes: ['EXPLICIT_EXECUTION_REQUIRED'],
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  },
);

test.each([
  { appId: '', secret: '' },
  { appId: ' \t', secret: 'synthetic' },
  { appId: 'synthetic', secret: '\n ' },
])(
  'rejects missing/invalid synthetic credentials without HTTP',
  async (invalid) => {
    const s = setup();
    const result = await runDetailedProbe(['--execute-once'], {
      ...s.options,
      credentials: invalid,
    });
    expect(result).toMatchObject({
      requestCount: 0,
      authentication: 'UNKNOWN',
      errorCodes: ['SHOPEE_LIVE_CREDENTIALS_MISSING'],
    });
    expect(s.fetch).not.toHaveBeenCalled();
  },
);

test('uses one detailed request, preserves existing normalized types and exposes only sanitized indicators', async () => {
  const s = setup(),
    result = await s.run();
  expect(s.fetch).toHaveBeenCalledOnce();
  const [url, options] = s.fetch.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe('https://open-api.affiliate.shopee.com.br/graphql');
  const body = JSON.parse(options.body as string);
  expect(body.variables).toEqual({ page: 1, limit: 1 });
  expect(body.query).toContain('productOfferV2');
  expect(body.query).not.toContain('generateShortLink');
  expect(body.query).not.toContain('mutation');
  expect(options.redirect).toBe('manual');
  expect(result).toMatchObject({
    startedAt: '2026-11-12T12:00:00.000Z',
    commit,
    httpStatus: 200,
    authentication: 'SUCCESS',
    requestCount: 1,
    offersReturned: 1,
    executionStatus: 'SUCCESS',
    errorCodes: [],
    pageInfo: { status: 'VALIDATED', page: 1, limit: 1, hasNextPage: true },
  });
  expect(result.indicators).toEqual({
    HAS_PRODUCT_ID: true,
    HAS_SHOP_ID: true,
    HAS_PRODUCT_NAME: true,
    HAS_SHOP_NAME: true,
    HAS_PRICE: true,
    HAS_PRICE_RANGE: true,
    HAS_COMMISSION: true,
    HAS_COMMISSION_RATE: true,
    HAS_IMAGE_URL: true,
    HAS_PRODUCT_URL: true,
    HAS_OFFER_URL: true,
  });
  expect(result.validatedTypes).toMatchObject({
    itemId: 'INT64_STRING',
    shopId: 'INT64_STRING',
    price: 'DECIMAL_STRING',
    commission: 'DECIMAL_STRING_ESTIMATE',
    commissionRate: 'DECIMAL_STRING_ESTIMATE',
  });
  expect(result.presentFields).toContain('pageInfo');
  expect(result.missingFields).toEqual([]);
  expect(s.normalized().offers[0]).toMatchObject({
    productId: product().itemId,
    shopId: product().shopId,
    price: { amount: product().price, currency: null },
    priceRange: {
      min: { amount: product().priceMin },
      max: { amount: product().priceMax },
    },
    estimatedCommission: {
      amount: product().commission,
      rate: product().commissionRate,
      currency: null,
    },
    availability: null,
    provenance: { source: 'SHOPEE_LIVE' },
  });
  const text = JSON.stringify(result);
  for (const privateValue of [
    ...Object.values(credentials),
    ...Object.values(product()).filter((v) => typeof v === 'string'),
  ])
    expect(text).not.toContain(privateValue);
  expect(text).not.toContain('Authorization');
  expect(text).not.toContain('Signature');
  expect(result).not.toHaveProperty('offers');
  expect(result).not.toHaveProperty('body');
});

test('records absent optional fields as unknown and never infers commercial data', async () => {
  const s = setup(async () => Response.json(page([{ itemId: '1001' }], false))),
    result = await s.run();
  expect(result).toMatchObject({
    authentication: 'SUCCESS',
    offersReturned: 1,
    indicators: {
      HAS_PRODUCT_ID: true,
      HAS_SHOP_ID: false,
      HAS_PRODUCT_NAME: false,
      HAS_PRICE: false,
      HAS_COMMISSION: false,
      HAS_IMAGE_URL: false,
    },
    validatedTypes: { shopId: 'NULL', price: 'NULL', commission: 'NULL' },
    pageInfo: { hasNextPage: false },
  });
  expect(result.missingFields).toContain('price');
  expect(result.missingFields).toContain('offerLink');
  expect(s.normalized().offers[0].price.amount).toBeNull();
  expect(s.fetch).toHaveBeenCalledOnce();
});

test('preserves an unsafe JSON Int64 lexeme through the existing transport without reporting the ID', async () => {
  const raw = JSON.stringify(
    page([{ ...product(), itemId: 'RAW_INT64_PLACEHOLDER' }]),
  ).replace('"RAW_INT64_PLACEHOLDER"', '9007199254740993');
  const s = setup(async () => new Response(raw)),
    result = await s.run();
  expect(s.normalized().offers[0].productId).toBe('9007199254740993');
  expect(result.validatedTypes.itemId).toBe('INT64_STRING');
  expect(JSON.stringify(result)).not.toContain('9007199254740993');
});

test('zero offers remains a valid authenticated page and never triggers another page', async () => {
  const s = setup(async () => Response.json(page([], true))),
    result = await s.run();
  expect(result).toMatchObject({
    authentication: 'SUCCESS',
    offersReturned: 0,
    executionStatus: 'SUCCESS',
    pageInfo: { hasNextPage: true },
  });
  expect(result.indicators.HAS_PRODUCT_ID).toBe(false);
  expect(s.fetch).toHaveBeenCalledOnce();
});

test('GraphQL errors, including partial data, retain only public codes', async () => {
  const s = setup(async () =>
      Response.json({
        ...page(),
        errors: [
          {
            message: credentials.secret,
            extensions: { code: 10020, private: product() },
          },
        ],
      }),
    ),
    result = await s.run();
  expect(result).toMatchObject({
    requestCount: 1,
    authentication: 'FAILURE',
    executionStatus: 'FAILED',
    errorCodes: ['10020'],
  });
  expect(s.fetch).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain(credentials.secret);
  expect(result.pageInfo.status).toBe('NOT_EVALUATED');
});

test.each([401, 403, 429, 500])(
  'HTTP %i ends the invocation without retry or leaked body',
  async (status) => {
    const s = setup(async () => new Response(credentials.secret, { status })),
      result = await s.run();
    expect(result).toMatchObject({
      httpStatus: status,
      requestCount: 1,
      executionStatus: 'FAILED',
      errorCodes: ['SHOPEE_LIVE_HTTP_ERROR'],
    });
    expect(result.authentication).toBe(
      status === 401 || status === 403 ? 'FAILURE' : 'UNKNOWN',
    );
    expect(s.fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(credentials.secret);
  },
);

test('timeout consumes one attempt and returns only a fixed error', async () => {
  vi.useFakeTimers();
  const s = setup(() => new Promise(() => {})),
    pending = s.run();
  await vi.advanceTimersByTimeAsync(10001);
  const result = await pending;
  expect(result).toMatchObject({
    requestCount: 1,
    executionStatus: 'FAILED',
    errorCodes: ['SHOPEE_LIVE_TIMEOUT'],
  });
  expect(s.fetch).toHaveBeenCalledOnce();
});

test.each([
  'not-json',
  'missing-page-info',
  'wrong-limit',
  'multiple-products',
  'numeric-price',
  'unsafe-url',
  'bad-identity',
])('invalid detailed response %s fails closed without retry', async (kind) => {
  const value: any = page();
  if (kind === 'missing-page-info') delete value.data.productOfferV2.pageInfo;
  if (kind === 'wrong-limit') value.data.productOfferV2.pageInfo.limit = 2;
  if (kind === 'multiple-products')
    value.data.productOfferV2.nodes.push(product());
  if (kind === 'numeric-price') value.data.productOfferV2.nodes[0].price = 12.5;
  if (kind === 'unsafe-url')
    value.data.productOfferV2.nodes[0].productLink =
      'http://example.invalid/private';
  if (kind === 'bad-identity')
    value.data.productOfferV2.nodes[0].itemId = 'INVALID';
  const s = setup(async () =>
      kind === 'not-json'
        ? new Response('PRIVATE_RAW_RESPONSE')
        : Response.json(value),
    ),
    result = await s.run();
  expect(result.executionStatus).toBe('FAILED');
  expect(result.requestCount).toBe(1);
  expect(result.errorCodes.length).toBeGreaterThan(0);
  expect(s.fetch).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain('PRIVATE_RAW_RESPONSE');
});

test.each([301, 302, 307, 308])(
  'redirect %i is not followed',
  async (status) => {
    const s = setup(
        async () =>
          new Response(null, {
            status,
            headers: { Location: 'https://example.invalid/private' },
          }),
      ),
      result = await s.run();
    expect(result.errorCodes).toEqual(['SHOPEE_LIVE_REDIRECT_BLOCKED']);
    expect(s.fetch).toHaveBeenCalledOnce();
  },
);

test('transport failures and an invalid commit cannot leak private diagnostics', async () => {
  const s = setup(async () => {
      throw new Error(credentials.secret);
    }),
    result = await s.run();
  expect(result.errorCodes).toEqual(['SHOPEE_LIVE_TRANSPORT_ERROR']);
  expect(JSON.stringify(result)).not.toContain(credentials.secret);
  const before = s.fetch.mock.calls.length;
  const invalid = await runDetailedProbe(['--execute-once'], {
    ...s.options,
    getCommit: () => credentials.secret,
  });
  expect(invalid.requestCount).toBe(0);
  expect(invalid.commit).toBeNull();
  expect(JSON.stringify(invalid)).not.toContain(credentials.secret);
  expect(s.fetch).toHaveBeenCalledTimes(before);
});

test('an isolated process without the flag cannot use LIVE or open operational resources', () => {
  let stdout = '';
  try {
    execFileSync(process.execPath, [fileURLToPath(scriptUrl)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error: any) {
    expect(error.status).toBe(1);
    stdout = String(error.stdout);
  }
  expect(JSON.parse(stdout)).toMatchObject({
    requestCount: 0,
    errorCodes: ['EXPLICIT_EXECUTION_REQUIRED'],
  });
});

test('offline execution leaves checkout and backend mode unchanged and never requests a commercial mutation', async () => {
  const cwd = fileURLToPath(new URL('../../../../', import.meta.url));
  const gitStatus = () =>
    execFileSync('git', ['status', '--porcelain=v1'], {
      cwd,
      encoding: 'utf8',
    });
  const before = gitStatus(),
    mode = process.env.SHOPEE_AFFILIATE_MODE,
    s = setup();
  await s.run();
  expect(gitStatus()).toBe(before);
  expect(process.env.SHOPEE_AFFILIATE_MODE === mode).toBe(true);
  expect(s.fetch).toHaveBeenCalledOnce();
  const options = s.fetch.mock.calls[0][1] as RequestInit;
  expect(JSON.parse(options.body as string).query).not.toMatch(
    /mutation|generateShortLink|conversionReport/,
  );
});
