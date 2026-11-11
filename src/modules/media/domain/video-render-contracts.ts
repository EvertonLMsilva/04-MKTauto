import { createHash } from 'node:crypto';
import { ContractValidationError } from '../../project/domain/project.errors.js';
import { validateP4Render } from './p4-render-contracts.js';
export const VIDEO_RENDER_CONTRACT_VERSION: any = 'video-render/1.0.0';
const FIELDS: any = Object.freeze([
  'schemaVersion',
  'videoRenderId',
  'pipelineRunId',
  'projectId',
  'projectVersion',
  'compositionPlanId',
  'compositionPlanContentHash',
  'outputAspectRatio',
  'durationMilliseconds',
  'containerFormat',
  'widthPixels',
  'heightPixels',
  'contentHash',
  'logicalReference',
  'createdAt',
  'revision',
  'supersedesVideoRenderId',
]);
const ASPECT_RATIOS: any = Object.freeze({
  '9:16': [9n, 16n],
  '1:1': [1n, 1n],
  '16:9': [16n, 9n],
});
const CONTAINER_FORMATS: any = Object.freeze(['mp4', 'webm', 'mov']);
const FORBIDDEN_REFERENCE_SCHEME: any =
  /^(?:https?|file|data|s3|gs|az|blob|bucket|object|storage|path):/i;
const SENSITIVE_REFERENCE: any =
  /(?:^|[:._-])(?:token|secret|credential|password|signature|api.?key)(?:[:._-]|$)/i;
export function validateVideoRender(value: any): any {
  if (value?.schemaVersion === 'video-render/2.0.0')
    return validateP4Render(value);
  record(value, 'videoRender');
  exact(value, FIELDS, 'videoRender');
  if (value.schemaVersion !== VIDEO_RENDER_CONTRACT_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  identifier(value.videoRenderId, 'videoRenderId', 200);
  identifier(value.pipelineRunId, 'pipelineRunId');
  identifier(value.projectId, 'projectId');
  positiveInteger(
    value.projectVersion,
    'projectVersion',
    'INVALID_PROJECT_VERSION',
  );
  identifier(value.compositionPlanId, 'compositionPlanId', 200);
  hash(value.compositionPlanContentHash, 'compositionPlanContentHash');
  if (!(value.outputAspectRatio in ASPECT_RATIOS))
    fail('INVALID_OUTPUT_ASPECT_RATIO', 'outputAspectRatio');
  boundedPositiveInteger(
    value.durationMilliseconds,
    'durationMilliseconds',
    'INVALID_DURATION',
    86400000,
  );
  if (!CONTAINER_FORMATS.includes(value.containerFormat))
    fail('INVALID_CONTAINER_FORMAT', 'containerFormat');
  boundedPositiveInteger(
    value.widthPixels,
    'widthPixels',
    'INVALID_VIDEO_DIMENSION',
    100000,
  );
  boundedPositiveInteger(
    value.heightPixels,
    'heightPixels',
    'INVALID_VIDEO_DIMENSION',
    100000,
  );
  if (
    !dimensionsMatchAspectRatio(
      value.widthPixels,
      value.heightPixels,
      value.outputAspectRatio,
    )
  ) {
    fail('VIDEO_DIMENSIONS_ASPECT_RATIO_MISMATCH', 'widthPixels');
  }
  hash(value.contentHash, 'contentHash');
  logicalReference(value.logicalReference);
  timestamp(value.createdAt, 'createdAt');
  positiveInteger(value.revision, 'revision', 'INVALID_REVISION');
  if (value.supersedesVideoRenderId !== null)
    identifier(value.supersedesVideoRenderId, 'supersedesVideoRenderId', 200);
  if (value.revision === 1 && value.supersedesVideoRenderId !== null)
    fail('INVALID_SUPERSESSION', 'supersedesVideoRenderId');
  if (value.revision > 1 && value.supersedesVideoRenderId === null)
    fail('SUPERSEDED_VIDEO_RENDER_REQUIRED', 'supersedesVideoRenderId');
  return deepFreeze(structuredClone(value));
}
export function videoRenderIdentityHash(value: any): any {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
export function dimensionsMatchAspectRatio(
  widthPixels: any,
  heightPixels: any,
  aspectRatio: any,
): any {
  if (!Number.isSafeInteger(widthPixels) || !Number.isSafeInteger(heightPixels))
    return false;
  const ratio: any = ASPECT_RATIOS[aspectRatio];
  return (
    Boolean(ratio) &&
    BigInt(widthPixels) * ratio[1] === BigInt(heightPixels) * ratio[0]
  );
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
      .sort()
      .map(
        (key: any): any => `${JSON.stringify(key)}:${stableJson(value[key])}`,
      )
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
