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

function validateUrl(
  value: unknown,
  hosts: ReadonlySet<string>,
  code: string,
): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !value.startsWith('https://') ||
    /\s|\\/.test(value) ||
    value.includes('#') ||
    value
      .split('')
      .some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
  )
    fail(code);
  try {
    const url = new URL(value);
    const rawAuthority = value.slice('https://'.length).split(/[/?#]/, 1)[0];
    // Reject even default ports, encoded authorities and normalized ambiguous hosts.
    if (
      !hosts.has(url.hostname) ||
      rawAuthority !== url.hostname ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.pathname === '/'
    )
      fail(code);
    for (const [key, entry] of url.searchParams) {
      if (
        /^(token|access_token|secret|credential|signature|authorization|password|api_key|redirect|redirect_url|redirect_uri|url|next|target|dest|destination)$/i.test(
          key,
        ) ||
        /^(?:https?:)?\/\//i.test(entry)
      )
        fail(code);
    }
  } catch {
    fail(code);
  }
  return value;
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
  const originUrl = validateUrl(raw.originUrl, ORIGIN_HOSTS, code);
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
    url: validateUrl(result.shortLink, RESULT_HOSTS, code),
    associationVerified: false,
    provenance: { source: 'SHOPEE_LIVE', fixtureVersion: null, observedAt },
  };
}
