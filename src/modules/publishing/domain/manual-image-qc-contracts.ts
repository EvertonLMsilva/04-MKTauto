import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  exact,
  hashValue,
  publicText,
} from './manual-distribution-contracts.js';
import type { ImageFormat } from './manual-image-package-contracts.js';

export const MANUAL_IMAGE_QC_VERSION = 'manual-image-qc/1.0.0' as const;
// Technical integrity only. PNG uses the existing Media MVP profile: RGB/RGBA,
// 8-bit, non-interlaced. No commercial, visual or publication eligibility claim.
export const IMAGE_TECHNICAL_QC_POLICY = Object.freeze({
  version: 'manual-image-technical-policy/1.0.0',
  maxBytes: 20 * 1024 * 1024,
  maxDimension: 3840,
  maxPixels: 3840 * 3840,
  pixelFormat: 'rgba8' as const,
});
export type ImageQcCode =
  | 'QC_REQUIRED'
  | 'IMAGE_IDENTITY_MISMATCH'
  | 'IMAGE_HASH_MISMATCH'
  | 'IMAGE_SIZE_EXCEEDED'
  | 'IMAGE_PHYSICAL_INVALID'
  | 'IMAGE_FORMAT_UNSUPPORTED'
  | 'BLOCKED_PHYSICAL_INSPECTION_REQUIRED'
  | 'IMAGE_QC_EVIDENCE_INVALID';
export class ImageQcError extends Error {
  constructor(readonly code: ImageQcCode) {
    super(code);
  }
}
export function qcFail(code: ImageQcCode): never {
  throw new ImageQcError(code);
}
export interface ImageQcRequest {
  imageArtifactId: string;
  imageContentHash: string;
  productId: string;
  productRevision: number;
}
export interface ImageQcIdentity extends ImageQcRequest {
  mediaReference: string;
  format: ImageFormat;
  widthPixels: number;
  heightPixels: number;
}
export interface ImageQcArtifact extends ImageQcIdentity {
  provenanceReference: string;
}
export interface ImageQcProvenance extends ImageQcIdentity {
  schemaVersion: 'manual-image-provenance/1.0.0';
  sourceId: string;
  contentHash: string;
}
export interface ImagePhysicalInspection extends ImageQcIdentity {
  schemaVersion: 'manual-image-physical-inspection/1.0.0';
  sourceId: string;
  provenanceReference: string;
  sizeBytes: number;
  decoderId: string;
  decoderVersion: string;
  fullyDecoded: true;
  frameCount: 1;
  pixelFormat: 'rgba8';
  decodedByteLength: number;
  pixelContentHash: string;
  policyVersion: string;
  contentHash: string;
}
// Exact legacy consumer contract. Do not add fields to the report envelope.
export interface ManualImageQcReport extends Omit<
  ImageQcIdentity,
  'mediaReference'
> {
  schemaVersion: typeof MANUAL_IMAGE_QC_VERSION;
  reportId: string;
  result: 'PASS';
  policyVersion: string;
  evidenceReference: string;
  contentHash: string;
}
export interface ManualImageQcBundle {
  report: ManualImageQcReport;
  inspection: ImagePhysicalInspection;
  provenance: ImageQcProvenance;
}
export const imageQcIdentityFields = [
  'imageArtifactId',
  'imageContentHash',
  'productId',
  'productRevision',
  'mediaReference',
  'format',
  'widthPixels',
  'heightPixels',
] as const;
const requestFields = [
  'imageArtifactId',
  'imageContentHash',
  'productId',
  'productRevision',
];
function requestValues(v: ImageQcRequest) {
  affiliateIdentifier(v.imageArtifactId, 'imageArtifactId');
  affiliateIdentifier(v.productId, 'productId');
  hashValue(v.imageContentHash, 'imageContentHash');
  if (!Number.isSafeInteger(v.productRevision) || v.productRevision < 1)
    qcFail('IMAGE_IDENTITY_MISMATCH');
}
function identityValues(v: ImageQcIdentity) {
  requestValues(v);
  if (!['png', 'jpeg'].includes(v.format)) qcFail('IMAGE_FORMAT_UNSUPPORTED');
  if (
    typeof v.mediaReference !== 'string' ||
    !/^media:[a-zA-Z0-9_:-]{1,194}$/.test(v.mediaReference)
  )
    qcFail('IMAGE_IDENTITY_MISMATCH');
  for (const n of [v.widthPixels, v.heightPixels])
    if (
      !Number.isSafeInteger(n) ||
      n < 1 ||
      n > IMAGE_TECHNICAL_QC_POLICY.maxDimension
    )
      qcFail('IMAGE_PHYSICAL_INVALID');
  if (v.widthPixels * v.heightPixels > IMAGE_TECHNICAL_QC_POLICY.maxPixels)
    qcFail('IMAGE_PHYSICAL_INVALID');
}
function canonical(v: { contentHash: string }) {
  hashValue(v.contentHash, 'contentHash');
  if (affiliateHash(v) !== v.contentHash) qcFail('IMAGE_QC_EVIDENCE_INVALID');
}
export function validateImageQcRequest(raw: unknown): ImageQcRequest {
  exact(raw, requestFields);
  const v = raw as ImageQcRequest;
  requestValues(v);
  return immutable(v);
}
export function validateImageQcArtifact(raw: unknown): ImageQcArtifact {
  exact(raw, [...imageQcIdentityFields, 'provenanceReference']);
  const v = raw as ImageQcArtifact;
  identityValues(v);
  publicText(v.provenanceReference, 'provenanceReference', 200);
  return immutable(v);
}
export function imageProvenanceReference(v: ImageQcProvenance): string {
  return 'image-provenance:sha256:' + affiliateHash(v);
}
export function validateImageQcProvenance(raw: unknown): ImageQcProvenance {
  exact(raw, [
    ...imageQcIdentityFields,
    'schemaVersion',
    'sourceId',
    'contentHash',
  ]);
  const v = raw as ImageQcProvenance;
  identityValues(v);
  affiliateIdentifier(v.sourceId, 'sourceId');
  if (v.schemaVersion !== 'manual-image-provenance/1.0.0')
    qcFail('QC_REQUIRED');
  canonical(v);
  return immutable(v);
}
export function imageInspectionReference(v: ImagePhysicalInspection): string {
  return 'image-inspection:sha256:' + affiliateHash(v);
}
export function imageQcReportId(v: ImagePhysicalInspection): string {
  return 'image_qc_' + affiliateHash(v);
}
// Resolves the content-addressed reference inside the self-contained bundle.
// Hash validation proves integrity/binding, not trust in an arbitrary caller.
// Only the producer's host-configured readers/decoder establish that trust.
export function validateManualImageQcBundle(raw: unknown): ManualImageQcBundle {
  exact(raw, ['report', 'inspection', 'provenance']);
  const v = raw as ManualImageQcBundle;
  const provenance = validateImageQcProvenance(v.provenance);
  const i = v.inspection,
    r = v.report;
  exact(i, [
    ...imageQcIdentityFields,
    'schemaVersion',
    'sourceId',
    'provenanceReference',
    'sizeBytes',
    'decoderId',
    'decoderVersion',
    'fullyDecoded',
    'frameCount',
    'pixelFormat',
    'decodedByteLength',
    'pixelContentHash',
    'policyVersion',
    'contentHash',
  ]);
  identityValues(i);
  canonical(i);
  affiliateIdentifier(i.decoderId, 'decoderId');
  publicText(i.decoderVersion, 'decoderVersion', 100);
  hashValue(i.pixelContentHash, 'pixelContentHash');
  if (
    i.schemaVersion !== 'manual-image-physical-inspection/1.0.0' ||
    i.policyVersion !== IMAGE_TECHNICAL_QC_POLICY.version ||
    i.fullyDecoded !== true ||
    i.frameCount !== 1 ||
    i.pixelFormat !== 'rgba8' ||
    i.decodedByteLength !== i.widthPixels * i.heightPixels * 4 ||
    !Number.isSafeInteger(i.sizeBytes) ||
    i.sizeBytes < 1 ||
    i.sizeBytes > IMAGE_TECHNICAL_QC_POLICY.maxBytes ||
    i.sourceId !== provenance.sourceId ||
    i.provenanceReference !== imageProvenanceReference(provenance) ||
    imageQcIdentityFields.some((k) => i[k] !== provenance[k])
  )
    qcFail('IMAGE_QC_EVIDENCE_INVALID');
  exact(r, [
    ...imageQcIdentityFields.filter((k) => k !== 'mediaReference'),
    'schemaVersion',
    'reportId',
    'result',
    'policyVersion',
    'evidenceReference',
    'contentHash',
  ]);
  canonical(r);
  if (
    r.schemaVersion !== MANUAL_IMAGE_QC_VERSION ||
    r.result !== 'PASS' ||
    r.policyVersion !== IMAGE_TECHNICAL_QC_POLICY.version ||
    r.reportId !== imageQcReportId(i) ||
    r.evidenceReference !== imageInspectionReference(i) ||
    imageQcIdentityFields.some((k) => k !== 'mediaReference' && r[k] !== i[k])
  )
    qcFail('IMAGE_QC_EVIDENCE_INVALID');
  return immutable(v);
}
