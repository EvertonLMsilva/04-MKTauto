import { createHash } from 'node:crypto';
import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import { inspectMvpPng } from '../../media/infrastructure/physical-media-inspection.js';
import { publicText } from '../domain/manual-distribution-contracts.js';
import type { ImageFormat } from '../domain/manual-image-package-contracts.js';
import {
  IMAGE_TECHNICAL_QC_POLICY,
  MANUAL_IMAGE_QC_VERSION,
  ImageQcError,
  qcFail,
  imageQcIdentityFields,
  imageProvenanceReference,
  imageInspectionReference,
  imageQcReportId,
  validateImageQcRequest,
  validateImageQcArtifact,
  validateImageQcProvenance,
  validateManualImageQcBundle,
  type ImageQcCode,
  type ImagePhysicalInspection,
  type ImageQcProvenance,
  type ManualImageQcReport,
  type ManualImageQcBundle,
} from '../domain/manual-image-qc-contracts.js';

type Read<T> = T | Promise<T>;
export interface ManualImageQcReaders {
  getArtifact(this: void, id: string): Read<unknown>;
  getProvenance(this: void, reference: string): Read<unknown>;
  readBytes(this: void, mediaReference: string): Read<Uint8Array | null>;
}
export interface ImageQcDecoder {
  id: string;
  version: string;
  // Trusted, complete local decode of the supplied bytes. A probe, extension or
  // signature is not a decoder. Return the entire single-frame RGBA8 raster.
  decode(bytes: Buffer): Read<{
    format: ImageFormat;
    widthPixels: number;
    heightPixels: number;
    fullyDecoded: boolean;
    frameCount: number;
    rgba: Uint8Array;
  }>;
}
interface QcOptions {
  trustedSourceIds: readonly string[];
  decoder?: ImageQcDecoder;
}
type QcStatus =
  'PASS' | 'BLOCKED' | 'QC_REQUIRED' | 'BLOCKED_PHYSICAL_INSPECTION_REQUIRED';
export interface ManualImageQcResult {
  status: QcStatus;
  bundle: ManualImageQcBundle | null;
  blockers: ImageQcCode[];
  humanApproval: 'HUMAN_APPROVAL_REQUIRED';
  commercialApproval: 'NOT_ASSESSED';
  publicationAuthorized: false;
}
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export class ManualImageQcService {
  private readonly sources: ReadonlySet<string>;
  private readonly decoder: ImageQcDecoder | null;
  constructor(
    private readonly readers: ManualImageQcReaders,
    options: QcOptions,
  ) {
    // Host-only configuration: neither source trust nor decoder comes from the
    // inspect request. Snapshot it so later caller mutation cannot extend trust.
    this.sources = new Set(
      options.trustedSourceIds.map((s) => affiliateIdentifier(s, 'sourceId')),
    );
    const d = options.decoder;
    let decoder: ImageQcDecoder | null = null;
    try {
      if (d && typeof d.decode === 'function')
        decoder = Object.freeze({
          id: affiliateIdentifier(d.id, 'decoderId'),
          version: publicText(d.version, 'decoderVersion', 100) as string,
          decode: d.decode.bind(d),
        });
    } catch {
      /* Invalid decoder configuration cannot certify physical QC. */
    }
    this.decoder = decoder;
  }
  async inspect(raw: unknown): Promise<ManualImageQcResult> {
    try {
      const request = validateImageQcRequest(raw);
      const found = await this.readers.getArtifact(request.imageArtifactId);
      if (!found) qcFail('QC_REQUIRED');
      const artifact = validateImageQcArtifact(found);
      if (
        artifact.imageArtifactId !== request.imageArtifactId ||
        artifact.imageContentHash !== request.imageContentHash ||
        artifact.productId !== request.productId ||
        artifact.productRevision !== request.productRevision
      )
        qcFail('IMAGE_IDENTITY_MISMATCH');
      let provenance: ImageQcProvenance;
      try {
        provenance = validateImageQcProvenance(
          await this.readers.getProvenance(artifact.provenanceReference),
        );
        if (
          !this.sources.has(provenance.sourceId) ||
          artifact.provenanceReference !==
            imageProvenanceReference(provenance) ||
          imageQcIdentityFields.some((k) => artifact[k] !== provenance[k])
        )
          qcFail('QC_REQUIRED');
      } catch {
        qcFail('QC_REQUIRED');
      }
      const source = await this.readers.readBytes(artifact.mediaReference);
      if (!(source instanceof Uint8Array) || source.byteLength < 1)
        qcFail('QC_REQUIRED');
      if (source.byteLength > IMAGE_TECHNICAL_QC_POLICY.maxBytes)
        qcFail('IMAGE_SIZE_EXCEEDED');
      const bytes = Buffer.from(source);
      if (sha256(bytes) !== artifact.imageContentHash)
        qcFail('IMAGE_HASH_MISMATCH');
      try {
        if (artifact.format === 'png') inspectMvpPng(bytes, artifact);
        else if (
          bytes[0] !== 255 ||
          bytes[1] !== 216 ||
          bytes.at(-2) !== 255 ||
          bytes.at(-1) !== 217
        )
          qcFail('IMAGE_PHYSICAL_INVALID');
      } catch {
        qcFail('IMAGE_PHYSICAL_INVALID');
      }
      if (!this.decoder) qcFail('BLOCKED_PHYSICAL_INSPECTION_REQUIRED');
      let decoded;
      try {
        decoded = await this.decoder.decode(Buffer.from(bytes));
      } catch {
        qcFail('BLOCKED_PHYSICAL_INSPECTION_REQUIRED');
      }
      if (
        !decoded ||
        decoded.fullyDecoded !== true ||
        decoded.frameCount !== 1 ||
        !(decoded.rgba instanceof Uint8Array) ||
        decoded.rgba.byteLength !==
          artifact.widthPixels * artifact.heightPixels * 4
      )
        qcFail('BLOCKED_PHYSICAL_INSPECTION_REQUIRED');
      if (
        decoded.format !== artifact.format ||
        decoded.widthPixels !== artifact.widthPixels ||
        decoded.heightPixels !== artifact.heightPixels
      )
        qcFail('IMAGE_PHYSICAL_INVALID');
      const { provenanceReference, ...identity } = artifact;
      const inspectionBody: Omit<ImagePhysicalInspection, 'contentHash'> = {
        ...identity,
        schemaVersion: 'manual-image-physical-inspection/1.0.0',
        sourceId: provenance.sourceId,
        provenanceReference,
        sizeBytes: bytes.length,
        decoderId: this.decoder.id,
        decoderVersion: this.decoder.version,
        fullyDecoded: true,
        frameCount: 1,
        pixelFormat: 'rgba8',
        decodedByteLength: decoded.rgba.byteLength,
        pixelContentHash: sha256(decoded.rgba),
        policyVersion: IMAGE_TECHNICAL_QC_POLICY.version,
      };
      const inspection = {
        ...inspectionBody,
        contentHash: affiliateHash(inspectionBody),
      };
      const reportBody: Omit<ManualImageQcReport, 'contentHash'> = {
        schemaVersion: MANUAL_IMAGE_QC_VERSION,
        reportId: imageQcReportId(inspection),
        imageArtifactId: artifact.imageArtifactId,
        imageContentHash: artifact.imageContentHash,
        productId: artifact.productId,
        productRevision: artifact.productRevision,
        format: artifact.format,
        widthPixels: artifact.widthPixels,
        heightPixels: artifact.heightPixels,
        result: 'PASS',
        policyVersion: IMAGE_TECHNICAL_QC_POLICY.version,
        evidenceReference: imageInspectionReference(inspection),
      };
      const bundle = validateManualImageQcBundle({
        report: { ...reportBody, contentHash: affiliateHash(reportBody) },
        inspection,
        provenance,
      });
      return this.result('PASS', bundle, []);
    } catch (error) {
      const code = error instanceof ImageQcError ? error.code : 'QC_REQUIRED';
      return this.result(
        code === 'QC_REQUIRED' ||
          code === 'BLOCKED_PHYSICAL_INSPECTION_REQUIRED'
          ? code
          : 'BLOCKED',
        null,
        [code],
      );
    }
  }
  private result(
    status: QcStatus,
    bundle: ManualImageQcBundle | null,
    blockers: ImageQcCode[],
  ): ManualImageQcResult {
    return immutable({
      status,
      bundle,
      blockers,
      humanApproval: 'HUMAN_APPROVAL_REQUIRED',
      commercialApproval: 'NOT_ASSESSED',
      publicationAuthorized: false,
    });
  }
}
