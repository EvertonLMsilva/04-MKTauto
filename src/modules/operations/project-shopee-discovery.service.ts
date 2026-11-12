import { Inject, Injectable } from '@nestjs/common';
import { ShopeeCatalogService } from '../affiliate/application/shopee-catalog.service.js';
import {
  SHOPEE_AFFILIATE,
  type ShopeeAffiliatePort,
} from '../affiliate/application/ports/shopee-affiliate.port.js';
import { FakeShopeeAffiliate } from '../affiliate/infrastructure/shopee-affiliate.provider.js';
import {
  PROJECT_SNAPSHOT_READER,
  type ProjectSnapshotReader,
} from '../project/application/ports/project-snapshot-reader.port.js';
import {
  dynamicOfferReasons,
  rankDynamicOffers,
} from '../affiliate/domain/shopee-dynamic.js';
import {
  projectDiscoveryInput,
  discoveryFailure,
  discoveryHandoff,
} from './project-shopee-discovery.contract.js';
@Injectable()
export class ProjectShopeeDiscoveryService {
  constructor(
    @Inject(ShopeeCatalogService)
    private readonly catalog: ShopeeCatalogService,
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly projects: ProjectSnapshotReader,
    @Inject(SHOPEE_AFFILIATE) private readonly provider: ShopeeAffiliatePort,
  ) {}
  private offlineOnly() {
    if (
      (process.env.SHOPEE_AFFILIATE_MODE ?? 'fake') !== 'fake' ||
      !(this.provider instanceof FakeShopeeAffiliate)
    )
      discoveryFailure('SHOPEE_PREVIEW_OFFLINE_ONLY', 403);
  }
  async preview(projectId: string, value: unknown) {
    this.offlineOnly();
    const { configuration, projectVersion } = projectDiscoveryInput(
      projectId,
      value,
    );
    const project = await this.projects.get(projectId);
    if (!project) discoveryFailure('PROJECT_NOT_FOUND', 404);
    if (
      project.project.id !== projectId ||
      (projectVersion !== undefined &&
        project.project.version !== projectVersion)
    )
      discoveryFailure('SHOPEE_PROJECT_REVISION_MISMATCH');
    if (project.project.niche !== configuration.niche)
      discoveryFailure('SHOPEE_PROJECT_NICHE_MISMATCH');
    this.offlineOnly();
    let found: Awaited<ReturnType<ShopeeCatalogService['discover']>>;
    try {
      found = await this.catalog.discover(
        configuration.queries,
        configuration.maxPages,
      );
    } catch (error) {
      if (error instanceof Error && /^SHOPEE_[A-Z_]+$/.test(error.message))
        discoveryFailure(error.message);
      discoveryFailure('SHOPEE_DISCOVERY_UNAVAILABLE', 503);
    }
    if (found.offers.some((o) => o.provenance.source !== 'FAKE'))
      discoveryFailure('SHOPEE_PREVIEW_OFFLINE_ONLY', 403);
    const ranked = rankDynamicOffers(found.offers).map((offer, index) => {
      const decision = dynamicOfferReasons(offer, configuration);
      // Explicit projection: no raw payloads, credentials, URLs or generated links.
      return {
        rank: index + 1,
        productId: offer.productId,
        shopId: offer.shopId,
        offerId: offer.offerId,
        name: offer.name,
        provenance: {
          source: 'FAKE' as const,
          fixtureVersion: offer.provenance.fixtureVersion,
          observedAt: null,
        },
        price: { amount: offer.price.amount, currency: offer.price.currency },
        priceMeaning: 'OBSERVED_NOT_PERMANENT' as const,
        estimatedCommission: {
          amount: offer.estimatedCommission.amount,
          currency: offer.estimatedCommission.currency,
          rate: offer.estimatedCommission.rate,
        },
        eligibility: 'NOT_EVALUATED' as const,
        status: decision.rejected
          ? ('REJECTED_BY_FILTER' as const)
          : ('REVIEW_REQUIRED' as const),
        reasons: decision.reasons,
        requiredReviews: [
          'MEDIA_RIGHTS_REQUIRED',
          'COMMERCIAL_APPROVAL_REQUIRED',
          'ASSOCIATION_REQUIRED',
          'LINK_REVIEW_REQUIRED',
          'ELIGIBLE_REGISTRATION_REQUIRED',
          'PRODUCTION_APPROVAL_REQUIRED',
          'PUBLICATION_APPROVAL_REQUIRED',
        ],
      };
    });
    const matching = ranked.filter((o) => o.status !== 'REJECTED_BY_FILTER');
    return {
      schemaVersion:
        'operations-project-shopee-discovery-preview/1.0.0' as const,
      project: {
        projectId: project.project.id,
        projectVersion: project.project.version,
        niche: project.project.niche,
      },
      providerMode: 'FAKE' as const,
      candidates: matching.slice(0, configuration.maxSelected),
      rejected: ranked.filter((o) => o.status === 'REJECTED_BY_FILTER'),
      limits: {
        maxPages: configuration.maxPages,
        maxCandidates: configuration.maxSelected,
        queries: configuration.queries,
        calls: found.calls,
        observedCandidates: ranked.length,
        omittedCandidates: Math.max(
          0,
          matching.length - configuration.maxSelected,
        ),
      },
      truncated: found.truncated || matching.length > configuration.maxSelected,
      authorizationsGranted: false as const,
      handoff: discoveryHandoff,
    };
  }
}
