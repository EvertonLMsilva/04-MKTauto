import type {
  ProjectRepository,
  ProjectActions,
  CommandResult,
  CommandRecord,
} from './ports/project-repository.port.js';
import { ProjectCommandError } from './ports/project-commands.port.js';
import { createHash } from 'node:crypto';
import { ContractValidationError } from '../domain/project.errors.js';
import { createProjectSnapshot } from '../domain/project-contracts.js';
import { ProjectRepositoryError } from '../domain/project.errors.js';

const COMMAND_FIELDS = Object.freeze({
  CREATE_PROJECT: ['idempotencyKey', 'actor', 'occurredAt', 'project'],
  CREATE_PROJECT_VERSION: [
    'idempotencyKey',
    'actor',
    'occurredAt',
    'expectedVersion',
    'project',
  ],
  ARCHIVE_PROJECT: [
    'idempotencyKey',
    'actor',
    'occurredAt',
    'projectId',
    'expectedVersion',
  ],
});

export class ProjectApplicationError extends ProjectCommandError {
  constructor(
    code: string,
    field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(code, field);
    this.message = `${code} em ${field}: ${message}`;
    if (options?.cause !== undefined) this.cause = options.cause;
    this.name = 'ProjectApplicationError';
  }
}

export class ProjectApplicationService {
  constructor(private readonly repository: ProjectRepository) {
    if (!repository || typeof repository.executeCommand !== 'function') {
      throw applicationFailure(
        'INVALID_REPOSITORY',
        'repository',
        'ProjectRepository obrigatório',
      );
    }
  }

  createProject(command: unknown) {
    return this.#execute('CREATE_PROJECT', command, ({ project }) => {
      const snapshot = createProjectSnapshot(project);
      if (snapshot.project.version !== 1) {
        throw applicationFailure(
          'PROJECT_VERSION_CONFLICT',
          'project.version',
          'um projeto novo deve começar na versão 1',
        );
      }
      return {
        payload: { snapshot },
        operation: (actions: ProjectActions) => actions.create(snapshot),
      };
    });
  }

  createProjectVersion(command: unknown) {
    return this.#execute(
      'CREATE_PROJECT_VERSION',
      command,
      ({ project, expectedVersion }) => {
        requireExpectedVersion(expectedVersion);
        const snapshot = createProjectSnapshot(project);
        return {
          payload: { expectedVersion, snapshot },
          operation: (actions) =>
            actions.createVersion(snapshot, expectedVersion),
        };
      },
    );
  }

  archiveProject(command: unknown) {
    return this.#execute(
      'ARCHIVE_PROJECT',
      command,
      ({ projectId, expectedVersion }) => {
        requireProjectId(projectId);
        requireExpectedVersion(expectedVersion);
        return {
          payload: { projectId, expectedVersion },
          operation: (actions) => actions.archive(projectId, expectedVersion),
        };
      },
    );
  }

  #execute<T extends CommandResult>(
    commandType: CommandRecord['commandType'],
    command: unknown,
    prepare: (command: Record<string, unknown>) => {
      payload: object;
      operation: (actions: ProjectActions) => T;
    },
  ): T {
    try {
      requireRecord(command, 'command');
      rejectSensitiveFields(command);
      requireExactKeys(command, COMMAND_FIELDS[commandType], 'command');
      const idempotencyKey = requireIdempotencyKey(command.idempotencyKey);
      const actor = requireActor(command.actor);
      const occurredAt = requireTimestamp(command.occurredAt, 'occurredAt');
      const prepared = prepare(command);
      const payloadHash = stableHash({
        actor,
        occurredAt,
        ...prepared.payload,
      });
      return this.repository.executeCommand(
        {
          idempotencyKey,
          commandType,
          payloadHash,
          actor,
          occurredAt,
        },
        prepared.operation,
      );
    } catch (caught) {
      throw asApplicationError(caught);
    }
  }
}

function stableHash(value: unknown) {
  return createHash('sha256').update(stableJson(value)!).digest('hex');
}

function stableJson(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireIdempotencyKey(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.trim())
  ) {
    throw applicationFailure(
      'INVALID_IDEMPOTENCY_KEY',
      'idempotencyKey',
      'use de 1 a 200 caracteres seguros',
    );
  }
  return value.trim();
}

function requireActor(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.trim().length > 160
  ) {
    throw applicationFailure(
      'INVALID_ACTOR',
      'actor',
      'ator obrigatório com até 160 caracteres',
    );
  }
  return value.trim().replace(/\s+/g, ' ');
}

function requireTimestamp(value: unknown, field: string) {
  const isoInstant =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (
    typeof value !== 'string' ||
    !isoInstant.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw applicationFailure(
      'INVALID_TIMESTAMP',
      field,
      'use um instante ISO 8601 válido',
    );
  }
  return new Date(value).toISOString();
}

function requireProjectId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(value)) {
    throw applicationFailure(
      'INVALID_PROJECT_ID',
      'projectId',
      'identificador de projeto inválido',
    );
  }
}

function requireExpectedVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw applicationFailure(
      'INVALID_EXPECTED_VERSION',
      'expectedVersion',
      'deve ser inteiro positivo',
    );
  }
}

function requireRecord(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw applicationFailure('INVALID_TYPE', field, 'deve ser um objeto');
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      throw applicationFailure(
        'UNKNOWN_FIELD',
        `${field}.${key}`,
        'campo não permitido',
      );
  }
  for (const key of allowed) {
    if (!(key in value))
      throw applicationFailure('REQUIRED_FIELD', key, 'campo obrigatório');
  }
}

function rejectSensitiveFields(value: unknown) {
  const sensitive =
    /^(?:access|refresh)?token$|^api[_-]?key$|authorization|client[_-]?secret|credential|password|private[_-]?key|secret/i;
  const seen = new WeakSet();
  function visit(current: unknown, path: string) {
    if (!current || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (sensitive.test(key.replace(/[^a-zA-Z_-]/g, ''))) {
        throw applicationFailure(
          'SENSITIVE_FIELD_REJECTED',
          childPath,
          'credenciais, tokens e segredos não pertencem ao comando',
        );
      }
      visit(child, childPath);
    }
  }
  visit(value, '');
}

function asApplicationError(caught: unknown) {
  if (caught instanceof ProjectApplicationError) return caught;
  if (caught instanceof ContractValidationError) {
    return applicationFailure(
      caught.code,
      caught.path,
      'payload de projeto inválido',
      { cause: caught },
    );
  }
  if (caught instanceof ProjectRepositoryError) {
    return applicationFailure(
      caught.code,
      caught.field,
      'comando de projeto rejeitado',
      { cause: caught },
    );
  }
  return caught;
}

function applicationFailure(
  code: string,
  field: string,
  message: string,
  options?: ErrorOptions,
) {
  return new ProjectApplicationError(code, field, message, options);
}
