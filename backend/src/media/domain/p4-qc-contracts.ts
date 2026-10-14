import { adaptationHash } from './media-hash.js';
import { immutable } from '../../affiliate/domain/affiliate-contracts.js';
export const P4_QC_POLICY = 'quality-control-policy/2.0.0';
export function p4Fail(code: any, field: any = 'contract'): any {
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
      value.sourceReference !==
        `object:ltx-video/sha256/${value.sourceContentHash}` ||
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
