import { affiliateHash } from '../affiliate/domain/affiliate-contracts.js';
import {
  IMAGE_TECHNICAL_QC_POLICY,
  imageInspectionReference,
  imageProvenanceReference,
  imageQcReportId,
  validateManualImageQcBundle,
  type ManualImageQcBundle,
  type ImageQcProvenance,
  type ImagePhysicalInspection,
} from './domain/manual-image-qc-contracts.js';

// Contract-only test data; this is never operational QC evidence.
function bundleFixture(): ManualImageQcBundle {
  const identity = {
    imageArtifactId: 'fixture_image',
    imageContentHash: 'a'.repeat(64),
    productId: 'fixture_product',
    productRevision: 1,
    mediaReference: 'media:fixture_image',
    format: 'png' as const,
    widthPixels: 90,
    heightPixels: 160,
  };
  const provenance: ImageQcProvenance = {
    ...identity,
    schemaVersion: 'manual-image-provenance/1.0.0',
    sourceId: 'fixture_source',
    contentHash: '',
  };
  provenance.contentHash = affiliateHash(provenance);
  const inspection: ImagePhysicalInspection = {
    ...identity,
    schemaVersion: 'manual-image-physical-inspection/1.0.0',
    sourceId: provenance.sourceId,
    provenanceReference: imageProvenanceReference(provenance),
    sizeBytes: 300,
    decoderId: 'fixture_decoder',
    decoderVersion: 'test-only/1',
    fullyDecoded: true,
    frameCount: 1,
    pixelFormat: 'rgba8',
    decodedByteLength: 90 * 160 * 4,
    pixelContentHash: 'b'.repeat(64),
    policyVersion: IMAGE_TECHNICAL_QC_POLICY.version,
    contentHash: '',
  };
  inspection.contentHash = affiliateHash(inspection);
  const { mediaReference: _media, ...reportIdentity } = identity;
  const report = {
    ...reportIdentity,
    schemaVersion: 'manual-image-qc/1.0.0' as const,
    reportId: imageQcReportId(inspection),
    result: 'PASS' as const,
    policyVersion: IMAGE_TECHNICAL_QC_POLICY.version,
    evidenceReference: imageInspectionReference(inspection),
    contentHash: '',
  };
  report.contentHash = affiliateHash(report);
  return { report, inspection, provenance };
}

test('versioned report is canonical, immutable and references the included inspection by hash', () => {
  const bundle = validateManualImageQcBundle(bundleFixture());
  expect(bundle.report.schemaVersion).toBe('manual-image-qc/1.0.0');
  expect(bundle.report.policyVersion).toBe(IMAGE_TECHNICAL_QC_POLICY.version);
  expect(affiliateHash(bundle.report)).toBe(bundle.report.contentHash);
  expect(bundle.report.evidenceReference).toBe(
    imageInspectionReference(bundle.inspection),
  );
  expect(Object.isFrozen(bundle.inspection)).toBe(true);
  expect(() => {
    bundle.report.widthPixels = 1;
  }).toThrow();
});

test.each([
  'reference',
  'reportHash',
  'inspectionHash',
  'provenance',
  'policy',
  'product',
  'revision',
  'pixels',
])('rejects inconsistent %s even when outer hashes are recomputed', (kind) => {
  const bundle = bundleFixture();
  if (kind === 'reference')
    bundle.report.evidenceReference = 'fixture:arbitrary-text';
  if (kind === 'reportHash') bundle.report.contentHash = 'a'.repeat(64);
  if (kind === 'inspectionHash') bundle.inspection.contentHash = 'a'.repeat(64);
  if (kind === 'provenance')
    bundle.provenance.imageContentHash = 'c'.repeat(64);
  if (kind === 'policy') bundle.report.policyVersion = 'unknown/1';
  if (kind === 'product') bundle.report.productId = 'other_product';
  if (kind === 'revision') bundle.report.productRevision++;
  if (kind === 'pixels') bundle.inspection.decodedByteLength--;
  if (kind !== 'reportHash')
    bundle.report.contentHash = affiliateHash(bundle.report);
  if (kind === 'pixels')
    bundle.inspection.contentHash = affiliateHash(bundle.inspection);
  expect(() => validateManualImageQcBundle(bundle)).toThrow();
});
