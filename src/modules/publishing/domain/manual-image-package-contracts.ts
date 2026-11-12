import {
  affiliateHash,
  affiliateIdentifier,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  exact,
  publicText,
  hashValue,
  captionText,
} from './manual-distribution-contracts.js';
export const MANUAL_IMAGE_PACKAGE_VERSION =
  'manual-image-package/1.0.0' as const;
export type ImageFormat = 'png' | 'jpeg';
export interface ManualImageInput {
  campaignId: string;
  campaignRevision: number;
  campaignHash: string;
  productId: string;
  productRevision: number;
  productHash: string;
  projectId: string;
  projectVersion: number;
  pipelineRunId: string | null;
  imageArtifactId: string;
  imageContentHash: string;
  mediaReference: string;
  format: ImageFormat;
  widthPixels: number;
  heightPixels: number;
  destination: 'instagram' | 'facebook';
  account: string;
  caption: string;
  externalProvider: string | null;
}
export interface ImagePhysicalProperties {
  format: ImageFormat;
  widthPixels: number;
  heightPixels: number;
  fullyDecoded: boolean;
}
export interface ImageArtifact {
  imageArtifactId: string;
  imageContentHash: string;
  mediaReference: string;
  productId: string;
  productRevision: number;
  projectId: string;
  projectVersion: number;
  format: ImageFormat;
  widthPixels: number;
  heightPixels: number;
  rightsEvidence: unknown[];
}
export interface ManualImagePackage extends Omit<
  ManualImageInput,
  'externalProvider'
> {
  schemaVersion: typeof MANUAL_IMAGE_PACKAGE_VERSION;
  packageHash: string;
  sizeBytes: number;
  cta: string;
  disclosure: string;
  affiliateUrl: string;
  externalProvider: string | null;
  rightsReferences: { id: string; sourceRef: string; evidenceHash: string }[];
  qualityControl: {
    status: 'PASS' | 'IMAGE_QC_REQUIRED';
    reportId: string | null;
    contentHash: string | null;
  };
  review: {
    status: 'APPROVED' | 'HUMAN_APPROVAL_REQUIRED';
    contentHash: string | null;
  };
}
export type ImageBlockerCode =
  | 'IMAGE_INPUT_INVALID'
  | 'CAMPAIGN_PRODUCT_MISMATCH'
  | 'IMAGE_NOT_FOUND'
  | 'IMAGE_HASH_MISMATCH'
  | 'IMAGE_PHYSICAL_INVALID'
  | 'IMAGE_RIGHTS_REQUIRED'
  | 'IMAGE_DESTINATION_INVALID'
  | 'IMAGE_CONTENT_INVALID'
  | 'IMAGE_PRICE_UNSUPPORTED'
  | 'IMAGE_QC_REQUIRED'
  | 'HUMAN_APPROVAL_REQUIRED'
  | 'IMAGE_EVIDENCE_UNAVAILABLE';
export class ManualImageError extends Error {
  constructor(readonly code: ImageBlockerCode) {
    super(code);
  }
}
export function imageFail(code: ImageBlockerCode): never {
  throw new ManualImageError(code);
}
export function validateManualImageInput(raw: unknown): ManualImageInput {
  try {
    const v = raw as ManualImageInput;
    exact(v, [
      'campaignId',
      'campaignRevision',
      'campaignHash',
      'productId',
      'productRevision',
      'productHash',
      'projectId',
      'projectVersion',
      'pipelineRunId',
      'imageArtifactId',
      'imageContentHash',
      'mediaReference',
      'format',
      'widthPixels',
      'heightPixels',
      'destination',
      'account',
      'caption',
      'externalProvider',
    ]);
    for (const k of [
      'campaignId',
      'productId',
      'projectId',
      'imageArtifactId',
    ] as const)
      affiliateIdentifier(v[k], k);
    if (v.pipelineRunId !== null)
      affiliateIdentifier(v.pipelineRunId, 'pipelineRunId');
    if (v.externalProvider !== null)
      affiliateIdentifier(v.externalProvider, 'externalProvider');
    for (const k of [
      'campaignHash',
      'productHash',
      'imageContentHash',
    ] as const)
      hashValue(v[k], k);
    for (const n of [
      v.campaignRevision,
      v.productRevision,
      v.projectVersion,
      v.widthPixels,
      v.heightPixels,
    ])
      if (!Number.isSafeInteger(n) || n < 1) imageFail('IMAGE_INPUT_INVALID');
    if (
      v.widthPixels > 16384 ||
      v.heightPixels > 16384 ||
      v.widthPixels * v.heightPixels > 40000000
    )
      imageFail('IMAGE_PHYSICAL_INVALID');
    publicText(v.mediaReference, 'mediaReference', 200);
    if (
      !/^media:[a-zA-Z0-9_:-]+$/.test(v.mediaReference) ||
      !['png', 'jpeg'].includes(v.format)
    )
      imageFail('IMAGE_INPUT_INVALID');
    if (
      !['instagram', 'facebook'].includes(v.destination) ||
      !/^[1-9]\d{4,63}$/.test(v.account)
    )
      imageFail('IMAGE_DESTINATION_INVALID');
    captionText(v.caption);
    return structuredClone(v);
  } catch (error) {
    if (error instanceof ManualImageError) throw error;
    imageFail('IMAGE_INPUT_INVALID');
  }
}
// Review is a separately hashed observation about this exact package. Excluding
// only its envelope avoids a circular packageHash -> approval -> packageHash.
// QC remains inside package identity: replacing QC requires a new exact review.
export function manualImagePackageHash(
  value:
    Omit<ManualImagePackage, 'packageHash' | 'review'> | ManualImagePackage,
): string {
  const {
    packageHash: _hash,
    review: _review,
    ...body
  } = value as ManualImagePackage;
  return affiliateHash(body);
}
