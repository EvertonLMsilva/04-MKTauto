import { Inject, Injectable } from '@nestjs/common';
import {
  affiliateIdentifier,
  immutable,
} from '../domain/affiliate-contracts.js';
import {
  externalAffiliateKey,
  validateExternalAffiliateOffer,
  validateAffiliateProviderLinkInput,
  validateAffiliateProviderLink,
  type AffiliateCapability,
  type AffiliateLinkInput,
  type ExternalAffiliateOffer,
} from '../domain/affiliate-provider.js';
import {
  AFFILIATE_PROVIDER_ADAPTERS,
  type AffiliateProviderAdapter,
} from './ports/affiliate-provider.port.js';

// Capability dispatch only: no catalog, persistence, scheduler or approvals.
@Injectable()
export class AffiliateProviderService {
  private readonly providers = new Map<string, AffiliateProviderAdapter>();
  constructor(
    @Inject(AFFILIATE_PROVIDER_ADAPTERS)
    adapters: readonly AffiliateProviderAdapter[],
  ) {
    for (const adapter of adapters) {
      affiliateIdentifier(adapter.providerId, 'providerId');
      const ports = adapter.capabilities;
      if (
        !ports ||
        (ports.offerLookup !== undefined &&
          typeof ports.offerLookup?.lookupProduct !== 'function') ||
        (ports.linkGeneration !== undefined &&
          typeof ports.linkGeneration?.generateLink !== 'function') ||
        (ports.mediaReferences !== undefined &&
          typeof ports.mediaReferences?.getMediaReferences !== 'function')
      )
        throw new Error('AFFILIATE_PROVIDER_CAPABILITY_INVALID');
      if (this.providers.has(adapter.providerId))
        throw new Error('AFFILIATE_PROVIDER_DUPLICATE');
      this.providers.set(adapter.providerId, {
        providerId: adapter.providerId,
        capabilities: { ...adapter.capabilities },
      });
    }
  }
  private provider(providerId: string) {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error('AFFILIATE_PROVIDER_NOT_FOUND');
    return provider;
  }
  capabilities(
    providerId: string,
  ): Readonly<Record<AffiliateCapability, boolean>> {
    const caps = this.provider(providerId).capabilities;
    return immutable({
      offerLookup: !!caps.offerLookup,
      linkGeneration: !!caps.linkGeneration,
      mediaReferences: !!caps.mediaReferences,
      conversions: false,
      realizedCommissions: false,
    });
  }
  requireCapability(providerId: string, capability: AffiliateCapability) {
    if (this.capabilities(providerId)[capability] !== true)
      throw new Error('AFFILIATE_CAPABILITY_UNSUPPORTED');
  }
  async lookupProduct(providerId: string, externalProductId: string) {
    externalAffiliateKey(providerId, 'PRODUCT', externalProductId);
    const port = this.provider(providerId).capabilities.offerLookup;
    if (!port) throw new Error('AFFILIATE_CAPABILITY_UNSUPPORTED');
    const offers = await port.lookupProduct(externalProductId);
    if (!Array.isArray(offers))
      throw new Error('AFFILIATE_PROVIDER_RESPONSE_INVALID');
    return immutable(
      offers.map((offer) =>
        validateExternalAffiliateOffer(offer, providerId, externalProductId),
      ),
    );
  }
  mediaReferences(providerId: string, offer: ExternalAffiliateOffer) {
    const checked = validateExternalAffiliateOffer(offer, providerId);
    const port = this.provider(providerId).capabilities.mediaReferences;
    if (!port) throw new Error('AFFILIATE_CAPABILITY_UNSUPPORTED');
    const references = port.getMediaReferences(checked);
    validateExternalAffiliateOffer(
      { ...checked, mediaReferences: references },
      providerId,
    );
    return immutable(structuredClone(references));
  }
  async generateLink(providerId: string, input: AffiliateLinkInput) {
    externalAffiliateKey(providerId, 'PRODUCT', input.externalProductId);
    const port = this.provider(providerId).capabilities.linkGeneration;
    if (!port) throw new Error('AFFILIATE_CAPABILITY_UNSUPPORTED');
    const checked = validateAffiliateProviderLinkInput(input);
    const link = await port.generateLink(checked);
    return validateAffiliateProviderLink(link, providerId, checked);
  }
}
