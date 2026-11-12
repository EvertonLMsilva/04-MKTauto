import type { RunCostPerimeter } from './run-cost-coverage.types.js';

export function coverageFail(code: string, field: string): never {
  throw Object.assign(new Error(`${code}: ${field}`), { code, field });
}
function object(
  value: unknown,
  keys: string[],
  field: string,
  optional: string[] = [],
): Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) => !keys.includes(k) && !optional.includes(k),
    ) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    coverageFail('COVERAGE_DECLARATION_INVALID', field);
  return value as Record<string, any>;
}
function text(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500)
    coverageFail('COVERAGE_DECLARATION_INVALID', field);
  for (let index = 0; index < value.length; index++)
    if (value.charCodeAt(index) < 32)
      coverageFail('COVERAGE_DECLARATION_INVALID', field);
}
function list(value: unknown, field: string): any[] {
  if (!Array.isArray(value))
    coverageFail('COVERAGE_DECLARATION_INVALID', field);
  return value;
}
function ids(value: unknown, field: string) {
  const items = list(value, field);
  items.forEach((v) => text(v, field));
  if (new Set(items).size !== items.length)
    coverageFail('COVERAGE_DUPLICATE_CLAIM', field);
}
export function validateCostPerimeter(value: unknown): RunCostPerimeter {
  const v = object(
    value,
    [
      'schemaVersion',
      'pipelineRunId',
      'projectId',
      'projectVersion',
      'runIdentityHash',
      'complete',
      'perimeterEvidenceIds',
      'evidence',
      'stages',
    ],
    'declaration',
  );
  if (
    v.schemaVersion !== 'run-cost-perimeter/1.0.0' ||
    typeof v.complete !== 'boolean' ||
    !Number.isSafeInteger(v.projectVersion) ||
    v.projectVersion < 1 ||
    typeof v.runIdentityHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.runIdentityHash)
  )
    coverageFail('COVERAGE_DECLARATION_INVALID', 'identity');
  text(v.pipelineRunId, 'pipelineRunId');
  text(v.projectId, 'projectId');
  ids(v.perimeterEvidenceIds, 'perimeterEvidenceIds');
  const stageIds = new Set<string>(),
    documentIds = new Set<string>();
  for (const item of list(v.stages, 'stages')) {
    const s = object(
      item,
      ['stageId', 'applicability', 'costEventIds', 'operations', 'evidenceIds'],
      'stage',
      ['justification'],
    );
    text(s.stageId, 'stageId');
    if (stageIds.has(s.stageId))
      coverageFail('COVERAGE_DUPLICATE_CLAIM', 'stageId');
    stageIds.add(s.stageId);
    if (!['APPLICABLE', 'NOT_APPLICABLE'].includes(s.applicability))
      coverageFail('COVERAGE_DECLARATION_INVALID', 'applicability');
    if (s.justification !== undefined) text(s.justification, 'justification');
    ids(s.costEventIds, 'costEventIds');
    ids(s.evidenceIds, 'evidenceIds');
    for (const item of list(s.operations, 'operations')) {
      const op = object(
        item,
        ['source', 'operationId', 'requestHash'],
        'operation',
      );
      text(op.operationId, 'operationId');
      if (
        !['TTS', 'GLOBAL', 'VIDEO'].includes(op.source) ||
        typeof op.requestHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(op.requestHash)
      )
        coverageFail('COVERAGE_DECLARATION_INVALID', 'operation');
    }
  }
  for (const item of list(v.evidence, 'evidence')) {
    const e = object(
      item,
      [
        'evidenceId',
        'reference',
        'pipelineRunId',
        'projectId',
        'projectVersion',
        'stageId',
        'kind',
        'currency',
      ],
      'evidence',
    );
    for (const key of ['evidenceId', 'reference', 'pipelineRunId', 'projectId'])
      text(e[key], key);
    if (documentIds.has(e.evidenceId))
      coverageFail('COVERAGE_DUPLICATE_CLAIM', 'evidenceId');
    documentIds.add(e.evidenceId);
    if (
      !['PERIMETER', 'BILLING', 'NOT_APPLICABLE'].includes(e.kind) ||
      !Number.isSafeInteger(e.projectVersion) ||
      e.projectVersion < 1 ||
      (e.kind === 'BILLING'
        ? typeof e.currency !== 'string' || !/^[A-Z]{3}$/.test(e.currency)
        : e.currency !== null) ||
      (e.kind === 'PERIMETER'
        ? e.stageId !== null
        : typeof e.stageId !== 'string' || !stageIds.has(e.stageId))
    )
      coverageFail('COVERAGE_EVIDENCE_INVALID', 'evidence');
  }
  return value as RunCostPerimeter;
}
