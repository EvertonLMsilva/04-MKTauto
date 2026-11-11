import type { EditorialScript } from './content.types.js';
import { createHash } from 'node:crypto';
import { ContractValidationError } from '../../project/domain/project.errors.js';
export const SCRIPT_CONTRACT_VERSION = 'script/1.0.0';
const FIELDS = Object.freeze([
  'schemaVersion',
  'scriptId',
  'pipelineRunId',
  'projectId',
  'projectVersion',
  'ideaSelectionId',
  'ideaSelectionContentHash',
  'ideaCandidateId',
  'ideaContentHash',
  'language',
  'contentFormat',
  'hook',
  'narrativeBlocks',
  'fullNarration',
  'visualDirections',
  'cta',
  'estimatedDurationSeconds',
  'sensitiveClaims',
  'reviewFlags',
  'origin',
  'createdAt',
  'revision',
  'supersedesScriptId',
  'contentHash',
]);
const BLOCK_FIELDS = Object.freeze(['position', 'purpose', 'narration']);
const VISUAL_FIELDS = Object.freeze([
  'position',
  'blockPosition',
  'description',
]);
const VISUAL_OPTIONAL_FIELDS = Object.freeze(['mediaSearchQuery']);
const CLAIM_FIELDS = Object.freeze([
  'position',
  'blockPosition',
  'summary',
  'sourceRequired',
  'humanReviewRequired',
]);
const PURPOSES = Object.freeze([
  'INTRODUCTION',
  'EXPLANATION',
  'EXAMPLE',
  'CONCLUSION',
]);
const REVIEW_FLAGS = Object.freeze([
  'SOURCE_VERIFICATION_REQUIRED',
  'HUMAN_REVIEW_REQUIRED',
  'ORIGINALITY_REVIEW_REQUIRED',
]);
const SENSITIVE_VALUE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i;
export function validateScript(input: unknown): EditorialScript {
  const value = input as EditorialScript;
  record(value, 'script');
  const commercial = value.schemaVersion === 'script/2.0.0';
  const ideaFields = [
    'ideaSelectionId',
    'ideaSelectionContentHash',
    'ideaCandidateId',
    'ideaContentHash',
  ];
  exact(
    value,
    commercial
      ? [
          ...FIELDS.filter((field: any) => !ideaFields.includes(field)),
          'editorialSelectionId',
          'editorialSelectionContentHash',
        ]
      : FIELDS,
    'script',
  );
  if (!commercial && value.schemaVersion !== SCRIPT_CONTRACT_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  identifier(value.scriptId, 'scriptId', 200);
  identifier(value.pipelineRunId, 'pipelineRunId');
  identifier(value.projectId, 'projectId');
  positiveInteger(value.projectVersion, 'projectVersion', 'INVALID_INTEGER');
  if (commercial) {
    identifier(value.editorialSelectionId, 'editorialSelectionId', 200);
    hash(value.editorialSelectionContentHash, 'editorialSelectionContentHash');
    if (!['OPERATOR', 'AUTOMATION'].includes(value.origin))
      fail('AFFILIATE_OPERATOR_SCRIPT_REQUIRED', 'origin');
  } else {
    identifier(value.ideaSelectionId, 'ideaSelectionId', 200);
    hash(value.ideaSelectionContentHash, 'ideaSelectionContentHash');
    identifier(value.ideaCandidateId, 'ideaCandidateId', 200);
    hash(value.ideaContentHash, 'ideaContentHash');
  }
  if (
    typeof value.language !== 'string' ||
    !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value.language)
  )
    fail('INVALID_LANGUAGE', 'language');
  if (!['short_video', 'long_video'].includes(value.contentFormat))
    fail('INVALID_CONTENT_FORMAT', 'contentFormat');
  normalizedText(value.hook, 'hook', 2, 500);
  validateBlocks(value.narrativeBlocks);
  multilineText(value.fullNarration, 'fullNarration', 2, 50000);
  validateVisuals(value.visualDirections, value.narrativeBlocks.length);
  if (value.cta !== null) normalizedText(value.cta, 'cta', 2, 500);
  positiveInteger(
    value.estimatedDurationSeconds,
    'estimatedDurationSeconds',
    'INVALID_DURATION',
  );
  validateClaims(value.sensitiveClaims, value.narrativeBlocks.length);
  validateFlags(value.reviewFlags, value.sensitiveClaims);
  if (
    ![
      'OPERATOR',
      'EXTERNAL_CONSUMER',
      ...(commercial ? ['AUTOMATION'] : []),
    ].includes(value.origin)
  )
    fail('INVALID_ORIGIN', 'origin');
  timestamp(value.createdAt, 'createdAt');
  positiveInteger(value.revision, 'revision', 'INVALID_REVISION');
  if (value.supersedesScriptId !== null)
    identifier(value.supersedesScriptId, 'supersedesScriptId', 200);
  if (value.revision === 1 && value.supersedesScriptId !== null)
    fail('INVALID_SUPERSESSION', 'supersedesScriptId');
  if (value.revision > 1 && value.supersedesScriptId === null)
    fail('SUPERSEDED_SCRIPT_REQUIRED', 'supersedesScriptId');
  hash(value.contentHash, 'contentHash');
  const expectedNarration = [
    value.hook,
    ...value.narrativeBlocks.map(({ narration }: any) => narration),
    value.cta,
  ]
    .filter((part: any) => part !== null)
    .join('\n\n');
  if (value.fullNarration !== expectedNarration)
    fail('NARRATION_MISMATCH', 'fullNarration');
  rejectSensitive(value);
  if (scriptContentHash(value) !== value.contentHash)
    fail('CONTENT_HASH_MISMATCH', 'contentHash');
  return deepFreeze(structuredClone(value));
}
export function scriptContentHash(value: object): string {
  const { contentHash: _contentHash, ...content } = value as {
    contentHash?: string;
  };
  return createHash('sha256').update(stableJson(content)).digest('hex');
}
function validateBlocks(value: any): any {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    fail('INVALID_BLOCKS', 'narrativeBlocks');
  value.forEach((block: any, index: any) => {
    const path = `narrativeBlocks.${index}`;
    record(block, path);
    exact(block, BLOCK_FIELDS, path);
    if (block.position !== index + 1)
      fail('INVALID_BLOCK_POSITION', `${path}.position`);
    if (!PURPOSES.includes(block.purpose))
      fail('INVALID_BLOCK_PURPOSE', `${path}.purpose`);
    normalizedText(block.narration, `${path}.narration`, 2, 10000);
  });
}
function validateVisuals(value: any, blockCount: any): any {
  if (!Array.isArray(value) || value.length === 0 || value.length > 300)
    fail('INVALID_VISUAL_DIRECTIONS', 'visualDirections');
  value.forEach((visual: any, index: any) => {
    const path = `visualDirections.${index}`;
    record(visual, path);
    exactOptional(visual, VISUAL_FIELDS, VISUAL_OPTIONAL_FIELDS, path);
    if (visual.position !== index + 1)
      fail('INVALID_VISUAL_POSITION', `${path}.position`);
    if (
      !Number.isSafeInteger(visual.blockPosition) ||
      visual.blockPosition < 1 ||
      visual.blockPosition > blockCount
    )
      fail('VISUAL_BLOCK_NOT_FOUND', `${path}.blockPosition`);
    normalizedText(visual.description, `${path}.description`, 2, 1000);
    if (visual.mediaSearchQuery !== undefined) {
      normalizedText(
        visual.mediaSearchQuery,
        `${path}.mediaSearchQuery`,
        2,
        100,
      );
    }
  });
}
function validateClaims(value: any, blockCount: any): any {
  if (!Array.isArray(value) || value.length > 100)
    fail('INVALID_SENSITIVE_CLAIMS', 'sensitiveClaims');
  value.forEach((claim: any, index: any) => {
    const path = `sensitiveClaims.${index}`;
    record(claim, path);
    exact(claim, CLAIM_FIELDS, path);
    if (claim.position !== index + 1)
      fail('INVALID_CLAIM_POSITION', `${path}.position`);
    if (
      !Number.isSafeInteger(claim.blockPosition) ||
      claim.blockPosition < 1 ||
      claim.blockPosition > blockCount
    )
      fail('CLAIM_BLOCK_NOT_FOUND', `${path}.blockPosition`);
    normalizedText(claim.summary, `${path}.summary`, 2, 500);
    if (typeof claim.sourceRequired !== 'boolean')
      fail('INVALID_TYPE', `${path}.sourceRequired`);
    if (typeof claim.humanReviewRequired !== 'boolean')
      fail('INVALID_TYPE', `${path}.humanReviewRequired`);
    if (!claim.sourceRequired && !claim.humanReviewRequired)
      fail('SENSITIVE_CLAIM_REVIEW_REQUIRED', path);
  });
}
function validateFlags(value: any, claims: any): any {
  if (!Array.isArray(value) || value.length > REVIEW_FLAGS.length)
    fail('INVALID_REVIEW_FLAGS', 'reviewFlags');
  const unique = new Set(value);
  if (unique.size !== value.length)
    fail('DUPLICATE_REVIEW_FLAG', 'reviewFlags');
  value.forEach((flag: any, index: any) => {
    if (!REVIEW_FLAGS.includes(flag))
      fail('INVALID_REVIEW_FLAG', `reviewFlags.${index}`);
  });
  if (
    claims.some(({ sourceRequired }: any) => sourceRequired) &&
    !unique.has('SOURCE_VERIFICATION_REQUIRED')
  )
    fail('REVIEW_FLAG_REQUIRED', 'reviewFlags');
  if (
    claims.some(({ humanReviewRequired }: any) => humanReviewRequired) &&
    !unique.has('HUMAN_REVIEW_REQUIRED')
  )
    fail('REVIEW_FLAG_REQUIRED', 'reviewFlags');
}
function rejectSensitive(value: any): any {
  const forbiddenKey =
    /^(?:prompt|systemMessage|instruction|token|apiKey|secret|password|media|transcript|sourceText|payload)$/i;
  const visit = (current: any, path: any) => {
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbiddenKey.test(key)) fail('FORBIDDEN_FIELD', childPath);
      if (typeof child === 'string' && SENSITIVE_VALUE.test(child))
        fail('SENSITIVE_CONTENT', childPath);
      visit(child, childPath);
    }
  };
  visit(value, '');
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
function exactOptional(
  value: any,
  requiredFields: any,
  optionalFields: any,
  path: any,
): any {
  const allowedFields = [...requiredFields, ...optionalFields];
  for (const key of Object.keys(value)) {
    if (!allowedFields.includes(key)) {
      fail('UNKNOWN_FIELD', `${path}.${key}`);
    }
  }
  for (const key of requiredFields) {
    if (!(key in value)) {
      fail('REQUIRED_FIELD', `${path}.${key}`);
    }
  }
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
function normalizedText(value: any, path: any, min: any, max: any): any {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > max ||
    value !== value.normalize('NFC').trim().replace(/\s+/g, ' ')
  )
    fail('INVALID_TEXT', path);
}
function multilineText(value: any, path: any, min: any, max: any): any {
  if (
    typeof value !== 'string' ||
    value.length < min ||
    value.length > max ||
    value !== value.normalize('NFC') ||
    value.trim() !== value ||
    value.includes('\r')
  )
    fail('INVALID_TEXT', path);
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
