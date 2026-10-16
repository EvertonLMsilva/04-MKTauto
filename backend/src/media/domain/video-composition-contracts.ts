import { createHash } from 'node:crypto';
import { ContractValidationError } from '../../project/domain/project.errors.js';
export const VIDEO_COMPOSITION_REQUEST_VERSION: any =
  'video-composition-request/1.0.0';
const REQUEST_FIELDS: any = Object.freeze([
  'schemaVersion',
  'videoCompositionRequestId',
  'compositionPlanId',
  'compositionPlanContentHash',
  'containerFormat',
  'widthPixels',
  'heightPixels',
  'requestedAt',
  'contentHash',
]);
const OUTPUT_FIELDS: any = Object.freeze([
  'durationMilliseconds',
  'containerFormat',
  'widthPixels',
  'heightPixels',
  'contentHash',
  'logicalReference',
]);
const CONTAINER_FORMATS: any = Object.freeze(['mp4', 'webm', 'mov']);
const FORBIDDEN_REFERENCE_SCHEME: any =
  /^(?:https?|file|data|s3|gs|az|blob|bucket|object|storage|path):/i;
const SENSITIVE_REFERENCE: any =
  /(?:^|[:._-])(?:token|secret|credential|password|signature|api.?key)(?:[:._-]|$)/i;
export function validateVideoCompositionRequest(value: any): any {
  record(value, 'request');
  exact(value, REQUEST_FIELDS, 'request');
  if (value.schemaVersion !== VIDEO_COMPOSITION_REQUEST_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  identifier(value.videoCompositionRequestId, 'videoCompositionRequestId', 180);
  identifier(value.compositionPlanId, 'compositionPlanId', 200);
  hash(value.compositionPlanContentHash, 'compositionPlanContentHash');
  container(value.containerFormat, 'containerFormat');
  dimension(value.widthPixels, 'widthPixels');
  dimension(value.heightPixels, 'heightPixels');
  timestamp(value.requestedAt, 'requestedAt');
  hash(value.contentHash, 'contentHash');
  if (videoCompositionRequestHash(value) !== value.contentHash)
    fail('CONTENT_HASH_MISMATCH', 'contentHash');
  return deepFreeze(structuredClone(value));
}
export function videoCompositionRequestHash(value: any): any {
  const { contentHash: _contentHash, ...content } = value;
  return createHash('sha256').update(stableJson(content)).digest('hex');
}
export function validateVideoComposerOutput(value: any): any {
  record(value, 'output');
  exact(value, OUTPUT_FIELDS, 'output');
  positiveInteger(
    value.durationMilliseconds,
    'durationMilliseconds',
    'INVALID_DURATION',
    86400000,
  );
  container(value.containerFormat, 'containerFormat');
  dimension(value.widthPixels, 'widthPixels');
  dimension(value.heightPixels, 'heightPixels');
  hash(value.contentHash, 'contentHash');
  logicalReference(value.logicalReference);
  return deepFreeze(structuredClone(value));
}
function logicalReference(value: any): any {
  const safe: any =
    typeof value === 'string' &&
    value.length >= 7 &&
    value.length <= 250 &&
    /^[a-z][a-z0-9_-]{2,40}:[a-z0-9][a-z0-9._-]{2,200}$/.test(value) &&
    !FORBIDDEN_REFERENCE_SCHEME.test(value) &&
    !SENSITIVE_REFERENCE.test(value);
  if (!safe) fail('INVALID_LOGICAL_REFERENCE', 'logicalReference');
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
function positiveInteger(
  value: any,
  path: any,
  code: any,
  max: any = Number.MAX_SAFE_INTEGER,
): any {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    fail(code, path);
}
function dimension(value: any, path: any): any {
  positiveInteger(value, path, 'INVALID_VIDEO_DIMENSION', 100000);
}
function container(value: any, path: any): any {
  if (!CONTAINER_FORMATS.includes(value))
    fail('INVALID_CONTAINER_FORMAT', path);
}
function hash(value: any, path: any): any {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail('INVALID_HASH', path);
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
      .sort()
      .map((key: any) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function deepFreeze(value: any): any {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
function fail(code: any, path: any): any {
  throw new ContractValidationError(code, path, 'valor inválido');
}
