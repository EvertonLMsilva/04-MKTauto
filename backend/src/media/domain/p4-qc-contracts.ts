import { adaptationHash } from './media-hash.js';
import { immutable } from '../../affiliate/domain/affiliate-contracts.js';
export const P4_QC_POLICY = 'quality-control-policy/2.0.0';
export function p4Fail(code: any, field: any = 'contract'): never {
  throw Object.assign(new Error(`${code}: ${field}`), { code, field });
}
const hash = (value: any) =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value: any) =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9_:-]{2,199}$/.test(value);
const exact = (value: any, keys: any) => {
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value)
      .sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0))
      .join(',') !==
      [...keys]
        .sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0))
        .join(',')
  )
    p4Fail('P4_INVALID_CONTRACT');
};
export function validateVideoOrigin(value: any): any {
  if (value?.kind === 'LEGACY_COMPOSITION') {
    exact(value, [
      'schemaVersion',
      'kind',
      'videoRenderId',
      'videoRenderContentHash',
    ]);
    if (
      value.schemaVersion !== 'video-origin/1.0.0' ||
      !id(value.videoRenderId) ||
      !hash(value.videoRenderContentHash)
    )
      p4Fail('P4_ORIGIN_INVALID');
  } else {
    exact(value, [
      'schemaVersion',
      'kind',
      'generationRequestId',
      'providerRequestId',
      'requestHash',
      'sourceReference',
      'sourceContentHash',
      'rights',
    ]);
    exact(value.rights, [
      'evidenceReference',
      'evidenceContentHash',
      'processingAuthorized',
      'commercialUseAuthorized',
      'audioAuthorized',
    ]);
    if (
      value.kind !== 'AI_GENERATED' ||
      value.schemaVersion !== 'video-origin/1.0.0' ||
      !id(value.generationRequestId) ||
      !id(value.providerRequestId) ||
      !hash(value.requestHash) ||
      !hash(value.sourceContentHash) ||
      !validMediaIdentity(value.sourceReference, value.sourceContentHash) ||
      typeof value.rights.evidenceReference !== 'string' ||
      !value.rights.evidenceReference.trim() ||
      !hash(value.rights.evidenceContentHash) ||
      value.rights.processingAuthorized !== true ||
      typeof value.rights.commercialUseAuthorized !== 'boolean' ||
      value.rights.audioAuthorized !== true
    )
      p4Fail('P4_ORIGIN_INVALID');
  }
  return immutable(value);
}
export function validateP4Report(value: any): any {
  exact(value, [
    'schemaVersion',
    'qualityControlReportId',
    'policyVersion',
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'videoRenderId',
    'videoRenderContentHash',
    'origin',
    'result',
    'approvalBlocked',
    'findings',
    'checkedAt',
    'contentHash',
  ]);
  validateVideoOrigin(value.origin);
  if (
    value.schemaVersion !== 'quality-control-report/2.0.0' ||
    value.policyVersion !== P4_QC_POLICY ||
    !id(value.qualityControlReportId) ||
    !id(value.videoRenderId) ||
    !hash(value.videoRenderContentHash) ||
    !Array.isArray(value.findings) ||
    value.findings.length < 1 ||
    value.findings.some(
      (f: any) =>
        !f ||
        !['PASS', 'FAIL'].includes(f.status) ||
        !/^[A-Z_]{3,80}$/.test(f.code),
    ) ||
    [
      'FILE_INTEGRITY',
      'LINEAGE',
      'PROFILE',
      'AUDIO',
      'PROCESSING_RIGHTS',
      'COMMERCIAL_RIGHTS',
      'NARRATION_RIGHTS',
    ].some(
      (code: any) =>
        value.findings.filter((f: any) => f.code === code).length !== 1,
    ) ||
    value.result !==
      (value.findings.some((f: any) => f.status === 'FAIL')
        ? 'FAIL'
        : 'PASS') ||
    value.approvalBlocked !== (value.result === 'FAIL') ||
    !Number.isFinite(Date.parse(value.checkedAt)) ||
    value.contentHash !== p4ReportHash(value)
  )
    p4Fail('P4_QC_INVALID');
  return immutable(value);
}
export function p4ReportHash(value: any): any {
  const { contentHash: _contentHash, ...body } = value;
  return adaptationHash(body);
}

/** Content-addressed identity only; this does not verify bytes or authorize copying. */
export function mediaIdentityHash(
  reference: unknown,
  contentHash: unknown,
): string {
  if (!validMediaIdentity(reference, contentHash))
    p4Fail('QC_MEDIA_IDENTITY_INVALID');
  return contentHash as string;
}
function validMediaIdentity(reference: unknown, contentHash: unknown): boolean {
  return (
    typeof contentHash === 'string' &&
    /^[a-f0-9]{64}$/.test(contentHash) &&
    typeof reference === 'string' &&
    (reference === `media:sha256_${contentHash}` ||
      reference === `object:ltx-video/sha256/${contentHash}`)
  );
}
export type TemporalStatus = 'PASS' | 'FAIL' | 'NOT_VALIDATED';
export interface TemporalEvidence {
  mediaReference: string;
  contentHash: string;
  motion: TemporalStatus;
  continuity: TemporalStatus;
  fidelity: TemporalStatus;
  motionBasis: 'SUBJECT_MOTION' | 'STILL' | 'GLOBAL_ZOOM_PAN' | 'UNKNOWN';
  provenance: null | {
    reference: string;
    contentHash: string;
    validator: string;
    version: string;
    parameters: Record<string, unknown>;
  };
}
export interface TemporalMediaIdentity {
  mediaAssetId: string;
  mediaReference: string;
  contentHash: string;
  scriptContentHash: string;
  visualDirectionPosition: number;
}
/** Trusted application dependency, never a generation response or user-supplied PASS.
 * Implementations must independently verify the exact bytes and evaluation artifact.
 * No production temporal/semantic analyzer is configured by this contract.
 */
export interface TemporalValidator {
  id: string;
  version: string;
  evaluate(identity: Readonly<TemporalMediaIdentity>): unknown;
}
export function validateTemporalEvidence(
  input: unknown,
  identity: { mediaReference: string; contentHash: string },
): TemporalEvidence {
  const value = input as TemporalEvidence;
  exact(value, [
    'mediaReference',
    'contentHash',
    'motion',
    'continuity',
    'fidelity',
    'motionBasis',
    'provenance',
  ]);
  mediaIdentityHash(identity.mediaReference, identity.contentHash);
  mediaIdentityHash(value.mediaReference, value.contentHash);
  if (
    value.contentHash !== identity.contentHash ||
    value.mediaReference !== identity.mediaReference
  )
    p4Fail('TEMPORAL_EVIDENCE_MEDIA_MISMATCH');
  if (
    ['motion', 'continuity', 'fidelity'].some(
      (key) =>
        !['PASS', 'FAIL', 'NOT_VALIDATED'].includes(value[key as 'motion']),
    )
  )
    p4Fail('TEMPORAL_EVIDENCE_INVALID');
  if (
    !['SUBJECT_MOTION', 'STILL', 'GLOBAL_ZOOM_PAN', 'UNKNOWN'].includes(
      value.motionBasis,
    ) ||
    (value.motion === 'PASS' && value.motionBasis !== 'SUBJECT_MOTION')
  )
    p4Fail('TEMPORAL_MOTION_NOT_PROVEN');
  if (value.provenance === null) {
    if (
      value.motion !== 'NOT_VALIDATED' ||
      value.continuity !== 'NOT_VALIDATED' ||
      value.fidelity !== 'NOT_VALIDATED'
    )
      p4Fail('TEMPORAL_PROVENANCE_REQUIRED');
  } else {
    exact(value.provenance, [
      'reference',
      'contentHash',
      'validator',
      'version',
      'parameters',
    ]);
    if (
      !hash(value.provenance.contentHash) ||
      ['reference', 'validator', 'version'].some(
        (key) =>
          typeof value.provenance![key as 'reference'] !== 'string' ||
          !value.provenance![key as 'reference'].trim(),
      ) ||
      !value.provenance.parameters ||
      typeof value.provenance.parameters !== 'object' ||
      Array.isArray(value.provenance.parameters) ||
      Object.keys(value.provenance.parameters).length === 0
    )
      p4Fail('TEMPORAL_PROVENANCE_INVALID');
  }
  return immutable(value);
}
export function temporalResult(evidence: TemporalEvidence): TemporalStatus {
  const values = [evidence.motion, evidence.continuity, evidence.fidelity];
  return values.includes('FAIL')
    ? 'FAIL'
    : values.every((v) => v === 'PASS')
      ? 'PASS'
      : 'NOT_VALIDATED';
}
export function temporalReportId(
  identity: TemporalMediaIdentity,
  evidence: TemporalEvidence,
): string {
  return `temporal_qc:${adaptationHash({ identity, evidence })}`;
}
export function validateTemporalReport(
  value: any,
  identity: TemporalMediaIdentity,
): any {
  exact(value, [
    'schemaVersion',
    'qualityControlReportId',
    'identity',
    'evidence',
    'result',
    'contentHash',
  ]);
  if (
    value.schemaVersion !== 'temporal-quality-control/1.0.0' ||
    value.qualityControlReportId !==
      temporalReportId(identity, value.evidence) ||
    adaptationHash(value.identity) !== adaptationHash(identity) ||
    value.contentHash !== p4ReportHash(value)
  )
    p4Fail('TEMPORAL_REPORT_INVALID');
  validateTemporalEvidence(value.evidence, identity);
  if (value.result !== temporalResult(value.evidence))
    p4Fail('TEMPORAL_REPORT_INVALID');
  return immutable(value);
}
