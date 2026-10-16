import { createHash } from 'node:crypto';
import { validateAiCallObservation } from '../../finance/domain/ai-call-telemetry-contracts.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import type { AcquisitionRequest } from './media.types.js';
export const MEDIA_ACQUISITION_REQUEST_VERSION =
  'media-acquisition-request/1.0.0';
const REQUEST_FIELDS = Object.freeze([
  'schemaVersion',
  'mediaAcquisitionRequestId',
  'scriptId',
  'scriptContentHash',
  'visualDirectionPosition',
  'assetType',
  'requestedAt',
  'contentHash',
]);
const OUTPUT_FIELDS = Object.freeze([
  'assetType',
  'technicalProperties',
  'contentHash',
  'mediaReference',
  'origin',
  'provider',
  'rights',
  'source',
  'telemetry',
]);
const REQUIRED_OUTPUT_FIELDS = Object.freeze(
  OUTPUT_FIELDS.filter(
    (field: any) => !['telemetry', 'source'].includes(field),
  ),
);
const TECHNICAL_FIELDS = Object.freeze([
  'format',
  'widthPixels',
  'heightPixels',
  'durationMilliseconds',
]);
const V2_TECHNICAL_FIELDS = Object.freeze([
  ...TECHNICAL_FIELDS,
  'mimeType',
  'hasAudio',
]);
const RIGHTS_FIELDS = Object.freeze(['usageBasis', 'commercialUseAllowed']);
const ASSET_TYPES = Object.freeze(['IMAGE', 'VIDEO']);
const FORMATS = Object.freeze({
  IMAGE: ['jpeg', 'png', 'webp'],
  VIDEO: ['mp4', 'webm', 'mov'],
});
const ORIGINS = Object.freeze([
  'OPERATOR_OWNED',
  'AUTHORIZED_THIRD_PARTY',
  'PROVIDER_GENERATED',
  'PROVIDER_LICENSED',
]);
const PROVIDER_ORIGINS = new Set(['PROVIDER_GENERATED', 'PROVIDER_LICENSED']);
const USAGE_BASES = Object.freeze([
  'OWNED',
  'LICENSED',
  'EXPLICIT_PERMISSION',
  'PROVIDER_TERMS',
]);
const FORBIDDEN_REFERENCE_SCHEME =
  /^(?:https?|file|data|s3|gs|az|blob|bucket|object|storage|path):/i;
const SENSITIVE_REFERENCE =
  /(?:^|[:._-])(?:token|secret|credential|password|signature|api.?key)(?:[:._-]|$)/i;
export function validateMediaAcquisitionRequest(
  value: unknown,
): AcquisitionRequest;
export function validateMediaAcquisitionRequest(value: any) {
  record(value, 'request');
  exact(value, REQUEST_FIELDS, 'request');
  if (value.schemaVersion !== MEDIA_ACQUISITION_REQUEST_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  identifier(value.mediaAcquisitionRequestId, 'mediaAcquisitionRequestId', 180);
  identifier(value.scriptId, 'scriptId', 200);
  hash(value.scriptContentHash, 'scriptContentHash');
  positiveInteger(
    value.visualDirectionPosition,
    'visualDirectionPosition',
    'INVALID_VISUAL_DIRECTION_POSITION',
  );
  if (!ASSET_TYPES.includes(value.assetType))
    fail('INVALID_ASSET_TYPE', 'assetType');
  timestamp(value.requestedAt, 'requestedAt');
  hash(value.contentHash, 'contentHash');
  if (mediaAcquisitionRequestHash(value) !== value.contentHash)
    fail('CONTENT_HASH_MISMATCH', 'contentHash');
  return deepFreeze(structuredClone(value));
}
export function mediaAcquisitionRequestHash(value: any) {
  const { contentHash: _contentHash, ...content } = value;
  return createHash('sha256').update(stableJson(content)).digest('hex');
}
export function validateMediaProviderOutput(value: any) {
  record(value, 'output');
  exactAllowedRequired(value, OUTPUT_FIELDS, REQUIRED_OUTPUT_FIELDS, 'output');
  if (!ASSET_TYPES.includes(value.assetType))
    fail('INVALID_ASSET_TYPE', 'assetType');
  technicalProperties(
    value.technicalProperties,
    value.assetType,
    value.source !== undefined,
  );
  hash(value.contentHash, 'contentHash');
  mediaReference(value.mediaReference);
  if (!ORIGINS.includes(value.origin)) fail('INVALID_MEDIA_ORIGIN', 'origin');
  if (value.provider !== null) identifier(value.provider, 'provider', 100);
  if (PROVIDER_ORIGINS.has(value.origin) && value.provider === null)
    fail('PROVIDER_REQUIRED', 'provider');
  if (!PROVIDER_ORIGINS.has(value.origin) && value.provider !== null)
    fail('PROVIDER_NOT_APPLICABLE', 'provider');
  rights(value.rights);
  validateRightsOrigin(value.origin, value.rights.usageBasis);
  if (value.origin === 'PROVIDER_LICENSED' && value.source === undefined)
    fail('SOURCE_REQUIRED', 'source');
  const normalized = structuredClone(value);
  if (value.telemetry !== undefined)
    normalized.telemetry = validateAiCallObservation(value.telemetry);
  return deepFreeze(normalized);
}
function technicalProperties(value: any, assetType: any, isV2: any) {
  record(value, 'technicalProperties');
  exact(
    value,
    isV2 ? V2_TECHNICAL_FIELDS : TECHNICAL_FIELDS,
    'technicalProperties',
  );
  if (!FORMATS[assetType as keyof typeof FORMATS].includes(value.format))
    fail('INVALID_MEDIA_FORMAT', 'technicalProperties.format');
  boundedPositiveInteger(
    value.widthPixels,
    'technicalProperties.widthPixels',
    'INVALID_MEDIA_DIMENSION',
    100000,
  );
  boundedPositiveInteger(
    value.heightPixels,
    'technicalProperties.heightPixels',
    'INVALID_MEDIA_DIMENSION',
    100000,
  );
  if (assetType === 'IMAGE' && value.durationMilliseconds !== null)
    fail('DURATION_NOT_APPLICABLE', 'technicalProperties.durationMilliseconds');
  if (assetType === 'VIDEO')
    boundedPositiveInteger(
      value.durationMilliseconds,
      'technicalProperties.durationMilliseconds',
      'INVALID_DURATION',
      86400000,
    );
  if (isV2) {
    const expectedMime =
      value.format === 'mp4'
        ? 'video/mp4'
        : value.format === 'mov'
          ? 'video/quicktime'
          : value.format === 'webm'
            ? 'video/webm'
            : `image/${value.format}`;
    if (value.mimeType !== expectedMime)
      fail('INVALID_MEDIA_MIME_TYPE', 'technicalProperties.mimeType');
    if (assetType === 'VIDEO' && typeof value.hasAudio !== 'boolean')
      fail('INVALID_AUDIO_FLAG', 'technicalProperties.hasAudio');
    if (assetType === 'IMAGE' && value.hasAudio !== null)
      fail('AUDIO_NOT_APPLICABLE', 'technicalProperties.hasAudio');
  }
}
function rights(value: any) {
  record(value, 'rights');
  exact(value, RIGHTS_FIELDS, 'rights');
  if (!USAGE_BASES.includes(value.usageBasis))
    fail('INVALID_USAGE_BASIS', 'rights.usageBasis');
  if (value.commercialUseAllowed !== true)
    fail('COMMERCIAL_USE_REQUIRED', 'rights.commercialUseAllowed');
}
function validateRightsOrigin(origin: any, usageBasis: any) {
  const allowed = {
    OPERATOR_OWNED: ['OWNED'],
    AUTHORIZED_THIRD_PARTY: ['LICENSED', 'EXPLICIT_PERMISSION'],
    PROVIDER_GENERATED: ['PROVIDER_TERMS'],
    PROVIDER_LICENSED: ['LICENSED', 'PROVIDER_TERMS'],
  };
  if (!allowed[origin as keyof typeof allowed].includes(usageBasis))
    fail('RIGHTS_ORIGIN_MISMATCH', 'rights.usageBasis');
}
function mediaReference(value: any) {
  const safe =
    typeof value === 'string' &&
    value.length >= 7 &&
    value.length <= 250 &&
    /^[a-z][a-z0-9_-]{2,40}:[a-z0-9][a-z0-9._-]{2,200}$/.test(value) &&
    !FORBIDDEN_REFERENCE_SCHEME.test(value) &&
    !SENSITIVE_REFERENCE.test(value);
  if (!safe) fail('INVALID_MEDIA_REFERENCE', 'mediaReference');
}
function record(value: any, path: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_TYPE', path);
}
function exact(value: any, fields: any, path: any) {
  for (const key of Object.keys(value))
    if (!fields.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of fields)
    if (!(key in value)) fail('REQUIRED_FIELD', `${path}.${key}`);
}
function exactAllowedRequired(
  value: any,
  allowed: any,
  required: any,
  path: any,
) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of required)
    if (!(key in value)) fail('REQUIRED_FIELD', `${path}.${key}`);
}
function identifier(value: any, path: any, max: any = 80) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    fail('INVALID_IDENTIFIER', path);
}
function positiveInteger(value: any, path: any, code: any) {
  if (!Number.isSafeInteger(value) || value < 1) fail(code, path);
}
function boundedPositiveInteger(value: any, path: any, code: any, max: any) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    fail(code, path);
}
function hash(value: any, path: any) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail('INVALID_HASH', path);
}
function timestamp(value: any, path: any) {
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
function deepFreeze(value: any) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
function fail(code: any, path: any) {
  throw new ContractValidationError(code, path, 'valor inválido');
}
