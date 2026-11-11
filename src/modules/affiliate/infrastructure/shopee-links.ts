import { validateShopeeUrl } from '../domain/shopee-link-url.js';
import type {
  ShopeeAffiliateLinkInput,
  ShopeeGeneratedAffiliateLink,
} from '../domain/shopee-affiliate-contracts.js';

// Official mutation/input/result: https://open-api.affiliate.shopee.com.br/explorer/v2
// URL hosts and lengths below are a restrictive local policy, not official quotas.
const ORIGIN_HOSTS = new Set(['shopee.com.br', 's.shopee.com.br']);
const RESULT_HOSTS = new Set(['s.shopee.com.br']);
export class ShopeeLinkError extends Error {}
function fail(code: string): never {
  throw new ShopeeLinkError(code);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateShopeeLinkInput(
  raw: unknown,
): ShopeeAffiliateLinkInput {
  const code = 'SHOPEE_LINK_INPUT_INVALID';
  if (
    !record(raw) ||
    Object.keys(raw).some(
      (key) => !['offerId', 'originUrl', 'subIds'].includes(key),
    ) ||
    typeof raw.offerId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(raw.offerId)
  )
    fail(code);
  const originUrl = validateShopeeUrl(raw.originUrl, ORIGIN_HOSTS, code, fail);
  if (
    raw.subIds !== undefined &&
    (!Array.isArray(raw.subIds) ||
      raw.subIds.length > 5 ||
      Array.from(raw.subIds).some(
        (id: unknown) =>
          typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(id),
      ))
  )
    fail(code);
  return {
    offerId: raw.offerId,
    originUrl,
    ...(raw.subIds === undefined
      ? {}
      : { subIds: [...(raw.subIds as string[])] }),
  };
}

export function buildShopeeLinkMutation(raw: ShopeeAffiliateLinkInput) {
  const input = validateShopeeLinkInput(raw);
  return {
    query:
      'mutation AffiliateShortLink($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }',
    variables: {
      input: {
        originUrl: input.originUrl,
        ...(input.subIds === undefined ? {} : { subIds: [...input.subIds] }),
      },
    },
  };
}

export function normalizeShopeeLink(
  raw: unknown,
  input: ShopeeAffiliateLinkInput,
  observedAt: string,
): ShopeeGeneratedAffiliateLink {
  const checked = validateShopeeLinkInput(input);
  const code = 'SHOPEE_LINK_RESPONSE_INVALID';
  if (
    !record(raw) ||
    (raw.errors !== undefined &&
      (!Array.isArray(raw.errors) || raw.errors.length)) ||
    !Number.isFinite(Date.parse(observedAt))
  )
    fail(code);
  const result = record(raw.data) ? raw.data.generateShortLink : null;
  if (!record(result)) fail(code);
  return {
    offerId: checked.offerId,
    originUrl: checked.originUrl,
    subIds: checked.subIds === undefined ? null : [...checked.subIds],
    url: validateShopeeUrl(result.shortLink, RESULT_HOSTS, code, fail),
    associationVerified: false,
    provenance: { source: 'SHOPEE_LIVE', fixtureVersion: null, observedAt },
  };
}
