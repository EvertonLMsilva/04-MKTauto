// Faithful V1 invariants/hash algorithms from 3d306c4fbae958bebf0319559371df59838ea04a.
export interface SubtitleCue {
  position: number;
  text: string;
  startMilliseconds: number;
  endMilliseconds: number;
}
export interface SubtitleTrack {
  schemaVersion: 'subtitle-track/1.0.0';
  subtitleTrackId: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  scriptId: string;
  scriptContentHash: string;
  voiceTrackId: string;
  voiceTrackContentHash: string;
  language: string;
  timeUnit: 'MILLISECONDS';
  durationMilliseconds: number;
  stylePolicyVersion: 'subtitle-style-policy/1.0.0';
  cues: SubtitleCue[];
  createdAt: string;
  revision: number;
  supersedesSubtitleTrackId: string | null;
  contentHash: string;
}
import { createHash } from 'node:crypto';
import { ContractValidationError } from '../../project/domain/project.errors.js';
export const SUBTITLE_TRACK_CONTRACT_VERSION = 'subtitle-track/1.0.0';
export const SUBTITLE_STYLE_POLICY_VERSION = 'subtitle-style-policy/1.0.0';
const FIELDS = Object.freeze([
  'schemaVersion',
  'subtitleTrackId',
  'pipelineRunId',
  'projectId',
  'projectVersion',
  'scriptId',
  'scriptContentHash',
  'voiceTrackId',
  'voiceTrackContentHash',
  'language',
  'timeUnit',
  'durationMilliseconds',
  'stylePolicyVersion',
  'cues',
  'createdAt',
  'revision',
  'supersedesSubtitleTrackId',
  'contentHash',
]);
const CUE_FIELDS = Object.freeze([
  'position',
  'text',
  'startMilliseconds',
  'endMilliseconds',
]);
const SENSITIVE_VALUE =
  /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,}|[?&](?:token|signature|credential|key)=)/i;
export function validateSubtitleTrack(input: unknown): SubtitleTrack {
  const value = input as SubtitleTrack;
  record(value, 'subtitleTrack');
  exact(value, FIELDS, 'subtitleTrack');
  if (value.schemaVersion !== SUBTITLE_TRACK_CONTRACT_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  identifier(value.subtitleTrackId, 'subtitleTrackId', 200);
  identifier(value.pipelineRunId, 'pipelineRunId');
  identifier(value.projectId, 'projectId');
  positiveInteger(
    value.projectVersion,
    'projectVersion',
    'INVALID_PROJECT_VERSION',
  );
  identifier(value.scriptId, 'scriptId', 200);
  hash(value.scriptContentHash, 'scriptContentHash');
  identifier(value.voiceTrackId, 'voiceTrackId', 200);
  hash(value.voiceTrackContentHash, 'voiceTrackContentHash');
  language(value.language, 'language');
  if (value.timeUnit !== 'MILLISECONDS') fail('INVALID_TIME_UNIT', 'timeUnit');
  positiveInteger(
    value.durationMilliseconds,
    'durationMilliseconds',
    'INVALID_DURATION',
  );
  if (value.stylePolicyVersion !== SUBTITLE_STYLE_POLICY_VERSION)
    fail('UNSUPPORTED_STYLE_POLICY', 'stylePolicyVersion');
  validateCues(value.cues, value.durationMilliseconds);
  timestamp(value.createdAt, 'createdAt');
  positiveInteger(value.revision, 'revision', 'INVALID_REVISION');
  if (value.supersedesSubtitleTrackId !== null)
    identifier(
      value.supersedesSubtitleTrackId,
      'supersedesSubtitleTrackId',
      200,
    );
  if (value.revision === 1 && value.supersedesSubtitleTrackId !== null)
    fail('INVALID_SUPERSESSION', 'supersedesSubtitleTrackId');
  if (value.revision > 1 && value.supersedesSubtitleTrackId === null)
    fail('SUPERSEDED_SUBTITLE_TRACK_REQUIRED', 'supersedesSubtitleTrackId');
  hash(value.contentHash, 'contentHash');
  if (subtitleTrackContentHash(value) !== value.contentHash)
    fail('CONTENT_HASH_MISMATCH', 'contentHash');
  return deepFreeze(structuredClone(value));
}
export function subtitleTrackContentHash(value: any): any {
  const { contentHash: _contentHash, ...content } = value;
  return createHash('sha256').update(stableJson(content)).digest('hex');
}
export function subtitleTrackIdentityHash(value: any): any {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}
function validateCues(value: any, durationMilliseconds: any): any {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000)
    fail('INVALID_CUES', 'cues');
  let previousEnd: number | null = null;
  value.forEach((cue: any, index: number) => {
    const path = `cues.${index}`;
    record(cue, path);
    exact(cue, CUE_FIELDS, path);
    if (cue.position !== index + 1)
      fail('INVALID_CUE_POSITION', `${path}.position`);
    cueText(cue.text, `${path}.text`);
    nonNegativeInteger(cue.startMilliseconds, `${path}.startMilliseconds`);
    if (!Number.isSafeInteger(cue.endMilliseconds))
      fail('INVALID_CUE_END', `${path}.endMilliseconds`);
    if (index === 0 && cue.startMilliseconds !== 0)
      fail('FIRST_CUE_MUST_START_AT_ZERO', `${path}.startMilliseconds`);
    if (cue.endMilliseconds <= cue.startMilliseconds)
      fail('INVALID_CUE_DURATION', `${path}.endMilliseconds`);
    if (previousEnd !== null && cue.startMilliseconds < previousEnd)
      fail('CUE_OVERLAP', `${path}.startMilliseconds`);
    if (cue.endMilliseconds > durationMilliseconds)
      fail('CUE_EXCEEDS_VOICE_DURATION', `${path}.endMilliseconds`);
    previousEnd = cue.endMilliseconds;
  });
}
function cueText(value: any, path: any): any {
  const valid =
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 1000 &&
    value === value.normalize('NFC').trim().replace(/\s+/gu, ' ') &&
    // V1 deliberately rejects control characters in cue text.
    // oxlint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/u.test(value);
  if (!valid) fail('INVALID_CUE_TEXT', path);
  if (SENSITIVE_VALUE.test(value)) fail('SENSITIVE_CONTENT', path);
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
function hash(value: any, path: any): any {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail('INVALID_HASH', path);
}
function language(value: any, path: any): any {
  if (typeof value !== 'string' || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value))
    fail('INVALID_LANGUAGE', path);
}
function positiveInteger(value: any, path: any, code: any): any {
  if (!Number.isSafeInteger(value) || value < 1) fail(code, path);
}
function nonNegativeInteger(value: any, path: any): any {
  if (!Number.isSafeInteger(value) || value < 0)
    fail('INVALID_CUE_START', path);
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
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
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
