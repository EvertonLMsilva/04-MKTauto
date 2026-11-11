import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { affiliateHash } from '../../src/modules/affiliate/domain/affiliate-contracts.js';
import type { ShopeeDynamicConfiguration } from '../../src/modules/affiliate/domain/shopee-dynamic.js';
import type { ShopeeAffiliateOfferDetails } from '../../src/modules/affiliate/domain/shopee-affiliate-contracts.js';
const { png } = await import(
  new URL('../../test-support/physical-fixtures.js', import.meta.url).href
);
const at = '2026-11-11T12:00:00Z';
const node = (id = '11', commission = '0.12') => ({
  itemId: id,
  shopId: '7',
  productName: `Fone ${id}`,
  price: '100.00',
  commissionRate: commission,
  commission: '12',
  imageUrl: `https://example.invalid/${id}.png`,
  productLink: `https://shopee.com.br/product/7/${id}`,
  offerLink: `https://s.shopee.com.br/offer_${id}`,
});

export function dynamicFixture(directory: string) {
  const mediaRoot = join(directory, 'media');
  const bytes = png();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const dir = join(mediaRoot, 'sha256', hash.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const imagePath = join(dir, hash + '.png');
  writeFileSync(imagePath, bytes);
  const grant = {
    id: 'ev_rights',
    kind: 'MEDIA_USAGE_RIGHT' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:reusable-local-transform-license',
    recordedAt: at,
    mediaAuthorization: {
      mediaRef: 'media:shopee_11',
      contentHash: hash,
      commercialUse: 'GRANTED' as const,
      processing: 'GRANTED' as const,
      localProcessing: true,
      externalProviders: [],
    },
  };
  const spec = {
    id: 'ev_spec',
    kind: 'PRODUCT_SPECIFICATION' as const,
    sourceRef: 'FICTITIOUS_TEST_ONLY:product_11',
    recordedAt: at,
  };
  const product = {
    schemaVersion: 'affiliate-product/2.0.0' as const,
    productId: 'shopee_11',
    revision: 1,
    name: 'Fone 11',
    brand: {
      status: 'NOT_PROVIDED' as const,
      name: null,
      evidenceRef: spec.id,
    },
    attributes: [{ name: 'tipo', value: 'Fone', evidenceRef: spec.id }],
    media: [
      { mediaRef: grant.mediaAuthorization.mediaRef, evidenceRef: grant.id },
    ],
    evidence: [spec, grant],
    localImage: {
      mediaReference: grant.mediaAuthorization.mediaRef,
      contentHash: hash,
      origin: 'AUTHORIZED_THIRD_PARTY' as const,
      provider: null,
      rights: {
        usageBasis: 'LICENSED' as const,
        commercialUseAllowed: true,
        evidence: [grant],
      },
    },
  };
  const proof = (subject: unknown) => ({
    sourceRef: 'FICTITIOUS_TEST_ONLY:operator-reviewed',
    recordedAt: at,
    subjectHash: affiliateHash(subject),
  });
  const config: ShopeeDynamicConfiguration = {
    projectId: 'project_001',
    niche: 'Tecnologia',
    queries: [{ keyword: 'Fone', productCatId: 3, sortType: 5, limit: 2 }],
    maxPages: 2,
    maxSelected: 1,
    minCommissionRate: '0.01',
    minPrice: '1',
    maxPrice: '1000',
    excludedProductIds: [],
    excludedShopIds: [],
    excludedTerms: [],
    subIds: ['project001', 'fones'],
    authorizations: [
      {
        externalProductId: '11',
        shopId: '7',
        product,
        mediaBinding: proof({
          externalProductId: '11',
          shopId: '7',
          imageUrl: node().imageUrl,
          mediaRef: product.localImage.mediaReference,
          contentHash: hash,
          faithful: true,
        }),
        commercialApproval: proof({
          projectId: 'project_001',
          externalProductId: '11',
          shopId: '7',
          productHash: affiliateHash(product),
        }),
        association: proof({
          projectId: 'project_001',
          campaignId: 'shopee_project_001_11',
          productId: '11',
          shopId: '7',
          offerId: 'shopee-item-11',
          originUrl: node().productLink,
          url: 'https://s.shopee.com.br/generated_11',
          subIds: ['project001', 'fones'],
        }),
      },
    ],
  };
  const raw = node();
  const provenance = {
    source: 'FAKE' as const,
    fixtureVersion: 'affiliate-postgres/1',
    observedAt: null,
  };
  const price = { amount: raw.price, currency: 'BRL' };
  const offer: ShopeeAffiliateOfferDetails = {
    offerId: 'shopee-item-11',
    productId: '11',
    shopId: '7',
    name: raw.productName,
    price,
    estimatedCommission: {
      amount: raw.commission,
      currency: 'BRL',
      rate: '0.12000000000000000000000000000001',
    },
    imageUrl: raw.imageUrl,
    provenance,
    description: null,
    availability: null,
    shopName: null,
    productUrl: raw.productLink,
    affiliateUrl: raw.offerLink,
    priceRange: { min: price, max: price },
    discountPercent: null,
  };
  const link = {
    offerId: offer.offerId,
    url: 'https://s.shopee.com.br/generated_11',
    associationVerified: false as const,
    provenance,
    originUrl: raw.productLink,
    subIds: ['project001', 'fones'],
  };
  return { config, offer, link, mediaRoot, imagePath };
}
