import { ContractValidationError } from './research-record-contracts.js';

export const RESEARCH_ARTIFACT_CONTRACT_VERSION: any =
  'research-topic-catalog/1.0.0';

const FIELDS: any = Object.freeze([
  'schemaVersion',
  'artifactId',
  'artifactType',
  'revision',
  'pipelineRunId',
  'projectId',
  'projectVersion',
  'logicalDate',
  'timezone',
  'createdAt',
  'createdBy',
  'researchInputHash',
  'analysisContext',
  'sourcePlan',
  'trendRunId',
  'state',
  'gaps',
  'contentHash',
  'rights',
]);
const CONTEXT_FIELDS: any = Object.freeze([
  'niche',
  'subniches',
  'audience',
  'language',
]);
const SOURCE_FIELDS: any = Object.freeze([
  'network',
  'role',
  'adapter',
  'status',
  'sourceRunIds',
  'gaps',
]);
const NETWORKS: any = Object.freeze([
  'facebook',
  'instagram',
  'threads',
  'tiktok',
  'youtube',
]);

export function createResearchArtifact(value: any): any {
  record(value, 'artifact');
  exact(value, FIELDS, 'artifact');
  if (value.schemaVersion !== RESEARCH_ARTIFACT_CONTRACT_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  if (value.artifactType !== 'topic_discovery')
    fail('INVALID_ARTIFACT_TYPE', 'artifactType');
  identifier(value.artifactId, 'artifactId', 200);
  identifier(value.pipelineRunId, 'pipelineRunId');
  identifier(value.projectId, 'projectId');
  identifier(value.trendRunId, 'trendRunId', 200);
  if (value.revision !== 1) fail('INVALID_REVISION', 'revision');
  if (!Number.isSafeInteger(value.projectVersion) || value.projectVersion < 1)
    fail('INVALID_PROJECT_VERSION', 'projectVersion');
  if (
    typeof value.logicalDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.logicalDate) ||
    new Date(`${value.logicalDate}T00:00:00.000Z`)
      .toISOString()
      .slice(0, 10) !== value.logicalDate
  )
    fail('INVALID_LOGICAL_DATE', 'logicalDate');
  if (typeof value.timezone !== 'string' || value.timezone === '')
    fail('INVALID_TIMEZONE', 'timezone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format();
  } catch {
    fail('INVALID_TIMEZONE', 'timezone');
  }
  timestamp(value.createdAt, 'createdAt');
  if (value.createdBy !== 'SYSTEM') fail('INVALID_CREATED_BY', 'createdBy');
  hash(value.researchInputHash, 'researchInputHash');
  hash(value.contentHash, 'contentHash');
  if (!['COMPLETED', 'COMPLETED_WITH_GAPS', 'FAILED'].includes(value.state))
    fail('INVALID_STATE', 'state');
  strings(value.gaps, 'gaps');

  record(value.analysisContext, 'analysisContext');
  exact(value.analysisContext, CONTEXT_FIELDS, 'analysisContext');
  text(value.analysisContext.niche, 'analysisContext.niche');
  strings(value.analysisContext.subniches, 'analysisContext.subniches');
  text(value.analysisContext.audience, 'analysisContext.audience');
  text(value.analysisContext.language, 'analysisContext.language');

  if (!Array.isArray(value.sourcePlan) || value.sourcePlan.length === 0)
    fail('INVALID_SOURCE_PLAN', 'sourcePlan');
  const networks: any = new Set();
  value.sourcePlan.forEach((source: any, index: any): any => {
    const path: any = `sourcePlan[${index}]`;
    record(source, path);
    exact(source, SOURCE_FIELDS, path);
    if (!NETWORKS.includes(source.network))
      fail('INVALID_NETWORK', `${path}.network`);
    if (networks.has(source.network))
      fail('DUPLICATE_NETWORK', `${path}.network`);
    networks.add(source.network);
    if (!['CONFIGURED_NETWORK', 'TECHNICAL_DEPENDENCY'].includes(source.role))
      fail('INVALID_SOURCE_ROLE', `${path}.role`);
    if (typeof source.adapter !== 'string' || source.adapter === '')
      fail('INVALID_ADAPTER', `${path}.adapter`);
    if (
      ![
        'SUCCESS',
        'PARTIAL',
        'BLOCKED_BY_PROVIDER',
        'FAILED',
        'UNSUPPORTED',
      ].includes(source.status)
    )
      fail('INVALID_SOURCE_STATUS', `${path}.status`);
    strings(source.sourceRunIds, `${path}.sourceRunIds`);
    strings(source.gaps, `${path}.gaps`);
  });

  record(value.rights, 'rights');
  exact(
    value.rights,
    ['usageCondition', 'mediaDownloaded', 'republicationAllowed'],
    'rights',
  );
  if (
    value.rights.usageCondition !== 'REFERENCE_ONLY' ||
    value.rights.mediaDownloaded !== false ||
    value.rights.republicationAllowed !== false
  ) {
    fail('INVALID_RIGHTS', 'rights');
  }
  return deepFreeze(structuredClone(value));
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
function text(value: any, path: any): any {
  if (typeof value !== 'string' || value.trim() === '')
    fail('REQUIRED_FIELD', path);
}
function strings(value: any, path: any): any {
  if (
    !Array.isArray(value) ||
    value.some((item: any): any => typeof item !== 'string' || item === '')
  )
    fail('INVALID_TYPE', path);
}
function timestamp(value: any, path: any): any {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    fail('INVALID_TIMESTAMP', path);
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
