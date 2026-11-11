import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
  collectAffiliateProductIssues,
  validateAffiliateProduct,
  validateAffiliateCampaign,
} from '../domain/affiliate-contracts.js';
import { eligibleCatalogCandidate } from '../domain/affiliate-catalog.js';
import { DEFAULT_AFFILIATE_DISCOVERY_POLICY } from '../domain/affiliate-discovery.js';
import { validateShopeeUrl } from '../domain/shopee-link-url.js';
import { ContractValidationError } from '../domain/affiliate.errors.js';
import { catalogError } from '../infrastructure/discovery-error.js';
import { inspectQualificationImage } from '../infrastructure/qualification-image.reader.js';
import { FeedQualificationService } from './feed-qualification.service.js';
import type { AffiliateRepositoryFactory } from './ports/affiliate-repository.port.js';
import type { ProjectSnapshotReader } from '../../project/application/ports/project-snapshot-reader.port.js';
import type {
  RegisterProductDto,
  RegisterCampaignDto,
} from './affiliate-commands.dto.js';

export class QualificationPreviewService {
  constructor(
    private readonly feeds: FeedQualificationService,
    private readonly persistence?: AffiliateRepositoryFactory<boolean>,
    private readonly projects?: ProjectSnapshotReader,
  ) {}
  async preview(raw: unknown) {
    const fail = (code: string): never => {
      throw catalogError(code);
    };
    const required = [
      'reportId',
      'externalProductId',
      'projectId',
      'recordedAt',
    ];
    const allowed = [...required, 'product', 'campaign', 'affiliateEvidence'];
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      required.some((k) => !Object.hasOwn(raw, k)) ||
      Object.keys(raw).some((k) => !allowed.includes(k))
    )
      fail('QUALIFICATION_PREVIEW_INVALID_INPUT');
    const input = raw as Record<string, any>;
    affiliateIdentifier(input.projectId, 'projectId');
    if (
      typeof input.reportId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.reportId) ||
      typeof input.externalProductId !== 'string' ||
      !/^[1-9]\d{0,39}$/.test(input.externalProductId) ||
      typeof input.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.recordedAt) ||
      !Number.isFinite(Date.parse(input.recordedAt))
    )
      fail('QUALIFICATION_PREVIEW_INVALID_INPUT');
    const report = await this.feeds.analyze();
    if (input.reportId !== report.reportId)
      fail('FEED_QUALIFICATION_REPORT_CHANGED');
    const candidate =
      report.items.find(
        (r) =>
          r.externalProductId === input.externalProductId &&
          r.classification === 'PRE_CANDIDATE',
      ) ?? fail('QUALIFICATION_PREVIEW_CANDIDATE_REQUIRED');
    const source = report.sources.find(
      (s) => s.feedId === candidate.source.feedId,
    )!;
    const spec = {
      id: 'ev_feed_' + input.externalProductId,
      kind: 'PRODUCT_SPECIFICATION',
      sourceRef: `local-feed:sha256:${source.sha256}:row:${candidate.source.rowNumber}:itemid:${input.externalProductId}`,
      recordedAt: new Date(input.recordedAt).toISOString(),
    };
    const product = input.product ?? {
      schemaVersion: 'affiliate-product/2.0.0',
      productId: 'prod_shopee_' + input.externalProductId,
      revision: 1,
      name: candidate.name,
      brand: { status: 'NOT_PROVIDED', name: null, evidenceRef: spec.id },
      attributes: [
        {
          name: 'categoria_no_catalogo',
          value: candidate.subcategory ?? candidate.category ?? candidate.name,
          evidenceRef: spec.id,
        },
      ],
      media: [],
      evidence: [spec],
    };
    const campaign = input.campaign ?? {
      schemaVersion: 'affiliate-campaign/1.0.0',
      campaignId: 'offer_shopee_' + input.externalProductId,
      revision: 1,
      projectId: input.projectId,
      productId: product.productId,
      productRevision: product.revision,
      affiliateUrl: null,
      cta: 'Veja os detalhes do produto no link afiliado.',
      disclosure:
        'Publicidade. Posso receber comissão por compras realizadas pelo link.',
    };
    if (
      !product ||
      typeof product !== 'object' ||
      Array.isArray(product) ||
      !campaign ||
      typeof campaign !== 'object' ||
      Array.isArray(campaign) ||
      product.productId !== 'prod_shopee_' + input.externalProductId ||
      product.name !== candidate.name ||
      campaign.campaignId !== 'offer_shopee_' + input.externalProductId ||
      campaign.projectId !== input.projectId ||
      campaign.productId !== product.productId ||
      campaign.productRevision !== product.revision
    )
      fail('QUALIFICATION_PREVIEW_SCOPE_MISMATCH');
    const pending: string[] = [];
    if (
      !Array.isArray(product.evidence) ||
      !product.evidence.some(
        (e: any) =>
          e &&
          typeof e === 'object' &&
          !Array.isArray(e) &&
          affiliateHash(e) === affiliateHash(spec),
      )
    )
      pending.push('FEED_SPECIFICATION_EVIDENCE_REQUIRED');
    const productIssues = collectAffiliateProductIssues(product);
    const offerIssues: { code: string; field: string }[] = [];
    let validProduct: ReturnType<typeof validateAffiliateProduct> | undefined;
    let validCampaign: ReturnType<typeof validateAffiliateCampaign> | undefined;
    if (productIssues.length) pending.push('PRODUCT_CONTRACT_INVALID');
    else validProduct = validateAffiliateProduct(product);
    try {
      validCampaign = validateAffiliateCampaign(campaign);
    } catch (error) {
      if (!(error instanceof ContractValidationError)) throw error;
      offerIssues.push({ code: error.code, field: error.path });
      pending.push('OFFER_CONTRACT_INVALID');
    }
    if (!campaign.affiliateUrl) pending.push('AFFILIATE_LINK_REQUIRED');
    else {
      try {
        validateShopeeUrl(
          campaign.affiliateUrl,
          new Set(DEFAULT_AFFILIATE_DISCOVERY_POLICY.allowedAffiliateHosts),
          'AFFILIATE_LINK_INVALID',
          fail,
        );
      } catch {
        pending.push('AFFILIATE_LINK_INVALID');
      }
    }
    const proof = input.affiliateEvidence;
    if (
      !proof ||
      typeof proof !== 'object' ||
      Array.isArray(proof) ||
      Object.keys(proof).sort().join(',') !==
        'recordedAt,sourceRef,subjectHash' ||
      typeof proof.sourceRef !== 'string' ||
      !proof.sourceRef.trim() ||
      proof.sourceRef.length > 1000 ||
      typeof proof.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(proof.recordedAt) ||
      !Number.isFinite(Date.parse(proof.recordedAt)) ||
      proof.subjectHash !==
        affiliateHash({
          externalProductId: input.externalProductId,
          affiliateUrl: campaign.affiliateUrl,
        })
    )
      pending.push('AFFILIATE_ASSOCIATION_EVIDENCE_REQUIRED');
    const mediaEvidence = await inspectQualificationImage(
      validProduct?.localImage,
    );
    if (mediaEvidence.status !== 'VERIFIED')
      pending.push(mediaEvidence.reason ?? 'LOCAL_IMAGE_REQUIRED');
    const catalogValidationPassed =
      !!validProduct &&
      !!validCampaign &&
      eligibleCatalogCandidate({
        product: validProduct,
        campaign: validCampaign,
      });
    if (!catalogValidationPassed)
      pending.push('REUSABLE_MEDIA_RIGHTS_REQUIRED');
    const context: { projectHash: string | null; revisionsVerified: boolean } =
      { projectHash: null, revisionsVerified: false };
    if (!this.persistence || !this.projects)
      pending.push('PROJECT_SCOPE_UNVERIFIED', 'REVISION_SCOPE_UNVERIFIED');
    else {
      try {
        const project = await this.projects.get(input.projectId);
        if (!project) pending.push('PROJECT_NOT_FOUND');
        else context.projectHash = affiliateHash(project);
        const repo = await this.persistence.open(true);
        try {
          const check = async (
            read: (id: string, r: number) => unknown,
            id: string,
            revision: number,
            value: unknown,
            prefix: string,
          ) => {
            if (!Number.isSafeInteger(revision) || revision < 1) {
              pending.push(prefix + '_REVISION_INVALID');
              return;
            }
            const current = await read(id, revision);
            if (await read(id, revision + 1))
              pending.push(prefix + '_REVISION_STALE');
            if (current && affiliateHash(current) !== affiliateHash(value))
              pending.push(prefix + '_REVISION_CONFLICT');
            if (!current && revision > 1 && !(await read(id, revision - 1)))
              pending.push(prefix + '_PREVIOUS_REVISION_REQUIRED');
          };
          await check(
            (id, r) => repo.getProduct(id, r),
            product.productId,
            product.revision,
            product,
            'PRODUCT',
          );
          await check(
            (id, r) => repo.getCampaign(id, r),
            campaign.campaignId,
            campaign.revision,
            campaign,
            'OFFER',
          );
          context.revisionsVerified = !pending.some((r) => /REVISION/.test(r));
        } finally {
          await repo.close();
        }
      } catch {
        pending.push('CATALOG_CONTEXT_UNAVAILABLE');
      }
    }
    const productDraft: RegisterProductDto = {
      idempotencyKey: 'preview_product_' + affiliateHash(product).slice(0, 40),
      product,
    };
    const offerDraft: RegisterCampaignDto = {
      idempotencyKey: 'preview_offer_' + affiliateHash(campaign).slice(0, 40),
      campaign,
    };
    const blockers = [...new Set(pending)].sort();
    const body = {
      previewVersion: 'affiliate-qualification-preview/1.0.0',
      reportId: report.reportId,
      selectedProduct: {
        externalProductId: candidate.externalProductId,
        name: candidate.name,
        productUrl: candidate.productUrl,
      },
      provenance: {
        ...candidate.source,
        sourceHash: source.sha256,
        sourceUpdatedAt: source.sourceUpdatedAt,
        originVerified: source.originVerified,
      },
      productDraft,
      offerDraft,
      productIssues,
      offerIssues,
      mediaEvidence,
      affiliateEvidence: proof ?? null,
      evidenceBasis: 'OPERATOR_DOCUMENTED_DECLARATIONS_REQUIRE_HUMAN_REVIEW',
      context,
      commercialSnapshot: {
        historicalPrice: candidate.historicalPrice,
        brandAvailableFromFeed: false,
        availability: null,
        commission: null,
      },
      unconfirmedCommercialData: [
        'CURRENCY_UNPROVEN',
        'CURRENT_PRICE_UNPROVEN',
        'AVAILABILITY_UNPROVEN',
        'COMMISSION_UNPROVEN',
      ],
      pending: blockers,
      catalogValidationPassed: catalogValidationPassed && blockers.length === 0,
      status: blockers.length ? 'BLOCKED' : 'READY_FOR_OPERATOR_REVIEW',
      registrationAuthorized: false,
      operationallyRegistered: false,
      finalPayload: blockers.length
        ? null
        : { product: productDraft, offer: offerDraft },
    };
    return immutable({ ...body, packageHash: affiliateHash(body) });
  }
}
