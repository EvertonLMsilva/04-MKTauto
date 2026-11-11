import type {
  ShopeeOfferQuery,
  ShopeeAffiliateOfferPage,
  ShopeeAffiliateOfferDetails,
} from '../domain/shopee-affiliate-contracts.js';

// Historical official-schema snapshot: docs/tasks/P7.1-SHOPEE-OFFERS-001-contract.md.
// Keep arguments/fields unchanged until the current official schema is evidenced.
// Types/nullability of these fields still require current Explorer homologation;
// the itemId-only probe does not validate this detailed contract or API quotas.
const QUERY = `query AffiliateOffers($page: Int!, $limit: Int!, $keyword: String, $sortType: Int, $productCatId: Int) {
  productOfferV2(page: $page, limit: $limit, keyword: $keyword, sortType: $sortType, productCatId: $productCatId) {
    nodes { itemId productName price priceMin priceMax priceDiscountRate imageUrl productLink offerLink commission commissionRate shopId shopName }
    pageInfo { page limit hasNextPage }
  }
}`;
export const SHOPEE_OFFER_FIELDS = [
  'data',
  'productOfferV2',
  'nodes',
  'itemId',
  'productName',
  'price',
  'priceMin',
  'priceMax',
  'priceDiscountRate',
  'imageUrl',
  'productLink',
  'offerLink',
  'commission',
  'commissionRate',
  'shopId',
  'shopName',
  'pageInfo',
  'page',
  'limit',
  'hasNextPage',
] as const;
// Local safety bounds, not statements about Shopee quotas.
const MAX_PAGE = 100;
const MAX_LIMIT = 10;
export class ShopeeOffersError extends Error {}
function fail(code = 'SHOPEE_OFFERS_RESPONSE_INVALID'): never {
  throw new ShopeeOffersError(code);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;
function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function buildShopeeOffersQuery(input: ShopeeOfferQuery = {}) {
  const keys = ['page', 'limit', 'keyword', 'sortType', 'productCatId'];
  if (!record(input) || Object.keys(input).some((key) => !keys.includes(key)))
    fail('SHOPEE_OFFERS_QUERY_INVALID');
  const page = input.page === undefined ? 1 : input.page;
  const limit = input.limit === undefined ? MAX_LIMIT : input.limit;
  if (
    !integer(page, 1, MAX_PAGE) ||
    !integer(limit, 1, MAX_LIMIT) ||
    (input.keyword !== undefined &&
      (typeof input.keyword !== 'string' ||
        input.keyword.length < 1 ||
        input.keyword.length > 100 ||
        hasControlCharacters(input.keyword))) ||
    (input.sortType !== undefined && !integer(input.sortType, 1, 5)) ||
    (input.productCatId !== undefined &&
      !integer(input.productCatId, 1, 2147483647))
  )
    fail('SHOPEE_OFFERS_QUERY_INVALID');
  return {
    query: QUERY,
    variables: {
      page,
      limit,
      ...(input.keyword === undefined ? {} : { keyword: input.keyword }),
      ...(input.sortType === undefined ? {} : { sortType: input.sortType }),
      ...(input.productCatId === undefined
        ? {}
        : { productCatId: input.productCatId }),
    },
  };
}

function id(value: unknown): string {
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return value;
  if (integer(value, 0, Number.MAX_SAFE_INTEGER)) return String(value);
  return fail();
}
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    hasControlCharacters(value)
  )
    fail();
  return value;
}
function decimal(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{1,40}(?:\.\d{1,40})?$/.test(value))
    fail();
  return value;
}
function url(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      [...parsed.searchParams.keys()].some((key) =>
        /^(token|secret|credential|signature|authorization|password|api_key)$/i.test(
          key,
        ),
      )
    )
      fail();
  } catch {
    fail();
  }
  return raw;
}

export function normalizeShopeeOfferPage(
  raw: unknown,
  request: { page: number; limit: number },
  observedAt: string,
): ShopeeAffiliateOfferPage {
  buildShopeeOffersQuery(request);
  if (!Number.isFinite(Date.parse(observedAt))) fail();
  if (
    !record(raw) ||
    (raw.errors !== undefined &&
      (!Array.isArray(raw.errors) || raw.errors.length))
  )
    fail();
  const data = raw.data;
  const connection = record(data) ? data.productOfferV2 : null;
  const nodes = record(connection) ? connection.nodes : null;
  const info = record(connection) ? connection.pageInfo : null;
  if (
    !Array.isArray(nodes) ||
    nodes.length > request.limit ||
    !record(info) ||
    (info.page != null && info.page !== request.page) ||
    info.limit !== request.limit ||
    typeof info.hasNextPage !== 'boolean'
  )
    fail();
  const offers = new Map<string, ShopeeAffiliateOfferDetails>();
  for (const node of nodes as unknown[]) {
    // The documented [ProductOfferV2]! permits null elements.
    if (node === null) continue;
    if (!record(node)) fail();
    const productId = id(node.itemId);
    const discount = node.priceDiscountRate;
    if (discount != null && !integer(discount, 0, 100)) fail();
    const offer: ShopeeAffiliateOfferDetails = {
      offerId: `shopee-item-${productId}`,
      productId,
      shopId: node.shopId == null ? null : id(node.shopId),
      name: text(node.productName),
      shopName: text(node.shopName),
      description: null,
      availability: null,
      price: { amount: decimal(node.price), currency: null },
      priceRange: {
        min: { amount: decimal(node.priceMin), currency: null },
        max: { amount: decimal(node.priceMax), currency: null },
      },
      estimatedCommission: {
        amount: decimal(node.commission),
        currency: null,
        rate: decimal(node.commissionRate),
      },
      discountPercent: discount == null ? null : (discount as number),
      imageUrl: url(node.imageUrl),
      productUrl: url(node.productLink),
      affiliateUrl: url(node.offerLink),
      provenance: { source: 'SHOPEE_LIVE', fixtureVersion: null, observedAt },
    };
    const previous = offers.get(productId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(offer))
      fail('SHOPEE_OFFERS_DUPLICATE_CONFLICT');
    offers.set(productId, offer);
  }
  return {
    offers: [...offers.values()],
    pageInfo: {
      page: info.page == null ? null : request.page,
      limit: request.limit,
      hasNextPage: info.hasNextPage as boolean,
      nextPage:
        info.hasNextPage && request.page < MAX_PAGE ? request.page + 1 : null,
    },
  };
}
