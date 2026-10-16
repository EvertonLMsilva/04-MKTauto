import type { QualityControlReport } from './media.types.js';
import { createHash } from 'node:crypto';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import { validateP4Report } from './p4-qc-contracts.js';
export const QUALITY_CONTROL_REPORT_VERSION = 'quality-control-report/1.0.0';
export const QUALITY_CONTROL_POLICY_VERSION = 'quality-control-policy/1.0.0';
export const QUALITY_CONTROL_STATUSES = Object.freeze(['PASS', 'WARN', 'FAIL']);
const REPORT_FIELDS = Object.freeze([
  'schemaVersion',
  'qualityControlReportId',
  'policyVersion',
  'pipelineRunId',
  'projectId',
  'projectVersion',
  'videoRenderId',
  'videoRenderContentHash',
  'artifacts',
  'result',
  'approvalBlocked',
  'findings',
  'checkedAt',
  'contentHash',
]);
const ARTIFACT_FIELDS = Object.freeze([
  'script',
  'voiceTrack',
  'mediaAssets',
  'compositionPlan',
  'subtitleTrack',
  'videoRender',
]);
const REF_FIELDS = Object.freeze(['id', 'contentHash']);
const MEDIA_REF_FIELDS = Object.freeze(['position', 'id', 'contentHash']);
const FINDING_FIELDS = Object.freeze([
  'code',
  'status',
  'subjectType',
  'subjectId',
  'message',
  'observed',
  'expected',
]);
const SENSITIVE =
  /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,}|[?&](?:token|signature|credential|key)=|(?:^|[\\/])users[\\/])/i;
export function validateQualityControlReport(
  input: unknown,
): QualityControlReport {
  const value = input as any;
  if (value?.schemaVersion === 'quality-control-report/2.0.0')
    return validateP4Report(value);
  record(value, 'report');
  exact(value, REPORT_FIELDS, 'report');
  if (value.schemaVersion !== QUALITY_CONTROL_REPORT_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  if (value.policyVersion !== QUALITY_CONTROL_POLICY_VERSION)
    fail('UNSUPPORTED_POLICY_VERSION', 'policyVersion');
  identifier(value.qualityControlReportId, 'qualityControlReportId', 200);
  identifier(value.pipelineRunId, 'pipelineRunId');
  identifier(value.projectId, 'projectId');
  positiveInteger(value.projectVersion, 'projectVersion');
  identifier(value.videoRenderId, 'videoRenderId', 200);
  hash(value.videoRenderContentHash, 'videoRenderContentHash');
  const artifacts = validateArtifacts(value.artifacts);
  status(value.result, 'result');
  if (value.approvalBlocked !== (value.result === 'FAIL'))
    fail('INVALID_APPROVAL_BLOCK', 'approvalBlocked');
  const findings = validateFindings(value.findings);
  if (aggregateQualityControlStatus(findings) !== value.result)
    fail('RESULT_MISMATCH', 'result');
  if (
    artifacts.videoRender.id !== value.videoRenderId ||
    artifacts.videoRender.contentHash !== value.videoRenderContentHash
  )
    fail('VIDEO_BINDING_MISMATCH', 'artifacts.videoRender');
  timestamp(value.checkedAt, 'checkedAt');
  hash(value.contentHash, 'contentHash');
  if (qualityControlReportContentHash(value) !== value.contentHash)
    fail('CONTENT_HASH_MISMATCH', 'contentHash');
  return deepFreeze(structuredClone(value));
}
export function qualityControlReportContentHash(value: any): any {
  const { contentHash: _contentHash, ...content } = value;
  return sha256(stableJson(content));
}
export function qualityControlReportIdentityHash(value: any): any {
  return sha256(stableJson(value));
}
export function qualityControlReportId(
  policyVersion: any,
  videoRenderId: any,
  videoRenderContentHash: any,
): any {
  if (policyVersion !== QUALITY_CONTROL_POLICY_VERSION)
    fail('UNSUPPORTED_POLICY_VERSION', 'policyVersion');
  identifier(videoRenderId, 'videoRenderId', 200);
  hash(videoRenderContentHash, 'videoRenderContentHash');
  return `quality_control:${sha256(`${policyVersion}\n${videoRenderId}\n${videoRenderContentHash}`)}`;
}
export function aggregateQualityControlStatus(findings: any): any {
  if (!Array.isArray(findings) || findings.length === 0)
    fail('FINDINGS_REQUIRED', 'findings');
  if (findings.some(({ status: value }: any) => value === 'FAIL'))
    return 'FAIL';
  if (findings.some(({ status: value }: any) => value === 'WARN'))
    return 'WARN';
  return 'PASS';
}
function validateArtifacts(value: any): any {
  record(value, 'artifacts');
  exact(value, ARTIFACT_FIELDS, 'artifacts');
  for (const name of [
    'script',
    'voiceTrack',
    'compositionPlan',
    'subtitleTrack',
    'videoRender',
  ])
    reference(value[name], `artifacts.${name}`);
  if (
    !Array.isArray(value.mediaAssets) ||
    value.mediaAssets.length === 0 ||
    value.mediaAssets.length > 1000
  )
    fail('INVALID_MEDIA_REFERENCES', 'artifacts.mediaAssets');
  value.mediaAssets.forEach((item: any, index: any) => {
    record(item, `artifacts.mediaAssets.${index}`);
    exact(item, MEDIA_REF_FIELDS, `artifacts.mediaAssets.${index}`);
    if (item.position !== index + 1)
      fail('INVALID_MEDIA_POSITION', `artifacts.mediaAssets.${index}.position`);
    identifier(item.id, `artifacts.mediaAssets.${index}.id`, 200);
    hash(item.contentHash, `artifacts.mediaAssets.${index}.contentHash`);
  });
  return value;
}
function reference(value: any, path: any): any {
  record(value, path);
  exact(value, REF_FIELDS, path);
  identifier(value.id, `${path}.id`, 200);
  hash(value.contentHash, `${path}.contentHash`);
}
function validateFindings(value: any): any {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2000)
    fail('FINDINGS_REQUIRED', 'findings');
  const keys = new Set();
  value.forEach((finding: any, index: any) => {
    const path = `findings.${index}`;
    record(finding, path);
    exact(finding, FINDING_FIELDS, path);
    if (
      typeof finding.code !== 'string' ||
      !/^[A-Z][A-Z0-9_]{2,79}$/.test(finding.code)
    )
      fail('INVALID_FINDING_CODE', `${path}.code`);
    status(finding.status, `${path}.status`);
    if (
      typeof finding.subjectType !== 'string' ||
      !/^[A-Z][A-Z0-9_]{2,39}$/.test(finding.subjectType)
    )
      fail('INVALID_SUBJECT_TYPE', `${path}.subjectType`);
    identifier(finding.subjectId, `${path}.subjectId`, 200);
    text(finding.message, `${path}.message`, 300);
    nullableText(finding.observed, `${path}.observed`);
    nullableText(finding.expected, `${path}.expected`);
    const key = `${finding.code}\n${finding.subjectType}\n${finding.subjectId}`;
    if (keys.has(key)) fail('DUPLICATE_FINDING', path);
    keys.add(key);
  });
  return value;
}
function record(value: any, path: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_TYPE', path);
}
function exact(value: any, fields: any, path: any): any {
  for (const key of Object.keys(value))
    if (!fields.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of fields)
    if (!(key in value)) fail('REQUIRED_FIELD', `${path}.${key}`);
}
function identifier(value: any, path: any, max: any = 80): any {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    fail('INVALID_IDENTIFIER', path);
}
function positiveInteger(value: any, path: any): any {
  if (!Number.isSafeInteger(value) || value < 1)
    fail('INVALID_POSITIVE_INTEGER', path);
}
function hash(value: any, path: any): any {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail('INVALID_HASH', path);
}
function status(value: any, path: any): any {
  if (!QUALITY_CONTROL_STATUSES.includes(value)) fail('INVALID_STATUS', path);
}
function nullableText(value: any, path: any): any {
  if (value !== null) text(value, path, 300);
}
function text(value: any, path: any, max: any): any {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > max ||
    // oxlint-disable-next-line no-control-regex -- Legacy public text forbids control characters.
    /[\u0000-\u001f\u007f]/u.test(value) ||
    SENSITIVE.test(value)
  )
    fail('INVALID_PUBLIC_TEXT', path);
}
function timestamp(value: any, path: any): any {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    fail('INVALID_TIMESTAMP', path);
}
function stableJson(value: any): any {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0))
      .map((key: any) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value: any): any {
  return createHash('sha256').update(value).digest('hex');
}
function deepFreeze(value: any): any {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
function fail(code: any, path: any): never {
  throw new ContractValidationError(code, path, 'valor inválido');
}
