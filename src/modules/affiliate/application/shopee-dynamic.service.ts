import { runAffiliateIo } from './affiliate-io.js';
import type { Io } from './affiliate-io.js';
import {
  ShopeeProjectLiveAuthorizationService,
  type ShopeeProjectLiveCostEvidenceReader,
} from './shopee-project-live-authorization.service.js';
import { randomUUID } from 'node:crypto';
import { ShopeeCatalogService } from './shopee-catalog.service.js';
import { AffiliateService } from './affiliate.service.js';
import { ShopeeDynamicJournal } from '../infrastructure/shopee-dynamic-journal.js';
import type { ProjectSnapshotReader } from '../../project/application/ports/project-snapshot-reader.port.js';
import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
  validateAffiliateProduct,
  validateAffiliateCampaign,
  type AffiliateProduct,
  type AffiliateCampaign,
} from '../domain/affiliate-contracts.js';
import { eligibleCatalogCandidate } from '../domain/affiliate-catalog.js';
import {
  dynamicCampaignId,
  dynamicOfferReasons,
  rankDynamicOffers,
  scopeEvidenceMatches,
  validateDynamicConfiguration,
  type ShopeeDynamicConfiguration,
  type ShopeeDynamicDecision,
  type ShopeeDynamicResult,
} from '../domain/shopee-dynamic.js';
import type {
  ShopeeAffiliateOfferDetails,
  ShopeeGeneratedAffiliateLink,
  ShopeeAffiliateLinkInput,
} from '../domain/shopee-affiliate-contracts.js';
import { inspectQualificationImage } from '../infrastructure/qualification-image.reader.js';
import {
  normalizeShopeeLink,
  validateShopeeLinkInput,
} from '../infrastructure/shopee-links.js';
import { buildShopeeOffersQuery } from '../infrastructure/shopee-offers.js';
import {
  withShopeeLiveAuthorization,
  shopeeLiveLinkAllowed,
} from '../infrastructure/shopee-affiliate.provider.js';
export interface ShopeeLiveAuthorizationScope {
  authorizationId: string;
  campaignId: string;
  campaignRevision: number;
  productionDates: string[];
  notBefore: string;
  expiresAt: string;
  maxOfferPages: number;
  maxLinks: number;
  periodic: boolean;
  evidenceRef: string;
  costBasis: 'NO_CHARGE_CONFIRMED';
  costEvidenceRef: string;
}
export const shopeeOperationalCycleId = (campaignId: string, day: string) =>
  'ops_' + affiliateHash({ campaignId, day }).slice(0, 60);
interface LinkClaim {
  projectId: string;
  campaignId: string;
  offer: ShopeeAffiliateOfferDetails;
  input: ShopeeAffiliateLinkInput;
  callId: string;
}
interface Preparation {
  product: AffiliateProduct;
  campaign: AffiliateCampaign;
  claim: LinkClaim;
  link: ShopeeGeneratedAffiliateLink;
}
interface CycleClaim {
  configuration: ShopeeDynamicConfiguration;
  cycleId: string;
}
type Discovery = Awaited<ReturnType<ShopeeCatalogService['discover']>>;
// Public application entry point for Operations. configure once; runCycle receives
// only project + occurrence identity. No timers, publishing or financial effects.
export class ShopeeDynamicService<A extends boolean = false> {
  projectLiveAuthorization(costs?: ShopeeProjectLiveCostEvidenceReader) {
    return new ShopeeProjectLiveAuthorizationService(
      this.catalog,
      this.affiliate,
      this.journal,
      this.projects,
      costs,
    );
  }
  async previewLiveAuthorization(
    raw: ShopeeDynamicConfiguration,
    rawScope: ShopeeLiveAuthorizationScope,
  ) {
    const configuration = validateDynamicConfiguration(raw);
    for (const query of configuration.queries) buildShopeeOffersQuery(query);
    await this.verifyProject(configuration);
    const scope = structuredClone(rawScope);
    const fail = (): never => {
      throw new Error('SHOPEE_LIVE_AUTHORIZATION_INVALID');
    };
    if (
      !scope ||
      Object.keys(scope).sort().join(',') !==
        'authorizationId,campaignId,campaignRevision,costBasis,costEvidenceRef,evidenceRef,expiresAt,maxLinks,maxOfferPages,notBefore,periodic,productionDates'
    )
      fail();
    affiliateIdentifier(scope.authorizationId, 'authorizationId');
    affiliateIdentifier(scope.campaignId, 'campaignId');
    if (
      !Number.isSafeInteger(scope.campaignRevision) ||
      scope.campaignRevision < 1 ||
      !Array.isArray(scope.productionDates) ||
      scope.productionDates.length < 1 ||
      scope.productionDates.length > 31 ||
      new Set(scope.productionDates).size !== scope.productionDates.length ||
      scope.productionDates.some(
        (d) =>
          typeof d !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
          !Number.isFinite(Date.parse(d)) ||
          new Date(d).toISOString().slice(0, 10) !== d,
      ) ||
      typeof scope.periodic !== 'boolean' ||
      (scope.productionDates.length > 1 && !scope.periodic) ||
      !Number.isSafeInteger(scope.maxOfferPages) ||
      scope.maxOfferPages !== configuration.maxPages ||
      !Number.isSafeInteger(scope.maxLinks) ||
      scope.maxLinks < 0 ||
      scope.maxLinks > configuration.maxSelected ||
      scope.costBasis !== 'NO_CHARGE_CONFIRMED' ||
      [scope.evidenceRef, scope.costEvidenceRef].some(
        (s) => typeof s !== 'string' || !s.trim() || s.length > 1000,
      ) ||
      [scope.notBefore, scope.expiresAt].some(
        (s) =>
          typeof s !== 'string' ||
          !/(Z|[+-]\d\d:\d\d)$/.test(s) ||
          !Number.isFinite(Date.parse(s)),
      ) ||
      Date.parse(scope.expiresAt) <= Date.parse(scope.notBefore) ||
      Date.parse(scope.expiresAt) - Date.parse(scope.notBefore) > 32 * 86400000
    )
      fail();
    const campaign = await this.affiliate.getCampaign(
      scope.campaignId,
      scope.campaignRevision,
    );
    if (!campaign || campaign.projectId !== configuration.projectId)
      throw new Error('SHOPEE_LIVE_SCOPE_MISMATCH');
    const subject = {
      schemaVersion: 'shopee-live-authorization/1',
      mode: 'SHOPEE_LIVE' as const,
      ...scope,
      projectId: configuration.projectId,
      configurationHash: affiliateHash(configuration),
    };
    return immutable({ scope: subject, scopeHash: affiliateHash(subject) });
  }
  async approveLiveAuthorization(
    configuration: ShopeeDynamicConfiguration,
    scope: ShopeeLiveAuthorizationScope,
    expectedScopeHash: string,
    actorId: string,
  ): Promise<{
    authorizationId: string;
    scopeHash: string;
  }> {
    return runAffiliateIo(
      function* (this: ShopeeDynamicService<A>): Generator<unknown, any, any> {
        affiliateIdentifier(actorId, 'actorId');
        const preview = yield yield this.previewLiveAuthorization(
          configuration,
          scope,
        );
        if (expectedScopeHash !== preview.scopeHash)
          throw new Error('SHOPEE_LIVE_SCOPE_MISMATCH');
        yield this.journal.initialize();
        const prior = yield this.journal.get<{
          scopeHash: string;
        }>('LIVE_AUTHORIZATION', scope.authorizationId, 'GRANTED');
        if (prior && prior.scopeHash !== preview.scopeHash)
          throw new Error('SHOPEE_LIVE_SCOPE_MISMATCH');
        yield this.journal.put(
          'LIVE_AUTHORIZATION',
          scope.authorizationId,
          'GRANTED',
          {
            ...preview,
            actorId,
            recordedAt: new Date().toISOString(),
          },
        );
        if (
          (yield this.journal.get<{
            scopeHash: string;
          }>('LIVE_AUTHORIZATION', scope.authorizationId, 'GRANTED'))
            ?.scopeHash !== preview.scopeHash
        )
          throw new Error('SHOPEE_LIVE_SCOPE_MISMATCH');
        return {
          authorizationId: scope.authorizationId,
          scopeHash: preview.scopeHash,
        };
      }.call(this),
    );
  }
  async runAuthorizedScheduledCycle(
    projectId: string,
    cycleId: string,
    authorizationId: string,
    campaignId: string,
    productionDate: string,
    campaignRevision = 1,
  ) {
    const journal = this.journal as ShopeeDynamicJournal;
    if (journal.asynchronous)
      throw new Error('SHOPEE_POSTGRES_LIVE_RESERVATION_UNSUPPORTED');
    const fail = (): never => {
      throw new Error('SHOPEE_LIVE_AUTHORIZATION_REQUIRED');
    };
    if (process.env.SHOPEE_AFFILIATE_MODE !== 'live') fail();
    const grant = journal.get<{
      scope: ShopeeLiveAuthorizationScope & {
        mode: string;
        projectId: string;
        configurationHash: string;
      };
      scopeHash: string;
    }>('LIVE_AUTHORIZATION', authorizationId, 'GRANTED');
    if (
      !grant ||
      grant.scope.mode !== 'SHOPEE_LIVE' ||
      grant.scope.projectId !== projectId ||
      grant.scope.campaignId !== campaignId ||
      grant.scope.campaignRevision !== campaignRevision ||
      !grant.scope.productionDates.includes(productionDate) ||
      cycleId !== shopeeOperationalCycleId(campaignId, productionDate) ||
      Date.now() < Date.parse(grant.scope.notBefore) ||
      Date.now() >= Date.parse(grant.scope.expiresAt)
    )
      fail();
    const approved = grant!;
    const config = journal.get<ShopeeDynamicConfiguration>(
      'CONFIGURATION',
      projectId,
    );
    if (
      !config ||
      affiliateHash(config) !== approved.scope.configurationHash ||
      affiliateHash(approved.scope) !== approved.scopeHash
    )
      throw new Error('SHOPEE_LIVE_SCOPE_MISMATCH');
    const key = affiliateHash({ projectId, cycleId });
    const claim = journal.get<{
      executionMode?: string;
    }>('CYCLE', key, 'CLAIM');
    if (claim && claim.executionMode !== 'SHOPEE_LIVE')
      throw new Error('SHOPEE_LIVE_SCOPE_MISMATCH');
    return withShopeeLiveAuthorization(
      {
        ...approved.scope,
        mode: 'SHOPEE_LIVE',
        reserve: (operation, index) => {
          if (
            !journal.put('LIVE_REQUEST', key, `${operation}_${index}`, {
              authorizationId,
              campaignId,
              productionDate,
              scopeHash: approved.scopeHash,
            })
          )
            throw new Error('SHOPEE_LIVE_CALL_ALREADY_RESERVED');
        },
      },
      () => this.runScheduledCycle(projectId, cycleId),
    );
  }
  // A lease spans the bounded discovery/link budget (at most 150s). A stopped
  // worker may only be recovered after expiry, never while it still owns work.
  async runScheduledCycle(
    projectId: string,
    cycleId: string,
    now = Date.now(),
  ): Promise<ShopeeDynamicResult> {
    return runAffiliateIo(
      function* (this: ShopeeDynamicService<A>): Generator<unknown, any, any> {
        affiliateIdentifier(projectId, 'projectId');
        affiliateIdentifier(cycleId, 'cycleId');
        const key = affiliateHash({ projectId, cycleId });
        const replay = yield this.journal.get<ShopeeDynamicResult>(
          'CYCLE',
          key,
          'RESULT',
        );
        if (replay) return immutable(replay);
        const previous = yield this.journal.get<
          {
            generation: number;
            expiresAt: number;
          }
          // worker may only be recovered after expiry, never while it still owns work.
        >('SCHEDULER_LEASE', key);
        if (
          previous &&
          previous.expiresAt > now &&
          !(yield this.journal.get(
            'SCHEDULER_RELEASE',
            key,
            String(previous.generation),
          ))
        )
          throw new Error('SHOPEE_CYCLE_BUSY');
        const generation = (previous?.generation ?? 0) + 1;
        if (
          !(yield this.journal.put('SCHEDULER_LEASE', key, String(generation), {
            generation,
            expiresAt: now + 300000,
          }))
        )
          throw new Error('SHOPEE_CYCLE_BUSY');
        try {
          const claim = yield this.journal.get('CYCLE', key, 'CLAIM');
          if (claim) {
            if (!(yield this.journal.get('CYCLE', key, 'DISCOVERY')))
              throw new Error('SHOPEE_DISCOVERY_RECOVERY_UNAVAILABLE');
            return yield yield this.recoverCycle(projectId, cycleId);
          }
          return yield yield this.runCycle(projectId, cycleId);
        } finally {
          yield this.journal.put('SCHEDULER_RELEASE', key, String(generation), {
            generation,
          });
        }
      }.call(this),
    );
  }
  constructor(
    private readonly catalog: ShopeeCatalogService,
    private readonly affiliate: AffiliateService<boolean>,
    private readonly journal: ShopeeDynamicJournal<boolean>,
    private readonly projects: ProjectSnapshotReader,
  ) {}
  async configure(raw: ShopeeDynamicConfiguration): Promise<{
    configurationHash: string;
  }> {
    return runAffiliateIo(
      function* (this: ShopeeDynamicService<A>): Generator<unknown, any, any> {
        const configuration = validateDynamicConfiguration(raw);
        for (const query of configuration.queries)
          buildShopeeOffersQuery(query);
        validateShopeeLinkInput({
          offerId: 'policy',
          originUrl: 'https://shopee.com.br/product/1/1',
          subIds: configuration.subIds,
        });
        yield yield this.verifyProject(configuration);
        yield this.journal.initialize();
        yield this.journal.put(
          'CONFIGURATION',
          configuration.projectId,
          randomUUID(),
          configuration,
        );
        return { configurationHash: affiliateHash(configuration) };
      }.call(this),
    );
  }
  async runCycle(
    projectId: string,
    cycleId: string,
  ): Promise<ShopeeDynamicResult> {
    return runAffiliateIo(
      function* (this: ShopeeDynamicService<A>): Generator<unknown, any, any> {
        affiliateIdentifier(projectId, 'projectId');
        affiliateIdentifier(cycleId, 'cycleId');
        const key = affiliateHash({ projectId, cycleId });
        const replay = yield this.journal.get<ShopeeDynamicResult>(
          'CYCLE',
          key,
          'RESULT',
        );
        if (replay) return immutable(replay);
        const configuration =
          yield this.journal.get<ShopeeDynamicConfiguration>(
            'CONFIGURATION',
            projectId,
          );
        if (!configuration) throw new Error('SHOPEE_CONFIGURATION_REQUIRED');
        yield yield this.verifyProject(configuration);
        if (
          !(yield this.journal.put('CYCLE', key, 'CLAIM', {
            configuration,
            cycleId,
            executionMode:
              process.env.SHOPEE_AFFILIATE_MODE === 'live'
                ? 'SHOPEE_LIVE'
                : 'FAKE',
          }))
        )
          throw new Error('SHOPEE_CYCLE_IN_PROGRESS_OR_RECOVERY_REQUIRED');
        let discovery: Discovery;
        try {
          discovery = yield yield this.catalog.discover(
            configuration.queries,
            configuration.maxPages,
          );
          yield this.journal.put('CYCLE', key, 'DISCOVERY', discovery);
        } catch (error) {
          // Fixed taxonomy only; never persist upstream body, messages or credentials.
          const code =
            error instanceof Error &&
            [
              'SHOPEE_AUTHENTICATION_REJECTED',
              'SHOPEE_CONTRACT_ERROR',
              'SHOPEE_OFFERS_DUPLICATE_CONFLICT',
            ].includes(error.message)
              ? error.message
              : 'SHOPEE_UNAVAILABLE';
          yield this.journal.put('CYCLE', key, 'DISCOVERY_FAILED', { code });
          throw new Error(code);
        }
        return yield this.prepareCycle(key, cycleId, configuration, discovery);
      }.call(this),
    );
  }
  // Explicit recovery after a stopped worker: uses the frozen discovery only.
  // No repeated query or mutation. Unfinished link CLAIMs stay uncertain until
  // reconcileLink supplies a documented remote outcome. Safe with two recoverers:
  // link claims are unique and all catalog commands use stable replay receipts.
  async recoverCycle(
    projectId: string,
    cycleId: string,
  ): Promise<ShopeeDynamicResult> {
    return runAffiliateIo(
      function* (this: ShopeeDynamicService<A>): Generator<unknown, any, any> {
        affiliateIdentifier(projectId, 'projectId');
        affiliateIdentifier(cycleId, 'cycleId');
        const key = affiliateHash({ projectId, cycleId });
        const replay = yield this.journal.get<ShopeeDynamicResult>(
          'CYCLE',
          key,
          'RESULT',
        );
        if (replay) return immutable(replay);
        const claim = yield this.journal.get<CycleClaim>('CYCLE', key, 'CLAIM');
        const discovery = yield this.journal.get<Discovery>(
          'CYCLE',
          key,
          'DISCOVERY',
        );
        if (!claim || !discovery)
          throw new Error('SHOPEE_DISCOVERY_RECOVERY_UNAVAILABLE');
        yield yield this.verifyProject(claim.configuration);
        return yield this.prepareCycle(
          key,
          cycleId,
          claim.configuration,
          discovery,
          true,
        );
      }.call(this),
    );
  }
  async reconcileLink(
    callId: string,
    evidence: {
      url: string;
      sourceRef: string;
      recordedAt: string;
    },
  ): Promise<{
    claim: LinkClaim;
    result: ShopeeGeneratedAffiliateLink | null;
    status: string;
    associationVerified: boolean;
  } | null> {
    return runAffiliateIo(
      function* (this: ShopeeDynamicService<A>): Generator<unknown, any, any> {
        if (!/^[a-f0-9]{64}$/.test(callId))
          throw new Error('SHOPEE_RECONCILIATION_INVALID');
        const claim = yield this.journal.get<LinkClaim>(
          'LINK',
          callId,
          'CLAIM',
        );
        if (
          !claim ||
          typeof evidence?.sourceRef !== 'string' ||
          !evidence.sourceRef.trim() ||
          evidence.sourceRef.length > 1000
        )
          throw new Error('SHOPEE_RECONCILIATION_INVALID');
        const link = normalizeShopeeLink(
          { data: { generateShortLink: { shortLink: evidence.url } } },
          claim.input,
          evidence.recordedAt,
        );
        const prior =
          (yield this.journal.get<ShopeeGeneratedAffiliateLink>(
            'LINK',
            callId,
            'RESULT',
          )) ??
          (yield this.journal.get<ShopeeGeneratedAffiliateLink>(
            'LINK',
            callId,
            'RECONCILED',
          ));
        if (prior && prior.url !== link.url)
          throw new Error('SHOPEE_RECONCILIATION_CONFLICT');
        yield this.journal.put(
          'LINK',
          callId,
          'RECONCILIATION_EVIDENCE',
          evidence,
        );
        yield this.journal.put('LINK', callId, 'RECONCILED', link);
        return { callId, associationVerified: false as const };
      }.call(this),
    );
  }
  inspectLink(callId: string): Io<
    A,
    {
      claim: LinkClaim;
      result: ShopeeGeneratedAffiliateLink | null;
      status: string;
      associationVerified: boolean;
    } | null
  > {
    return runAffiliateIo(
      function* (this: ShopeeDynamicService<A>): Generator<unknown, any, any> {
        if (!/^[a-f0-9]{64}$/.test(callId))
          throw new Error('SHOPEE_LINK_IDENTITY_INVALID');
        const claim = yield this.journal.get<LinkClaim>(
          'LINK',
          callId,
          'CLAIM',
        );
        if (!claim) return null;
        const result =
          (yield this.journal.get<ShopeeGeneratedAffiliateLink>(
            'LINK',
            callId,
            'RESULT',
          )) ??
          (yield this.journal.get<ShopeeGeneratedAffiliateLink>(
            'LINK',
            callId,
            'RECONCILED',
          ));
        return immutable({
          claim,
          result,
          status: result ? 'RETURNED' : 'UNCERTAIN',
          associationVerified: false,
        });
      }.call(this),
    );
  }
  private async prepareCycle(
    key: string,
    cycleId: string,
    config: ShopeeDynamicConfiguration,
    discovery: Discovery,
    recovery = false,
  ): Promise<ShopeeDynamicResult> {
    return runAffiliateIo(
      function* (this: ShopeeDynamicService<A>): Generator<unknown, any, any> {
        const decisions: ShopeeDynamicDecision[] = [];
        let selected = 0;
        let linkCalls = 0;
        for (const offer of rankDynamicOffers(discovery.offers)) {
          const filter = dynamicOfferReasons(offer, config);
          const decision: ShopeeDynamicDecision = {
            productId: offer.productId,
            offerId: offer.offerId,
            status: filter.rejected ? 'REJECTED' : 'WAITING',
            reasons: filter.reasons,
          };
          decisions.push(decision);
          if (decision.reasons.length) continue;
          if (selected >= config.maxSelected) {
            decision.reasons = ['SELECTION_LIMIT'];
            continue;
          }
          const authorization = config.authorizations.find(
            (a) =>
              a.externalProductId === offer.productId &&
              a.shopId === offer.shopId,
          );
          if (!authorization) {
            decision.reasons = ['PRODUCT_AUTHORIZATION_REQUIRED'];
            continue;
          }
          let product: AffiliateProduct;
          try {
            product = validateAffiliateProduct(authorization.product);
          } catch {
            decision.reasons = ['PRODUCT_CONTRACT_OR_RIGHTS_INVALID'];
            continue;
          }
          if (
            product.productId !== `shopee_${offer.productId}` ||
            product.name !== offer.name ||
            product.status === 'ARCHIVED'
          ) {
            decision.reasons = ['PRODUCT_IDENTITY_MISMATCH'];
            continue;
          }
          const priorProduct = yield yield this.affiliate.getProduct(
            product.productId,
            product.revision,
          );
          if (
            (priorProduct &&
              affiliateHash(priorProduct) !== affiliateHash(product)) ||
            (yield yield this.affiliate.getProduct(
              product.productId,
              product.revision + 1,
            )) ||
            (!priorProduct &&
              product.revision > 1 &&
              !(yield yield this.affiliate.getProduct(
                product.productId,
                product.revision - 1,
              )))
          ) {
            decision.reasons = ['PRODUCT_REVISION_REVIEW_REQUIRED'];
            continue;
          }
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
          ) {
            decision.reasons = ['FAITHFUL_PRODUCT_MEDIA_EVIDENCE_REQUIRED'];
            continue;
          }
          if (
            !scopeEvidenceMatches(authorization.commercialApproval, {
              projectId: config.projectId,
              externalProductId: offer.productId,
              shopId: offer.shopId,
              productHash: affiliateHash(product),
            })
          ) {
            decision.reasons = ['COMMERCIAL_APPROVAL_REQUIRED'];
            continue;
          }
          const campaignId = dynamicCampaignId(
            config.projectId,
            offer.productId,
          );
          const draft = {
            schemaVersion: 'affiliate-campaign/1.0.0' as const,
            campaignId,
            revision: 1,
            projectId: config.projectId,
            productId: product.productId,
            productRevision: product.revision,
            affiliateUrl: 'https://s.shopee.com.br/pending',
            cta: 'Veja os detalhes do produto no link afiliado.',
            disclosure:
              'Publicidade. Posso receber comissão por compras realizadas pelo link.',
          };
          if (!eligibleCatalogCandidate({ product, campaign: draft })) {
            decision.reasons = ['REUSABLE_MEDIA_RIGHTS_REQUIRED'];
            continue;
          }
          const physical = yield inspectQualificationImage(image);
          if (physical.status !== 'VERIFIED') {
            decision.reasons = [physical.reason ?? 'LOCAL_IMAGE_REQUIRED'];
            continue;
          }
          // Ensure offer/shop identity is present in a canonical product URL. A short
          // link alone cannot establish this association and is never followed.
          const originUrl = offer.productUrl!;
          try {
            validateShopeeLinkInput({
              offerId: offer.offerId,
              originUrl,
              subIds: config.subIds,
            });
            const url = new URL(originUrl);
            if (
              url.hostname !== 'shopee.com.br' ||
              url.pathname !== `/product/${offer.shopId}/${offer.productId}`
            )
              throw new Error();
          } catch {
            decision.reasons = ['PRODUCT_ORIGIN_IDENTITY_UNVERIFIED'];
            continue;
          }
          const input = {
            offerId: offer.offerId,
            originUrl,
            subIds: config.subIds,
          };
          const callId = affiliateHash({
            projectId: config.projectId,
            campaignId,
            productId: offer.productId,
            shopId: offer.shopId,
            input,
          });
          decision.callId = callId;
          const claim: LinkClaim = {
            projectId: config.projectId,
            campaignId,
            offer,
            input,
            callId,
          };
          let link =
            (yield this.journal.get<ShopeeGeneratedAffiliateLink>(
              'LINK',
              callId,
              'RESULT',
            )) ??
            (yield this.journal.get<ShopeeGeneratedAffiliateLink>(
              'LINK',
              callId,
              'RECONCILED',
            ));
          if (!link) {
            if (
              process.env.SHOPEE_AFFILIATE_MODE === 'live' &&
              !shopeeLiveLinkAllowed()
            ) {
              decision.reasons = ['LIVE_LINK_AUTHORIZATION_REQUIRED'];
              continue;
            }
            // Recovery cannot initiate a new mutation, even if the worker stopped
            // before reserving it. A fresh occurrence may safely discover again.
            if (recovery) {
              decision.reasons = ['LINK_RECONCILIATION_REQUIRED'];
              continue;
            }
            if (linkCalls >= config.maxSelected) {
              decision.reasons = ['LINK_CALL_LIMIT'];
              continue;
            }
            const scope = affiliateHash({
              projectId: config.projectId,
              productId: offer.productId,
              shopId: offer.shopId,
            });
            if (!(yield this.journal.claimLink(callId, scope, claim))) {
              decision.reasons = ['LINK_RECONCILIATION_REQUIRED'];
              continue;
            }
            linkCalls++;
            try {
              link = yield yield this.catalog.generateTrackedLink(input);
              if (
                link.offerId !== offer.offerId ||
                link.originUrl !== originUrl ||
                JSON.stringify(link.subIds) !== JSON.stringify(config.subIds)
              )
                throw new Error();
              yield this.journal.put('LINK', callId, 'RESULT', link);
            } catch {
              yield this.journal.put('LINK', callId, 'UNCERTAIN', {
                code: 'LINK_RECONCILIATION_REQUIRED',
              });
              decision.reasons = ['LINK_RECONCILIATION_REQUIRED'];
              continue;
            }
          }
          if (
            !scopeEvidenceMatches(authorization.association, {
              projectId: config.projectId,
              campaignId,
              productId: offer.productId,
              shopId: offer.shopId,
              offerId: offer.offerId,
              originUrl,
              url: link.url,
              subIds: link.subIds,
            })
          ) {
            decision.reasons = ['AFFILIATE_ASSOCIATION_EVIDENCE_REQUIRED'];
            continue;
          }
          let previous: AffiliateCampaign | null = null;
          let revision = 1;
          // Bound local history traversal. A changed link/product appends a revision;
          // observations alone never rewrite products or historical campaign/source rows.
          for (; revision <= 100; revision++) {
            const current = yield yield this.affiliate.getCampaign(
              campaignId,
              revision,
            );
            if (!current) break;
            previous = current;
          }
          if (revision > 100) {
            decision.reasons = ['CAMPAIGN_REVISION_LIMIT'];
            continue;
          }
          const unchanged =
            previous &&
            previous.affiliateUrl === link.url &&
            previous.productId === product.productId &&
            previous.productRevision === product.revision;
          const campaign = validateAffiliateCampaign({
            ...draft,
            affiliateUrl: link.url,
            revision: unchanged ? previous!.revision : revision,
          });
          // The operator-reviewed media and commercial/association scope are retained
          // with the exact prepared revisions. The first provenance is replayed on
          // later cycles; historical source revisions are never rewritten.
          const preparationKey = affiliateHash({ product, campaign });
          yield this.journal.put('PREPARATION', preparationKey, 'INPUT', {
            product,
            campaign,
            claim: (yield this.journal.get<
              LinkClaim // Recovery cannot initiate a new mutation, even if the worker stopped
              // before reserving it. A fresh occurrence may safely discover again.
            >('LINK', callId, 'CLAIM'))!,
            link,
            authorization,
            configurationHash: affiliateHash(config),
          });
          const prepared = (yield this.journal.get<Preparation>(
            'PREPARATION',
            preparationKey,
            'INPUT',
          ))!;
          const receipt = preparationKey.slice(0, 60);
          const source = {
            schemaVersion: 'affiliate-campaign-source/1.0.0',
            sourceId: `ss_${receipt}`,
            revision: 1,
            source: 'SHOPEE_AFFILIATE_API',
            offer: {
              offerId: prepared.claim.offer.offerId,
              productId: prepared.claim.offer.productId,
              shopId: prepared.claim.offer.shopId,
              provenance: prepared.claim.offer.provenance,
            },
            productId: product.productId,
            productRevision: product.revision,
            campaignId,
            campaignRevision: prepared.campaign.revision,
            briefingId: null,
            affiliateUrl: prepared.link.url,
          };
          yield yield this.affiliate.prepareShopeeCatalog(
            prepared.product,
            prepared.campaign,
            source,
            product.media.map((m) => m.mediaRef),
            receipt,
          );
          yield this.journal.put('PREPARATION', preparationKey, 'COMPLETE', {
            productId: product.productId,
            campaignId,
            callId,
          });
          decision.status = 'PREPARED';
          decision.reasons = ['CATALOG_READY'];
          decision.campaignId = campaignId;
          selected++;
        }
        const result: ShopeeDynamicResult = {
          projectId: config.projectId,
          cycleId,
          configurationHash: affiliateHash(config),
          truncated: discovery.truncated,
          decisions,
        };
        yield this.journal.put('CYCLE', key, 'RESULT', result);
        // Another explicit recoverer might have completed first. Always return the
        // committed result, never a competing in-memory decision set.
        return immutable(
          (yield this.journal.get<ShopeeDynamicResult>(
            'CYCLE',
            key,
            'RESULT',
          ))!,
        );
      }.call(this),
    );
  }
  private async verifyProject(
    config: ShopeeDynamicConfiguration,
  ): Promise<void> {
    return runAffiliateIo(
      function* (this: ShopeeDynamicService<A>): Generator<unknown, any, any> {
        const project = yield yield this.projects.get(config.projectId);
        if (!project) throw new Error('SHOPEE_PROJECT_REQUIRED');
        if (project.project.niche !== config.niche)
          throw new Error('SHOPEE_PROJECT_NICHE_MISMATCH');
      }.call(this),
    );
  }
}
