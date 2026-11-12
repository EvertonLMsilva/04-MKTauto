import { Inject, Injectable } from '@nestjs/common';
import { ShopeeDynamicService } from '../affiliate/application/shopee-dynamic.service.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import {
  SHOPEE_AFFILIATE,
  type ShopeeAffiliatePort,
} from '../affiliate/application/ports/shopee-affiliate.port.js';
import { FakeShopeeAffiliate } from '../affiliate/infrastructure/shopee-affiliate.provider.js';
import {
  affiliateHash,
  validateAffiliateProduct,
} from '../affiliate/domain/affiliate-contracts.js';
import {
  PROJECT_SNAPSHOT_READER,
  type ProjectSnapshotReader,
} from '../project/application/ports/project-snapshot-reader.port.js';
import { operationalQcIdentity } from '../publishing/application/local-qc-identity.js';
import { freezeCatalogRequest } from '../content-operations/domain/product-rotation.js';
import { handoffScope } from './project-shopee-handoff.contract.js';
import { discoveryFailure } from './project-shopee-discovery.contract.js';
import { ProjectShopeePreparationLock } from './project-shopee-preparation-lock.js';

type Selection = ReturnType<typeof freezeCatalogRequest>['catalogSelection'];
@Injectable()
export class ProjectShopeeHandoffService {
  constructor(
    @Inject(ShopeeDynamicService)
    private readonly dynamic: ShopeeDynamicService,
    @Inject(AffiliateService) private readonly affiliate: AffiliateService,
    @Inject(PROJECT_SNAPSHOT_READER)
    private readonly projects: ProjectSnapshotReader,
    @Inject(SHOPEE_AFFILIATE) private readonly provider: ShopeeAffiliatePort,
    @Inject(ProjectShopeePreparationLock)
    private readonly lock: ProjectShopeePreparationLock,
  ) {}
  private offline() {
    if (
      (process.env.SHOPEE_AFFILIATE_MODE ?? 'fake') !== 'fake' ||
      !(this.provider instanceof FakeShopeeAffiliate)
    )
      discoveryFailure('SHOPEE_HANDOFF_OFFLINE_ONLY', 403);
  }
  async prepare(projectId: string, value: unknown, principal: unknown) {
    const actor = operationalQcIdentity.assertActive(principal);
    this.offline();
    const scope = handoffScope(projectId, value);
    const project = await this.projects.get(projectId);
    if (!project) discoveryFailure('PROJECT_NOT_FOUND', 404);
    if (
      project.project.id !== projectId ||
      project.project.version !== scope.identity.projectVersion
    )
      discoveryFailure('SHOPEE_PROJECT_REVISION_MISMATCH');
    if (project.project.niche !== scope.configuration.niche)
      discoveryFailure('SHOPEE_PROJECT_NICHE_MISMATCH');
    this.offline();
    return this.lock.run(
      scope.configuration,
      async () => {
        this.offline();
        const journal = this.lock.journal;
        const binding = {
          identity: scope.identity,
          configurationHash: scope.configurationHash,
          identityHash: scope.identityHash,
          actorId: actor.id,
        };
        const previous = journal.get<typeof binding>(
          'OPERATIONS_PROJECT_HANDOFF',
          scope.key,
          'REQUEST',
        );
        if (previous && affiliateHash(previous) !== affiliateHash(binding))
          discoveryFailure('SHOPEE_HANDOFF_OCCURRENCE_CONFLICT', 409);
        journal.put(
          'OPERATIONS_PROJECT_HANDOFF',
          scope.key,
          'REQUEST',
          binding,
        );
        type Result = Awaited<
          ReturnType<ProjectShopeeHandoffService['result']>
        >;
        const replay = journal.get<Result>(
          'OPERATIONS_PROJECT_HANDOFF',
          scope.key,
          'RESULT',
        );
        if (replay) return replay;
        await this.dynamic.configure(scope.configuration);
        this.offline();
        // One explicit call reuses Affiliate's existing lease/recovery; no scheduler is started.
        const cycle = await this.dynamic.runScheduledCycle(
          projectId,
          `project_${scope.key.slice(0, 48)}`,
        );
        if (cycle.configurationHash !== scope.configurationHash)
          discoveryFailure('SHOPEE_HANDOFF_CONFIGURATION_CONFLICT', 409);
        let selection = journal.get<Selection>(
          'OPERATIONS_PROJECT_HANDOFF',
          scope.key,
          'SELECTION',
        );
        if (
          !selection &&
          cycle.decisions.some((d) => d.status === 'PREPARED')
        ) {
          const candidates = this.affiliate
            .catalogCandidates(projectId)
            .filter((candidate) =>
              cycle.decisions.some((d) => {
                if (
                  d.status !== 'PREPARED' ||
                  d.campaignId !== candidate.campaign.campaignId ||
                  !d.callId
                )
                  return false;
                const authorization = scope.configuration.authorizations.find(
                  (a) => a.externalProductId === d.productId,
                );
                const link = this.dynamic.inspectLink(d.callId)?.result;
                const completed = journal.get(
                  'PREPARATION',
                  affiliateHash({
                    product: candidate.product,
                    campaign: candidate.campaign,
                  }),
                  'COMPLETE',
                );
                return (
                  authorization &&
                  link &&
                  completed &&
                  link.provenance.source === 'FAKE' &&
                  candidate.campaign.affiliateUrl === link.url &&
                  affiliateHash(candidate.product) ===
                    affiliateHash(
                      validateAffiliateProduct(authorization.product),
                    )
                );
              }),
            );
          selection = freezeCatalogRequest(
            { briefingId: `brief_project_${scope.key.slice(0, 40)}` },
            candidates,
            null,
          ).catalogSelection;
          if (!selection)
            discoveryFailure('SHOPEE_HANDOFF_EXACT_CATALOG_REQUIRED', 409);
          journal.put(
            'OPERATIONS_PROJECT_HANDOFF',
            scope.key,
            'SELECTION',
            selection,
          );
        }
        const result = await this.result(
          scope.identityHash,
          scope.configurationHash,
          cycle,
          selection,
        );
        journal.put('OPERATIONS_PROJECT_HANDOFF', scope.key, 'RESULT', result);
        return journal.get<Result>(
          'OPERATIONS_PROJECT_HANDOFF',
          scope.key,
          'RESULT',
        )!;
      },
      scope.identity.projectVersion,
    );
  }
  private async result(
    identityHash: string,
    configurationHash: string,
    cycle: Awaited<ReturnType<ShopeeDynamicService['runCycle']>>,
    selection: Selection,
  ) {
    let briefing = null;
    if (selection) {
      const frozen = await this.affiliate.createCatalogBriefing(
        {
          briefingId: selection.briefingId,
          campaignId: selection.sourceCampaignId,
          campaignRevision: selection.sourceCampaignRevision,
        },
        selection.briefingHash,
      );
      if (frozen.contentHash !== selection.briefingHash)
        discoveryFailure('SHOPEE_HANDOFF_BRIEFING_MISMATCH', 409);
      const source = await this.affiliate.resolveBriefingSource(
        frozen.briefingId,
      );
      const decision = cycle.decisions.find(
        (d) =>
          d.status === 'PREPARED' &&
          d.campaignId === selection.sourceCampaignId,
      );
      const claim = decision?.callId
        ? this.dynamic.inspectLink(decision.callId)?.claim
        : null;
      if (
        !source ||
        !claim ||
        source.campaignId !== selection.sourceCampaignId ||
        source.campaignRevision !== selection.sourceCampaignRevision ||
        source.productId !== selection.productId ||
        source.productRevision !== selection.productRevision ||
        source.offer.offerId !== claim.offer.offerId ||
        source.offer.productId !== claim.offer.productId ||
        source.offer.shopId !== claim.offer.shopId ||
        source.affiliateUrl !== selection.affiliateUrl ||
        source.offer.provenance.source !== 'FAKE'
      )
        discoveryFailure('SHOPEE_HANDOFF_SOURCE_MISMATCH', 409);
      briefing = {
        briefingId: frozen.briefingId,
        contentHash: frozen.contentHash,
        projectId: cycle.projectId,
        productId: selection.productId,
        productRevision: selection.productRevision,
        campaignId: selection.sourceCampaignId,
        campaignRevision: selection.sourceCampaignRevision,
        offerId: source.offer.offerId,
        shopId: source.offer.shopId,
        sourceId: source.sourceId,
        sourceRevision: source.revision,
        selectionMethod: selection.method,
        cta: frozen.cta,
        disclosure: frozen.disclosure,
        affiliateUrl: source.affiliateUrl,
      };
    }
    return {
      schemaVersion: 'operations-project-shopee-handoff-result/1.0.0' as const,
      mode: 'FAKE' as const,
      projectId: cycle.projectId,
      cycleId: cycle.cycleId,
      identityHash,
      configurationHash,
      status: briefing ? ('PREPARED' as const) : ('WAITING' as const),
      decisions: cycle.decisions.map((d) => ({
        productId: d.productId,
        offerId: d.offerId,
        status: d.status,
        reasons: d.reasons,
        campaignId: d.campaignId ?? null,
        callId: d.callId ?? null,
        linkStatus: d.callId
          ? (this.dynamic.inspectLink(d.callId)?.status ?? null)
          : null,
        associationVerified: false,
      })),
      briefing,
      productionScheduled: false,
      publicationAuthorized: false,
      spendingAuthorized: false,
      operationalAcceptance: 'NOT_ASSESSED' as const,
    };
  }
}
