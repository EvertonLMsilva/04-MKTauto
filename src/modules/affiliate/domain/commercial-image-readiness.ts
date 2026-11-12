import {
  affiliateBrandName,
  affiliateHash,
  affiliateIdentifier,
  immutable,
  validateAffiliateCampaign,
  validateAffiliateProduct,
  type AffiliateCampaign,
  type AffiliateEvidence,
  type AffiliateProduct,
} from './affiliate-contracts.js';
import { ContractValidationError } from './affiliate.errors.js';
import { eligibleCatalogCandidate } from './affiliate-catalog.js';
import {
  validateAffiliateCampaignSource,
  type AffiliateCampaignSourceV1,
} from './affiliate-campaign-source.js';
import {
  assertMediaProcessingRights,
  validateMediaRightsEvidence,
} from '../../media/domain/media-processing-rights.js';

export interface CommercialImageReadinessInput {
  schemaVersion: 'commercial-image-readiness/1.0.0';
  product: { productId: string; revision: number };
  campaign: { campaignId: string; revision: number } | null;
  source?: { sourceId: string; revision: number } | null;
  media: { mediaRef: string; contentHash: string };
  provider: 'local' | 'openai' | 'kairogen';
  purpose: 'GENERATION_REFERENCE' | 'COMMERCIAL_POST' | 'VIDEO_REFERENCE';
  evidenceRefs: string[];
}
export interface CommercialImageInspection {
  status: 'VERIFIED' | 'PENDING' | 'INVALID';
  reason: string | null;
  contentHash: string | null;
  sizeBytes: number | null;
}
export interface CommercialImageReadinessContext {
  product: AffiliateProduct | null;
  campaign: AffiliateCampaign | null;
  source: AffiliateCampaignSourceV1 | null;
  productCurrent: boolean;
  campaignCurrent: boolean;
  physical: CommercialImageInspection;
}
function fail(): never {
  throw new Error('COMMERCIAL_IMAGE_READINESS_INPUT_INVALID');
}
function exact(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    fail();
}
function reference(raw: unknown, key: string) {
  exact(raw, [key, 'revision']);
  try {
    affiliateIdentifier(raw[key], key);
  } catch {
    fail();
  }
  if (
    !Number.isSafeInteger(raw.revision) ||
    (raw.revision as number) < 1 ||
    (raw.revision as number) >= Number.MAX_SAFE_INTEGER
  )
    fail();
}
export function validateCommercialImageReadinessInput(
  raw: unknown,
): CommercialImageReadinessInput {
  const fields = [
    'schemaVersion',
    'product',
    'campaign',
    'media',
    'provider',
    'purpose',
    'evidenceRefs',
  ];
  if (raw && typeof raw === 'object' && Object.hasOwn(raw, 'source'))
    fields.push('source');
  exact(raw, fields);
  if (
    raw.schemaVersion !== 'commercial-image-readiness/1.0.0' ||
    !['local', 'openai', 'kairogen'].includes(raw.provider as string) ||
    !['GENERATION_REFERENCE', 'COMMERCIAL_POST', 'VIDEO_REFERENCE'].includes(
      raw.purpose as string,
    )
  )
    fail();
  reference(raw.product, 'productId');
  if (raw.campaign !== null) reference(raw.campaign, 'campaignId');
  if (raw.source != null) reference(raw.source, 'sourceId');
  exact(raw.media, ['mediaRef', 'contentHash']);
  if (
    typeof raw.media.mediaRef !== 'string' ||
    !raw.media.mediaRef.trim() ||
    raw.media.mediaRef.length > 1000 ||
    raw.media.mediaRef
      .split('')
      .some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    typeof raw.media.contentHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.media.contentHash)
  )
    fail();
  if (
    !Array.isArray(raw.evidenceRefs) ||
    raw.evidenceRefs.length > 300 ||
    new Set(raw.evidenceRefs).size !== raw.evidenceRefs.length
  )
    fail();
  try {
    raw.evidenceRefs.forEach((id) => affiliateIdentifier(id, 'evidenceRef'));
  } catch {
    fail();
  }
  return immutable(
    JSON.parse(
      JSON.stringify({ ...raw, source: raw.source ?? null }),
    ) as CommercialImageReadinessInput,
  );
}
function checked<T>(value: unknown, validate: (raw: unknown) => T): T | null {
  if (value === null) return null;
  try {
    return validate(structuredClone(value));
  } catch (error) {
    if (error instanceof ContractValidationError) return null;
    throw error;
  }
}
function rightsFailure(error: unknown): boolean {
  return (
    error instanceof ContractValidationError ||
    (error instanceof Error &&
      'code' in error &&
      [
        'MEDIA_PROCESSING_RIGHTS_UNCONFIRMED',
        'INVALID_MEDIA_RIGHTS_EVIDENCE',
        'MEDIA_RIGHTS_IDENTITY_MISMATCH',
      ].includes(String(error.code)))
  );
}
function permission(
  evidence: AffiliateEvidence[][],
  media: CommercialImageReadinessInput['media'],
  provider: string | null,
) {
  try {
    for (const group of evidence) {
      validateMediaRightsEvidence(group, media);
      // No operationScope/QC context is supplied: restricted QC permission can
      // never be promoted to commercial reference or production permission.
      assertMediaProcessingRights(group, media, provider);
    }
    return true;
  } catch (error) {
    if (rightsFailure(error)) return false;
    throw error;
  }
}

// Documentary assessment of one bound source image. It never approves an
// external operation, legal title, a future generated asset or publication.
export function evaluateCommercialImageReadiness(
  raw: unknown,
  context: CommercialImageReadinessContext,
) {
  const input = validateCommercialImageReadinessInput(raw),
    blockers: string[] = [],
    missingPermissions: string[] = [];
  const product = checked(context.product, validateAffiliateProduct);
  const campaign = input.campaign
    ? checked(context.campaign, validateAffiliateCampaign)
    : null;
  const source = input.source
    ? checked(context.source, validateAffiliateCampaignSource)
    : null;
  if (!product)
    blockers.push(
      context.product ? 'PRODUCT_CONTRACT_INVALID' : 'PRODUCT_NOT_FOUND',
    );
  if (
    product &&
    (product.productId !== input.product.productId ||
      product.revision !== input.product.revision)
  )
    blockers.push('PRODUCT_BINDING_MISMATCH');
  if (product && !context.productCurrent)
    blockers.push('PRODUCT_REVISION_STALE');
  if (product?.status === 'ARCHIVED') blockers.push('PRODUCT_ARCHIVED');
  if (input.campaign && !campaign)
    blockers.push('CAMPAIGN_NOT_FOUND_OR_INVALID');
  const campaignBound = !!(
    campaign &&
    product &&
    input.campaign &&
    campaign.campaignId === input.campaign.campaignId &&
    campaign.revision === input.campaign.revision &&
    campaign.productId === product.productId &&
    campaign.productRevision === product.revision
  );
  if (campaign && !campaignBound) blockers.push('CAMPAIGN_BINDING_MISMATCH');
  if (campaign && !context.campaignCurrent)
    blockers.push('CAMPAIGN_REVISION_STALE');
  const sourceBound = !!(
    source &&
    input.source &&
    campaignBound &&
    campaign &&
    product &&
    source.sourceId === input.source.sourceId &&
    source.revision === input.source.revision &&
    source.productId === product.productId &&
    source.productRevision === product.revision &&
    source.campaignId === campaign.campaignId &&
    source.campaignRevision === campaign.revision &&
    source.affiliateUrl === campaign.affiliateUrl
  );
  if (input.source && !sourceBound) blockers.push('SOURCE_BINDING_MISMATCH');
  const fake = sourceBound && source!.offer.provenance.source === 'FAKE';
  if (fake) blockers.push('FAKE_SOURCE_NOT_COMMERCIAL_EVIDENCE');
  const image = product?.localImage;
  const mediaBound = !!(
    image &&
    image.mediaReference === input.media.mediaRef &&
    image.contentHash === input.media.contentHash &&
    product?.media.some((m) => m.mediaRef === input.media.mediaRef)
  );
  if (!mediaBound) blockers.push('IMAGE_PRODUCT_HASH_BINDING_MISMATCH');

  const referenced = new Set(
    product?.attributes.map((a) => a.evidenceRef) ?? [],
  );
  if (product?.schemaVersion === 'affiliate-product/2.0.0')
    referenced.add(product.brand.evidenceRef);
  product?.media
    .filter((m) => m.mediaRef === input.media.mediaRef)
    .forEach((m) => referenced.add(m.evidenceRef));
  const productEvidence =
    product?.evidence.filter(
      (e) =>
        referenced.has(e.id) ||
        e.mediaAuthorization?.mediaRef === input.media.mediaRef,
    ) ?? [];
  const imageEvidence = image?.rights.evidence ?? [];
  const documents = new Map<string, AffiliateEvidence>();
  let conflict = false;
  for (const evidence of [...productEvidence, ...imageEvidence]) {
    const prior = documents.get(evidence.id);
    if (prior && affiliateHash(prior) !== affiliateHash(evidence))
      conflict = true;
    documents.set(evidence.id, evidence);
  }
  const expectedRefs = [...documents.keys()].sort();
  const evidenceBound =
    !conflict &&
    expectedRefs.length > 0 &&
    JSON.stringify(expectedRefs) ===
      JSON.stringify([...input.evidenceRefs].sort());
  if (!evidenceBound) {
    blockers.push('EVIDENCE_BINDING_MISMATCH');
    missingPermissions.push('BOUND_EVIDENCE_REQUIRED');
  }
  const groups = [productEvidence, imageEvidence];
  const granted = (provider: string | null) =>
    mediaBound && evidenceBound && permission(groups, input.media, provider);
  const local = granted(null),
    openai = granted('openai'),
    kairogen = granted('kairogen');
  const commercial =
    image?.rights.commercialUseAllowed === true &&
    (local || openai || kairogen);
  if (!commercial)
    missingPermissions.push('COMMERCIAL_PUBLICATION_RIGHTS_REQUIRED');
  const requestedPermission =
    input.provider === 'local'
      ? local
      : input.provider === 'openai'
        ? openai
        : kairogen;
  if (!requestedPermission)
    missingPermissions.push(
      input.provider === 'local'
        ? 'LOCAL_PROCESSING_PERMISSION_REQUIRED'
        : input.provider === 'openai'
          ? 'OPENAI_REFERENCE_TRANSFER_REQUIRED'
          : 'KAIROGEN_REFERENCE_TRANSFER_REQUIRED',
    );
  if (input.purpose === 'COMMERCIAL_POST' && !local)
    missingPermissions.push('LOCAL_PROCESSING_PERMISSION_REQUIRED');
  blockers.push(...missingPermissions);
  if (context.physical.status !== 'VERIFIED')
    blockers.push(
      context.physical.reason ?? 'PHYSICAL_IMAGE_VERIFICATION_REQUIRED',
    );
  else if (context.physical.contentHash !== input.media.contentHash)
    blockers.push('PHYSICAL_IMAGE_HASH_MISMATCH');
  const catalogEligibility =
    campaignBound && product && campaign
      ? context.productCurrent &&
        context.campaignCurrent &&
        eligibleCatalogCandidate({ product, campaign })
      : null;
  if (input.purpose === 'COMMERCIAL_POST' && catalogEligibility === false)
    blockers.push('CATALOG_IMAGE_RIGHTS_REQUIRED');
  const uniqueBlockers = [...new Set(blockers)];
  const eligibility =
    uniqueBlockers.length === 0
      ? ('DOCUMENTARILY_ELIGIBLE' as const)
      : fake &&
          uniqueBlockers.every(
            (code) => code === 'FAKE_SOURCE_NOT_COMMERCIAL_EVIDENCE',
          )
        ? ('FAKE_ONLY' as const)
        : ('BLOCKED' as const);
  const reviewRequirements = [
    'EXACT_OUTPUT_VISUAL_REVIEW',
    'EXACT_OUTPUT_COMMERCIAL_RIGHTS_REVIEW',
    'EXECUTION_REVALIDATION_REQUIRED',
  ];
  if (!sourceBound) reviewRequirements.push('PRODUCT_SHOP_BINDING_REVIEW');
  const body = {
    schemaVersion: 'commercial-image-readiness/1.0.0' as const,
    requestHash: affiliateHash(input),
    binding: {
      productId: input.product.productId,
      productRevision: input.product.revision,
      productHash: product ? affiliateHash(product) : null,
      campaignId: input.campaign?.campaignId ?? null,
      campaignRevision: input.campaign?.revision ?? null,
      campaignHash: campaign ? affiliateHash(campaign) : null,
      sourceId: input.source?.sourceId ?? null,
      sourceRevision: input.source?.revision ?? null,
      sourceHash: sourceBound ? affiliateHash(source) : null,
      offerId: sourceBound ? source!.offer.offerId : null,
      externalProductId: sourceBound ? source!.offer.productId : null,
      shopId: sourceBound ? source!.offer.shopId : null,
      mediaRef: input.media.mediaRef,
      contentHash: input.media.contentHash,
      provider: input.provider,
      purpose: input.purpose,
    },
    fidelity: {
      productName: product?.name ?? null,
      brand: {
        name: affiliateBrandName(product) ?? null,
        evidenceRef:
          product?.schemaVersion === 'affiliate-product/2.0.0'
            ? product.brand.evidenceRef
            : null,
      },
      attributes: product?.attributes ?? [],
      originalImage: image
        ? {
            mediaReference: image.mediaReference,
            contentHash: image.contentHash,
            origin: image.origin,
            provider: image.provider,
          }
        : null,
    },
    provenance: sourceBound ? source!.offer.provenance : null,
    evidenceReferences: [...documents.values()].map(
      ({ id, kind, sourceRef, recordedAt }) => ({
        id,
        kind,
        sourceRef,
        recordedAt,
      }),
    ),
    rights: {
      localProcessing: local ? 'DOCUMENTED' : 'MISSING',
      openaiProcessing: openai ? 'DOCUMENTED' : 'MISSING',
      kairogenProcessing: kairogen ? 'DOCUMENTED' : 'MISSING',
      commercialSourceUse: commercial ? 'DOCUMENTED' : 'MISSING',
      evidenceBasis: 'DOCUMENTARY_ASSERTIONS_NOT_LEGAL_VERIFICATION',
    },
    physicalImage: context.physical,
    catalogEligibility,
    missingPermissions: [...new Set(missingPermissions)],
    reviewRequirements,
    eligibility,
    blockers: uniqueBlockers,
    visualReviewRequired: true as const,
    generatedOutputFidelityVerified: false as const,
    generatedOutputRightsVerified: false as const,
    processingAuthorized: false as const,
    publicationAuthorized: false as const,
    externalRightsVerified: false as const,
    nextHumanAction:
      eligibility === 'FAKE_ONLY'
        ? 'PROVIDE_REAL_AUTHORIZED_PRODUCT_EVIDENCE'
        : eligibility === 'BLOCKED'
          ? 'CORRECT_BINDINGS_AND_PROVIDE_MISSING_EVIDENCE'
          : 'REVIEW_EXACT_OUTPUT_FIDELITY_AND_COMMERCIAL_RIGHTS',
  };
  return immutable({ ...body, reportHash: affiliateHash(body) });
}
