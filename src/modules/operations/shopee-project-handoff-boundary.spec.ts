import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { FakeShopeeAffiliate } from '../affiliate/infrastructure/shopee-affiliate.provider.js';
import { ShopeeCatalogService } from '../affiliate/application/shopee-catalog.service.js';
import { ShopeeDynamicService } from '../affiliate/application/shopee-dynamic.service.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { ShopeeCatalogCommit } from '../affiliate/infrastructure/shopee-catalog-commit.js';
import { ShopeeDynamicJournal } from '../affiliate/infrastructure/shopee-dynamic-journal.js';
import { validateAffiliateCampaignSource } from '../affiliate/domain/affiliate-campaign-source.js';
import { validateDynamicConfiguration } from '../affiliate/domain/shopee-dynamic.js';

// Diagnostic of the unmodified production FAKE provider, not a replacement provider.
// Uses only a disposable SQLite fixture; no operational evidence or approval is created.
test('reproduces the existing FAKE provider boundary before project-first catalog preparation', async () => {
  const f = p2EditorialFixture();
  vi.stubEnv('SHOPEE_AFFILIATE_MODE', 'fake');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('EXTERNAL_TRANSPORT_FORBIDDEN');
    }),
  );
  try {
    provisionSchema(f.base.db);
    f.base.create({
      id: 'project_empty',
      name: 'Isolated first campaign',
      version: 1,
      niche: 'Tecnologia',
      subniches: [],
      audience: { profile: 'Adultos', language: 'pt-BR' },
      references: [],
      channel: {
        publishing: {
          contentsPerDay: 1,
          networks: ['instagram'],
          timezone: 'America/Sao_Paulo',
          times: ['10:00'],
        },
      },
    });
    const projects = { get: async (id: string) => f.base.get(id) };
    const affiliate = new AffiliateService(
      new SqliteAffiliatePersistence(f.database),
      projects,
      new ShopeeCatalogCommit(f.database),
    );
    const provider = new FakeShopeeAffiliate();
    const link = vi.spyOn(provider, 'generateLink');
    const catalog = new ShopeeCatalogService(provider);
    const dynamic = new ShopeeDynamicService(
      catalog,
      affiliate,
      new ShopeeDynamicJournal(f.database),
      projects,
    );
    const configuration = {
      projectId: 'project_empty',
      niche: 'tecnologia',
      queries: [{ keyword: 'fone', limit: 10 }],
      maxPages: 1,
      maxSelected: 1,
      excludedProductIds: [],
      excludedShopIds: [],
      excludedTerms: [],
      subIds: [],
      authorizations: [],
    };
    const discovery = await catalog.discover(
      configuration.queries,
      configuration.maxPages,
    );
    expect(discovery.offers).toHaveLength(2);
    expect(
      discovery.offers.every(
        (o) => o.productUrl === null && o.affiliateUrl === null,
      ),
    ).toBe(true);
    await dynamic.configure(configuration);
    const result = await dynamic.runCycle(
      'project_empty',
      'isolated_occurrence_1',
    );
    expect(
      result.decisions.every(
        (d) =>
          d.status === 'WAITING' && d.reasons.includes('OFFER_DATA_INCOMPLETE'),
      ),
    ).toBe(true);
    expect(affiliate.catalogCandidates('project_empty')).toEqual([]);
    expect(link).not.toHaveBeenCalled();
    expect(
      await dynamic.runCycle('project_empty', 'isolated_occurrence_1'),
    ).toEqual(result);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    f.cleanup();
  }
});

test('reproduces incompatible shop identity and generated FAKE URL in existing Affiliate contracts', async () => {
  const provider = new FakeShopeeAffiliate();
  const offer = (await provider.queryOfferPage()).offers[0];
  expect(offer.shopId).toBe('fake-shop-001');
  expect(() =>
    validateDynamicConfiguration({
      projectId: 'project_empty',
      niche: 'tecnologia',
      queries: [{ keyword: 'fone' }],
      maxPages: 1,
      maxSelected: 1,
      excludedProductIds: [],
      excludedShopIds: [],
      excludedTerms: [],
      subIds: [],
      authorizations: [
        {
          externalProductId: offer.productId,
          shopId: offer.shopId!,
          product: {} as never,
          mediaBinding: {} as never,
        },
      ],
    }),
  ).toThrow('SHOPEE_CONFIGURATION_INVALID');
  // Control: configuration validation accepts the same structural scope with a numeric shop.
  // Product/media placeholders are not approvals and no preparation is invoked here.
  expect(() =>
    validateDynamicConfiguration({
      projectId: 'project_empty',
      niche: 'tecnologia',
      queries: [{ keyword: 'fone' }],
      maxPages: 1,
      maxSelected: 1,
      excludedProductIds: [],
      excludedShopIds: [],
      excludedTerms: [],
      subIds: [],
      authorizations: [
        {
          externalProductId: offer.productId,
          shopId: '7',
          product: {} as never,
          mediaBinding: {} as never,
        },
      ],
    }),
  ).not.toThrow();
  // Existing legacy FAKE overload. No manual product URL and no HTTP request.
  const link = await provider.generateLink({ offerId: offer.offerId });
  expect(link.provenance.source).toBe('FAKE');
  expect(link.url).toBe('https://shopee-affiliate.invalid/link/fake-offer-001');
  const source = {
    schemaVersion: 'affiliate-campaign-source/1.0.0',
    sourceId: 'fixture_source',
    revision: 1,
    source: 'SHOPEE_AFFILIATE_API',
    offer: {
      offerId: offer.offerId,
      productId: offer.productId,
      shopId: offer.shopId,
      provenance: offer.provenance,
    },
    productId: `shopee_${offer.productId}`,
    productRevision: 1,
    campaignId: 'fixture_campaign',
    campaignRevision: 1,
    briefingId: null,
    affiliateUrl: link.url,
  };
  expect(() => validateAffiliateCampaignSource(source)).toThrow(
    'INVALID_AFFILIATE_CAMPAIGN_SOURCE',
  );
  expect(() =>
    validateAffiliateCampaignSource({
      ...source,
      affiliateUrl: 'https://s.shopee.com.br/fixture_link',
    }),
  ).not.toThrow();
});
