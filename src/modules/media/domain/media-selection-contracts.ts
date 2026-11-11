import type { SelectionRequest } from './media.types.js';
import { createHash } from 'node:crypto';
import { ContractValidationError } from '../../project/domain/project.errors.js';
export const MEDIA_SELECTION_REQUEST_VERSION = 'media-selection-request/1.0.0';
const FIELDS = Object.freeze([
  'schemaVersion',
  'mediaSelectionRequestId',
  'scriptId',
  'scriptContentHash',
  'visualDirectionPosition',
  'productionProfile',
  'requestedAt',
  'contentHash',
]);
export function validateMediaSelectionRequest(
  input: unknown,
): SelectionRequest {
  const value = input as any;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_TYPE', 'request');
  for (const key of Object.keys(value))
    if (!FIELDS.includes(key)) fail('UNKNOWN_FIELD', `request.${key}`);
  for (const key of FIELDS)
    if (!(key in value)) fail('REQUIRED_FIELD', `request.${key}`);
  if (value.schemaVersion !== MEDIA_SELECTION_REQUEST_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  identifier(value.mediaSelectionRequestId, 'mediaSelectionRequestId', 160);
  identifier(value.scriptId, 'scriptId', 200);
  hash(value.scriptContentHash, 'scriptContentHash');
  if (
    !Number.isSafeInteger(value.visualDirectionPosition) ||
    value.visualDirectionPosition < 1
  )
    fail('INVALID_VISUAL_DIRECTION_POSITION', 'visualDirectionPosition');
  if (!['STATIC_IMAGE_V1', 'MIXED_MEDIA_V2'].includes(value.productionProfile))
    fail('INVALID_PRODUCTION_PROFILE', 'productionProfile');
  if (
    typeof value.requestedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.requestedAt))
  )
    fail('INVALID_TIMESTAMP', 'requestedAt');
  hash(value.contentHash, 'contentHash');
  if (mediaSelectionRequestHash(value) !== value.contentHash)
    fail('CONTENT_HASH_MISMATCH', 'contentHash');
  return freeze(structuredClone(value));
}
export function mediaSelectionRequestHash(value: any): any {
  const { contentHash: _, ...content } = value;
  return createHash('sha256').update(stableJson(content)).digest('hex');
}
function identifier(value: any, path: any, max: any): any {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    fail('INVALID_IDENTIFIER', path);
}
function hash(value: any, path: any): any {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail('INVALID_HASH', path);
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
function freeze(value: any): any {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
function fail(code: any, path: any): never {
  throw new ContractValidationError(code, path, 'valor inválido');
}
