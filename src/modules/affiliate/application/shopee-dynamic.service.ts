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
export class ShopeeDynamicService {
  constructor(
    private readonly catalog: ShopeeCatalogService,
    private readonly affiliate: AffiliateService,
    private readonly journal: ShopeeDynamicJournal,
    private readonly projects: ProjectSnapshotReader,
  ) {}

  async configure(raw: ShopeeDynamicConfiguration) {
    const configuration = validateDynamicConfiguration(raw);
    for (const query of configuration.queries) buildShopeeOffersQuery(query);
    validateShopeeLinkInput({
      offerId: 'policy',
      originUrl: 'https://shopee.com.br/product/1/1',
      subIds: configuration.subIds,
    });
    await this.verifyProject(configuration);
    this.journal.initialize();
    this.journal.put(
      'CONFIGURATION',
      configuration.projectId,
      randomUUID(),
      configuration,
    );
    return { configurationHash: affiliateHash(configuration) };
  }

  async runCycle(
    projectId: string,
    cycleId: string,
  ): Promise<ShopeeDynamicResult> {
    affiliateIdentifier(projectId, 'projectId');
    affiliateIdentifier(cycleId, 'cycleId');
    const key = affiliateHash({ projectId, cycleId });
    const replay = this.journal.get<ShopeeDynamicResult>(
      'CYCLE',
      key,
      'RESULT',
    );
    if (replay) return immutable(replay);
    const configuration = this.journal.get<ShopeeDynamicConfiguration>(
      'CONFIGURATION',
      projectId,
    );
    if (!configuration) throw new Error('SHOPEE_CONFIGURATION_REQUIRED');
    await this.verifyProject(configuration);
    if (!this.journal.put('CYCLE', key, 'CLAIM', { configuration, cycleId }))
      throw new Error('SHOPEE_CYCLE_IN_PROGRESS_OR_RECOVERY_REQUIRED');
    let discovery: Discovery;
    try {
      discovery = await this.catalog.discover(
        configuration.queries,
        configuration.maxPages,
      );
      this.journal.put('CYCLE', key, 'DISCOVERY', discovery);
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
      this.journal.put('CYCLE', key, 'DISCOVERY_FAILED', { code });
      throw new Error(code);
    }
    return this.prepareCycle(key, cycleId, configuration, discovery);
  }

  // Explicit recovery after a stopped worker: uses the frozen discovery only.
  // No repeated query or mutation. Unfinished link CLAIMs stay uncertain until
  // reconcileLink supplies a documented remote outcome. Safe with two recoverers:
  // link claims are unique and all catalog commands use stable replay receipts.
  async recoverCycle(
    projectId: string,
    cycleId: string,
  ): Promise<ShopeeDynamicResult> {
    affiliateIdentifier(projectId, 'projectId');
    affiliateIdentifier(cycleId, 'cycleId');
    const key = affiliateHash({ projectId, cycleId });
    const replay = this.journal.get<ShopeeDynamicResult>(
      'CYCLE',
      key,
      'RESULT',
    );
    if (replay) return immutable(replay);
    const claim = this.journal.get<CycleClaim>('CYCLE', key, 'CLAIM');
    const discovery = this.journal.get<Discovery>('CYCLE', key, 'DISCOVERY');
    if (!claim || !discovery)
      throw new Error('SHOPEE_DISCOVERY_RECOVERY_UNAVAILABLE');
    await this.verifyProject(claim.configuration);
    return this.prepareCycle(
      key,
      cycleId,
      claim.configuration,
      discovery,
      true,
    );
  }

  async reconcileLink(
    callId: string,
    evidence: { url: string; sourceRef: string; recordedAt: string },
  ) {
    if (!/^[a-f0-9]{64}$/.test(callId))
      throw new Error('SHOPEE_RECONCILIATION_INVALID');
    const claim = this.journal.get<LinkClaim>('LINK', callId, 'CLAIM');
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
      this.journal.get<ShopeeGeneratedAffiliateLink>(
        'LINK',
        callId,
        'RESULT',
      ) ??
      this.journal.get<ShopeeGeneratedAffiliateLink>(
        'LINK',
        callId,
        'RECONCILED',
      );
    if (prior && prior.url !== link.url)
      throw new Error('SHOPEE_RECONCILIATION_CONFLICT');
    this.journal.put('LINK', callId, 'RECONCILIATION_EVIDENCE', evidence);
    this.journal.put('LINK', callId, 'RECONCILED', link);
    return { callId, associationVerified: false as const };
  }

  inspectLink(callId: string) {
    if (!/^[a-f0-9]{64}$/.test(callId))
      throw new Error('SHOPEE_LINK_IDENTITY_INVALID');
    const claim = this.journal.get<LinkClaim>('LINK', callId, 'CLAIM');
    if (!claim) return null;
    const result =
      this.journal.get<ShopeeGeneratedAffiliateLink>(
        'LINK',
        callId,
        'RESULT',
      ) ??
      this.journal.get<ShopeeGeneratedAffiliateLink>(
        'LINK',
        callId,
        'RECONCILED',
      );
    return immutable({
      claim,
      result,
      status: result ? 'RETURNED' : 'UNCERTAIN',
      associationVerified: false,
    });
  }

  private async prepareCycle(
    key: string,
    cycleId: string,
    config: ShopeeDynamicConfiguration,
    discovery: Discovery,
    recovery = false,
  ) {
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
          a.externalProductId === offer.productId && a.shopId === offer.shopId,
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
      const priorProduct = await this.affiliate.getProduct(
        product.productId,
        product.revision,
      );
      if (
        (priorProduct &&
          affiliateHash(priorProduct) !== affiliateHash(product)) ||
        (await this.affiliate.getProduct(
          product.productId,
          product.revision + 1,
        )) ||
        (!priorProduct &&
          product.revision > 1 &&
          !(await this.affiliate.getProduct(
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
      const campaignId = dynamicCampaignId(config.projectId, offer.productId);
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
      const physical = await inspectQualificationImage(image);
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
        this.journal.get<ShopeeGeneratedAffiliateLink>(
          'LINK',
          callId,
          'RESULT',
        ) ??
        this.journal.get<ShopeeGeneratedAffiliateLink>(
          'LINK',
          callId,
          'RECONCILED',
        );
      if (!link) {
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
        if (!this.journal.claimLink(callId, scope, claim)) {
          decision.reasons = ['LINK_RECONCILIATION_REQUIRED'];
          continue;
        }
        linkCalls++;
        try {
          link = await this.catalog.generateTrackedLink(input);
          if (
            link.offerId !== offer.offerId ||
            link.originUrl !== originUrl ||
            JSON.stringify(link.subIds) !== JSON.stringify(config.subIds)
          )
            throw new Error();
          this.journal.put('LINK', callId, 'RESULT', link);
        } catch {
          this.journal.put('LINK', callId, 'UNCERTAIN', {
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
        const current = await this.affiliate.getCampaign(campaignId, revision);
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
      this.journal.put('PREPARATION', preparationKey, 'INPUT', {
        product,
        campaign,
        claim: this.journal.get<LinkClaim>('LINK', callId, 'CLAIM')!,
        link,
        authorization,
        configurationHash: affiliateHash(config),
      });
      const prepared = this.journal.get<Preparation>(
        'PREPARATION',
        preparationKey,
        'INPUT',
      )!;
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
      await this.affiliate.prepareShopeeCatalog(
        prepared.product,
        prepared.campaign,
        source,
        product.media.map((m) => m.mediaRef),
        receipt,
      );
      this.journal.put('PREPARATION', preparationKey, 'COMPLETE', {
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
    this.journal.put('CYCLE', key, 'RESULT', result);
    // Another explicit recoverer might have completed first. Always return the
    // committed result, never a competing in-memory decision set.
    return immutable(
      this.journal.get<ShopeeDynamicResult>('CYCLE', key, 'RESULT')!,
    );
  }
  private async verifyProject(config: ShopeeDynamicConfiguration) {
    const project = await this.projects.get(config.projectId);
    if (!project) throw new Error('SHOPEE_PROJECT_REQUIRED');
    if (project.project.niche !== config.niche)
      throw new Error('SHOPEE_PROJECT_NICHE_MISMATCH');
  }
}
