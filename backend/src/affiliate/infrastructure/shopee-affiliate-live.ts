import { createHash } from 'node:crypto';
import type { ShopeeAffiliatePort } from '../application/ports/shopee-affiliate.port.js';
import type {
  ShopeeAffiliateOffer,
  ShopeeAffiliateLink,
} from '../domain/shopee-affiliate-contracts.js';

// Primary technical evidence: official Explorer source and embedded V2 schema.
// https://open-api.affiliate.shopee.com.br/explorer
// https://open-api.affiliate.shopee.com.br/explorer/v2
// Keep this fixed read isolated from the module's normal (fake-only) provider.
export const SHOPEE_OFFERS_QUERY =
  'query ControlledOffers { productOfferV2(page: 1, limit: 1) { nodes { itemId } } }';
const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';
const MAX_BYTES = 262144;
const TIMEOUT_MS = 10000;
const KNOWN_CODES = new Set([10000, 10010, 10020, 10030, 10035, 11001]);

export interface ShopeeLiveMetadata {
  requestCount: number;
  httpStatus: number | null;
  authentication: 'SUCCESS' | 'FAILURE' | 'UNKNOWN';
  operation: 'productOfferV2';
  offersReturned: number | null;
  contractFields: string[];
  errorCodes: string[];
}

type Credentials = { appId: string; secret: string };
type Dependencies = { fetch: typeof globalThis.fetch; now?: () => number };
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Only fixed codes leave the transport; upstream bodies/messages/causes do not.
class LiveError extends Error {}
function fail(code: string): never {
  throw new LiveError(code);
}

export class ShopeeAffiliateLive implements ShopeeAffiliatePort {
  #credentials: Credentials;
  #fetch: typeof globalThis.fetch;
  #now: () => number;
  #metadata: ShopeeLiveMetadata = {
    requestCount: 0,
    httpStatus: null,
    authentication: 'UNKNOWN',
    operation: 'productOfferV2',
    offersReturned: null,
    contractFields: [],
    errorCodes: [],
  };

  constructor(credentials: Credentials, dependencies: Dependencies) {
    if (!credentials.appId || !credentials.secret)
      fail('SHOPEE_LIVE_CREDENTIALS_MISSING');
    this.#credentials = { ...credentials };
    this.#fetch = dependencies.fetch;
    this.#now = dependencies.now ?? Date.now;
  }

  metadata(): ShopeeLiveMetadata {
    return structuredClone(this.#metadata);
  }

  async generateLink(_input: {
    offerId: string;
  }): Promise<ShopeeAffiliateLink> {
    fail('SHOPEE_LIVE_LINKS_UNAVAILABLE');
  }

  async queryOffers(): Promise<ShopeeAffiliateOffer[]> {
    return this.#execute();
  }

  async #execute(): Promise<ShopeeAffiliateOffer[]> {
    if (this.#metadata.requestCount !== 0)
      fail('SHOPEE_LIVE_ALREADY_ATTEMPTED');
    // Reserve synchronously: concurrent calls and failures cannot consume a retry.
    this.#metadata.requestCount = 1;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new LiveError('SHOPEE_LIVE_TIMEOUT'));
        }, TIMEOUT_MS);
      });
      return await Promise.race([this.#read(controller.signal), deadline]);
    } catch (error) {
      const code = controller.signal.aborted
        ? 'SHOPEE_LIVE_TIMEOUT'
        : error instanceof LiveError
          ? error.message
          : 'SHOPEE_LIVE_TRANSPORT_ERROR';
      if (!this.#metadata.errorCodes.length) this.#metadata.errorCodes = [code];
      throw new LiveError(code);
    } finally {
      clearTimeout(timeout);
      controller.abort();
      this.#credentials = { appId: '', secret: '' };
    }
  }

  async #read(signal: AbortSignal): Promise<ShopeeAffiliateOffer[]> {
    const now = this.#now();
    const timestamp = String(Math.ceil(now / 1000));
    // Same string, same UTF-8 bytes for signing and transport; no reserialization.
    const payload = JSON.stringify({ query: SHOPEE_OFFERS_QUERY });
    const { appId, secret } = this.#credentials;
    const signature = createHash('sha256')
      .update(appId + timestamp + payload + secret, 'utf8')
      .digest('hex');
    const response = await this.#fetch(ENDPOINT, {
      method: 'POST',
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      },
      body: payload,
      signal,
    });
    this.#metadata.httpStatus = response.status;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      fail('SHOPEE_LIVE_REDIRECT_BLOCKED');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        this.#metadata.authentication = 'FAILURE';
      await response.body?.cancel();
      fail('SHOPEE_LIVE_HTTP_ERROR');
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      fail('SHOPEE_LIVE_RESPONSE_TOO_LARGE');
    }
    const reader = response.body?.getReader();
    if (!reader) fail('SHOPEE_LIVE_RESPONSE_INVALID');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) fail('SHOPEE_LIVE_RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      fail('SHOPEE_LIVE_RESPONSE_INVALID');
    }
    if (!record(body)) fail('SHOPEE_LIVE_RESPONSE_INVALID');
    if (
      body.errors !== undefined &&
      (!Array.isArray(body.errors) || body.errors.length)
    ) {
      this.#metadata.errorCodes = Array.isArray(body.errors)
        ? body.errors.map((error: unknown) => {
            const code =
              record(error) && record(error.extensions)
                ? error.extensions.code
                : null;
            return typeof code === 'number' && KNOWN_CODES.has(code)
              ? String(code)
              : 'SHOPEE_GRAPHQL_ERROR';
          })
        : ['SHOPEE_GRAPHQL_ERROR'];
      if (
        this.#metadata.errorCodes.includes('10020') ||
        this.#metadata.errorCodes.includes('10035')
      )
        this.#metadata.authentication = 'FAILURE';
      fail('SHOPEE_LIVE_GRAPHQL_ERROR');
    }
    const data = body.data;
    const connection = record(data) ? data.productOfferV2 : null;
    const nodes = record(connection) ? connection.nodes : null;
    if (!Array.isArray(nodes) || nodes.length > 1)
      fail('SHOPEE_LIVE_RESPONSE_INVALID');
    const offers = nodes.map((node: unknown): ShopeeAffiliateOffer => {
      if (!record(node)) fail('SHOPEE_LIVE_RESPONSE_INVALID');
      const id = node.itemId;
      // Never round an Int64 delivered as an unsafe JSON number.
      if (
        !(typeof id === 'string' && /^\d{1,20}$/.test(id)) &&
        !(typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)
      )
        fail('SHOPEE_LIVE_RESPONSE_INVALID');
      return {
        offerId: `shopee-item-${String(id)}`,
        productId: String(id),
        shopId: null,
        name: null,
        price: { amount: null, currency: null },
        estimatedCommission: { amount: null, currency: null, rate: null },
        imageUrl: null,
        provenance: {
          source: 'SHOPEE_LIVE',
          fixtureVersion: null,
          observedAt: new Date(now).toISOString(),
        },
      };
    });
    if (signal.aborted) fail('SHOPEE_LIVE_TIMEOUT');
    this.#metadata.authentication = 'SUCCESS';
    this.#metadata.offersReturned = offers.length;
    this.#metadata.contractFields = [
      'data',
      'productOfferV2',
      'nodes',
      ...(offers.length ? ['itemId'] : []),
    ];
    return offers;
  }
}
