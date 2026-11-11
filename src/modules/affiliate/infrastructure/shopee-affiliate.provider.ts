import type { FactoryProvider } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

import { SHOPEE_AFFILIATE } from '../application/ports/shopee-affiliate.port.js';
import type { ShopeeAffiliatePort } from '../application/ports/shopee-affiliate.port.js';
import type {
  ShopeeAffiliateOffer,
  ShopeeAffiliateLink,
  ShopeeAffiliateProvenance,
  ShopeeAffiliateLinkInput,
  ShopeeGeneratedAffiliateLink,
} from '../domain/shopee-affiliate-contracts.js';
import { validateShopeeLinkInput } from './shopee-links.js';
import { ShopeeAffiliateLive } from './shopee-affiliate-live.js';
import { buildShopeeOffersQuery } from './shopee-offers.js';
import type { ShopeeOfferPagePort } from '../application/ports/shopee-affiliate.port.js';
import type {
  ShopeeOfferQuery,
  ShopeeAffiliateOfferPage,
} from '../domain/shopee-affiliate-contracts.js';

export interface ShopeeLiveExecutionPermit {
  mode: 'SHOPEE_LIVE';
  expiresAt: string;
  maxOfferPages: number;
  maxLinks: number;
  reserve: (operation: 'OFFERS' | 'LINK', index: number) => void;
}
const liveExecution = new AsyncLocalStorage<{
  permit: ShopeeLiveExecutionPermit;
  reads: number;
  links: number;
}>();
// Internal capability, created only after checking an operator's persisted grant.
// Async context prevents one campaign's permission leaking to another request.
export function withShopeeLiveAuthorization<T>(
  permit: ShopeeLiveExecutionPermit,
  run: () => Promise<T>,
): Promise<T> {
  return liveExecution.run({ permit: { ...permit }, reads: 0, links: 0 }, run);
}
export function shopeeLiveLinkAllowed() {
  const context = liveExecution.getStore();
  return (
    !!context &&
    context.permit.mode === 'SHOPEE_LIVE' &&
    Date.now() < Date.parse(context.permit.expiresAt) &&
    context.links < context.permit.maxLinks
  );
}
function reserveLiveRequest(operation: 'OFFERS' | 'LINK') {
  const context = liveExecution.getStore();
  if (
    !context ||
    context.permit.mode !== 'SHOPEE_LIVE' ||
    Date.now() >= Date.parse(context.permit.expiresAt) ||
    !Number.isFinite(Date.parse(context.permit.expiresAt))
  )
    throw new Error('SHOPEE_LIVE_AUTHORIZATION_REQUIRED');
  const index = operation === 'OFFERS' ? ++context.reads : ++context.links;
  const limit =
    operation === 'OFFERS'
      ? context.permit.maxOfferPages
      : context.permit.maxLinks;
  if (!Number.isSafeInteger(limit) || index > limit)
    throw new Error('SHOPEE_LIVE_CALL_LIMIT');
  context.permit.reserve(operation, index);
}

const provenance = (): ShopeeAffiliateProvenance => ({
  source: 'FAKE',
  fixtureVersion: 'shopee-affiliate-fake/1',
  observedAt: null,
});

export class FakeShopeeAffiliate implements ShopeeOfferPagePort {
  async queryOfferPage(
    input: ShopeeOfferQuery = {},
  ): Promise<ShopeeAffiliateOfferPage> {
    const { page, limit } = buildShopeeOffersQuery(input).variables;
    const offers = page === 1 ? await this.queryOffers() : [];
    return {
      offers: offers.slice(0, limit).map((offer) => ({
        ...offer,
        description: null,
        availability: null,
        shopName: null,
        productUrl: null,
        affiliateUrl: null,
        priceRange: {
          min: { amount: null, currency: null },
          max: { amount: null, currency: null },
        },
        discountPercent: null,
      })),
      pageInfo: { page, limit, hasNextPage: false, nextPage: null },
    };
  }
  async queryOffers(): Promise<ShopeeAffiliateOffer[]> {
    return [
      {
        offerId: 'fake-offer-001',
        productId: '9007199254740993',
        shopId: 'fake-shop-001',
        name: 'Synthetic fixture with image',
        price: { amount: '9007199254740993.01', currency: 'BRL' },
        estimatedCommission: {
          amount: '0.000001',
          currency: 'BRL',
          rate: '0.012345',
        },
        imageUrl: 'https://shopee-affiliate.invalid/fixture/image-001.png',
        provenance: provenance(),
      },
      {
        offerId: 'fake-offer-002',
        productId: 'fake-product-002',
        shopId: null,
        name: null,
        price: { amount: null, currency: null },
        estimatedCommission: { amount: null, currency: null, rate: null },
        imageUrl: null,
        provenance: provenance(),
      },
    ];
  }

  generateLink(
    input: ShopeeAffiliateLinkInput,
  ): Promise<ShopeeGeneratedAffiliateLink>;
  generateLink(input: { offerId: string }): Promise<ShopeeAffiliateLink>;
  async generateLink(
    input: ShopeeAffiliateLinkInput | { offerId: string },
  ): Promise<ShopeeAffiliateLink> {
    const checked =
      input && Object.hasOwn(input, 'originUrl')
        ? validateShopeeLinkInput(input)
        : null;
    const offer = (await this.queryOffers()).find(
      (value) => value.offerId === (checked?.offerId ?? input?.offerId),
    );
    if (!offer) throw new Error('SHOPEE_AFFILIATE_OFFER_NOT_FOUND');
    const link: ShopeeAffiliateLink = {
      offerId: offer.offerId,
      url: `https://shopee-affiliate.invalid/link/${offer.offerId}`,
      associationVerified: false,
      provenance: provenance(),
    };
    if (checked) {
      const generated: ShopeeGeneratedAffiliateLink = {
        ...link,
        originUrl: checked.originUrl,
        subIds: checked.subIds === undefined ? null : [...checked.subIds],
      };
      return generated;
    }
    return link;
  }
}

// Singleton facade, single-use transport. No fetch or credential validation is deferred
// beyond explicitly selecting LIVE. Transport failures never carry upstream messages.
export class ConfiguredShopeeAffiliate implements ShopeeOfferPagePort {
  #credentials: { appId: string; secret: string };
  #fetch: typeof globalThis.fetch;
  constructor(
    credentials: { appId: string; secret: string },
    fetch: typeof globalThis.fetch,
  ) {
    if (!credentials.appId.trim() || !credentials.secret.trim())
      throw new Error('SHOPEE_LIVE_CREDENTIALS_MISSING');
    this.#credentials = { ...credentials };
    this.#fetch = fetch;
  }
  private async operation<T>(
    run: (transport: ShopeeAffiliateLive) => Promise<T>,
  ): Promise<T> {
    const transport = new ShopeeAffiliateLive(this.#credentials, {
      fetch: this.#fetch,
    });
    try {
      return await run(transport);
    } catch (error) {
      const meta = transport.metadata();
      if (meta.authentication === 'FAILURE')
        throw new Error('SHOPEE_AUTHENTICATION_REJECTED');
      const code = error instanceof Error ? error.message : '';
      if (/^SHOPEE_(?:OFFERS_QUERY|LINK_INPUT)_INVALID$/.test(code))
        throw new Error(code);
      if (
        /^SHOPEE_(?:OFFERS|LINK)_/.test(code) ||
        code.startsWith('SHOPEE_LIVE_RESPONSE_')
      )
        throw new Error('SHOPEE_CONTRACT_ERROR');
      throw new Error('SHOPEE_UNAVAILABLE');
    }
  }
  queryOfferPage(input: ShopeeOfferQuery = {}) {
    buildShopeeOffersQuery(input);
    reserveLiveRequest('OFFERS');
    return this.operation((t) => t.queryOfferPage(input));
  }
  async queryOffers() {
    return (await this.queryOfferPage()).offers;
  }
  generateLink(
    input: ShopeeAffiliateLinkInput,
  ): Promise<ShopeeGeneratedAffiliateLink>;
  generateLink(input: { offerId: string }): Promise<ShopeeAffiliateLink>;
  generateLink(
    input: ShopeeAffiliateLinkInput | { offerId: string },
  ): Promise<ShopeeAffiliateLink> {
    const checked = validateShopeeLinkInput(input);
    reserveLiveRequest('LINK');
    return this.operation((t) => t.generateLink(checked));
  }
}

export const shopeeAffiliateProvider = {
  provide: SHOPEE_AFFILIATE,
  useFactory: () => {
    const mode = process.env.SHOPEE_AFFILIATE_MODE ?? 'fake';
    if (mode === 'live')
      return new ConfiguredShopeeAffiliate(
        {
          appId: process.env.SHOPEE_AFFILIATE_APP_ID ?? '',
          secret: process.env.SHOPEE_AFFILIATE_SECRET ?? '',
        },
        globalThis.fetch,
      );
    if (mode !== 'fake') throw new Error('SHOPEE_AFFILIATE_MODE_INVALID');
    return new FakeShopeeAffiliate();
  },
} satisfies FactoryProvider<ShopeeAffiliatePort>;
