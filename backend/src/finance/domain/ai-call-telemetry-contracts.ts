import { ContractValidationError } from '../../project/domain/project.errors.js';
export const AI_CALL_TELEMETRY_CONTRACT_VERSION = 'ai-call-telemetry/1.0.0';
const OBSERVATION_FIELDS = Object.freeze([
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
]);
const TELEMETRY_FIELDS = Object.freeze([
  'schemaVersion',
  'aiCallId',
  'logicalCallId',
  'requestHash',
  'pipelineRunId',
  'projectId',
  'projectVersion',
  'artifactId',
  'costEventId',
  ...OBSERVATION_FIELDS,
  'outcome',
  'failureCode',
  'recordedAt',
]);
const SENSITIVE_VALUE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i;
export function validateAiCallObservation(value: any) {
  record(value, 'observation');
  exact(value, OBSERVATION_FIELDS, 'observation');
  const tokens = {
    inputTokens: optionalCount(value.inputTokens, 'inputTokens'),
    outputTokens: optionalCount(value.outputTokens, 'outputTokens'),
    cachedInputTokens: optionalCount(
      value.cachedInputTokens,
      'cachedInputTokens',
    ),
  };
  const hasUsage = Object.values(tokens).some((item: any) => item !== null);
  const usageOrigin = optionalToken(value.usageOrigin, 'usageOrigin');
  if (hasUsage !== (usageOrigin !== null))
    fail('INVALID_USAGE_ORIGIN', 'usageOrigin');
  if (
    tokens.inputTokens !== null &&
    tokens.cachedInputTokens !== null &&
    tokens.cachedInputTokens > tokens.inputTokens
  )
    fail('INVALID_USAGE_VALUE', 'cachedInputTokens');
  const costAmount = optionalPositiveDecimal(value.costAmount, 'costAmount');
  const currency =
    value.currency === null ? null : currencyCode(value.currency);
  const costOrigin = optionalToken(value.costOrigin, 'costOrigin');
  if (
    [costAmount, currency, costOrigin].some((item: any) => item !== null) &&
    [costAmount, currency, costOrigin].some((item: any) => item === null)
  ) {
    fail('INCOMPLETE_COST', 'costAmount');
  }
  return deepFreeze({
    provider: token(value.provider, 'provider'),
    model: token(value.model, 'model'),
    taskType: token(value.taskType, 'taskType'),
    promptVersion: versionedToken(value.promptVersion, 'promptVersion'),
    ...tokens,
    usageOrigin,
    costAmount,
    currency,
    costOrigin,
    latencyMs: optionalCount(value.latencyMs, 'latencyMs'),
    occurredAt: timestamp(value.occurredAt, 'occurredAt'),
    fallback: optionalBoolean(value.fallback, 'fallback'),
    inputHash: optionalHash(value.inputHash, 'inputHash'),
    outputHash: optionalHash(value.outputHash, 'outputHash'),
  });
}
export function validateAiCallTelemetry(value: any) {
  record(value, 'telemetry');
  exact(value, TELEMETRY_FIELDS, 'telemetry');
  if (value.schemaVersion !== AI_CALL_TELEMETRY_CONTRACT_VERSION) {
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  }
  const observation = validateAiCallObservation(
    Object.fromEntries(
      OBSERVATION_FIELDS.map((field: any) => [field, value[field]]),
    ),
  );
  const outcome = value.outcome;
  if (!['SUCCESS', 'FAILURE'].includes(outcome))
    fail('INVALID_AI_CALL_OUTCOME', 'outcome');
  const artifactId = optionalIdentifier(value.artifactId, 'artifactId', 200);
  const failureCode = optionalErrorCode(value.failureCode);
  if (outcome === 'SUCCESS' && (artifactId === null || failureCode !== null)) {
    fail(
      'INVALID_AI_CALL_OUTCOME',
      artifactId === null ? 'artifactId' : 'failureCode',
    );
  }
  if (outcome === 'FAILURE' && (artifactId !== null || failureCode === null)) {
    fail(
      'INVALID_AI_CALL_OUTCOME',
      artifactId !== null ? 'artifactId' : 'failureCode',
    );
  }
  const costEventId = optionalIdentifier(value.costEventId, 'costEventId', 200);
  if ((observation.costAmount === null) !== (costEventId === null)) {
    fail('INVALID_COST_EVENT_LINK', 'costEventId');
  }
  rejectSensitive(value);
  return deepFreeze({
    schemaVersion: AI_CALL_TELEMETRY_CONTRACT_VERSION,
    aiCallId: identifier(value.aiCallId, 'aiCallId', 200),
    logicalCallId: identifier(value.logicalCallId, 'logicalCallId', 200),
    requestHash: hash(value.requestHash, 'requestHash'),
    pipelineRunId: identifier(value.pipelineRunId, 'pipelineRunId'),
    projectId: identifier(value.projectId, 'projectId'),
    projectVersion: positiveInteger(value.projectVersion, 'projectVersion'),
    artifactId,
    costEventId,
    ...observation,
    outcome,
    failureCode,
    recordedAt: timestamp(value.recordedAt, 'recordedAt'),
  });
}
function optionalCount(value: any, path: any) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0)
    fail('INVALID_USAGE_VALUE', path);
  return value;
}
function optionalBoolean(value: any, path: any) {
  if (value === null || typeof value === 'boolean') return value;
  fail('INVALID_TYPE', path);
}
function optionalHash(value: any, path: any) {
  return value === null ? null : hash(value, path);
}
function optionalIdentifier(value: any, path: any, max: any) {
  return value === null ? null : identifier(value, path, max);
}
function optionalToken(value: any, path: any) {
  return value === null ? null : token(value, path);
}
function optionalErrorCode(value: any) {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length > 120 ||
    !/^[A-Z][A-Z0-9_]*$/.test(value)
  )
    fail('INVALID_FAILURE_CODE', 'failureCode');
  return value;
}
function optionalPositiveDecimal(value: any, path: any) {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^\d+(?:\.\d+)?$/.test(value) ||
    value.length > 80
  )
    fail('INVALID_COST_AMOUNT', path);
  const [rawInteger, rawFraction = ''] = value.split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.replace(/0+$/, '');
  const normalized = fraction ? `${integer}.${fraction}` : integer;
  if (integer.length > 40 || fraction.length > 18 || normalized === '0')
    fail('INVALID_COST_AMOUNT', path);
  return normalized;
}
function currencyCode(value: any) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))
    fail('INVALID_CURRENCY', 'currency');
  return value;
}
function versionedToken(value: any, path: any) {
  if (
    typeof value !== 'string' ||
    value.length > 120 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*\/\d+\.\d+\.\d+$/.test(value)
  )
    fail('INVALID_VERSION', path);
  return value;
}
function token(value: any, path: any) {
  if (
    typeof value !== 'string' ||
    value.length > 120 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(value)
  )
    fail('INVALID_TOKEN', path);
  return value;
}
function identifier(value: any, path: any, max: any = 80) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)
  )
    fail('INVALID_IDENTIFIER', path);
  return value;
}
function positiveInteger(value: any, path: any) {
  if (!Number.isSafeInteger(value) || value < 1)
    fail('INVALID_PROJECT_VERSION', path);
  return value;
}
function hash(value: any, path: any) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail('INVALID_HASH', path);
  return value;
}
function timestamp(value: any, path: any) {
  const pattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail('INVALID_TIMESTAMP', path);
  return new Date(value).toISOString();
}
function rejectSensitive(value: any) {
  const forbidden =
    /^(?:prompt|instruction|message|token|apiKey|secret|password|payload|rawResponse|response|content)$/i;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.test(key)) fail('FORBIDDEN_FIELD', key);
    if (typeof child === 'string' && SENSITIVE_VALUE.test(child))
      fail('SENSITIVE_CONTENT', key);
  }
}
function record(value: any, path: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_TYPE', path);
}
function exact(value: any, allowed: any, path: any) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of allowed)
    if (!(key in value)) fail('REQUIRED_FIELD', `${path}.${key}`);
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
