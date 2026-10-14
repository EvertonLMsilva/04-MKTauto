import type { ProjectSnapshot } from '../../project/application/ports/project-snapshot-reader.port.js';
import { validateProjectSnapshot } from '../../project/domain/project-contracts.js';
import { ContractValidationError } from '../../project/domain/project.errors.js';

export const PIPELINE_RUN_CONTRACT_VERSION = 'pipeline-run/1.0.0';
export const PIPELINE_HANDOFF_CONTRACT_VERSION = 'pipeline-handoff/1.0.0';
export type RunState = 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export interface PublicError {
  code: string;
  field: string;
}
export interface Transition {
  previousState: RunState | null;
  nextState: RunState;
  changedAt: string;
  error: PublicError | null;
}
export interface PipelineRun {
  schemaVersion: string;
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  projectSnapshot: ProjectSnapshot;
  state: RunState;
  startedAt: string;
  completedAt: string | null;
  error: PublicError | null;
  transitions: Transition[];
}
export interface Execution {
  pipelineRunId: string;
  projectId: string;
  projectVersion: number;
  startedAt: string;
}
export class OperationsError extends Error {
  constructor(
    public readonly code: string,
    public readonly field: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}
export function immutable<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) immutable(child);
  return Object.freeze(value);
}
export function fail(code: string, path: string): never {
  throw new ContractValidationError(code, path, code);
}
export function record(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_TYPE', path);
}
export function exact(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
) {
  for (const key of Object.keys(value))
    if (!fields.includes(key)) fail('UNKNOWN_FIELD', `${path}.${key}`);
  for (const key of fields)
    if (!(key in value)) fail('REQUIRED_FIELD', `${path}.${key}`);
}
export function identifier(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 80 ||
    !/^[a-z0-9][a-z0-9_-]{2,}$/.test(value)
  )
    fail('INVALID_IDENTIFIER', path);
  return value;
}
export function timestamp(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    fail('INVALID_TIMESTAMP', path);
  return new Date(value).toISOString();
}
export function version(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    fail('INVALID_PROJECT_VERSION', path);
  return value as number;
}
function state(value: unknown, path: string): RunState {
  if (!['RUNNING', 'SUCCEEDED', 'FAILED'].includes(value as string))
    fail('INVALID_PIPELINE_RUN_STATE', path);
  return value as RunState;
}
function safeCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(value);
}
function safeField(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/.test(value)
  );
}
export function sanitizePipelineRunError(value: unknown): PublicError {
  const e =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  return immutable({
    code: safeCode(e.code) ? e.code : 'PIPELINE_RUN_FAILED',
    field: safeField(e.field) ? e.field : 'pipelineRun',
  });
}
function publicError(value: unknown, path: string): PublicError {
  record(value, path);
  exact(value, ['code', 'field'], path);
  if (!safeCode(value.code)) fail('INVALID_ERROR_CODE', `${path}.code`);
  if (!safeField(value.field)) fail('INVALID_ERROR_FIELD', `${path}.field`);
  return immutable({ code: value.code, field: value.field });
}
export function validatePipelineRun(value: unknown): PipelineRun {
  record(value, 'pipelineRun');
  exact(
    value,
    [
      'schemaVersion',
      'pipelineRunId',
      'projectId',
      'projectVersion',
      'projectSnapshot',
      'state',
      'startedAt',
      'completedAt',
      'error',
      'transitions',
    ],
    'pipelineRun',
  );
  if (value.schemaVersion !== PIPELINE_RUN_CONTRACT_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  const pipelineRunId = identifier(value.pipelineRunId, 'pipelineRunId');
  const projectId = identifier(value.projectId, 'projectId');
  const projectVersion = version(value.projectVersion, 'projectVersion');
  const projectSnapshot = validateProjectSnapshot(value.projectSnapshot);
  if (projectSnapshot.project.id !== projectId)
    fail('PROJECT_REFERENCE_MISMATCH', 'projectSnapshot.project.id');
  if (projectSnapshot.project.version !== projectVersion)
    fail('PROJECT_REFERENCE_MISMATCH', 'projectSnapshot.project.version');
  const runState = state(value.state, 'state');
  const startedAt = timestamp(value.startedAt, 'startedAt');
  const completedAt =
    value.completedAt === null
      ? null
      : timestamp(value.completedAt, 'completedAt');
  const error = value.error === null ? null : publicError(value.error, 'error');
  if (!(
    (runState === 'RUNNING' && completedAt === null && error === null) ||
    (runState === 'SUCCEEDED' && completedAt !== null && error === null) ||
    (runState === 'FAILED' && completedAt !== null && error !== null)
  ))
    fail('INVALID_PIPELINE_RUN_STATE', 'state');
  if (!Array.isArray(value.transitions) || !value.transitions.length)
    fail('INVALID_TRANSITIONS', 'transitions');
  const transitions = value.transitions.map(
    (t: unknown, i: number): Transition => {
      const path = `transitions.${i}`;
      record(t, path);
      exact(t, ['previousState', 'nextState', 'changedAt', 'error'], path);
      const previousState =
        t.previousState === null
          ? null
          : state(t.previousState, `${path}.previousState`);
      const nextState = state(t.nextState, `${path}.nextState`);
      const changedAt = timestamp(t.changedAt, `${path}.changedAt`);
      const error =
        t.error === null ? null : publicError(t.error, `${path}.error`);
      if (!(
        (previousState === null && nextState === 'RUNNING' && error === null) ||
        (previousState === 'RUNNING' &&
          nextState === 'SUCCEEDED' &&
          error === null) ||
        (previousState === 'RUNNING' &&
          nextState === 'FAILED' &&
          error !== null) ||
        (previousState === 'FAILED' &&
          nextState === 'RUNNING' &&
          error === null)
      ))
        fail('INVALID_PIPELINE_RUN_TRANSITION', path);
      return immutable({ previousState, nextState, changedAt, error });
    },
  );
  const first = transitions[0];
  if (
    first.previousState !== null ||
    first.nextState !== 'RUNNING' ||
    first.changedAt !== startedAt
  )
    fail('INVALID_TRANSITION_HISTORY', 'transitions.0');
  for (let i = 1; i < transitions.length; i++)
    if (transitions[i].previousState !== transitions[i - 1].nextState)
      fail('INVALID_TRANSITION_HISTORY', `transitions.${i}`);
  const last = transitions.at(-1)!;
  if (last.nextState !== runState) fail('INVALID_TRANSITION_HISTORY', 'state');
  if (runState === 'RUNNING') {
    if (completedAt !== null || error !== null || last.error !== null)
      fail('INVALID_TRANSITION_HISTORY', 'transitions');
  } else if (
    last.changedAt !== completedAt ||
    !(last.error === null
      ? error === null
      : error !== null &&
        last.error.code === error.code &&
        last.error.field === error.field)
  )
    fail('INVALID_TRANSITION_HISTORY', 'transitions');
  return immutable({
    schemaVersion: PIPELINE_RUN_CONTRACT_VERSION,
    pipelineRunId,
    projectId,
    projectVersion,
    projectSnapshot,
    state: runState,
    startedAt,
    completedAt,
    error,
    transitions,
  });
}
export function validateHandoff(value: unknown): Execution {
  const seen = new WeakSet<object>();
  function visit(v: unknown, path: string) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    for (const [key, child] of Object.entries(v)) {
      const p = path ? `${path}.${key}` : key;
      if (
        /^(?:access|refresh)?token$|^api[_-]?key$|authorization|client[_-]?secret|credential|password|private[_-]?key|secret/i.test(
          key.replace(/[^a-zA-Z_-]/g, ''),
        )
      )
        fail('SENSITIVE_FIELD_REJECTED', p);
      visit(child, p);
    }
  }
  visit(value, '');
  record(value, 'request');
  const fields = [
    'schemaVersion',
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'startedAt',
  ];
  for (const key of Object.keys(value))
    if (!fields.includes(key)) fail('UNKNOWN_FIELD', `request.${key}`);
  for (const key of fields) if (!(key in value)) fail('REQUIRED_FIELD', key);
  if (value.schemaVersion !== PIPELINE_HANDOFF_CONTRACT_VERSION)
    fail('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion');
  return immutable({
    pipelineRunId: identifier(value.pipelineRunId, 'pipelineRunId'),
    projectId: identifier(value.projectId, 'projectId'),
    projectVersion: version(value.projectVersion, 'projectVersion'),
    startedAt: timestamp(value.startedAt, 'startedAt'),
  });
}
