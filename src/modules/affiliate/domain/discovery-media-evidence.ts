import { ContractValidationError } from './affiliate.errors.js';
import { immutable } from './affiliate-contracts.js';

// Validation of the embedded discovery evidence only; no acquisition or media effects.
export interface DiscoveryMedia {
  assetType: 'IMAGE' | 'VIDEO';
  technicalProperties: {
    format: string;
    widthPixels: number;
    heightPixels: number;
    durationMilliseconds: number | null;
    mimeType?: string;
    hasAudio?: boolean | null;
  };
  contentHash: string;
  mediaReference: string;
  origin: string;
  provider: string | null;
  rights: { usageBasis: string; commercialUseAllowed: boolean };
  source?: unknown;
  telemetry?: Record<string, unknown>;
}
function fail(code: string, path: string): never {
  throw new ContractValidationError(code, path, 'valor inválido');
}
function record(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_TYPE', path);
}
function fields(
  value: unknown,
  allowed: string[],
  required: string[],
  path: string,
) {
  record(value, path);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of required)
    if (!(key in value)) fail('REQUIRED_FIELD', `${path}.${key}`);
}
const hash = (v: unknown, path: string) => {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
    fail('INVALID_HASH', path);
  return v;
};
const count = (v: unknown, path: string, code: string, max: number) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > max)
    fail(code, path);
};
export function validateDiscoveryMedia(raw: unknown): DiscoveryMedia {
  const required = [
    'assetType',
    'technicalProperties',
    'contentHash',
    'mediaReference',
    'origin',
    'provider',
    'rights',
  ];
  fields(raw, [...required, 'source', 'telemetry'], required, 'output');
  const v = raw as DiscoveryMedia;
  if (!['IMAGE', 'VIDEO'].includes(v.assetType))
    fail('INVALID_ASSET_TYPE', 'assetType');
  const technical = [
    'format',
    'widthPixels',
    'heightPixels',
    'durationMilliseconds',
    ...(v.source !== undefined ? ['mimeType', 'hasAudio'] : []),
  ];
  fields(v.technicalProperties, technical, technical, 'technicalProperties');
  const t = v.technicalProperties;
  if (
    !(
      v.assetType === 'IMAGE' ? ['jpeg', 'png', 'webp'] : ['mp4', 'webm', 'mov']
    ).includes(t.format)
  )
    fail('INVALID_MEDIA_FORMAT', 'technicalProperties.format');
  count(
    t.widthPixels,
    'technicalProperties.widthPixels',
    'INVALID_MEDIA_DIMENSION',
    100000,
  );
  count(
    t.heightPixels,
    'technicalProperties.heightPixels',
    'INVALID_MEDIA_DIMENSION',
    100000,
  );
  if (v.assetType === 'IMAGE' && t.durationMilliseconds !== null)
    fail('DURATION_NOT_APPLICABLE', 'technicalProperties.durationMilliseconds');
  if (v.assetType === 'VIDEO')
    count(
      t.durationMilliseconds,
      'technicalProperties.durationMilliseconds',
      'INVALID_DURATION',
      86400000,
    );
  if (v.source !== undefined) {
    const mime =
      t.format === 'mp4'
        ? 'video/mp4'
        : t.format === 'mov'
          ? 'video/quicktime'
          : t.format === 'webm'
            ? 'video/webm'
            : `image/${t.format}`;
    if (t.mimeType !== mime)
      fail('INVALID_MEDIA_MIME_TYPE', 'technicalProperties.mimeType');
    if (v.assetType === 'VIDEO' && typeof t.hasAudio !== 'boolean')
      fail('INVALID_AUDIO_FLAG', 'technicalProperties.hasAudio');
    if (v.assetType === 'IMAGE' && t.hasAudio !== null)
      fail('AUDIO_NOT_APPLICABLE', 'technicalProperties.hasAudio');
  }
  hash(v.contentHash, 'contentHash');
  if (
    typeof v.mediaReference !== 'string' ||
    v.mediaReference.length < 7 ||
    v.mediaReference.length > 250 ||
    !/^[a-z][a-z0-9_-]{2,40}:[a-z0-9][a-z0-9._-]{2,200}$/.test(
      v.mediaReference,
    ) ||
    /^(?:https?|file|data|s3|gs|az|blob|bucket|object|storage|path):/i.test(
      v.mediaReference,
    ) ||
    /(?:^|[:._-])(?:token|secret|credential|password|signature|api.?key)(?:[:._-]|$)/i.test(
      v.mediaReference,
    )
  )
    fail('INVALID_MEDIA_REFERENCE', 'mediaReference');
  const origins: Record<string, string[]> = {
    OPERATOR_OWNED: ['OWNED'],
    AUTHORIZED_THIRD_PARTY: ['LICENSED', 'EXPLICIT_PERMISSION'],
    PROVIDER_GENERATED: ['PROVIDER_TERMS'],
    PROVIDER_LICENSED: ['LICENSED', 'PROVIDER_TERMS'],
  };
  if (!Object.hasOwn(origins, v.origin)) fail('INVALID_MEDIA_ORIGIN', 'origin');
  if (
    v.provider !== null &&
    (typeof v.provider !== 'string' ||
      v.provider.length > 100 ||
      !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(v.provider))
  )
    fail('INVALID_IDENTIFIER', 'provider');
  const providerOrigin = ['PROVIDER_GENERATED', 'PROVIDER_LICENSED'].includes(
    v.origin,
  );
  if (providerOrigin && v.provider === null)
    fail('PROVIDER_REQUIRED', 'provider');
  if (!providerOrigin && v.provider !== null)
    fail('PROVIDER_NOT_APPLICABLE', 'provider');
  fields(
    v.rights,
    ['usageBasis', 'commercialUseAllowed'],
    ['usageBasis', 'commercialUseAllowed'],
    'rights',
  );
  if (
    !['OWNED', 'LICENSED', 'EXPLICIT_PERMISSION', 'PROVIDER_TERMS'].includes(
      v.rights.usageBasis,
    )
  )
    fail('INVALID_USAGE_BASIS', 'rights.usageBasis');
  if (v.rights.commercialUseAllowed !== true)
    fail('COMMERCIAL_USE_REQUIRED', 'rights.commercialUseAllowed');
  if (!origins[v.origin].includes(v.rights.usageBasis))
    fail('RIGHTS_ORIGIN_MISMATCH', 'rights.usageBasis');
  if (v.origin === 'PROVIDER_LICENSED' && v.source === undefined)
    fail('SOURCE_REQUIRED', 'source');
  return immutable({
    ...v,
    ...(v.telemetry !== undefined
      ? { telemetry: observation(v.telemetry) }
      : {}),
  });
}
function observation(raw: unknown): Record<string, unknown> {
  const keys = [
    'provider',
    'model',
    'taskType',
    'promptVersion',
    'inputTokens',
    'outputTokens',
    'cachedInputTokens',
    'usageOrigin',
    'costAmount',
    'currency',
    'costOrigin',
    'latencyMs',
    'occurredAt',
    'fallback',
    'inputHash',
    'outputHash',
  ];
  fields(raw, keys, keys, 'observation');
  const v = raw as Record<string, unknown>;
  const token = (x: unknown, path: string, version = false): string => {
    if (
      typeof x !== 'string' ||
      x.length > 120 ||
      !(
        version
          ? /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*\/\d+\.\d+\.\d+$/
          : /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/
      ).test(x)
    )
      fail(version ? 'INVALID_VERSION' : 'INVALID_TOKEN', path);
    return x;
  };
  const optionalToken = (x: unknown, path: string) =>
    x === null ? null : token(x, path);
  const optionalCount = (x: unknown, path: string): number | null => {
    if (x === null) return null;
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0)
      fail('INVALID_USAGE_VALUE', path);
    return x;
  };
  const inputTokens = optionalCount(v.inputTokens, 'inputTokens'),
    outputTokens = optionalCount(v.outputTokens, 'outputTokens'),
    cachedInputTokens = optionalCount(v.cachedInputTokens, 'cachedInputTokens');
  const usageOrigin = optionalToken(v.usageOrigin, 'usageOrigin');
  if (
    [inputTokens, outputTokens, cachedInputTokens].some((x) => x !== null) !==
    (usageOrigin !== null)
  )
    fail('INVALID_USAGE_ORIGIN', 'usageOrigin');
  if (
    inputTokens !== null &&
    cachedInputTokens !== null &&
    cachedInputTokens > inputTokens
  )
    fail('INVALID_USAGE_VALUE', 'cachedInputTokens');
  let costAmount: string | null = null;
  if (v.costAmount !== null) {
    if (
      typeof v.costAmount !== 'string' ||
      !/^\d+(?:\.\d+)?$/.test(v.costAmount) ||
      v.costAmount.length > 80
    )
      fail('INVALID_COST_AMOUNT', 'costAmount');
    const [i, f = ''] = v.costAmount.split('.');
    const integer = i.replace(/^0+(?=\d)/, ''),
      fraction = f.replace(/0+$/, '');
    costAmount = fraction ? `${integer}.${fraction}` : integer;
    if (integer.length > 40 || fraction.length > 18 || costAmount === '0')
      fail('INVALID_COST_AMOUNT', 'costAmount');
  }
  if (
    v.currency !== null &&
    (typeof v.currency !== 'string' || !/^[A-Z]{3}$/.test(v.currency))
  )
    fail('INVALID_CURRENCY', 'currency');
  const costOrigin = optionalToken(v.costOrigin, 'costOrigin');
  if (
    [costAmount, v.currency, costOrigin].some((x) => x !== null) &&
    [costAmount, v.currency, costOrigin].some((x) => x === null)
  )
    fail('INCOMPLETE_COST', 'costAmount');
  const provider = token(v.provider, 'provider'),
    model = token(v.model, 'model'),
    taskType = token(v.taskType, 'taskType'),
    promptVersion = token(v.promptVersion, 'promptVersion', true);
  const latencyMs = optionalCount(v.latencyMs, 'latencyMs');
  if (
    typeof v.occurredAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      v.occurredAt,
    ) ||
    !Number.isFinite(Date.parse(v.occurredAt))
  )
    fail('INVALID_TIMESTAMP', 'occurredAt');
  if (v.fallback !== null && typeof v.fallback !== 'boolean')
    fail('INVALID_TYPE', 'fallback');
  return {
    provider,
    model,
    taskType,
    promptVersion,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    usageOrigin,
    costAmount,
    currency: v.currency,
    costOrigin,
    latencyMs,
    occurredAt: new Date(v.occurredAt).toISOString(),
    fallback: v.fallback,
    inputHash: v.inputHash === null ? null : hash(v.inputHash, 'inputHash'),
    outputHash: v.outputHash === null ? null : hash(v.outputHash, 'outputHash'),
  };
}
