import { createHash } from 'node:crypto';
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
const ASSET_TYPES = Object.freeze(['IMAGE', 'VIDEO']);
export function validateMediaAcquisitionRequest(
  input: unknown,
): AcquisitionRequest {
  const value = input as any;
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
export function mediaAcquisitionRequestHash(value: any): any {
  const { contentHash: _contentHash, ...content } = value;
  return createHash('sha256').update(stableJson(content)).digest('hex');
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
