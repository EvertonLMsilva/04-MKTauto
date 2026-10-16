import { createHash } from 'node:crypto';
import { record, exact, fail, immutable } from './operations-contracts.js';
export const STAGE_RECOVERY_CONTRACT_VERSION = 'stage-recovery/1.0.0';
export const PIPELINE_STAGE_STATES = Object.freeze([
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
]);
export const STAGE_ATTEMPT_TRIGGERS = Object.freeze([
  'INITIAL',
  'AUTOMATIC',
  'MANUAL',
]);
export const PIPELINE_STAGES = Object.freeze([
  'RESEARCH',
  'TREND_FORMAT_ANALYSIS',
  'IDEA_GENERATION',
  'IDEA_SELECTION',
  'SCRIPT',
  'VOICE',
  'MEDIA',
  'VISUAL_MOTION_PLAN',
  'BACKGROUND_MUSIC',
  'COMPOSITION',
  'SUBTITLES',
  'PREVIEW',
  'QC',
]);
export const STAGE_DEPENDENCIES: Readonly<Record<string, readonly string[]>> =
  immutable({
    RESEARCH: [],
    TREND_FORMAT_ANALYSIS: ['RESEARCH'],
    IDEA_GENERATION: ['RESEARCH', 'TREND_FORMAT_ANALYSIS'],
    IDEA_SELECTION: ['IDEA_GENERATION'],
    SCRIPT: ['IDEA_SELECTION'],
    VOICE: ['SCRIPT'],
    MEDIA: ['SCRIPT'],
    VISUAL_MOTION_PLAN: ['SCRIPT', 'MEDIA'],
    BACKGROUND_MUSIC: ['SCRIPT'],
    COMPOSITION: ['VOICE', 'MEDIA', 'VISUAL_MOTION_PLAN', 'BACKGROUND_MUSIC'],
    SUBTITLES: ['SCRIPT', 'VOICE'],
    PREVIEW: ['COMPOSITION', 'SUBTITLES'],
    QC: ['PREVIEW'],
  });
export interface StageInput {
  stage: string;
  artifactId: string;
  contentHash: string;
}
export interface StageRequest {
  schemaVersion: string;
  pipelineRunId: string;
  stage: string;
  requestHash: string;
  inputs: StageInput[];
  policyVersions: Record<string, string>;
  providerConfigHash: string | null;
}
export interface StageFailure {
  code: string;
  field: string;
  retryAllowed: boolean;
}
export interface Produced {
  artifactId: string;
  contentHash: string;
  value: unknown;
}
export interface StageAttempt {
  id: number;
  pipelineRunId: string;
  stage: string;
  attempt: number;
  trigger: string;
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  identityHash: string;
  requestHash: string;
  inputs: StageInput[];
  policyVersions: Record<string, string>;
  providerConfigHash: string | null;
  startedAt: string;
  completedAt: string | null;
  failure: StageFailure | null;
  artifactId: string | null;
  artifactContentHash: string | null;
  result: Produced | null;
}
export function stageIdentifier(v: unknown, path: string, max: number): string {
  if (
    typeof v !== 'string' ||
    v.length > max ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_:./-]{1,}$/.test(v)
  )
    fail('INVALID_IDENTIFIER', path);
  return v;
}
export function contentHash(v: unknown, path: string): string {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
    fail('INVALID_CONTENT_HASH', path);
  return v;
}
export function stageEnum(
  v: unknown,
  allowed: readonly string[],
  path: string,
): string {
  if (!allowed.includes(v as string)) fail('INVALID_ENUM', path);
  return v as string;
}
export function validateStageExecutionRequest(value: unknown): StageRequest {
  record(value, 'stageRequest');
  exact(
    value,
    [
      'schemaVersion',
      'pipelineRunId',
      'stage',
      'requestHash',
      'inputs',
      'policyVersions',
      'providerConfigHash',
    ],
    'stageRequest',
  );
  if (value.schemaVersion !== STAGE_RECOVERY_CONTRACT_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  const pipelineRunId = stageIdentifier(
    value.pipelineRunId,
    'pipelineRunId',
    80,
  );
  const stage = stageEnum(value.stage, PIPELINE_STAGES, 'stage');
  const requestHash = contentHash(value.requestHash, 'requestHash');
  if (!Array.isArray(value.inputs)) fail('INVALID_TYPE', 'inputs');
  const positions = new Set<string>();
  const inputs = value.inputs
    .map((input: unknown, index: number) => {
      const p = `inputs.${index}`;
      record(input, p);
      exact(input, ['stage', 'artifactId', 'contentHash'], p);
      const dependency = stageEnum(input.stage, PIPELINE_STAGES, `${p}.stage`);
      if (!STAGE_DEPENDENCIES[stage].includes(dependency))
        fail('INVALID_STAGE_DEPENDENCY', `${p}.stage`);
    const key = `${dependency}:${String(input.artifactId)}`;
      if (positions.has(key)) fail('DUPLICATE_STAGE_INPUT', p);
      positions.add(key);
      return immutable({
        stage: dependency,
        artifactId: stageIdentifier(input.artifactId, `${p}.artifactId`, 200),
        contentHash: contentHash(input.contentHash, `${p}.contentHash`),
      });
    })
    .sort(
      (a, b) =>
        a.stage.localeCompare(b.stage) ||
        a.artifactId.localeCompare(b.artifactId),
    );
  record(value.policyVersions, 'policyVersions');
  const policyVersions: Record<string, string> = {};
  for (const key of Object.keys(value.policyVersions).sort()) {
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(key))
      fail('INVALID_POLICY_NAME', `policyVersions.${key}`);
    policyVersions[key] = stageIdentifier(
      value.policyVersions[key],
      `policyVersions.${key}`,
      120,
    );
  }
  const providerConfigHash =
    value.providerConfigHash === null
      ? null
      : contentHash(value.providerConfigHash, 'providerConfigHash');
  return immutable({
    schemaVersion: STAGE_RECOVERY_CONTRACT_VERSION,
    pipelineRunId,
    stage,
    requestHash,
    inputs,
    policyVersions,
    providerConfigHash,
  });
}
export function stageExecutionIdentityHash(v: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(validateStageExecutionRequest(v)))
    .digest('hex');
}
export function isTransientStageFailure(value: unknown) {
  let current = value;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current !== 'object') break;
    const e = current as Record<string, unknown>;
    if (
      e.transient === true ||
      [429, 500, 502, 503, 504].includes((e.status ?? e.statusCode) as number)
    )
      return true;
    const code = typeof e.code === 'string' ? e.code : '';
    if (
      /(?:TIMEOUT|RATE_LIMIT|TOO_MANY_REQUESTS|NETWORK|CONNECTION|TEMPORAR|_5\d\d$)/.test(
        code,
      ) &&
      !/(?:INVALID|REJECTED|POLICY|CONTRACT|AUTH|PERMISSION)/.test(code)
    )
      return true;
    current = e.cause;
  }
  return false;
}
export function sanitizeStageFailure(value: unknown): StageFailure {
  const e =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return immutable({
    code:
      typeof e.code === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(e.code)
        ? e.code
        : 'STAGE_FAILED',
    field:
      typeof e.field === 'string' &&
      /^[A-Za-z][A-Za-z0-9_.[\]]{0,119}$/.test(e.field)
        ? e.field
        : 'stage',
    retryAllowed: isTransientStageFailure(value),
  });
}
export function descendantsOf(stage: string) {
  stageEnum(stage, PIPELINE_STAGES, 'stage');
  const result = new Set<string>();
  const pending = [stage];
  while (pending.length) {
    const parent = pending.shift()!;
    for (const [candidate, deps] of Object.entries(STAGE_DEPENDENCIES))
      if (deps.includes(parent) && !result.has(candidate)) {
        result.add(candidate);
        pending.push(candidate);
      }
  }
  return Object.freeze([...result]);
}
