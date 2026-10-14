import { createHash } from 'node:crypto';
import {
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  ECONOMIC_VIDEO_PROFILE,
  ECONOMIC_VIDEO_ENDPOINT,
  economicVideoConfiguration,
} from '../../finance/domain/economic-video-profile.js';
export class VideoGenerationError extends Error {
  [key: string]: any;
  constructor(code: any, field: any) {
    super(`${code}: ${field}`);
    this.name = 'VideoGenerationError';
    this.code = code;
    this.field = field;
  }
}
export function fail(code: any, field: any): any {
  throw new VideoGenerationError(code, field);
}
function exact(value: any, keys: any): any {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key: any): any => !keys.includes(key)) ||
    keys.some((key: any): any => !(key in value))
  )
    fail('VIDEO_GENERATION_INVALID_CONTRACT', 'fields');
}
export function validateVideoGenerationRequest(value: any): any {
  const legacy: any = value?.schemaVersion === 'video-generation-request/1.0.0';
  const economic: any =
    value?.schemaVersion === 'video-generation-request/3.0.0';
  exact(value, [
    'schemaVersion',
    'generationRequestId',
    'pipelineRunId',
    'campaignId',
    'originalSlot',
    'provider',
    'purpose',
    'outputAspectRatio',
    'prompt',
    ...(legacy ? [] : ['image', 'endpoint', 'configuration']),
    ...(economic ? ['profileVersion'] : []),
  ]);
  if (
    !legacy &&
    !economic &&
    value.schemaVersion !== 'video-generation-request/2.0.0'
  )
    fail('VIDEO_GENERATION_INVALID_CONTRACT', 'schemaVersion');
  for (const field of [
    'generationRequestId',
    'pipelineRunId',
    'campaignId',
    'provider',
  ])
    affiliateIdentifier(value[field], field);
  if (value.purpose !== 'ORIGINAL' || value.outputAspectRatio !== '9:16')
    fail('VIDEO_GENERATION_ORIGINAL_ONLY', 'purpose');
  if (!Number.isSafeInteger(value.originalSlot) || value.originalSlot < 1)
    fail('VIDEO_GENERATION_INVALID_CONTRACT', 'originalSlot');
  if (
    typeof value.prompt !== 'string' ||
    !value.prompt.trim() ||
    value.prompt.length > 12000
  )
    fail('VIDEO_GENERATION_INVALID_CONTRACT', 'prompt');
  if (!legacy) {
    exact(value.image, ['mediaRef', 'contentHash']);
    if (
      typeof value.image.mediaRef !== 'string' ||
      !/^[a-zA-Z0-9_.:/-]{3,200}$/.test(value.image.mediaRef) ||
      !/^[a-f0-9]{64}$/.test(value.image.contentHash)
    )
      fail('VIDEO_GENERATION_INVALID_CONTRACT', 'image');
    if (
      typeof value.endpoint !== 'string' ||
      !/^[a-zA-Z0-9_./-]{3,200}$/.test(value.endpoint)
    )
      fail('VIDEO_GENERATION_INVALID_CONTRACT', 'endpoint');
    const config: any = value.configuration;
    exact(config, [
      'resolution',
      'frames',
      'fps',
      'audio',
      'multiscale',
      'parameters',
    ]);
    exact(config.resolution, ['width', 'height']);
    for (const amount of [
      config.resolution.width,
      config.resolution.height,
      config.frames,
      config.fps,
    ]) {
      if (!Number.isSafeInteger(amount) || amount <= 0)
        fail('VIDEO_GENERATION_INVALID_CONTRACT', 'configuration');
    }
    if (
      config.resolution.width * 16 !== config.resolution.height * 9 ||
      typeof config.audio !== 'boolean' ||
      typeof config.multiscale !== 'boolean' ||
      !config.parameters ||
      Object.getPrototypeOf(config.parameters) !== Object.prototype
    )
      fail('VIDEO_GENERATION_INVALID_CONTRACT', 'configuration');
    canonical(config.parameters);
    if (
      economic &&
      (value.profileVersion !== ECONOMIC_VIDEO_PROFILE ||
        value.endpoint !== ECONOMIC_VIDEO_ENDPOINT ||
        value.provider !== 'fal_ai' ||
        JSON.stringify(canonical(config)) !==
          JSON.stringify(
            canonical(economicVideoConfiguration(value.originalSlot)),
          ))
    )
      fail('VIDEO_GENERATION_ECONOMIC_PROFILE_INVALID', 'configuration');
  }
  return immutable(value);
}
// All provider parameters, including nested options, participate in identity.
function canonical(value: any): any {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key: any): any => [key, canonical(value[key])]),
    );
  fail('VIDEO_GENERATION_INVALID_CONTRACT', 'parameters');
}
export function videoRequestHash(value: any): any {
  const request: any = validateVideoGenerationRequest(value);
  const normalized: any =
    request.schemaVersion === 'video-generation-request/1.0.0'
      ? Object.fromEntries(
          Object.entries(request).sort(([a]: any, [b]: any): any =>
            a.localeCompare(b),
          ),
        )
      : canonical(request);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
