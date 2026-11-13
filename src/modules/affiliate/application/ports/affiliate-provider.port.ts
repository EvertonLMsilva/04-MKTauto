import type {
  AffiliateGeneratedLink,
  AffiliateLinkInput,
  AffiliateMediaReference,
  ExternalAffiliateOffer,
} from '../../domain/affiliate-provider.js';

export const AFFILIATE_PROVIDER_ADAPTERS = Symbol(
  'AFFILIATE_PROVIDER_ADAPTERS',
);
export interface AffiliateOfferLookupPort {
  lookupProduct(
    externalProductId: string,
  ): Promise<readonly ExternalAffiliateOffer[]>;
}
export interface AffiliateLinkGenerationPort {
  generateLink(input: AffiliateLinkInput): Promise<AffiliateGeneratedLink>;
}
export interface AffiliateMediaReferencePort {
  // References from an existing observation; never downloads or queries again.
  getMediaReferences(
    offer: ExternalAffiliateOffer,
  ): readonly AffiliateMediaReference[];
}
export interface AffiliateProviderAdapter {
  readonly providerId: string;
  readonly capabilities: {
    readonly offerLookup?: AffiliateOfferLookupPort;
    readonly linkGeneration?: AffiliateLinkGenerationPort;
    readonly mediaReferences?: AffiliateMediaReferencePort;
  };
}
// Future conversions/realizedCommissions have separate capability names, not
// dummy methods or empty reports. They remain unsupported in this increment.
