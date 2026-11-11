import {
  affiliateHash,
  affiliateIdentifier,
  immutable,
} from '../../affiliate/domain/affiliate-contracts.js';
export { affiliateHash } from '../../affiliate/domain/affiliate-contracts.js';
import type { AffiliateEditorialSelection } from './content.types.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';
export function validateAffiliateEditorialSelection(
  input: unknown,
): AffiliateEditorialSelection {
  const value = input as any;
  exact(
    value,
    [
      'schemaVersion',
      'selectionId',
      'pipelineRunId',
      'projectId',
      'projectVersion',
      'briefingId',
      'briefingHash',
      'evidenceRefs',
      'title',
      'editorialAngle',
      'decision',
      'actor',
      'decidedAt',
      'contentHash',
    ],
    'selection',
  );
  schema(value.schemaVersion, 'affiliate-editorial-selection/1.0.0');
  for (const field of [
    'selectionId',
    'pipelineRunId',
    'projectId',
    'briefingId',
  ])
    affiliateIdentifier(value[field], field);
  revision(value.projectVersion, 'projectVersion');
  if (value.decision !== 'SELECTED') fail('INVALID_DECISION', 'decision');
  const automated = value.actor?.type === 'AUTOMATION';
  exact(
    value.actor,
    automated
      ? [
          'type',
          'id',
          'policyId',
          'policyVersion',
          'productId',
          'campaignId',
          'reason',
        ]
      : ['type', 'id'],
    'actor',
  );
  if (!automated && value.actor.type !== 'HUMAN')
    fail('HUMAN_ACTOR_REQUIRED', 'actor.type');
  if (automated) {
    for (const field of ['policyId', 'productId', 'campaignId'])
      affiliateIdentifier(value.actor[field], `actor.${field}`);
    text(value.actor.policyVersion, 'actor.policyVersion', 120);
    text(value.actor.reason, 'actor.reason', 400);
  }
  affiliateIdentifier(value.actor.id, 'actor.id');
  if (
    typeof value.decidedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value.decidedAt,
    ) ||
    !Number.isFinite(Date.parse(value.decidedAt))
  )
    fail('INVALID_TIMESTAMP', 'decidedAt');
  text(value.title, 'title', 160);
  text(value.editorialAngle, 'editorialAngle', 400);
  list(value.evidenceRefs, 'evidenceRefs');
  const refs = new Set();
  for (const ref of value.evidenceRefs) {
    affiliateIdentifier(ref, 'evidenceRefs');
    unique(refs, ref, 'evidenceRefs');
  }
  for (const field of ['briefingHash', 'contentHash'])
    if (!/^[a-f0-9]{64}$/.test(value[field] ?? '')) fail('INVALID_HASH', field);
  const { contentHash, ...body } = value;
  if (affiliateHash(body) !== contentHash)
    fail('CONTENT_HASH_MISMATCH', 'contentHash');
  return immutable(structuredClone(value));
}
function exact(value: any, fields: any, path: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_AFFILIATE_TYPE', path);
  for (const key of Object.keys(value))
    if (!fields.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of fields)
    if (!Object.hasOwn(value, key)) fail('REQUIRED_FIELD', `${path}.${key}`);
}
function text(value: any, field: any, max: any = 4000): any {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i.test(value)
  )
    fail('INVALID_AFFILIATE_TEXT', field);
}
function revision(value: any, field: any): any {
  if (!Number.isSafeInteger(value) || value < 1)
    fail('INVALID_AFFILIATE_REVISION', field);
}
function schema(value: any, expected: any): any {
  if (value !== expected) fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
}
function list(value: any, field: any): any {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200)
    fail('INVALID_AFFILIATE_LIST', field);
}
function unique(set: any, value: any, field: any): any {
  if (set.has(value)) fail('DUPLICATE_AFFILIATE_VALUE', field);
  set.add(value);
}
function fail(code: any, field: any): never {
  throw new ContractValidationError(code, field, 'contrato afiliado inválido');
}
