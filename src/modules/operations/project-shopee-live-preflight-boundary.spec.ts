import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { ShopeeCatalogService } from '../affiliate/application/shopee-catalog.service.js';
import { ShopeeDynamicService } from '../affiliate/application/shopee-dynamic.service.js';
import { FakeShopeeAffiliate } from '../affiliate/infrastructure/shopee-affiliate.provider.js';
import { ShopeeDynamicJournal } from '../affiliate/infrastructure/shopee-dynamic-journal.js';
import { SqliteAffiliatePersistence } from '../affiliate/infrastructure/sqlite-affiliate.persistence.js';
import { NativeCampaignWorkflow } from '../content-operations/application/native-campaign-workflow.js';

// Diagnostic only: no permission is granted and no provider is invoked.
// The unknown campaign identity is a negative fixture, never a proposed identity.
test.each([0, 1])(
  'project-first authorization cannot be previewed without a registered campaign, even with maxLinks=%i',
  async (maxLinks) => {
    const f = p2EditorialFixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('LIVE_HTTP_FORBIDDEN');
      }),
    );
    try {
      provisionSchema(f.base.db);
      f.base.create({
        id: 'project_empty',
        name: 'FICTITIOUS_TEST_ONLY',
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
      );
      const provider = new FakeShopeeAffiliate();
      const pages = vi.spyOn(provider, 'queryOfferPage');
      const links = vi.spyOn(provider, 'generateLink');
      const journal = new ShopeeDynamicJournal(f.database);
      const initialize = vi.spyOn(journal, 'initialize');
      const writes = vi.spyOn(journal, 'put');
      const dynamic = new ShopeeDynamicService(
        new ShopeeCatalogService(provider),
        affiliate,
        journal,
        projects,
      );
      const configuration = {
        projectId: 'project_empty',
        niche: 'tecnologia',
        queries: [{ keyword: 'fone', limit: 1 }],
        maxPages: 1,
        maxSelected: 1,
        excludedProductIds: [],
        excludedShopIds: [],
        excludedTerms: [],
        subIds: [],
        authorizations: [],
      };
      const scope = {
        authorizationId: 'fixture_never_granted',
        campaignId: 'fixture_campaign_not_registered',
        campaignRevision: 1,
        productionDates: ['2026-11-12'],
        periodic: false,
        notBefore: '2026-11-12T00:00:00Z',
        expiresAt: '2026-11-13T00:00:00Z',
        maxOfferPages: 1,
        maxLinks,
        evidenceRef: 'FICTITIOUS_TEST_ONLY:proposal-not-approval',
        costBasis: 'NO_CHARGE_CONFIRMED' as const,
        costEvidenceRef: 'FICTITIOUS_TEST_ONLY:cost-proposal',
      };
      const digest = () =>
        createHash('sha256').update(readFileSync(f.database)).digest('hex');
      const before = digest();
      expect(affiliate.catalogCandidates('project_empty')).toEqual([]);
      await expect(
        dynamic.previewLiveAuthorization(configuration, scope),
      ).rejects.toThrow('SHOPEE_LIVE_SCOPE_MISMATCH');
      // Existing registered identities are mandatory even for a read-only proposal.
      await expect(
        dynamic.previewLiveAuthorization(configuration, {
          ...scope,
          campaignId: 'camp_001',
        }),
      ).rejects.toThrow('SHOPEE_LIVE_SCOPE_MISMATCH');
      const existing = await dynamic.previewLiveAuthorization(
        { ...configuration, projectId: 'project_001' },
        { ...scope, campaignId: 'camp_001' },
      );
      expect(existing.scope.campaignId).toBe('camp_001');
      expect(existing.scopeHash).toMatch(/^[a-f0-9]{64}$/);
      // Unused ports stay inert: localRequest must stop at the missing campaign.
      const workflow = new NativeCampaignWorkflow(
        affiliate,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      await expect(
        workflow.localRequest({
          campaignId: scope.campaignId,
          campaignRevision: 1,
          projectVersion: 1,
          requestId: 'fixture_request',
          requestedAt: '2026-11-12T12:00:00Z',
          selectionMode: 'CATALOG',
          recurrence: { enabled: true },
        }),
      ).rejects.toThrow('CAMPAIGN_CONTEXT_NOT_FOUND');
      expect(digest()).toBe(before);
      expect(initialize).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
      expect(pages).not.toHaveBeenCalled();
      expect(links).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      f.cleanup();
    }
  },
);
