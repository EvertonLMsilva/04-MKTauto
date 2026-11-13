import type { ProjectSnapshotReader } from '../../project/application/ports/project-snapshot-reader.port.js';
import type { AffiliateService } from './affiliate.service.js';
import {
  affiliateHash,
  immutable,
  validateAffiliateProduct,
  type AffiliateProduct,
} from '../domain/affiliate-contracts.js';
import {
  dynamicCampaignId,
  dynamicOfferReasons,
  rankDynamicOffers,
  validateDynamicConfiguration,
  type ShopeeDynamicConfiguration,
  type ShopeeScopeEvidence,
} from '../domain/shopee-dynamic.js';
import type { ShopeeAffiliateOfferDetails } from '../domain/shopee-affiliate-contracts.js';
import {
  buildShopeeOffersQuery,
  normalizeShopeeOfferPage,
} from '../infrastructure/shopee-offers.js';
import {
  buildShopeeLinkMutation,
  validateShopeeLinkInput,
} from '../infrastructure/shopee-links.js';

export interface FirstLinkPreparationInput {
  projectVersion: number;
  configuration: ShopeeDynamicConfiguration;
  observation: {
    // Neither label is an authenticated LIVE observation or a transport permit.
    dataOrigin: 'SIMULATED' | 'UNVERIFIED_SNAPSHOT';
    observedAt: string;
    response: unknown;
  } | null;
}

function canonicalRequest(
  offer: ShopeeAffiliateOfferDetails,
  subIds: readonly string[],
) {
  try {
    const request = validateShopeeLinkInput({
      offerId: offer.offerId,
      originUrl: offer.productUrl,
      subIds,
    });
    const url = new URL(request.originUrl);
    if (
      url.hostname !== 'shopee.com.br' ||
      url.pathname !== `/product/${offer.shopId}/${offer.productId}`
    )
      return null;
    return request;
  } catch {
    return null;
  }
}

function evidenceReference(proof: ShopeeScopeEvidence | undefined) {
  return proof
    ? {
        sourceRef: proof.sourceRef,
        recordedAt: proof.recordedAt,
        subjectHash: proof.subjectHash,
      }
    : null;
}

// Read-only preparation, not an execution adapter or a replacement for Dynamic's
// commercial/physical gates. Only project/catalog readers are injected. There is
// no HTTP port, credential source, journal writer, grant issuer or media download.
export class FirstLinkPreparationService {
  constructor(
    private readonly projects: ProjectSnapshotReader,
    private readonly affiliate: Pick<
      AffiliateService<boolean>,
      'catalogCandidates'
    >,
  ) {}

  async preview(input: FirstLinkPreparationInput) {
    if (
      !input ||
      Object.keys(input).sort().join(',') !==
        'configuration,observation,projectVersion' ||
      !Number.isSafeInteger(input.projectVersion) ||
      input.projectVersion < 1
    ) {
      throw new Error('FIRST_LINK_PREPARATION_INPUT_INVALID');
    }
    const projectVersion = input.projectVersion;
    const observation = input.observation
      ? structuredClone(input.observation)
      : null;
    const configuration = validateDynamicConfiguration(input.configuration);
    if (
      configuration.queries.length !== 1 ||
      configuration.maxPages !== 1 ||
      configuration.maxSelected !== 1
    ) {
      throw new Error('FIRST_LINK_SINGLE_OPERATION_REQUIRED');
    }
    const query = configuration.queries[0];
    const { variables, expectedItemId } = buildShopeeOffersQuery(query);
    const request = {
      ...variables,
      ...(expectedItemId === undefined ? {} : { itemId: expectedItemId }),
    };
    const project = await this.projects.get(
      configuration.projectId,
      projectVersion,
    );
    if (
      !project ||
      project.project.id !== configuration.projectId ||
      project.project.version !== projectVersion ||
      project.project.niche.trim().toLocaleLowerCase('pt-BR') !==
        configuration.niche
    ) {
      throw new Error('FIRST_LINK_PROJECT_CONTEXT_MISMATCH');
    }
    if (
      observation &&
      !['SIMULATED', 'UNVERIFIED_SNAPSHOT'].includes(observation.dataOrigin)
    ) {
      throw new Error('FIRST_LINK_OBSERVATION_BASIS_INVALID');
    }
    const page = observation
      ? normalizeShopeeOfferPage(
          observation.response,
          request,
          observation.observedAt,
        )
      : null;
    const ranked = rankDynamicOffers(page?.offers ?? []);
    const offer = ranked.find((candidate) => {
      const filter = dynamicOfferReasons(candidate, configuration);
      return (
        !filter.rejected &&
        !filter.reasons.length &&
        canonicalRequest(candidate, configuration.subIds) !== null
      );
    });
    const authorization = configuration.authorizations.find(
      (a) =>
        a.externalProductId === offer?.productId && a.shopId === offer.shopId,
    );
    let product: AffiliateProduct | null = null;
    if (authorization) {
      try {
        product = validateAffiliateProduct(authorization.product);
      } catch {
        /* Existing execution must reject invalid product/rights. */
      }
    }
    const missingFields: string[] = [];
    if (!observation) missingFields.push('observation');
    if (!product) missingFields.push('product');
    else if (!product.localImage) missingFields.push('product.localImage');
    for (const field of [
      'mediaBinding',
      'commercialApproval',
      'association',
    ] as const) {
      if (!authorization?.[field]) missingFields.push(field);
    }
    const campaignId = offer
      ? dynamicCampaignId(configuration.projectId, offer.productId)
      : null;
    const candidates = offer
      ? await this.affiliate.catalogCandidates(configuration.projectId)
      : [];
    const campaign =
      candidates.find((c) => c.campaign.campaignId === campaignId)?.campaign ??
      null;
    const blockers = [
      'FRESH_AUTHORIZED_OBSERVATION_REQUIRED',
      'LIVE_AUTHORIZATION_REQUIRED',
      'BLOCKED_COST_UNCONFIRMED',
      'EXISTING_RIGHTS_AND_COMMERCIAL_GATES_REQUIRED',
      'RETURNED_LINK_ASSOCIATION_REVIEW_REQUIRED',
    ];
    if (!offer) blockers.push('NO_FILTER_ELIGIBLE_CANONICAL_CANDIDATE');
    if (!campaign) blockers.push('REGISTERED_CAMPAIGN_REQUIRED');
    if (missingFields.length) blockers.push('COMMERCIAL_EVIDENCE_INCOMPLETE');
    if (
      product &&
      (product.productId !== `shopee_${offer?.productId}` ||
        product.name !== offer?.name ||
        product.status === 'ARCHIVED')
    ) {
      blockers.push('PRODUCT_IDENTITY_MISMATCH');
    }
    const linkRequest = offer
      ? canonicalRequest(offer, configuration.subIds)!
      : null;
    const selection =
      offer && linkRequest
        ? {
            productId: offer.productId,
            shopId: offer.shopId,
            offerId: offer.offerId,
            campaignId: campaignId!,
            campaignRevision: campaign?.revision ?? null,
            productRevision: product?.revision ?? null,
            productHash: product ? affiliateHash(product) : null,
            provenance: offer.provenance,
            eligibility: 'FILTER_ELIGIBLE_REVIEW_REQUIRED' as const,
            request: linkRequest,
            // Same identity as the existing LINK claim; this preview never reserves it.
            requestHash: affiliateHash({
              projectId: configuration.projectId,
              campaignId,
              productId: offer.productId,
              shopId: offer.shopId,
              input: linkRequest,
            }),
            mutationHash: affiliateHash(buildShopeeLinkMutation(linkRequest)),
          }
        : null;
    const body = {
      schemaVersion: 'shopee-first-link-preparation/1.0.0' as const,
      context: {
        projectId: configuration.projectId,
        projectVersion,
        projectHash: affiliateHash(project.project),
      },
      configurationHash: affiliateHash(configuration),
      liveOfferSnapshotStatus: !observation
        ? ('MISSING' as const)
        : observation.dataOrigin === 'SIMULATED'
          ? ('SIMULATED_NOT_LIVE_EVIDENCE' as const)
          : ('UNVERIFIED_NOT_LIVE_EVIDENCE' as const),
      observation:
        observation && page
          ? {
              dataOrigin: observation.dataOrigin,
              observedAt: observation.observedAt,
              snapshotHash: affiliateHash({
                offers: page.offers,
                pageInfo: page.pageInfo,
                request,
              }),
              offersObserved: page.offers.length,
              hasNextPage: page.pageInfo.hasNextPage,
              followedNextPage: false as const,
            }
          : null,
      selection,
      evidenceReferences: {
        product:
          product?.evidence.map(({ id, kind, sourceRef, recordedAt }) => ({
            id,
            kind,
            sourceRef,
            recordedAt,
          })) ?? [],
        mediaBinding: evidenceReference(authorization?.mediaBinding),
        commercialApproval: evidenceReference(
          authorization?.commercialApproval,
        ),
        association: evidenceReference(authorization?.association),
      },
      missingFields,
      authorizationStatus: 'NOT_GRANTED' as const,
      executionAllowed: false as const,
      associationVerified: false as const,
      rightsAndCommercialStatus: 'REQUIRES_EXISTING_EXECUTION_GATES' as const,
      proposedLimits: {
        maxOfferPages: 1,
        maxMutations: 1,
        operation: 'generateShortLink',
        retryMutation: false,
        publication: false,
        mediaDownload: false,
        scheduler: false,
      },
      costStatus: 'PROVISIONAL_NO_CHARGE_ASSUMPTION_OPERATOR_ACCEPTED' as const,
      quotaStatus: 'NOT_VERIFIED' as const,
      authorizationDependency: {
        entryPoint: 'ShopeeDynamicService.previewLiveAuthorization',
        requiresRegisteredCampaign: true,
        requiredExistingCostBasis: 'NO_CHARGE_CONFIRMED',
        projectFirstHandoff:
          'OPERATIONS_FAKE_ONLY_REQUIRES_FRONT_E_COORDINATION',
      },
      blockers,
      nextHumanAction:
        'REVIEW_EVIDENCE_AND_COORDINATE_PROJECT_FIRST_LIVE_AUTHORIZATION' as const,
    };
    return immutable({ ...body, previewHash: affiliateHash(body) });
  }
}
