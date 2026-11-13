import type { FactoryProvider } from '@nestjs/common';
import {
  AFFILIATE_PROVIDER_ADAPTERS,
  type AffiliateProviderAdapter,
} from '../application/ports/affiliate-provider.port.js';
import {
  SHOPEE_AFFILIATE,
  type ShopeeOfferPagePort,
} from '../application/ports/shopee-affiliate.port.js';
import {
  validateAffiliateProviderLink,
  validateAffiliateProviderLinkInput,
  validateExternalAffiliateOffer,
  type AffiliateGeneratedLink,
  type AffiliateLinkInput,
  type AffiliateMediaReference,
  type AffiliateObservation,
  type ExternalAffiliateOffer,
} from '../domain/affiliate-provider.js';
import type {
  ShopeeAffiliateOfferDetails,
  ShopeeAffiliateProvenance,
} from '../domain/shopee-affiliate-contracts.js';
import { buildShopeeOffersQuery } from './shopee-offers.js';
import { validateShopeeLinkInput } from './shopee-links.js';

function invalidResponse(): never {
  throw new Error('AFFILIATE_PROVIDER_RESPONSE_INVALID');
}

function checkedItemId(value: string): string {
  const { expectedItemId } = buildShopeeOffersQuery({ itemId: value });
  if (expectedItemId === undefined)
    throw new Error('SHOPEE_OFFERS_QUERY_INVALID');
  return expectedItemId;
}

function observation(source: ShopeeAffiliateProvenance): AffiliateObservation {
  if (source.source === 'SHOPEE_LIVE') {
    return {
      providerId: 'shopee',
      mode: 'LIVE',
      observedAt: source.observedAt,
      sourceReference: null,
      fixtureVersion: null,
    };
  }
  if (source.source === 'FAKE') {
    return {
      providerId: 'shopee',
      mode: 'FAKE',
      observedAt: null,
      sourceReference: null,
      fixtureVersion: source.fixtureVersion,
    };
  }
  return invalidResponse();
}

// Translation only. The injected existing provider owns transport and LIVE gates.
export class ShopeeAffiliateAdapter implements AffiliateProviderAdapter {
  readonly providerId = 'shopee';
  readonly capabilities = Object.freeze({
    offerLookup: Object.freeze({
      lookupProduct: (externalProductId: string) =>
        this.lookupProduct(externalProductId),
    }),
    linkGeneration: Object.freeze({
      generateLink: (input: AffiliateLinkInput) => this.generateLink(input),
    }),
    mediaReferences: Object.freeze({
      getMediaReferences: (offer: ExternalAffiliateOffer) =>
        this.getMediaReferences(offer),
    }),
  });

  constructor(private readonly source: ShopeeOfferPagePort) {}

  async lookupProduct(
    externalProductId: string,
  ): Promise<readonly ExternalAffiliateOffer[]> {
    const itemId = checkedItemId(externalProductId);
    const page = await this.source.queryOfferPage({
      itemId,
      page: 1,
      limit: 1,
    });
    if (page.offers.length > 1) invalidResponse();
    return Object.freeze(
      page.offers.map((offer) => this.mapOffer(offer, itemId)),
    );
  }

  private mapOffer(
    offer: ShopeeAffiliateOfferDetails,
    externalProductId: string,
  ): ExternalAffiliateOffer {
    const provenance = observation(offer.provenance);
    return validateExternalAffiliateOffer(
      {
        schemaVersion: 'affiliate-external-offer/1.0.0',
        providerId: this.providerId,
        offerReference: offer.offerId,
        product: {
          externalProductId: offer.productId,
          name: offer.name,
          description: offer.description ?? null,
          url: offer.productUrl ?? null,
        },
        store: {
          externalStoreId: offer.shopId,
          name: offer.shopName ?? null,
        },
        price: { ...offer.price },
        priceRange: {
          min: { ...offer.priceRange.min },
          max: { ...offer.priceRange.max },
        },
        estimatedCommission: {
          ...offer.estimatedCommission,
          classification: 'ESTIMATE',
        },
        availability: 'UNKNOWN',
        reportedAffiliateUrl: offer.affiliateUrl ?? null,
        linkAssociationStatus: 'NOT_VERIFIED',
        mediaReferences:
          offer.imageUrl == null
            ? []
            : [
                {
                  providerId: this.providerId,
                  externalProductId: offer.productId,
                  kind: 'IMAGE',
                  url: offer.imageUrl,
                  rightsStatus: 'NOT_EVALUATED',
                  evidenceReferences: [],
                  provenance,
                },
              ],
        provenance,
      },
      this.providerId,
      externalProductId,
    );
  }

  getMediaReferences(
    offer: ExternalAffiliateOffer,
  ): readonly AffiliateMediaReference[] {
    return validateExternalAffiliateOffer(offer, this.providerId)
      .mediaReferences;
  }

  async generateLink(
    input: AffiliateLinkInput,
  ): Promise<AffiliateGeneratedLink> {
    const canonicalInput = validateAffiliateProviderLinkInput(input);
    const externalProductId = checkedItemId(canonicalInput.externalProductId);
    const checked = validateShopeeLinkInput({
      offerId: canonicalInput.offerReference,
      originUrl: canonicalInput.originUrl,
      ...(canonicalInput.subIds === undefined
        ? {}
        : { subIds: canonicalInput.subIds }),
    });
    const origin = new URL(checked.originUrl);
    if (
      origin.hostname !== 'shopee.com.br' ||
      !new RegExp(`^/product/\\d{1,20}/${externalProductId}$`).test(
        origin.pathname,
      )
    )
      throw new Error('SHOPEE_LINK_IDENTITY_INVALID');

    const link = await this.source.generateLink(checked);
    if (
      link.offerId !== checked.offerId ||
      link.originUrl !== checked.originUrl ||
      JSON.stringify(link.subIds) !== JSON.stringify(checked.subIds ?? null) ||
      link.associationVerified !== false
    )
      invalidResponse();
    return validateAffiliateProviderLink(
      {
        providerId: this.providerId,
        externalProductId,
        offerReference: checked.offerId,
        originUrl: checked.originUrl,
        url: link.url,
        subIds: link.subIds === null ? null : [...link.subIds],
        associationVerified: false,
        evidenceReferences: [],
        provenance: observation(link.provenance),
      },
      this.providerId,
      canonicalInput,
    );
  }
}

export const shopeeAffiliateAdapterProvider = {
  provide: AFFILIATE_PROVIDER_ADAPTERS,
  inject: [SHOPEE_AFFILIATE],
  useFactory: (source: ShopeeOfferPagePort) => [
    new ShopeeAffiliateAdapter(source),
  ],
} satisfies FactoryProvider<readonly AffiliateProviderAdapter[]>;
