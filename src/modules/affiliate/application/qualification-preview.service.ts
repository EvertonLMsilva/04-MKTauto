import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
  collectAffiliateProductIssues,
  validateAffiliateProduct,
  validateAffiliateCampaign,
} from '../domain/affiliate-contracts.js';
import { eligibleCatalogCandidate } from '../domain/affiliate-catalog.js';
import { evaluateCatalogCandidate } from '../domain/affiliate-catalog.js';
import type {
  AffiliateProduct,
  AffiliateCampaign,
} from '../domain/affiliate-contracts.js';
import {
  validateFirstProductInput,
  firstProductPreparationBody,
  sealFirstProductPreparation,
} from '../domain/first-product-preparation.js';
import { AffiliateService } from './affiliate.service.js';
import { DEFAULT_AFFILIATE_DISCOVERY_POLICY } from '../domain/affiliate-discovery.js';
import { validateShopeeUrl } from '../domain/shopee-link-url.js';
import { ContractValidationError } from '../domain/affiliate.errors.js';
import { catalogError, errorCode } from '../infrastructure/discovery-error.js';
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
    return this.previewFromReport(raw);
  }
  // Preparation only. Never calls reviewed registration, creates a briefing or
  // consults Shopee. No input means no feed, media, project or catalog reads.
  async prepareFirstProduct(raw?: unknown) {
    const body = firstProductPreparationBody();
    if (raw === undefined) return sealFirstProductPreparation(body);
    const input = validateFirstProductInput(raw);
    body.inputHash = affiliateHash(input);
    body.dataOrigin = input.dataOrigin;
    body.realProductEvidenceStatus =
      input.dataOrigin === 'SYNTHETIC_FIXTURE'
        ? 'SYNTHETIC_ONLY'
        : 'OPERATOR_PROVIDED_UNVERIFIED';
    body.technicalBlockers = [];
    let preview: Awaited<ReturnType<QualificationPreviewService['preview']>>;
    try {
      preview = await this.preview(input.previewRequest);
    } catch (error) {
      const code = errorCode(error);
      body.technicalBlockers = [
        error instanceof ContractValidationError ||
        code?.startsWith('QUALIFICATION_PREVIEW_') ||
        code?.startsWith('FEED_QUALIFICATION_') ||
        code?.startsWith('EXTERNAL_CATALOG_')
          ? (code ?? 'FIRST_PRODUCT_PREVIEW_INVALID')
          : 'FIRST_PRODUCT_PREVIEW_UNAVAILABLE',
      ];
      return sealFirstProductPreparation(body);
    }
    body.preview = preview;
    const externalProductId = preview.selectedProduct.externalProductId;
    if (!externalProductId) {
      body.technicalBlockers = ['PRODUCT_ID_REQUIRED'];
      return sealFirstProductPreparation(body);
    }
    const product = preview.productDraft.product as AffiliateProduct,
      campaign = preview.offerDraft.campaign as AffiliateCampaign;
    const assessment = evaluateCatalogCandidate({ product, campaign });
    body.catalog.draftEligibility = assessment;
    body.product = product;
    body.campaign = campaign;
    body.provenance = preview.provenance;
    let shopId: string | null = null;
    try {
      const url = new URL(preview.selectedProduct.productUrl!);
      const match = /^\/product\/([1-9]\d*)\/([1-9]\d*)$/.exec(url.pathname);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'shopee.com.br' &&
        match?.[2] === preview.selectedProduct.externalProductId
      )
        shopId = match[1];
    } catch {
      /* Unknown identity remains null, never guessed. */
    }
    body.candidate = {
      externalProductId,
      productId: product.productId,
      shopId,
      offerId: null,
      productUrl: preview.selectedProduct.productUrl,
      identityBasis: 'LOCAL_FEED_DECLARATION_NOT_REMOTE_VERIFICATION',
    };
    body.media = {
      source: product.localImage ?? null,
      physical: preview.mediaEvidence,
      rightsEvidence: product.localImage?.rights.evidence ?? [],
    };
    body.affiliate = {
      url: campaign.affiliateUrl ?? null,
      documentaryAssociation: preview.affiliateEvidence,
      associationVerified: false,
    };
    body.commercial.historicalPrice =
      preview.commercialSnapshot.historicalPrice;
    body.technicalBlockers = [
      ...preview.pending,
      ...assessment.technicalBlockers,
    ];
    body.operationalBlockers = [
      ...body.operationalBlockers,
      ...assessment.operationalBlockers,
    ];
    if (this.projects && this.persistence) {
      try {
        const project = await this.projects.get(
          campaign.projectId,
          input.projectVersion,
        );
        if (!project)
          body.technicalBlockers.push('PROJECT_VERSION_UNAVAILABLE');
        else if (
          project.project.id !== campaign.projectId ||
          project.project.version !== input.projectVersion ||
          affiliateHash(project) !== preview.context.projectHash
        )
          body.technicalBlockers.push('PROJECT_CONTEXT_CHANGED');
        else {
          const projectHash = affiliateHash(project);
          body.project = {
            projectId: project.project.id,
            projectVersion: project.project.version,
            niche: project.project.niche,
            subniches: [...project.project.subniches],
            projectHash,
          };
          const catalog = await new AffiliateService(
            this.persistence,
            this.projects,
          ).catalogReadiness(campaign.projectId, input.projectVersion);
          if (catalog.projectHash !== projectHash)
            body.technicalBlockers.push('PROJECT_CONTEXT_CHANGED');
          body.catalog.snapshotHash = catalog.snapshotHash;
          const item =
            catalog.items.find(
              (item) => item.campaign.campaignId === campaign.campaignId,
            ) ??
            catalog.items.find(
              (item) => item.product.productId === product.productId,
            );
          body.catalog.persistedEntry = item ?? null;
          body.catalog.registrationStatus = !item
            ? 'NOT_REGISTERED'
            : item.productHash === affiliateHash(product) &&
                item.campaignHash === affiliateHash(campaign)
              ? 'EXACT_REGISTERED_REVISIONS'
              : 'DIFFERENT_REGISTERED_REVISIONS';
          if (
            body.catalog.registrationStatus === 'DIFFERENT_REGISTERED_REVISIONS'
          )
            body.technicalBlockers.push('CATALOG_REGISTERED_REVISIONS_DIFFER');
        }
      } catch {
        body.technicalBlockers.push('CATALOG_CONTEXT_UNAVAILABLE');
      }
    }
    body.technicalBlockers = [...new Set(body.technicalBlockers)].sort();
    body.operationalBlockers = [...new Set(body.operationalBlockers)].sort();
    if (
      preview.status === 'READY_FOR_OPERATOR_REVIEW' &&
      !body.technicalBlockers.length
    ) {
      body.technicalPreparationStatus = 'READY_FOR_OPERATOR_REVIEW';
      body.handoff = {
        method: 'POST',
        path: '/affiliate/feed-qualifications/preview/register',
        request: { expectedPackageHash: preview.packageHash, preview },
        requiredHumanFields: ['idempotencyKey', 'confirmed', 'decision'],
        serverActorRequired: true,
      };
    }
    return sealFirstProductPreparation(body);
  }
  async revalidateRegistration(request: unknown, expectedPackageHash: string) {
    const current = await this.preview(request);
    const report = await this.feeds.analyze();
    if (report.reportId !== current.reportId)
      throw catalogError('FEED_QUALIFICATION_REPORT_CHANGED');
    if (
      current.status !== 'READY_FOR_OPERATOR_REVIEW' ||
      !current.finalPayload ||
      current.pending.length
    )
      throw catalogError('AFFILIATE_REVIEW_BLOCKED');
    if (current.packageHash !== expectedPackageHash)
      throw catalogError('AFFILIATE_REVIEW_STALE');
    return current;
  }
  // A private snapshot parameter prevents callers from supplying a forged report.
  private async previewFromReport(
    raw: unknown,
    snapshot?: Awaited<ReturnType<FeedQualificationService['analyze']>>,
  ) {
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
    const report = snapshot ?? (await this.feeds.analyze());
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

  // Review only: one immutable qualification snapshot, one final consistency
  // check, and the exact individual policy. Never registers or authorizes items.
  async previewBatch(raw: unknown) {
    const invalid = (): never => {
      throw catalogError('QUALIFICATION_PREVIEW_BATCH_INVALID_INPUT');
    };
    const record = (v: unknown): v is Record<string, unknown> =>
      !!v && typeof v === 'object' && !Array.isArray(v);
    if (
      !record(raw) ||
      Object.keys(raw).sort().join(',') !==
        'candidates,projectId,recordedAt,reportId' ||
      !Array.isArray(raw.candidates) ||
      raw.candidates.length < 1 ||
      raw.candidates.length > 20
    )
      invalid();
    const input = immutable(raw as Record<string, unknown>);
    affiliateIdentifier(input.projectId, 'projectId');
    if (
      typeof input.reportId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.reportId) ||
      typeof input.recordedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.recordedAt) ||
      !Number.isFinite(Date.parse(input.recordedAt))
    )
      invalid();
    type CandidateInput = {
      externalProductId: string;
      source: { feedId: string; rowNumber: number };
      product?: unknown;
      campaign?: unknown;
      affiliateEvidence?: unknown;
    };
    const candidates = Array.from(input.candidates as unknown[]).map(
      (value) => {
        if (
          !record(value) ||
          Object.keys(value).some(
            (k) =>
              ![
                'externalProductId',
                'source',
                'product',
                'campaign',
                'affiliateEvidence',
              ].includes(k),
          ) ||
          typeof value.externalProductId !== 'string' ||
          !/^[1-9]\d{0,39}$/.test(value.externalProductId) ||
          !record(value.source) ||
          Object.keys(value.source).sort().join(',') !== 'feedId,rowNumber' ||
          typeof value.source.feedId !== 'string' ||
          !value.source.feedId.trim() ||
          value.source.feedId.length > 128 ||
          Array.from(value.source.feedId).some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
          ) ||
          !Number.isSafeInteger(value.source.rowNumber) ||
          Number(value.source.rowNumber) < 2
        )
          invalid();
        return value as CandidateInput;
      },
    );
    if (
      new Set(candidates.map((c) => c.externalProductId)).size !==
      candidates.length
    )
      throw catalogError('QUALIFICATION_PREVIEW_BATCH_DUPLICATE');
    const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    candidates.sort(
      (a, b) =>
        compare(a.externalProductId, b.externalProductId) ||
        compare(a.source.feedId, b.source.feedId) ||
        a.source.rowNumber - b.source.rowNumber,
    );
    const report = immutable(await this.feeds.analyze());
    if (report.reportId !== input.reportId)
      throw catalogError('FEED_QUALIFICATION_REPORT_CHANGED');
    type Individual = Awaited<
      ReturnType<QualificationPreviewService['preview']>
    >;
    const evidenceKeys = [
      'FEED_SPECIFICATION',
      'PRODUCT_CONTRACT',
      'OFFER_CONTRACT',
      'LOCAL_IMAGE_BYTES',
      'REUSABLE_MEDIA_RIGHTS',
      'DOCUMENTED_AFFILIATE_ASSOCIATION',
      'PROJECT_SCOPE',
      'REVISION_SCOPE',
    ];
    const items: {
      identity: CandidateInput['source'] & { externalProductId: string };
      requestHash: string;
      provenance: Individual['provenance'] | null;
      qualification: string | null;
      status: string;
      blockers: string[];
      evidence: { present: string[]; missing: string[]; unverified: string[] };
      preview: Individual | null;
      previewHash: string | null;
      productDraft: Individual['productDraft'] | null;
      offerDraft: Individual['offerDraft'] | null;
      productIssues: Individual['productIssues'];
      offerIssues: Individual['offerIssues'];
      commercialSnapshot: Individual['commercialSnapshot'] | null;
      error: { code: string; stage: string } | null;
      registrationAuthorized: false;
      operationallyRegistered: false;
      associationVerified: false;
    }[] = [];
    for (const candidateInput of candidates) {
      const matches = report.items.filter(
        (c) =>
          c.externalProductId === candidateInput.externalProductId &&
          c.source.feedId === candidateInput.source.feedId &&
          c.source.rowNumber === candidateInput.source.rowNumber,
      );
      const candidate = matches.length === 1 ? matches[0] : undefined;
      const source =
        candidate &&
        report.sources.find((s) => s.feedId === candidate.source.feedId);
      const item: (typeof items)[number] = {
        identity: {
          externalProductId: candidateInput.externalProductId,
          ...candidateInput.source,
        },
        requestHash: affiliateHash(candidateInput),
        provenance:
          candidate && source
            ? {
                ...candidate.source,
                sourceHash: source.sha256,
                sourceUpdatedAt: source.sourceUpdatedAt,
                originVerified: source.originVerified,
              }
            : null,
        qualification: candidate?.classification ?? null,
        status: 'ERROR',
        blockers: [],
        evidence: { present: [], missing: [], unverified: [...evidenceKeys] },
        preview: null,
        previewHash: null,
        productDraft: null,
        offerDraft: null,
        productIssues: [],
        offerIssues: [],
        commercialSnapshot: null,
        error: null,
        registrationAuthorized: false,
        operationallyRegistered: false,
        associationVerified: false,
      };
      items.push(item);
      if (!candidate || !source) {
        item.blockers = ['QUALIFICATION_PREVIEW_CANDIDATE_IDENTITY_MISMATCH'];
        item.error = { code: item.blockers[0], stage: 'IDENTITY' };
        continue;
      }
      if (candidate.classification !== 'PRE_CANDIDATE') {
        item.status = 'NOT_PREVIEWABLE';
        item.blockers = [...new Set(candidate.reasons)].sort();
        continue;
      }
      try {
        const { source: _identity, ...fields } = candidateInput;
        const result = await this.previewFromReport(
          {
            reportId: input.reportId,
            projectId: input.projectId,
            recordedAt: input.recordedAt,
            ...fields,
          },
          { ...report, items: [candidate] },
        );
        item.status = result.status;
        item.blockers = [...result.pending];
        item.previewHash = result.packageHash;
        item.productIssues = result.productIssues;
        item.offerIssues = result.offerIssues;
        // Invalid drafts are never exposed by the batch; the individual endpoint
        // keeps its existing diagnostic drafts and hash unchanged.
        item.productDraft = result.productIssues.length
          ? null
          : result.productDraft;
        item.offerDraft = result.offerIssues.length ? null : result.offerDraft;
        item.preview = item.productDraft && item.offerDraft ? result : null;
        item.commercialSnapshot = result.commercialSnapshot;
        const checks = [
          !result.pending.includes('FEED_SPECIFICATION_EVIDENCE_REQUIRED'),
          !result.productIssues.length,
          !result.offerIssues.length,
          result.mediaEvidence.status === 'VERIFIED',
          !result.pending.includes('REUSABLE_MEDIA_RIGHTS_REQUIRED'),
          !result.pending.includes('AFFILIATE_ASSOCIATION_EVIDENCE_REQUIRED'),
          !!result.context.projectHash,
          result.context.revisionsVerified,
        ];
        item.evidence = {
          present: evidenceKeys.filter((_, i) => checks[i]),
          missing: evidenceKeys.filter((_, i) => !checks[i]),
          unverified: [],
        };
      } catch (error) {
        const reported =
          error instanceof ContractValidationError
            ? error.code
            : errorCode(error);
        const code =
          reported &&
          /^(QUALIFICATION_PREVIEW_|INVALID_AFFILIATE_|AFFILIATE_)/.test(
            reported,
          ) &&
          /^[A-Z0-9_]+$/.test(reported)
            ? reported
            : 'QUALIFICATION_PREVIEW_UNAVAILABLE';
        item.error = { code, stage: 'PREVIEW' };
        item.blockers = [code];
        item.status = 'ERROR';
        item.preview = null;
        item.previewHash = null;
        item.productDraft = null;
        item.offerDraft = null;
        item.productIssues = [];
        item.offerIssues = [];
        item.commercialSnapshot = null;
        item.evidence = {
          present: [],
          missing: [],
          unverified: [...evidenceKeys],
        };
      }
    }
    const current = await this.feeds.analyze();
    if (current.reportId !== report.reportId)
      throw catalogError('FEED_QUALIFICATION_REPORT_CHANGED');
    const body = {
      previewVersion: 'affiliate-qualification-batch-preview/1.0.0',
      reportId: report.reportId,
      projectId: input.projectId,
      recordedAt: new Date(input.recordedAt as string).toISOString(),
      items,
      summary: {
        requested: items.length,
        readyForOperatorReview: items.filter(
          (i) => i.status === 'READY_FOR_OPERATOR_REVIEW',
        ).length,
        blocked: items.filter((i) => i.status === 'BLOCKED').length,
        notPreviewable: items.filter((i) => i.status === 'NOT_PREVIEWABLE')
          .length,
        errors: items.filter((i) => i.status === 'ERROR').length,
      },
      evidenceBasis: 'OPERATOR_DOCUMENTED_DECLARATIONS_REQUIRE_HUMAN_REVIEW',
      technicalPreparationOnly: true,
      registrationAuthorized: false,
      operationallyRegistered: false,
      associationVerified: false,
      humanApprovalGranted: false,
      liveAuthorized: false,
    };
    return immutable({ ...body, packageHash: affiliateHash(body) });
  }
}
