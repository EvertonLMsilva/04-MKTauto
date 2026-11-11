import { ContractValidationError } from './research-record-contracts.js';
import { validateProjectSnapshot } from '../../project/domain/project-contracts.js';

export const RESEARCH_INPUT_CONTRACT_VERSION: any = 'research-input/1.0.0';

const INPUT_FIELDS: any = Object.freeze([
  'schemaVersion',
  'execution',
  'window',
  'projectSnapshot',
]);
const EXECUTION_FIELDS: any = Object.freeze([
  'pipelineRunId',
  'projectId',
  'projectVersion',
  'startedAt',
]);
const WINDOW_FIELDS: any = Object.freeze(['logicalDate']);

export function createResearchInput(value: any): any {
  rejectSensitiveFields(value);
  requireRecord(value, 'researchInput');
  requireExactKeys(value, INPUT_FIELDS, 'researchInput');
  if (value.schemaVersion !== RESEARCH_INPUT_CONTRACT_VERSION) {
    fail(
      'UNSUPPORTED_SCHEMA_VERSION',
      'schemaVersion',
      'versão do contrato não suportada',
    );
  }

  const execution: any = validateExecution(value.execution);
  const window: any = validateResearchWindow(value.window);
  const projectSnapshot: any = validateProjectSnapshot(value.projectSnapshot);
  if (projectSnapshot.project.id !== execution.projectId) {
    fail(
      'PROJECT_REFERENCE_MISMATCH',
      'projectSnapshot.project.id',
      'snapshot diverge da execução',
    );
  }
  if (projectSnapshot.project.version !== execution.projectVersion) {
    fail(
      'PROJECT_REFERENCE_MISMATCH',
      'projectSnapshot.project.version',
      'snapshot diverge da execução',
    );
  }

  return deepFreeze({
    schemaVersion: RESEARCH_INPUT_CONTRACT_VERSION,
    execution,
    window,
    projectSnapshot,
  });
}

export function validateResearchWindow(value: any): any {
  requireRecord(value, 'window');
  requireExactKeys(value, WINDOW_FIELDS, 'window');
  if (
    typeof value.logicalDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.logicalDate) ||
    new Date(`${value.logicalDate}T00:00:00.000Z`)
      .toISOString()
      .slice(0, 10) !== value.logicalDate
  ) {
    fail(
      'INVALID_LOGICAL_DATE',
      'window.logicalDate',
      'use uma data válida em YYYY-MM-DD',
    );
  }
  return deepFreeze({ logicalDate: value.logicalDate });
}

function validateExecution(value: any): any {
  requireRecord(value, 'execution');
  requireExactKeys(value, EXECUTION_FIELDS, 'execution');
  const pipelineRunId: any = requireIdentifier(
    value.pipelineRunId,
    'execution.pipelineRunId',
  );
  const projectId: any = requireIdentifier(
    value.projectId,
    'execution.projectId',
  );
  if (!Number.isSafeInteger(value.projectVersion) || value.projectVersion < 1) {
    fail(
      'INVALID_PROJECT_VERSION',
      'execution.projectVersion',
      'deve ser inteiro positivo',
    );
  }
  const startedAt: any = requireTimestamp(
    value.startedAt,
    'execution.startedAt',
  );
  return deepFreeze({
    pipelineRunId,
    projectId,
    projectVersion: value.projectVersion,
    startedAt,
  });
}

function requireRecord(value: any, path: any): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_TYPE', path, 'deve ser um objeto');
  }
}

function requireExactKeys(value: any, allowed: any, path: any): any {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      fail('UNKNOWN_FIELD', `${path}.${key}`, 'campo não permitido');
  }
  for (const key of allowed) {
    if (!(key in value))
      fail(
        'REQUIRED_FIELD',
        path === 'researchInput' ? key : `${path}.${key}`,
        'campo obrigatório',
      );
  }
}

function requireIdentifier(value: any, path: any): any {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !/^[a-z0-9][a-z0-9_-]{2,}$/.test(value)
  ) {
    fail(
      'INVALID_IDENTIFIER',
      path,
      'use identificador seguro em letras minúsculas, números, _ ou -',
    );
  }
  return value;
}

function requireTimestamp(value: any, path: any): any {
  const isoInstant: any =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (
    typeof value !== 'string' ||
    !isoInstant.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    fail('INVALID_TIMESTAMP', path, 'use um instante ISO 8601 válido');
  }
  return new Date(value).toISOString();
}

function rejectSensitiveFields(value: any, prefix: any = ''): any {
  const sensitive: any =
    /^(?:access|refresh)?token$|^api[_-]?key$|authorization|client[_-]?secret|credential|password|private[_-]?key|secret/i;
  const seen: any = new WeakSet();
  function visit(current: any, path: any): any {
    if (!current || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of entries(current)) {
      const childPath: any = path ? `${path}.${key}` : key;
      if (sensitive.test(key.replace(/[^a-zA-Z_-]/g, ''))) {
        fail(
          'SENSITIVE_FIELD_REJECTED',
          childPath,
          'credenciais, tokens e segredos não pertencem ao contrato',
        );
      }
      visit(child, childPath);
    }
  }
  visit(value, prefix);
}

function deepFreeze(value: any): any {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code: any, path: any, message: any): never {
  throw new ContractValidationError(code, path, message);
}

function entries(value: any): [string, any][] {
  return Object.entries(value);
}
