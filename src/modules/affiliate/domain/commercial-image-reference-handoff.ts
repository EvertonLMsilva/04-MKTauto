import { affiliateHash, immutable } from './affiliate-contracts.js';
import {
  validateCommercialImageReadinessInput,
  type CommercialImageReadinessInput,
  type evaluateCommercialImageReadiness,
} from './commercial-image-readiness.js';

export interface CommercialImageReferenceHandoffInput {
  schemaVersion: 'commercial-image-reference-handoff/1.0.0';
  reference: CommercialImageReadinessInput;
  expectedPreparationHash?: string;
}
type Readiness = ReturnType<typeof evaluateCommercialImageReadiness>;
function fail(): never {
  throw new Error('COMMERCIAL_IMAGE_REFERENCE_INPUT_INVALID');
}
export function validateCommercialImageReferenceHandoffInput(
  raw: unknown,
): CommercialImageReferenceHandoffInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const value = raw as Record<string, unknown>,
    keys = ['schemaVersion', 'reference'];
  if (Object.hasOwn(value, 'expectedPreparationHash'))
    keys.push('expectedPreparationHash');
  if (
    Object.keys(value).sort().join(',') !== keys.sort().join(',') ||
    value.schemaVersion !== 'commercial-image-reference-handoff/1.0.0'
  )
    fail();
  if (
    Object.hasOwn(value, 'expectedPreparationHash') &&
    (typeof value.expectedPreparationHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.expectedPreparationHash))
  )
    fail();
  const reference = validateCommercialImageReadinessInput(value.reference);
  // A handoff carries an opaque existing media identity, never a URL, file path
  // or inline image. Resolution/bytes remain owned by the existing Media store.
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]*(?:\/[A-Za-z0-9_.:-]+)*$/.test(
      reference.media.mediaRef,
    ) ||
    /^(?:https?|ftp|file|data|blob|s3|gs):/i.test(reference.media.mediaRef)
  )
    fail();
  return immutable({
    schemaVersion: 'commercial-image-reference-handoff/1.0.0',
    reference,
    ...(value.expectedPreparationHash === undefined
      ? {}
      : { expectedPreparationHash: value.expectedPreparationHash as string }),
  });
}
function assertExportable(value: unknown): void {
  if (typeof value === 'string') {
    if (
      /[a-z][a-z0-9+.-]*:\/\/|^(?:data|file|blob):|^[a-z]:[\\/]|^\\\\|^\/|(?:authorization|api[_-]?key|access[_-]?token|secret|password)\s*[:=]|\bBearer\s+\S+/i.test(
        value,
      )
    ) {
      throw new Error('COMMERCIAL_IMAGE_REFERENCE_PRIVATE_METADATA_FORBIDDEN');
    }
  } else if (Array.isArray(value)) value.forEach(assertExportable);
  else if (value && typeof value === 'object')
    Object.values(value).forEach(assertExportable);
}

// Presentation/integrity boundary only. Rights, physical checks and revision
// eligibility come exclusively from C-017; no independent rights rule is added.
export function buildCommercialImageReferenceHandoff(
  raw: unknown,
  readiness: Readiness,
) {
  const input = validateCommercialImageReferenceHandoffInput(raw),
    selector = input.reference;
  const { reportHash, ...readinessBody } = readiness;
  const expected = {
    productId: selector.product.productId,
    productRevision: selector.product.revision,
    campaignId: selector.campaign?.campaignId ?? null,
    campaignRevision: selector.campaign?.revision ?? null,
    sourceId: selector.source?.sourceId ?? null,
    sourceRevision: selector.source?.revision ?? null,
    mediaRef: selector.media.mediaRef,
    contentHash: selector.media.contentHash,
    provider: selector.provider,
    purpose: selector.purpose,
  };
  if (
    readiness.schemaVersion !== 'commercial-image-readiness/1.0.0' ||
    reportHash !== affiliateHash(readinessBody) ||
    readiness.requestHash !== affiliateHash(selector) ||
    Object.entries(expected).some(
      ([key, value]) =>
        readiness.binding[key as keyof typeof readiness.binding] !== value,
    ) ||
    readiness.visualReviewRequired !== true ||
    readiness.processingAuthorized !== false ||
    readiness.publicationAuthorized !== false
  ) {
    throw new Error('COMMERCIAL_IMAGE_REFERENCE_READINESS_MISMATCH');
  }
  const binding = readiness.binding,
    knownSource = binding.sourceHash !== null;
  for (const attribute of readiness.fidelity.attributes) {
    if (
      /^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)$/i.test(
        attribute.name.trim(),
      )
    ) {
      throw new Error('COMMERCIAL_IMAGE_REFERENCE_PRIVATE_METADATA_FORBIDDEN');
    }
  }
  const reference = {
    product: {
      productId: binding.productId,
      revision: binding.productRevision,
      productHash: binding.productHash,
      name: readiness.fidelity.productName,
      brand: readiness.fidelity.brand,
      attributes: readiness.fidelity.attributes,
    },
    campaign: selector.campaign
      ? {
          campaignId: binding.campaignId,
          revision: binding.campaignRevision,
          campaignHash: binding.campaignHash,
        }
      : null,
    source: {
      status: knownSource
        ? ('DOCUMENTARILY_BOUND' as const)
        : ('UNKNOWN' as const),
      sourceId: binding.sourceId,
      revision: binding.sourceRevision,
      sourceHash: binding.sourceHash,
      offerId: knownSource ? binding.offerId : null,
      externalProductId: knownSource ? binding.externalProductId : null,
      shopId: knownSource ? binding.shopId : null,
      provenance: readiness.provenance,
      externallyVerified: false as const,
    },
    media: {
      mediaReference: binding.mediaRef,
      contentHash: binding.contentHash,
    },
    originalImage: readiness.fidelity.originalImage,
    provider: binding.provider,
    purpose: binding.purpose,
    // Private document locations stay in C-017/the canonical catalog. IDs and a
    // digest bind the documentary assertions without exporting the sourceRef.
    evidence: readiness.evidenceReferences.map((evidence) => ({
      id: evidence.id,
      kind: evidence.kind,
      recordedAt: evidence.recordedAt,
      documentHash: affiliateHash(evidence),
    })),
  };
  assertExportable(reference);
  const status =
    readiness.eligibility === 'DOCUMENTARILY_ELIGIBLE'
      ? ('PREPARED_DOCUMENTARY_ONLY' as const)
      : readiness.eligibility === 'FAKE_ONLY'
        ? ('FAKE_ONLY' as const)
        : ('BLOCKED' as const);
  const body = {
    schemaVersion: 'commercial-image-reference-handoff/1.0.0' as const,
    reference,
    referenceHash: affiliateHash(reference),
    readinessHash: reportHash,
    readinessVersion: readiness.schemaVersion,
    physicalEvidence: {
      status: readiness.physicalImage.status,
      reason: readiness.physicalImage.reason,
      contentHash: readiness.physicalImage.contentHash,
      sizeBytes: readiness.physicalImage.sizeBytes,
    },
    rights: {
      localProcessing: readiness.rights.localProcessing,
      openaiProcessing: readiness.rights.openaiProcessing,
      kairogenProcessing: readiness.rights.kairogenProcessing,
      commercialSourceUse: readiness.rights.commercialSourceUse,
      evidenceBasis: readiness.rights.evidenceBasis,
    },
    status,
    blockers: readiness.blockers,
    missingPermissions: readiness.missingPermissions,
    reviewRequirements: readiness.reviewRequirements,
    unknownFacts: [
      'price',
      'discount',
      'packaging',
      'generatedOutputFidelity',
      'generatedOutputRights',
    ],
    uploadAuthorized: false as const,
    generationAuthorized: false as const,
    publicationAuthorized: false as const,
    visualReviewRequired: true as const,
    revalidationRequiredBeforeUpload: true as const,
    // A future consumer can re-evaluate this exact selector immediately before
    // transfer and compare preparationHash. Matching never authorizes an upload.
    revalidationRequest: {
      schemaVersion: input.schemaVersion,
      reference: selector,
    },
    futureTransferRequirements: [
      'FRESH_C017_PHYSICAL_RIGHTS_AND_REVISION_VALIDATION',
      'MATCHING_PREPARATION_HASH',
      'SEPARATE_AUTHENTICATED_OPERATIONAL_UPLOAD_AUTHORIZATION',
    ],
    nextHumanAction: readiness.nextHumanAction,
  };
  assertExportable(body);
  const preparationHash = affiliateHash(body);
  if (
    input.expectedPreparationHash &&
    input.expectedPreparationHash !== preparationHash
  )
    throw new Error('COMMERCIAL_IMAGE_REFERENCE_CONFLICT');
  return immutable({ ...body, preparationHash });
}
