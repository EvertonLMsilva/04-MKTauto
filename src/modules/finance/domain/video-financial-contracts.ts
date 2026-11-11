import { createHash } from 'node:crypto';
import {
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
import {
  ECONOMIC_VIDEO_PROFILE,
  ECONOMIC_VIDEO_ENDPOINT,
  economicVideoConfiguration,
} from './economic-video-profile.js';

export class VideoGenerationError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(code: any, field: any) {
    super(`${code}: ${field}`);
    this.name = 'VideoGenerationError';
    this.code = code;
    this.field = field;
  }
}
export function fail(code: any, field: any): never {
  throw new VideoGenerationError(code, field);
}
export const AURA_ONE_VIDEO_BUDGET = Object.freeze({
  totalUsd: '1',
  perGenerationUsd: '0.33',
  maxPaidSubmissions: 3,
  plannedOriginals: 3,
});
const SCALE = 10n ** 18n;
export function usdUnits(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,40}(?:\.\d{1,18})?$/.test(value))
    fail('VIDEO_GENERATION_INVALID_AMOUNT', 'amount');
  const [integer, fraction = ''] = value.split('.');
  return BigInt(integer) * SCALE + BigInt(fraction.padEnd(18, '0'));
}
export function usdAmount(units: bigint): string {
  const integer = units / SCALE;
  const fraction = (units % SCALE)
    .toString()
    .padStart(18, '0')
    .replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : String(integer);
}
function exact(value: any, keys: any): any {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key: any) => !keys.includes(key)) ||
    keys.some((key: any) => !(key in value))
  )
    fail('VIDEO_GENERATION_INVALID_CONTRACT', 'fields');
}
export function validateVideoGenerationRequest(value: any): any {
  const legacy = value?.schemaVersion === 'video-generation-request/1.0.0';
  const economic = value?.schemaVersion === 'video-generation-request/3.0.0';
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
    const config = value.configuration;
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
        .map((key: any) => [key, canonical(value[key])]),
    );
  fail('VIDEO_GENERATION_INVALID_CONTRACT', 'parameters');
}
export function videoRequestHash(value: any): any {
  const request = validateVideoGenerationRequest(value);
  const normalized =
    request.schemaVersion === 'video-generation-request/1.0.0'
      ? Object.fromEntries(
          Object.entries(request).sort(([a]: any, [b]: any): any =>
            a.localeCompare(b),
          ),
        )
      : canonical(request);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
export function validateVideoBudget(value: any): any {
  exact(value, [
    'totalUsd',
    'perGenerationUsd',
    'maxPaidSubmissions',
    'plannedOriginals',
  ]);
  if (usdUnits(value.totalUsd) <= 0n || usdUnits(value.perGenerationUsd) <= 0n)
    fail('VIDEO_GENERATION_INVALID_AMOUNT', 'budget');
  for (const key of ['maxPaidSubmissions', 'plannedOriginals'])
    if (
      !Number.isSafeInteger(value[key]) ||
      value[key] < 1 ||
      value[key] > 1000
    )
      fail('VIDEO_GENERATION_INVALID_CONTRACT', key);
  return immutable({
    totalUsd: usdAmount(usdUnits(value.totalUsd)),
    perGenerationUsd: usdAmount(usdUnits(value.perGenerationUsd)),
    maxPaidSubmissions: value.maxPaidSubmissions,
    plannedOriginals: value.plannedOriginals,
  });
}
// The configured port is the trust boundary. Requests cannot supply prices or attestations.
export function validateVideoCostCeiling(
  value: any,
  request: any,
  now: any,
): any {
  if (
    !value ||
    value.kind !== 'ENFORCED_MAXIMUM' ||
    value.includesAllCharges !== true ||
    value.currency !== 'USD' ||
    value.provider !== request.provider ||
    value.requestHash !== videoRequestHash(request) ||
    typeof value.evidenceReference !== 'string' ||
    !/^[a-zA-Z0-9_.:/-]{3,120}$/.test(value.evidenceReference) ||
    typeof value.expiresAt !== 'string' ||
    typeof now !== 'string' ||
    !Number.isFinite(Date.parse(now)) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) <= Date.parse(now)
  )
    fail('VIDEO_GENERATION_PRICE_UNPROVEN', 'costCeiling');
  let units;
  try {
    units = usdUnits(value.maximumAmount);
  } catch {
    fail('VIDEO_GENERATION_PRICE_UNPROVEN', 'maximumAmount');
  }
  if (units <= 0n) fail('VIDEO_GENERATION_PRICE_UNPROVEN', 'maximumAmount');
  return immutable({
    kind: value.kind,
    includesAllCharges: true,
    currency: 'USD',
    provider: value.provider,
    requestHash: value.requestHash,
    maximumAmount: usdAmount(units),
    evidenceReference: value.evidenceReference,
    expiresAt: value.expiresAt,
  });
}
// Estimates remain estimates. Only BudgetGate's persisted human approval authorizes them.
export function validateVideoCostAuthorization(
  value: any,
  request: any,
  now: any,
): any {
  if (value?.kind !== 'OFFICIAL_ESTIMATE')
    return validateVideoCostCeiling(value, request, now);
  exact(value, [
    'kind',
    'currency',
    'provider',
    'requestHash',
    'estimatedAmount',
    'reservationAmount',
    'evidenceReference',
    'expiresAt',
  ]);
  if (
    value.currency !== 'USD' ||
    value.provider !== request.provider ||
    value.requestHash !== videoRequestHash(request) ||
    typeof value.evidenceReference !== 'string' ||
    !/^https:\/\/fal\.ai\/models\/[a-zA-Z0-9_./-]+$/.test(
      value.evidenceReference,
    ) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !Number.isFinite(Date.parse(now)) ||
    Date.parse(value.expiresAt) <= Date.parse(now) ||
    usdUnits(value.estimatedAmount) <= 0n ||
    usdUnits(value.reservationAmount) < usdUnits(value.estimatedAmount)
  )
    fail('VIDEO_GENERATION_PRICE_UNPROVEN', 'estimate');
  return immutable(value);
}
export function videoReservationAmount(value: any): any {
  return value.kind === 'OFFICIAL_ESTIMATE'
    ? value.reservationAmount
    : value.maximumAmount;
}
export function videoQuoteHash(value: any): any {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function validateVideoProviderResult(value: any, operation: any): any {
  exact(value, [
    'generationRequestId',
    'requestHash',
    'provider',
    'state',
    'providerRequestId',
    'videoReference',
    'actualCostUsd',
  ]);
  if (
    value.generationRequestId !== operation.request.generationRequestId ||
    value.requestHash !== operation.requestHash ||
    value.provider !== operation.request.provider
  )
    fail('VIDEO_GENERATION_RESULT_CONFLICT', 'identity');
  if (!['SUBMITTED', 'UNKNOWN', 'COMPLETED', 'FAILED'].includes(value.state))
    fail('VIDEO_GENERATION_INVALID_CONTRACT', 'state');
  for (const key of ['providerRequestId', 'videoReference'])
    if (
      value[key] !== null &&
      (typeof value[key] !== 'string' ||
        !/^[a-zA-Z0-9_.:/-]{3,200}$/.test(value[key]))
    )
      fail('VIDEO_GENERATION_INVALID_CONTRACT', key);
  if (value.state !== 'UNKNOWN' && value.providerRequestId === null)
    fail('VIDEO_GENERATION_INVALID_CONTRACT', 'providerRequestId');
  if (value.state === 'COMPLETED' && value.videoReference === null)
    fail('VIDEO_GENERATION_INVALID_CONTRACT', 'videoReference');
  if (value.actualCostUsd !== null) usdUnits(value.actualCostUsd);
  return immutable({
    ...value,
    actualCostUsd:
      value.actualCostUsd === null
        ? null
        : usdAmount(usdUnits(value.actualCostUsd)),
  });
}
