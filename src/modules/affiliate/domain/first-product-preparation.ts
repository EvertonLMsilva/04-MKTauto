import {
  affiliateHash,
  immutable,
  type AffiliateProduct,
} from './affiliate-contracts.js';
import type { evaluateCatalogCandidate } from './affiliate-catalog.js';
import type { QualificationPreviewService } from '../application/qualification-preview.service.js';
import type { AffiliateService } from '../application/affiliate.service.js';
import { catalogError } from '../infrastructure/discovery-error.js';

export interface FirstProductInput {
  schemaVersion: 'affiliate-first-product-input/1.0.0';
  dataOrigin: 'OPERATOR_PROVIDED' | 'SYNTHETIC_FIXTURE';
  projectVersion: number;
  previewRequest: Record<string, unknown>;
}
export function validateFirstProductInput(raw: unknown): FirstProductInput {
  const invalid = (field: string): never => {
    throw Object.assign(catalogError('FIRST_PRODUCT_INPUT_INVALID'), { field });
  };
  const value = raw as FirstProductInput;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'schemaVersion',
          'dataOrigin',
          'projectVersion',
          'previewRequest',
        ].includes(key),
    )
  )
    invalid('input');
  for (const field of [
    'schemaVersion',
    'dataOrigin',
    'projectVersion',
    'previewRequest',
  ])
    if (!Object.hasOwn(value, field)) invalid(field);
  if (value.schemaVersion !== 'affiliate-first-product-input/1.0.0')
    invalid('schemaVersion');
  if (!['OPERATOR_PROVIDED', 'SYNTHETIC_FIXTURE'].includes(value.dataOrigin))
    invalid('dataOrigin');
  if (!Number.isSafeInteger(value.projectVersion) || value.projectVersion < 1)
    invalid('projectVersion');
  if (
    !value.previewRequest ||
    typeof value.previewRequest !== 'object' ||
    Array.isArray(value.previewRequest)
  )
    invalid('previewRequest');
  for (const field of [
    'reportId',
    'externalProductId',
    'projectId',
    'recordedAt',
  ])
    if (!Object.hasOwn(value.previewRequest, field))
      invalid(`previewRequest.${field}`);
  return immutable(value);
}
type Preview = Awaited<ReturnType<QualificationPreviewService['preview']>>;
type Catalog = Awaited<ReturnType<AffiliateService['catalogReadiness']>>;
export function firstProductPreparationBody() {
  return {
    reportVersion: 'affiliate-first-product-preparation/1.0.0' as const,
    implementationStatus: 'IMPLEMENTED' as const,
    technicalPreparationStatus: 'BLOCKED' as
      'BLOCKED' | 'READY_FOR_OPERATOR_REVIEW',
    realProductEvidenceStatus: 'MISSING' as
      'MISSING' | 'SYNTHETIC_ONLY' | 'OPERATOR_PROVIDED_UNVERIFIED',
    operationalApprovalStatus: 'BLOCKED_EXTERNAL_EVIDENCE' as const,
    registrationAuthorized: false as const,
    operationallyRegistered: false as const,
    liveAuthorized: false as const,
    publicationAuthorized: false as const,
    inputHash: null as string | null,
    dataOrigin: null as FirstProductInput['dataOrigin'] | null,
    candidate: null as {
      externalProductId: string;
      productId: unknown;
      shopId: string | null;
      offerId: null;
      productUrl: string | null;
      identityBasis: string;
    } | null,
    project: null as {
      projectId: string;
      projectVersion: number;
      niche: string;
      subniches: string[];
      projectHash: string;
    } | null,
    product: null as unknown,
    campaign: null as unknown,
    provenance: null as unknown,
    media: {
      source: null as AffiliateProduct['localImage'] | null,
      physical: {
        status: 'PENDING',
        reason: 'LOCAL_IMAGE_REQUIRED',
      } as Preview['mediaEvidence'],
      rightsEvidence: [] as unknown[],
    },
    affiliate: {
      url: null as unknown,
      documentaryAssociation: null as unknown,
      associationVerified: false as const,
    },
    commercial: {
      historicalPrice: null as unknown,
      current: {
        price: null,
        currency: null,
        availability: null,
        commission: null,
      },
      unknown: [
        'CURRENCY_UNPROVEN',
        'CURRENT_PRICE_UNPROVEN',
        'AVAILABILITY_UNPROVEN',
        'COMMISSION_UNPROVEN',
      ],
    },
    catalog: {
      registrationStatus: 'UNVERIFIED' as
        | 'UNVERIFIED'
        | 'NOT_REGISTERED'
        | 'EXACT_REGISTERED_REVISIONS'
        | 'DIFFERENT_REGISTERED_REVISIONS',
      draftEligibility: null as ReturnType<
        typeof evaluateCatalogCandidate
      > | null,
      persistedEntry: null as Catalog['items'][number] | null,
      snapshotHash: null as string | null,
    },
    technicalBlockers: ['OPERATOR_PROVIDED_INPUT_REQUIRED'],
    operationalBlockers: [
      'REAL_PRODUCT_EVIDENCE_REQUIRED',
      'REAL_OFFER_APPROVAL_REQUIRED',
      'EXTERNAL_MEDIA_RIGHTS_VERIFICATION_REQUIRED',
      'AFFILIATE_ASSOCIATION_UNVERIFIED',
      'CURRENT_SHOPEE_DATA_UNVERIFIED',
      'BLOCKED_COST_UNCONFIRMED',
    ],
    evidenceBasis:
      'OPERATOR_DOCUMENTED_DECLARATIONS_NOT_REMOTE_VERIFICATION' as const,
    preview: null as Preview | null,
    handoff: null as {
      method: 'POST';
      path: string;
      request: { expectedPackageHash: string; preview: Preview };
      requiredHumanFields: string[];
      serverActorRequired: true;
    } | null,
    requiredInput: {
      schemaVersion: 'affiliate-first-product-input/1.0.0',
      fields: ['dataOrigin', 'projectVersion', 'previewRequest'],
      previewFields: [
        'reportId',
        'externalProductId',
        'projectId',
        'recordedAt',
        'product',
        'campaign',
        'affiliateEvidence',
      ],
      configuration: ['AFFILIATE_DISCOVERY_CONFIG', 'FFMPEG_MEDIA_ROOT'],
      optionalReadOnlyContext: '--database <explicit SQLite path>',
    },
  };
}
export function sealFirstProductPreparation(
  body: ReturnType<typeof firstProductPreparationBody>,
) {
  return immutable({ ...body, preparationHash: affiliateHash(body) });
}
