import type { MediaAsset } from './media.types.js';
import { createHash } from 'node:crypto';
import { validateMediaRightsEvidence } from './media-processing-rights.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
export const MEDIA_ASSET_CONTRACT_VERSION = 'media-asset/1.0.0';
export const MEDIA_ASSET_V2_CONTRACT_VERSION = 'media-asset/2.0.0';
const FIELDS = Object.freeze([
  'schemaVersion',
  'mediaAssetId',
  'pipelineRunId',
  'projectId',
  'projectVersion',
  'scriptId',
  'scriptContentHash',
  'visualDirectionPosition',
  'assetType',
  'technicalProperties',
  'contentHash',
  'mediaReference',
  'origin',
  'provider',
  'rights',
  'createdAt',
  'revision',
  'supersedesMediaAssetId',
]);
const V2_FIELDS = Object.freeze([...FIELDS, 'source']);
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
const SOURCE_FIELDS = Object.freeze([
  'externalAssetId',
  'licenseName',
  'licenseUrl',
  'photographerName',
  'photographerUrl',
  'sourceUrl',
]);
const RIGHTS_FIELDS = Object.freeze(['usageBasis', 'commercialUseAllowed']);
const ASSET_TYPES = Object.freeze(['IMAGE', 'VIDEO']);
const FORMATS = Object.freeze({
  IMAGE: Object.freeze(['jpeg', 'png', 'webp']),
  VIDEO: Object.freeze(['mp4', 'webm', 'mov']),
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
export function validateMediaAsset(input: unknown): MediaAsset {
  const value = input as MediaAsset;
  record(value, 'mediaAsset');
  const isV2 = value.schemaVersion === MEDIA_ASSET_V2_CONTRACT_VERSION;
  exact(value, isV2 ? V2_FIELDS : FIELDS, 'mediaAsset');
  if (!isV2 && value.schemaVersion !== MEDIA_ASSET_CONTRACT_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  identifier(value.mediaAssetId, 'mediaAssetId', 200);
  identifier(value.pipelineRunId, 'pipelineRunId');
  identifier(value.projectId, 'projectId');
  positiveInteger(
    value.projectVersion,
    'projectVersion',
    'INVALID_PROJECT_VERSION',
  );
  identifier(value.scriptId, 'scriptId', 200);
  hash(value.scriptContentHash, 'scriptContentHash');
  positiveInteger(
    value.visualDirectionPosition,
    'visualDirectionPosition',
    'INVALID_VISUAL_DIRECTION_POSITION',
  );
  if (!ASSET_TYPES.includes(value.assetType))
    fail('INVALID_ASSET_TYPE', 'assetType');
  technicalProperties(value.technicalProperties, value.assetType, isV2);
  hash(value.contentHash, 'contentHash');
  mediaReference(value.mediaReference);
  if (!ORIGINS.includes(value.origin)) fail('INVALID_MEDIA_ORIGIN', 'origin');
  if (value.provider !== null) identifier(value.provider, 'provider', 100);
  if (PROVIDER_ORIGINS.has(value.origin) && value.provider === null)
    fail('PROVIDER_REQUIRED', 'provider');
  if (!PROVIDER_ORIGINS.has(value.origin) && value.provider !== null)
    fail('PROVIDER_NOT_APPLICABLE', 'provider');
  rights(value.rights);
  if (Object.hasOwn(value.rights, 'evidence'))
    validateMediaRightsEvidence(value.rights.evidence, {
      mediaRef: value.mediaReference,
      contentHash: value.contentHash,
    });
  validateRightsOrigin(value.origin, value.rights.usageBasis);
  if (isV2) source(value.source, value.origin, value.provider);
  timestamp(value.createdAt, 'createdAt');
  positiveInteger(value.revision, 'revision', 'INVALID_REVISION');
  if (value.supersedesMediaAssetId !== null)
    identifier(value.supersedesMediaAssetId, 'supersedesMediaAssetId', 200);
  if (value.revision === 1 && value.supersedesMediaAssetId !== null)
    fail('INVALID_SUPERSESSION', 'supersedesMediaAssetId');
  if (value.revision > 1 && value.supersedesMediaAssetId === null)
    fail('SUPERSEDED_MEDIA_ASSET_REQUIRED', 'supersedesMediaAssetId');
  return deepFreeze(structuredClone(value));
}
export function mediaAssetIdentityHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
function technicalProperties(value: any, assetType: any, isV2: any): any {
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
    if (assetType === 'IMAGE' && value.hasAudio !== null)
      fail('AUDIO_NOT_APPLICABLE', 'technicalProperties.hasAudio');
    if (assetType === 'VIDEO' && typeof value.hasAudio !== 'boolean')
      fail('INVALID_AUDIO_FLAG', 'technicalProperties.hasAudio');
  }
  if (assetType === 'VIDEO') {
    if (value.durationMilliseconds === null)
      fail('DURATION_REQUIRED', 'technicalProperties.durationMilliseconds');
    boundedPositiveInteger(
      value.durationMilliseconds,
      'technicalProperties.durationMilliseconds',
      'INVALID_DURATION',
      86400000,
    );
  }
}
function source(value: any, origin: any, provider: any): any {
  if (origin !== 'PROVIDER_LICENSED') {
    if (value !== null) fail('SOURCE_NOT_APPLICABLE', 'source');
    return;
  }
  record(value, 'source');
  exact(value, SOURCE_FIELDS, 'source');
  if (provider === null) fail('PROVIDER_REQUIRED', 'provider');
  safeSourceText(value.externalAssetId, 'source.externalAssetId', 100);
  safeSourceText(value.licenseName, 'source.licenseName', 100);
  safeSourceText(value.photographerName, 'source.photographerName', 200);
  httpsUrl(value.licenseUrl, 'source.licenseUrl');
  httpsUrl(value.photographerUrl, 'source.photographerUrl');
  httpsUrl(value.sourceUrl, 'source.sourceUrl');
}
function safeSourceText(value: any, path: any, max: any): any {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max)
    fail('INVALID_SOURCE_METADATA', path);
}
function httpsUrl(value: any, path: any): any {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      fail('INVALID_SOURCE_URL', path);
  } catch {
    fail('INVALID_SOURCE_URL', path);
  }
}
function rights(value: any): any {
  record(value, 'rights');
  exact(
    value,
    [
      ...RIGHTS_FIELDS,
      ...(Object.hasOwn(value, 'evidence') ? ['evidence'] : []),
    ],
    'rights',
  );
  if (!USAGE_BASES.includes(value.usageBasis))
    fail('INVALID_USAGE_BASIS', 'rights.usageBasis');
  if (value.commercialUseAllowed !== true)
    fail('COMMERCIAL_USE_REQUIRED', 'rights.commercialUseAllowed');
}
function validateRightsOrigin(origin: any, usageBasis: any): any {
  const allowed: any = {
    OPERATOR_OWNED: ['OWNED'],
    AUTHORIZED_THIRD_PARTY: ['LICENSED', 'EXPLICIT_PERMISSION'],
    PROVIDER_GENERATED: ['PROVIDER_TERMS'],
    PROVIDER_LICENSED: ['LICENSED', 'PROVIDER_TERMS'],
  };
  if (!allowed[origin].includes(usageBasis))
    fail('RIGHTS_ORIGIN_MISMATCH', 'rights.usageBasis');
}
function mediaReference(value: any): any {
  const safe =
    typeof value === 'string' &&
    value.length >= 7 &&
    value.length <= 250 &&
    /^[a-z][a-z0-9_-]{2,40}:[a-z0-9][a-z0-9._-]{2,200}$/.test(value) &&
    !FORBIDDEN_REFERENCE_SCHEME.test(value) &&
    !SENSITIVE_REFERENCE.test(value);
  if (!safe) fail('INVALID_MEDIA_REFERENCE', 'mediaReference');
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
function positiveInteger(value: any, path: any, code: any): any {
  if (!Number.isSafeInteger(value) || value < 1) fail(code, path);
}
function boundedPositiveInteger(
  value: any,
  path: any,
  code: any,
  max: any,
): any {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    fail(code, path);
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
      .sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0))
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
function fail(code: any, path: any): never {
  throw new ContractValidationError(code, path, 'valor inválido');
}
