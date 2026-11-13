import type { ProjectSnapshotReader } from '../../project/application/ports/project-snapshot-reader.port.js';
import type { AffiliateService } from './affiliate.service.js';
import type { ShopeeCatalogService } from './shopee-catalog.service.js';
import { FirstLinkPreparationService } from './first-link-preparation.js';
import {
  affiliateHash,
  affiliateIdentifier,
  AFFILIATE_PRODUCT_V2_VERSION,
  collectAffiliateProductIssues,
  immutable,
  validateAffiliateProduct,
  type AffiliateProduct,
} from '../domain/affiliate-contracts.js';
import { eligibleCatalogCandidate } from '../domain/affiliate-catalog.js';
import {
  dynamicCampaignId,
  dynamicOfferReasons,
  rankDynamicOffers,
  scopeEvidenceMatches,
  validateDynamicConfiguration,
  type ShopeeDynamicAuthorization,
  type ShopeeDynamicConfiguration,
} from '../domain/shopee-dynamic.js';
import {
  validateLinkAuthorizationDraft,
  validateProjectDiscoveryAuthorization,
  validateProjectDiscoveryIdentity,
  validateSelectedOfferLinkAuthorization,
  type LinkAuthorizationDraft,
  type ProjectDiscoveryAuthorization,
  type ProjectDiscoveryIdentity,
  type SelectedOfferLinkAuthorization,
} from '../domain/shopee-project-live-authorization.js';
import { buildShopeeOffersQuery } from '../infrastructure/shopee-offers.js';
import { inspectQualificationImage } from '../infrastructure/qualification-image.reader.js';
import { ShopeeDynamicJournal } from '../infrastructure/shopee-dynamic-journal.js';
import { withShopeeLiveAuthorization } from '../infrastructure/shopee-affiliate.provider.js';

// A trusted read-only adapter to existing financial governance, not a new cost
// policy or financial authorization. No adapter means blocked. Provisional cost
// acceptance is never sufficient, even if an adapter accidentally returns true.
export interface ShopeeProjectLiveCostEvidenceReader {
  verifyNoCharge(input: {
    kind:
      | ProjectDiscoveryAuthorization['kind']
      | SelectedOfferLinkAuthorization['kind'];
    projectId: string;
    projectVersion: number;
    occurrenceId: string;
    scopeHash: string;
    costEvidenceRef: string;
  }): Promise<boolean>;
}
type Discovery = Awaited<ReturnType<ShopeeCatalogService['discover']>>;
interface FrozenDiscovery {
  schemaVersion: 'shopee-project-discovery-result/1.0.0';
  identity: ProjectDiscoveryIdentity;
  authorizationId: string;
  scopeHash: string;
  configuration: ShopeeDynamicConfiguration;
  discovery: Discovery;
  recordedAt: string;
  snapshotHash: string;
}
interface Grant<S> {
  scope: S;
  scopeHash: string;
  actorId: string;
  configuration?: ShopeeDynamicConfiguration;
  authorization?: ShopeeDynamicAuthorization;
}
type LinkIdentity = ProjectDiscoveryIdentity & { snapshotHash: string };
const discoveryTopic = 'PROJECT_DISCOVERY_AUTHORIZATION',
  linkTopic = 'SELECTED_OFFER_LINK_AUTHORIZATION';
function identity(scope: ProjectDiscoveryIdentity): ProjectDiscoveryIdentity {
  return validateProjectDiscoveryIdentity({
    projectId: scope.projectId,
    projectVersion: scope.projectVersion,
    occurrenceId: scope.occurrenceId,
  });
}
function draft(scope: SelectedOfferLinkAuthorization): LinkAuthorizationDraft {
  const {
    authorizationId,
    operatorId,
    notBefore,
    expiresAt,
    evidenceRef,
    costBasis,
    costEvidenceRef,
  } = scope;
  return {
    authorizationId,
    operatorId,
    notBefore,
    expiresAt,
    evidenceRef,
    costBasis,
    costEvidenceRef,
  };
}

export class ShopeeProjectLiveAuthorizationService {
  constructor(
    private readonly catalog: ShopeeCatalogService,
    private readonly affiliate: AffiliateService<boolean>,
    private readonly journal: ShopeeDynamicJournal<boolean>,
    private readonly projects: ProjectSnapshotReader,
    private readonly costs?: ShopeeProjectLiveCostEvidenceReader,
    private readonly now = Date.now,
  ) {}

  private sqlite() {
    if (this.journal.asynchronous)
      throw new Error('SHOPEE_PROJECT_POSTGRES_RESERVATION_UNSUPPORTED');
    return this.journal as ShopeeDynamicJournal;
  }
  private async project(
    scope: ProjectDiscoveryIdentity,
    configuration: ShopeeDynamicConfiguration,
  ) {
    const current = await this.projects.get(scope.projectId);
    if (
      !current ||
      current.project.id !== scope.projectId ||
      current.project.version !== scope.projectVersion ||
      configuration.projectId !== scope.projectId ||
      current.project.niche.trim().toLocaleLowerCase('pt-BR') !==
        configuration.niche
    ) {
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    }
  }
  private period(scope: { notBefore: string; expiresAt: string }) {
    return this.now() < Date.parse(scope.notBefore) ||
      this.now() >= Date.parse(scope.expiresAt)
      ? ['SHOPEE_PROJECT_AUTHORIZATION_NOT_CURRENT']
      : [];
  }
  private async financial(
    scope: ProjectDiscoveryAuthorization | SelectedOfferLinkAuthorization,
    scopeHash: string,
  ) {
    if (
      scope.costBasis !== 'NO_CHARGE_CONFIRMED' ||
      !scope.costEvidenceRef ||
      !this.costs
    )
      return ['BLOCKED_COST_UNCONFIRMED'];
    try {
      return (await this.costs.verifyNoCharge({
        kind: scope.kind,
        ...identity(scope),
        scopeHash,
        costEvidenceRef: scope.costEvidenceRef,
      })) === true
        ? []
        : ['BLOCKED_COST_UNCONFIRMED'];
    } catch {
      return ['BLOCKED_COST_UNCONFIRMED'];
    }
  }
  async previewDiscovery(
    rawConfiguration: ShopeeDynamicConfiguration,
    rawScope: unknown,
  ) {
    const configuration = validateDynamicConfiguration(rawConfiguration),
      scope = validateProjectDiscoveryAuthorization(rawScope);
    // Keep Catalog's existing bounded queries/pages; discovery never grants links.
    if (
      configuration.maxPages !== scope.maxOfferPages ||
      affiliateHash(configuration) !== scope.configurationHash
    ) {
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    }
    for (const query of configuration.queries) buildShopeeOffersQuery(query);
    await this.project(scope, configuration);
    const scopeHash = affiliateHash(scope);
    return immutable({
      scope,
      scopeHash,
      blockers: [
        ...this.period(scope),
        ...(await this.financial(scope, scopeHash)),
      ],
      authorizationStatus: 'NOT_GRANTED' as const,
    });
  }
  private grant<S extends { authorizationId: string }>(
    topic: string,
    scope: S,
    scopeHash: string,
    actorId: string,
    extra: Partial<Grant<S>> = {},
  ) {
    affiliateIdentifier(actorId, 'actorId');
    const journal = this.sqlite();
    journal.initialize();
    journal.put(topic, scope.authorizationId, 'GRANTED', {
      ...extra,
      scope,
      scopeHash,
      actorId,
    });
    const saved = journal.get<Grant<S>>(
      topic,
      scope.authorizationId,
      'GRANTED',
    );
    if (!saved || saved.scopeHash !== scopeHash || saved.actorId !== actorId)
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    return immutable({ authorizationId: scope.authorizationId, scopeHash });
  }
  async approveDiscovery(
    rawConfiguration: ShopeeDynamicConfiguration,
    scope: unknown,
    expectedScopeHash: string,
    actorId: string,
  ) {
    const configuration = validateDynamicConfiguration(rawConfiguration);
    const preview = await this.previewDiscovery(configuration, scope);
    if (preview.blockers.length) throw new Error(preview.blockers[0]);
    if (preview.scopeHash !== expectedScopeHash)
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    return this.grant(
      discoveryTopic,
      preview.scope,
      preview.scopeHash,
      actorId,
      { configuration },
    );
  }
  async executeDiscovery(
    raw: ProjectDiscoveryIdentity & { authorizationId: string },
  ): Promise<FrozenDiscovery> {
    const authorizationId = raw.authorizationId;
    const scopeIdentity = identity(raw),
      key = affiliateHash(scopeIdentity),
      journal = this.sqlite();
    affiliateIdentifier(authorizationId, 'authorizationId');
    const saved = journal.get<Grant<ProjectDiscoveryAuthorization>>(
      discoveryTopic,
      authorizationId,
      'GRANTED',
    );
    if (!saved?.configuration)
      throw new Error('SHOPEE_PROJECT_AUTHORIZATION_REQUIRED');
    const preview = await this.previewDiscovery(
      saved.configuration,
      saved.scope,
    );
    if (
      preview.scopeHash !== saved.scopeHash ||
      affiliateHash(identity(saved.scope)) !== key
    )
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    if (preview.blockers.length) throw new Error(preview.blockers[0]);
    if (process.env.SHOPEE_AFFILIATE_MODE !== 'live')
      throw new Error('SHOPEE_PROJECT_LIVE_MODE_REQUIRED');
    const prior = journal.get<{ scopeHash: string }>(
      'PROJECT_DISCOVERY',
      key,
      'CLAIM',
    );
    if (prior && prior.scopeHash !== saved.scopeHash)
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    const replay = journal.get<FrozenDiscovery>(
      'PROJECT_DISCOVERY',
      key,
      'RESULT',
    );
    if (replay) return this.verifySnapshot(replay);
    if (
      !journal.put('PROJECT_DISCOVERY', key, 'CLAIM', {
        authorizationId,
        scopeHash: saved.scopeHash,
      })
    ) {
      throw new Error('SHOPEE_PROJECT_DISCOVERY_IN_PROGRESS_OR_UNCERTAIN');
    }
    try {
      const discovery = await withShopeeLiveAuthorization(
        {
          mode: 'SHOPEE_LIVE',
          expiresAt: saved.scope.expiresAt,
          maxOfferPages: saved.scope.maxOfferPages,
          maxLinks: 0,
          reserve: (operation, index) => {
            if (
              operation !== 'OFFERS' ||
              index < 1 ||
              index > saved.scope.maxOfferPages ||
              !journal.put('PROJECT_DISCOVERY', key, `OFFER_PAGE_${index}`, {
                authorizationId,
                scopeHash: saved.scopeHash,
              })
            ) {
              throw new Error('SHOPEE_PROJECT_CALL_ALREADY_RESERVED');
            }
          },
        },
        () =>
          this.catalog.discover(
            saved.configuration!.queries,
            saved.scope.maxOfferPages,
          ),
      );
      if (
        discovery.offers.some(
          (offer) => offer.provenance.source !== 'SHOPEE_LIVE',
        )
      )
        throw new Error('SHOPEE_PROJECT_LIVE_OBSERVATION_REQUIRED');
      const body = {
        schemaVersion: 'shopee-project-discovery-result/1.0.0' as const,
        identity: scopeIdentity,
        authorizationId,
        scopeHash: saved.scopeHash,
        configuration: saved.configuration,
        discovery,
        recordedAt: new Date(this.now()).toISOString(),
      };
      journal.put('PROJECT_DISCOVERY', key, 'RESULT', {
        ...body,
        snapshotHash: affiliateHash(body),
      });
      return this.verifySnapshot(
        journal.get<FrozenDiscovery>('PROJECT_DISCOVERY', key, 'RESULT')!,
      );
    } catch {
      journal.put('PROJECT_DISCOVERY', key, 'UNCERTAIN', {
        code: 'SHOPEE_PROJECT_DISCOVERY_UNCERTAIN',
      });
      throw new Error('SHOPEE_PROJECT_DISCOVERY_UNCERTAIN');
    }
  }
  private verifySnapshot(snapshot: FrozenDiscovery) {
    const { snapshotHash, ...body } = snapshot;
    if (affiliateHash(body) !== snapshotHash)
      throw new Error('SHOPEE_PROJECT_SNAPSHOT_MISMATCH');
    return immutable(snapshot);
  }
  async inspectDiscovery(raw: ProjectDiscoveryIdentity) {
    const valid = validateProjectDiscoveryIdentity(raw),
      journal = this.sqlite(),
      key = affiliateHash(valid);
    const frozen = journal.get<FrozenDiscovery>(
      'PROJECT_DISCOVERY',
      key,
      'RESULT',
    );
    if (frozen)
      return immutable({
        status: 'FROZEN' as const,
        result: this.verifySnapshot(frozen),
      });
    return immutable({
      status: journal.get('PROJECT_DISCOVERY', key, 'CLAIM')
        ? ('IN_PROGRESS_OR_UNCERTAIN' as const)
        : ('NOT_STARTED' as const),
      result: null,
    });
  }
  private async frozen(raw: LinkIdentity) {
    const scopeIdentity = identity(raw),
      report = await this.inspectDiscovery(scopeIdentity);
    if (!report.result || report.result.snapshotHash !== raw.snapshotHash)
      throw new Error('SHOPEE_PROJECT_SNAPSHOT_MISMATCH');
    await this.project(scopeIdentity, report.result.configuration);
    return report.result;
  }
  // Preparation from persisted normalized facts only. A partial proposal is not
  // an AffiliateProduct, a grant or a registration command. In particular, an
  // image URL and the discovery's provenance never manufacture usage rights.
  async previewProduct(raw: unknown) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).sort().join(',') !==
        'occurrenceId,projectId,projectVersion,snapshotHash' ||
      !('snapshotHash' in raw) ||
      typeof raw.snapshotHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(raw.snapshotHash)
    )
      throw new Error('SHOPEE_PROJECT_PRODUCT_PREPARATION_INPUT_INVALID');
    const input = immutable(raw as LinkIdentity);
    const frozen = await this.frozen(input);
    if (frozen.schemaVersion !== 'shopee-project-discovery-result/1.0.0')
      throw new Error('SHOPEE_PROJECT_SNAPSHOT_MISMATCH');
    if (affiliateHash(frozen.identity) !== affiliateHash(identity(input)))
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    const preparation = await this.preparation(frozen);
    const selection = preparation.selection;
    const offer = selection
      ? frozen.discovery.offers.find(
          (o) =>
            o.productId === selection.productId &&
            o.shopId === selection.shopId &&
            o.offerId === selection.offerId,
        )
      : undefined;
    if (selection && !offer)
      throw new Error('SHOPEE_PROJECT_SNAPSHOT_MISMATCH');
    const productId = offer ? `shopee_${offer.productId}` : null;
    // Only an absent initial revision allows proposing revision 1. Existing
    // products require explicit revision review; never pick an old revision or
    // increment history implicitly. No rights are copied from an earlier grant.
    const existing = productId
      ? await this.affiliate.getProduct(productId, 1)
      : null;
    const product: Partial<AffiliateProduct> | null = offer
      ? {
          schemaVersion: AFFILIATE_PRODUCT_V2_VERSION,
          productId: productId!,
          ...(!existing ? { revision: 1 } : {}),
          name: offer.name!,
          attributes: [],
          media: [],
          evidence: [],
        }
      : null;
    const productIssues = product ? collectAffiliateProductIssues(product) : [];
    const body = {
      schemaVersion: 'shopee-project-product-preparation/1.0.0' as const,
      identity: frozen.identity,
      snapshotHash: frozen.snapshotHash,
      configurationHash: affiliateHash(frozen.configuration),
      recordedAt: frozen.recordedAt,
      selection:
        selection && offer
          ? { ...selection, provenance: offer.provenance }
          : null,
      // Keep original URLs, nullable facts, estimates and observation provenance;
      // the compatibility projection used by selection is not a new observation.
      offer: offer ?? null,
      productDraft: product ? { product } : null,
      productIssues,
      revisionStatus: !offer
        ? ('NOT_EVALUATED' as const)
        : existing
          ? ('EXISTING_PRODUCT_REVIEW_REQUIRED' as const)
          : ('INITIAL_REVISION_PROPOSED' as const),
      unknownFields: [
        'brand',
        'attributes',
        'rights',
        'processingPermission',
        'realizedCommission',
        ...(offer?.description == null ? ['description'] : []),
        ...(offer?.availability == null ? ['availability'] : []),
        ...(offer?.price.currency == null ? ['currency'] : []),
      ],
      pending: [
        ...(!offer ? ['NO_FILTER_ELIGIBLE_CANONICAL_CANDIDATE'] : []),
        ...(productIssues.length ? ['PRODUCT_CONTRACT_INCOMPLETE'] : []),
        ...(existing ? ['PRODUCT_REVISION_REVIEW_REQUIRED'] : []),
        'LOCAL_IMAGE_REQUIRED',
        'REUSABLE_MEDIA_RIGHTS_REQUIRED',
        'COMMERCIAL_APPROVAL_REQUIRED',
        'RETURNED_LINK_ASSOCIATION_EVIDENCE_REQUIRED',
      ],
      rightsStatus: 'NOT_VERIFIED' as const,
      mediaStatus: 'LOCAL_IMAGE_REQUIRED' as const,
      associationVerified: false as const,
      status: 'BLOCKED' as const,
      finalPayload: null,
      registrationAuthorized: false as const,
      publicationAuthorized: false as const,
    };
    return immutable({ ...body, previewHash: affiliateHash(body) });
  }
  private async preparation(
    frozen: FrozenDiscovery,
    authorization?: ShopeeDynamicAuthorization,
  ) {
    const configuration = {
      ...frozen.configuration,
      queries: [{ ...frozen.configuration.queries[0], page: 1, limit: 1 }],
      maxPages: 1,
      maxSelected: 1,
      authorizations: authorization ? [authorization] : [],
    };
    // Schema projection of already frozen normalized facts, never a new remote
    // observation. Keep C-015's UNVERIFIED label and all its negative claims.
    const ranked = rankDynamicOffers(frozen.discovery.offers).filter(
      (offer) => {
        const filter = dynamicOfferReasons(offer, frozen.configuration);
        return !filter.rejected && !filter.reasons.length;
      },
    );
    const projection = (o: Discovery['offers'][number]) => ({
      itemId: o.productId,
      shopId: o.shopId,
      productName: o.name,
      shopName: o.shopName,
      price: o.price.amount,
      priceMin: o.priceRange.min.amount,
      priceMax: o.priceRange.max.amount,
      commission: o.estimatedCommission.amount,
      commissionRate: o.estimatedCommission.rate,
      priceDiscountRate: o.discountPercent,
      imageUrl: o.imageUrl,
      productLink: o.productUrl,
      offerLink: o.affiliateUrl,
    });
    const preparer = new FirstLinkPreparationService(
      this.projects,
      this.affiliate,
    );
    const prepare = (offer?: Discovery['offers'][number]) =>
      preparer.preview({
        configuration,
        projectVersion: frozen.identity.projectVersion,
        observation: {
          dataOrigin: 'UNVERIFIED_SNAPSHOT',
          observedAt: offer?.provenance.observedAt ?? frozen.recordedAt,
          response: {
            data: {
              productOfferV2: {
                nodes: offer ? [projection(offer)] : [],
                pageInfo: {
                  page: 1,
                  limit: 1,
                  hasNextPage: frozen.discovery.truncated,
                },
              },
            },
          },
        },
      });
    // C-015 checks canonical identity. Consider the full frozen ranking without
    // claiming that projected input is a new authenticated observation.
    for (const offer of ranked) {
      const prepared = await prepare(offer);
      if (prepared.selection) return prepared;
    }
    return prepare();
  }
  private async commercial(
    frozen: FrozenDiscovery,
    preparation: Awaited<ReturnType<FirstLinkPreparationService['preview']>>,
    authorization?: ShopeeDynamicAuthorization,
  ) {
    const selected = preparation.selection;
    if (
      !selected ||
      !authorization ||
      authorization.externalProductId !== selected.productId ||
      authorization.shopId !== selected.shopId
    )
      return ['PRODUCT_AUTHORIZATION_REQUIRED'];
    let product;
    try {
      product = validateAffiliateProduct(authorization.product);
    } catch {
      return ['PRODUCT_CONTRACT_OR_RIGHTS_INVALID'];
    }
    const offer = frozen.discovery.offers.find(
      (o) => o.productId === selected.productId,
    )!;
    if (
      product.productId !== `shopee_${offer.productId}` ||
      product.name !== offer.name ||
      product.status === 'ARCHIVED'
    )
      return ['PRODUCT_IDENTITY_MISMATCH'];
    const prior = await this.affiliate.getProduct(
      product.productId,
      product.revision,
    );
    if (
      (prior && affiliateHash(prior) !== affiliateHash(product)) ||
      (await this.affiliate.getProduct(
        product.productId,
        product.revision + 1,
      )) ||
      (!prior &&
        product.revision > 1 &&
        !(await this.affiliate.getProduct(
          product.productId,
          product.revision - 1,
        )))
    )
      return ['PRODUCT_REVISION_REVIEW_REQUIRED'];
    const image = product.localImage;
    if (
      !image ||
      product.media.length !== 1 ||
      product.media[0].mediaRef !== image.mediaReference ||
      image.origin !== 'AUTHORIZED_THIRD_PARTY' ||
      !scopeEvidenceMatches(authorization.mediaBinding, {
        externalProductId: offer.productId,
        shopId: offer.shopId,
        imageUrl: offer.imageUrl,
        mediaRef: image.mediaReference,
        contentHash: image.contentHash,
        faithful: true,
      })
    )
      return ['FAITHFUL_PRODUCT_MEDIA_EVIDENCE_REQUIRED'];
    if (
      !scopeEvidenceMatches(authorization.commercialApproval, {
        projectId: frozen.identity.projectId,
        externalProductId: offer.productId,
        shopId: offer.shopId,
        productHash: affiliateHash(product),
      })
    )
      return ['COMMERCIAL_APPROVAL_REQUIRED'];
    if (
      !eligibleCatalogCandidate({
        product,
        campaign: {
          schemaVersion: 'affiliate-campaign/1.0.0',
          campaignId: selected.campaignId,
          revision: 1,
          projectId: frozen.identity.projectId,
          productId: product.productId,
          productRevision: product.revision,
          affiliateUrl: 'https://s.shopee.com.br/pending',
          cta: 'Veja os detalhes do produto no link afiliado.',
          disclosure:
            'Publicidade. Posso receber comissão por compras realizadas pelo link.',
        },
      })
    )
      return ['REUSABLE_MEDIA_RIGHTS_REQUIRED'];
    const physical = await inspectQualificationImage(image);
    return physical.status === 'VERIFIED'
      ? []
      : [physical.reason ?? 'LOCAL_IMAGE_REQUIRED'];
  }
  async previewLink(
    rawIdentity: LinkIdentity,
    rawDraft: unknown,
    rawAuthorization?: ShopeeDynamicAuthorization,
  ) {
    const input = validateLinkAuthorizationDraft(rawDraft);
    const authorization = rawAuthorization
      ? immutable(structuredClone(rawAuthorization))
      : undefined;
    const frozen = await this.frozen(structuredClone(rawIdentity));
    const preparation = await this.preparation(frozen, authorization),
      blockers = await this.commercial(frozen, preparation, authorization);
    const selected = preparation.selection;
    let scope: SelectedOfferLinkAuthorization | null = null;
    if (
      selected &&
      authorization &&
      !blockers.length &&
      selected.productHash &&
      selected.productRevision
    ) {
      const selectionHash = affiliateHash({
        identity: frozen.identity,
        snapshotHash: frozen.snapshotHash,
        selection: selected,
      });
      scope = validateSelectedOfferLinkAuthorization({
        schemaVersion: 'shopee-selected-offer-link-authorization/1.0.0',
        kind: 'SELECTED_OFFER_LINK_AUTHORIZATION',
        ...input,
        ...frozen.identity,
        configurationHash: affiliateHash(frozen.configuration),
        snapshotHash: frozen.snapshotHash,
        productId: selected.productId,
        shopId: selected.shopId,
        offerId: selected.offerId,
        originUrl: selected.request.originUrl,
        subIds: selected.request.subIds,
        selectionHash,
        requestHash: selected.requestHash,
        productHash: selected.productHash,
        productRevision: selected.productRevision,
        mediaBindingHash: affiliateHash(authorization.mediaBinding),
        commercialApprovalHash: affiliateHash(authorization.commercialApproval),
        rightsEvidenceRefs: authorization.product.evidence
          .filter((e) => e.kind === 'MEDIA_USAGE_RIGHT')
          .map((e) => e.sourceRef),
        maxOfferPages: 0,
        maxLinks: 1,
      });
    }
    const scopeHash = scope ? affiliateHash(scope) : null;
    blockers.push(...this.period(input));
    blockers.push(
      ...(scope && scopeHash
        ? await this.financial(scope, scopeHash)
        : ['BLOCKED_COST_UNCONFIRMED']),
    );
    return immutable({
      scope,
      scopeHash,
      // Reuse C-015's selection/evidence projection without presenting its
      // historical campaign-bound authorization policy as this scope's gate.
      preparation: {
        sourcePreviewHash: preparation.previewHash,
        context: preparation.context,
        observation: preparation.observation,
        liveOfferSnapshotStatus: preparation.liveOfferSnapshotStatus,
        selection: preparation.selection,
        evidenceReferences: preparation.evidenceReferences,
        missingFields: preparation.missingFields,
        rightsAndCommercialStatus: preparation.rightsAndCommercialStatus,
      },
      blockers,
      pendingAfterLink: ['RETURNED_LINK_ASSOCIATION_EVIDENCE_REQUIRED'],
      authorizationStatus: 'NOT_GRANTED' as const,
      associationVerified: false as const,
      mutationExecuted: false as const,
    });
  }
  async approveLink(
    rawIdentity: LinkIdentity,
    rawDraft: unknown,
    rawAuthorization: ShopeeDynamicAuthorization,
    expectedScopeHash: string,
    actorId: string,
  ) {
    const authorization = immutable(structuredClone(rawAuthorization));
    const preview = await this.previewLink(
      rawIdentity,
      rawDraft,
      authorization,
    );
    if (preview.blockers.length) throw new Error(preview.blockers[0]);
    if (
      !preview.scope ||
      preview.scopeHash !== expectedScopeHash ||
      preview.scope.operatorId !== actorId
    )
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    return this.grant(linkTopic, preview.scope, expectedScopeHash, actorId, {
      authorization: structuredClone(authorization),
    });
  }
  async reserveLink(
    rawScope: unknown,
    expectedScopeHash: string,
    actorId: string,
  ) {
    const scope = validateSelectedOfferLinkAuthorization(rawScope),
      journal = this.sqlite();
    const grant = journal.get<Grant<SelectedOfferLinkAuthorization>>(
      linkTopic,
      scope.authorizationId,
      'GRANTED',
    );
    if (!grant?.authorization)
      throw new Error('SHOPEE_PROJECT_AUTHORIZATION_REQUIRED');
    if (
      affiliateHash(scope) !== expectedScopeHash ||
      expectedScopeHash !== grant.scopeHash ||
      actorId !== scope.operatorId ||
      actorId !== grant.actorId
    )
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    const reviewed = await this.previewLink(
      { ...identity(scope), snapshotHash: scope.snapshotHash },
      draft(scope),
      grant.authorization,
    );
    if (reviewed.blockers.length) throw new Error(reviewed.blockers[0]);
    if (reviewed.scopeHash !== expectedScopeHash)
      throw new Error('SHOPEE_PROJECT_SCOPE_MISMATCH');
    const prior = journal.get<{ scopeHash?: string; authorizationId?: string }>(
      'LINK',
      scope.requestHash,
      'CLAIM',
    );
    if (prior) {
      if (
        prior.scopeHash !== expectedScopeHash ||
        prior.authorizationId !== scope.authorizationId
      )
        throw new Error('SHOPEE_PROJECT_LINK_CLAIM_CONFLICT');
      return immutable({
        callId: scope.requestHash,
        status: 'ALREADY_RESERVED' as const,
        transportAuthorized: false as const,
        associationVerified: false as const,
      });
    }
    const frozen = await this.frozen({
      ...identity(scope),
      snapshotHash: scope.snapshotHash,
    });
    const offer = frozen.discovery.offers.find(
      (o) => o.productId === scope.productId,
    )!;
    const claim = {
      ...identity(scope),
      campaignId: dynamicCampaignId(scope.projectId, scope.productId),
      offer,
      input: reviewed.preparation.selection!.request,
      callId: scope.requestHash,
      scopeHash: expectedScopeHash,
      authorizationId: scope.authorizationId,
      selectionHash: scope.selectionHash,
    };
    if (
      !journal.claimLink(
        scope.requestHash,
        affiliateHash({
          projectId: scope.projectId,
          productId: scope.productId,
          shopId: scope.shopId,
        }),
        claim,
      )
    )
      throw new Error('SHOPEE_PROJECT_LINK_CLAIM_CONFLICT');
    // Gate/reservation only. No transport capability is returned and no mutation
    // is invoked here. A future authorized executor must reuse this exact claim.
    return immutable({
      callId: scope.requestHash,
      status: 'RESERVED' as const,
      transportAuthorized: false as const,
      associationVerified: false as const,
    });
  }
}
