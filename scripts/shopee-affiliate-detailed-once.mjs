import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fields = [
  'itemId',
  'shopId',
  'productName',
  'shopName',
  'price',
  'priceMin',
  'priceMax',
  'priceDiscountRate',
  'commission',
  'commissionRate',
  'imageUrl',
  'productLink',
  'offerLink',
  'pageInfo',
];
const errors = new Set([
  '10000',
  '10010',
  '10020',
  '10030',
  '10035',
  '11001',
  'EXPLICIT_EXECUTION_REQUIRED',
  'SHOPEE_GRAPHQL_ERROR',
  'SHOPEE_LIVE_CREDENTIALS_MISSING',
  'SHOPEE_LIVE_ALREADY_ATTEMPTED',
  'SHOPEE_LIVE_TIMEOUT',
  'SHOPEE_LIVE_TRANSPORT_ERROR',
  'SHOPEE_LIVE_REDIRECT_BLOCKED',
  'SHOPEE_LIVE_HTTP_ERROR',
  'SHOPEE_LIVE_RESPONSE_TOO_LARGE',
  'SHOPEE_LIVE_RESPONSE_INVALID',
  'SHOPEE_LIVE_GRAPHQL_ERROR',
  'SHOPEE_OFFERS_QUERY_INVALID',
  'SHOPEE_OFFERS_RESPONSE_INVALID',
  'SHOPEE_OFFERS_DUPLICATE_CONFLICT',
  'SHOPEE_DETAILED_PROBE_BASELINE_UNAVAILABLE',
]);
function emptyReport() {
  return {
    schemaVersion: 'shopee-detailed-probe/1.0.0',
    startedAt: null,
    commit: null,
    operation: 'productOfferV2',
    httpStatus: null,
    authentication: 'UNKNOWN',
    requestCount: 0,
    offersReturned: null,
    executionStatus: 'FAILED',
    fieldObservationStatus: 'NOT_EVALUATED',
    presentFields: [],
    missingFields: [],
    validatedTypes: {},
    pageInfo: {
      status: 'NOT_EVALUATED',
      page: null,
      limit: null,
      hasNextPage: null,
    },
    indicators: {
      HAS_PRODUCT_ID: false,
      HAS_SHOP_ID: false,
      HAS_PRODUCT_NAME: false,
      HAS_SHOP_NAME: false,
      HAS_PRICE: false,
      HAS_PRICE_RANGE: false,
      HAS_COMMISSION: false,
      HAS_COMMISSION_RATE: false,
      HAS_IMAGE_URL: false,
      HAS_PRODUCT_URL: false,
      HAS_OFFER_URL: false,
    },
    errorCodes: [],
  };
}
function readCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function metadataOnly(report, metadata) {
  report.requestCount = metadata?.requestCount === 1 ? 1 : 0;
  report.httpStatus =
    Number.isInteger(metadata?.httpStatus) &&
    metadata.httpStatus >= 100 &&
    metadata.httpStatus <= 599
      ? metadata.httpStatus
      : null;
  report.authentication = ['SUCCESS', 'FAILURE', 'UNKNOWN'].includes(
    metadata?.authentication,
  )
    ? metadata.authentication
    : 'UNKNOWN';
  report.offersReturned =
    Number.isInteger(metadata?.offersReturned) && metadata.offersReturned >= 0
      ? metadata.offersReturned
      : null;
}

// Injection points are for offline doubles. CLI users cannot change the query,
// transport, endpoint, page or limit. No private configuration file is loaded.
export async function runDetailedProbe(args = [], dependencies = {}) {
  const report = emptyReport();
  if (
    !Array.isArray(args) ||
    args.length !== 1 ||
    args[0] !== '--execute-once'
  ) {
    report.errorCodes = ['EXPLICIT_EXECUTION_REQUIRED'];
    return report;
  }
  let live;
  try {
    const now = dependencies.now ?? Date.now;
    report.startedAt = new Date(now()).toISOString();
    const commit = (dependencies.getCommit ?? readCommit)();
    if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit))
      throw new Error('SHOPEE_DETAILED_PROBE_BASELINE_UNAVAILABLE');
    report.commit = commit;
    const Transport =
      dependencies.Transport ??
      (
        await import('../dist/modules/affiliate/infrastructure/shopee-affiliate-live.js')
      ).ShopeeAffiliateLive;
    live = new Transport(
      dependencies.credentials ?? {
        appId: process.env.SHOPEE_AFFILIATE_APP_ID ?? '',
        secret: process.env.SHOPEE_AFFILIATE_SECRET ?? '',
      },
      { fetch: dependencies.fetch ?? globalThis.fetch, now },
    );
    const page = await live.queryOfferPage({ page: 1, limit: 1 });
    const metadata = live.metadata();
    metadataOnly(report, metadata);
    // The existing normalizer enforces identity, decimal/URL types, cardinality
    // and pageInfo. This runner only projects safe observations from its result.
    const offer = page.offers[0];
    const present = new Set(metadata.contractFields);
    report.presentFields = fields.filter((field) => present.has(field));
    report.missingFields = fields.filter((field) => !present.has(field));
    report.fieldObservationStatus = 'NORMALIZED_SINGLE_PAGE';
    const values = {
      itemId: offer?.productId,
      shopId: offer?.shopId,
      productName: offer?.name,
      shopName: offer?.shopName,
      price: offer?.price.amount,
      priceMin: offer?.priceRange.min.amount,
      priceMax: offer?.priceRange.max.amount,
      priceDiscountRate: offer?.discountPercent,
      commission: offer?.estimatedCommission.amount,
      commissionRate: offer?.estimatedCommission.rate,
      imageUrl: offer?.imageUrl,
      productLink: offer?.productUrl,
      offerLink: offer?.affiliateUrl,
    };
    const has = (field) =>
      typeof values[field] === 'string' && values[field].length > 0;
    report.indicators = {
      HAS_PRODUCT_ID: has('itemId'),
      HAS_SHOP_ID: has('shopId'),
      HAS_PRODUCT_NAME: has('productName'),
      HAS_SHOP_NAME: has('shopName'),
      HAS_PRICE: has('price'),
      HAS_PRICE_RANGE: has('priceMin') && has('priceMax'),
      HAS_COMMISSION: has('commission'),
      HAS_COMMISSION_RATE: has('commissionRate'),
      HAS_IMAGE_URL: has('imageUrl'),
      HAS_PRODUCT_URL: has('productLink'),
      HAS_OFFER_URL: has('offerLink'),
    };
    report.validatedTypes = Object.fromEntries(
      Object.keys(values).map((field) => [
        field,
        !offer
          ? 'NOT_OBSERVED'
          : values[field] == null
            ? 'NULL'
            : ['itemId', 'shopId'].includes(field)
              ? 'INT64_STRING'
              : ['price', 'priceMin', 'priceMax'].includes(field)
                ? 'DECIMAL_STRING'
                : ['commission', 'commissionRate'].includes(field)
                  ? 'DECIMAL_STRING_ESTIMATE'
                  : field === 'priceDiscountRate'
                    ? 'INTEGER'
                    : ['imageUrl', 'productLink', 'offerLink'].includes(field)
                      ? 'HTTPS_STRING'
                      : 'STRING',
      ]),
    );
    report.pageInfo = {
      status: 'VALIDATED',
      page: page.pageInfo.page,
      limit: page.pageInfo.limit,
      hasNextPage: page.pageInfo.hasNextPage,
    };
    report.executionStatus = 'SUCCESS';
    return report;
  } catch (error) {
    const metadata = live?.metadata();
    metadataOnly(report, metadata);
    const codes = metadata?.errorCodes?.length
      ? metadata.errorCodes
      : [error?.message];
    report.errorCodes = codes.map((code) =>
      errors.has(code) ? code : 'SHOPEE_DETAILED_PROBE_FAILED',
    );
    return report;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = await runDetailedProbe(process.argv.slice(2));
  console.log(JSON.stringify(report));
  if (report.executionStatus !== 'SUCCESS') process.exitCode = 1;
}
