import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import {
  createProjectSnapshot,
  validateProjectSnapshot,
} from '../domain/project-contracts.js';
import type { ProjectSnapshot } from '../domain/project-contracts.js';
import { ProjectRepositoryError } from '../domain/project.errors.js';
import { assertProjectTransition } from '../domain/project-rules.js';
import type {
  ProjectRepository,
  ProjectActions,
  CommandRecord,
  CommandResult,
} from '../application/ports/project-repository.port.js';
export class SqliteProjectRepository implements ProjectRepository {
  readonly db: DatabaseSync;
  constructor(path: string, { readOnly = false }: { readOnly?: boolean } = {}) {
    if (!isAbsolute(path))
      throw new Error('PROJECT_API_DATABASE must be an explicit absolute path');
    const preflight = new DatabaseSync(path, { readOnly: true });
    try {
      if (
        ![39, 40, 41, 42].includes(
          Number(preflight.prepare('PRAGMA user_version').get()?.user_version),
        ) ||
        (Number(preflight.prepare('PRAGMA user_version').get()?.user_version) >=
          41 &&
          preflight
            .prepare('SELECT name FROM schema_migrations WHERE version=41')
            .get()?.name !== '041_campaign_orchestration')
      )
        throw failure(
          'PROJECT_SCHEMA_VERSION_UNSUPPORTED',
          'schemaVersion',
          'pré-verificação exige schema existente atualizado',
        );
    } finally {
      preflight.close();
    }
    this.db = new DatabaseSync(path, { readOnly });
    try {
      if (readOnly) this.db.exec('PRAGMA query_only = ON;');
      else
        this.db.exec(
          'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;',
        );
    } catch (caught) {
      this.db.close();
      throw caught;
    }
  }

  create(
    value: unknown,
    { createdAt = new Date().toISOString() }: { createdAt?: string } = {},
  ) {
    const snapshot = normalizeSnapshot(value);
    if (snapshot.project.version !== 1) {
      throw failure(
        'PROJECT_VERSION_CONFLICT',
        'project.version',
        'um projeto novo deve começar na versão 1',
      );
    }
    requireTimestamp(createdAt, 'createdAt');
    return this.#transaction(() => this.#create(snapshot, createdAt));
  }

  createVersion(
    value: unknown,
    {
      expectedVersion,
      createdAt = new Date().toISOString(),
    }: { expectedVersion: number; createdAt?: string },
  ) {
    const snapshot = normalizeSnapshot(value);
    requireExpectedVersion(expectedVersion);
    requireTimestamp(createdAt, 'createdAt');
    return this.#transaction(() =>
      this.#createVersion(snapshot, expectedVersion, createdAt),
    );
  }

  get(projectId: string, version?: number) {
    requireProjectId(projectId);
    if (version !== undefined) requireVersion(version, 'project.version');
    const row =
      version === undefined
        ? this.db
            .prepare(
              `SELECT snapshot_json FROM project_snapshots
          WHERE project_id = ? ORDER BY version DESC LIMIT 1`,
            )
            .get(projectId)
        : this.db
            .prepare(
              `SELECT snapshot_json FROM project_snapshots
          WHERE project_id = ? AND version = ?`,
            )
            .get(projectId, version);
    return row
      ? normalizeSnapshot(JSON.parse(String(row.snapshot_json)))
      : null;
  }

  getProject(projectId: string) {
    requireProjectId(projectId);
    const row = this.#project(projectId);
    if (!row) return null;
    return Object.freeze({
      id: row.id,
      latestVersion: row.latest_version,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      snapshot: this.get(row.id, row.latest_version)!,
    });
  }

  listProjects() {
    return this.db
      .prepare('SELECT id FROM projects ORDER BY updated_at DESC, id')
      .all()
      .map(({ id }) => this.getProject(String(id)));
  }

  listProjectVersions(projectId: string) {
    requireProjectId(projectId);
    return this.db
      .prepare(
        `SELECT version FROM project_snapshots
      WHERE project_id = ? ORDER BY version`,
      )
      .all(projectId)
      .map(({ version }) => this.get(projectId, Number(version)));
  }

  archive(
    projectId: string,
    {
      expectedVersion,
      archivedAt = new Date().toISOString(),
    }: { expectedVersion: number; archivedAt?: string },
  ) {
    requireProjectId(projectId);
    requireExpectedVersion(expectedVersion);
    requireTimestamp(archivedAt, 'archivedAt');
    return this.#transaction(() =>
      this.#archive(projectId, expectedVersion, archivedAt),
    );
  }

  executeCommand<T extends CommandResult>(
    {
      idempotencyKey,
      commandType,
      payloadHash,
      actor,
      occurredAt,
    }: CommandRecord,
    operation: (actions: ProjectActions) => T,
  ): T {
    requireCommandRecord({
      idempotencyKey,
      commandType,
      payloadHash,
      actor,
      occurredAt,
    });
    if (typeof operation !== 'function') {
      throw failure(
        'INVALID_COMMAND_OPERATION',
        'operation',
        'operação obrigatória',
      );
    }
    return this.#transaction(() => {
      const prior = this.db
        .prepare(
          `SELECT command_type, payload_hash, result_json
        FROM project_commands WHERE idempotency_key = ?`,
        )
        .get(idempotencyKey);
      if (prior) {
        if (
          prior.command_type !== commandType ||
          prior.payload_hash !== payloadHash
        ) {
          throw failure(
            'IDEMPOTENCY_KEY_REUSED',
            'idempotencyKey',
            'a chave já foi usada por outro comando ou conteúdo',
          );
        }
        return commandResult(
          String(prior.command_type),
          String(prior.result_json),
        ) as T;
      }

      const actions: ProjectActions = Object.freeze({
        create: (value: ProjectSnapshot) =>
          this.#create(normalizeSnapshot(value), occurredAt),
        createVersion: (value: ProjectSnapshot, expectedVersion: number) => {
          requireExpectedVersion(expectedVersion);
          return this.#createVersion(
            normalizeSnapshot(value),
            expectedVersion,
            occurredAt,
          );
        },
        archive: (projectId: string, expectedVersion: number) => {
          requireProjectId(projectId);
          requireExpectedVersion(expectedVersion);
          return this.#archive(projectId, expectedVersion, occurredAt);
        },
      });
      const result = operation(actions);
      const reference = commandResultReference(result);
      const resultJson = JSON.stringify(result);
      this.db
        .prepare(
          `INSERT INTO project_commands
        (idempotency_key, command_type, payload_hash, actor, occurred_at,
         project_id, project_version, result_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          idempotencyKey,
          commandType,
          payloadHash,
          actor,
          occurredAt,
          reference.projectId,
          reference.projectVersion,
          resultJson,
        );
      return commandResult(commandType, resultJson) as T;
    });
  }

  close() {
    this.db.close();
  }

  #create(snapshot: ProjectSnapshot, createdAt: string) {
    this.db
      .prepare(
        `INSERT INTO projects
      (id, latest_version, archived_at, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)`,
      )
      .run(snapshot.project.id, snapshot.project.version, createdAt, createdAt);
    this.#insertSnapshot(snapshot, createdAt);
    return this.get(snapshot.project.id, snapshot.project.version)!;
  }

  #createVersion(
    snapshot: ProjectSnapshot,
    expectedVersion: number,
    createdAt: string,
  ) {
    const project = this.#project(snapshot.project.id);
    assertProjectTransition(
      project && {
        latestVersion: project.latest_version,
        archivedAt: project.archived_at,
      },
      expectedVersion,
      snapshot.project.version,
    );

    this.#insertSnapshot(snapshot, createdAt);
    const result = this.db
      .prepare(
        `UPDATE projects SET latest_version = ?, updated_at = ?
      WHERE id = ? AND latest_version = ? AND archived_at IS NULL`,
      )
      .run(
        snapshot.project.version,
        createdAt,
        snapshot.project.id,
        expectedVersion,
      );
    if (result.changes !== 1) {
      throw failure(
        'EXPECTED_VERSION_MISMATCH',
        'expectedVersion',
        'o projeto foi alterado concorrentemente',
      );
    }
    return this.get(snapshot.project.id, snapshot.project.version)!;
  }

  #archive(projectId: string, expectedVersion: number, archivedAt: string) {
    const project = this.#project(projectId);
    assertProjectTransition(
      project && {
        latestVersion: project.latest_version,
        archivedAt: project.archived_at,
      },
      expectedVersion,
    );
    const result = this.db
      .prepare(
        `UPDATE projects SET archived_at = ?, updated_at = ?
      WHERE id = ? AND latest_version = ? AND archived_at IS NULL`,
      )
      .run(archivedAt, archivedAt, projectId, expectedVersion);
    if (result.changes !== 1) {
      throw failure(
        'EXPECTED_VERSION_MISMATCH',
        'expectedVersion',
        'o projeto foi alterado concorrentemente',
      );
    }
    return this.getProject(projectId)!;
  }

  #insertSnapshot(snapshot: ProjectSnapshot, createdAt: string) {
    this.db
      .prepare(
        `INSERT INTO project_snapshots
      (project_id, version, schema_version, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.project.id,
        snapshot.project.version,
        snapshot.schemaVersion,
        JSON.stringify(snapshot),
        createdAt,
      );
  }

  #project(projectId: string) {
    return this.db
      .prepare(
        `SELECT id, latest_version, archived_at, created_at, updated_at
      FROM projects WHERE id = ?`,
      )
      .get(projectId) as
      | {
          id: string;
          latest_version: number;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
  }

  #transaction<T>(operation: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (caught) {
      this.#rollback();
      throw mapSqliteError(caught);
    }
  }

  #rollback() {
    if (this.db.isTransaction) this.db.exec('ROLLBACK');
  }
}

function normalizeSnapshot(value: unknown) {
  if (value && typeof value === 'object' && 'project' in value && value.project)
    return validateProjectSnapshot(value);
  return createProjectSnapshot(value);
}

function requireProjectId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw failure(
      'INVALID_PROJECT_ID',
      'project.id',
      'identificador obrigatório',
    );
  }
}

function requireExpectedVersion(value: unknown): asserts value is number {
  requireVersion(value, 'expectedVersion', 'INVALID_EXPECTED_VERSION');
}

function requireVersion(
  value: unknown,
  field: string,
  code: string = 'INVALID_PROJECT_VERSION',
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1)
    throw failure(code, field, 'deve ser inteiro positivo');
}

function requireTimestamp(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw failure(
      'INVALID_TIMESTAMP',
      field,
      'use um instante ISO 8601 válido',
    );
  }
}

function requireCommandRecord({
  idempotencyKey,
  commandType,
  payloadHash,
  actor,
  occurredAt,
}: CommandRecord) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw failure(
      'INVALID_IDEMPOTENCY_KEY',
      'idempotencyKey',
      'chave obrigatória',
    );
  }
  if (
    !['CREATE_PROJECT', 'CREATE_PROJECT_VERSION', 'ARCHIVE_PROJECT'].includes(
      commandType,
    )
  ) {
    throw failure(
      'INVALID_COMMAND_TYPE',
      'commandType',
      'tipo de comando inválido',
    );
  }
  if (typeof payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(payloadHash)) {
    throw failure(
      'INVALID_PAYLOAD_HASH',
      'payloadHash',
      'hash SHA-256 inválido',
    );
  }
  if (typeof actor !== 'string' || actor.trim() === '') {
    throw failure('INVALID_ACTOR', 'actor', 'ator obrigatório');
  }
  requireTimestamp(occurredAt, 'occurredAt');
}

function commandResultReference(result: CommandResult) {
  if ('project' in result) {
    return {
      projectId: result.project.id,
      projectVersion: result.project.version,
    };
  }
  if ('snapshot' in result) {
    return { projectId: result.id, projectVersion: result.latestVersion };
  }
  throw failure(
    'INVALID_COMMAND_RESULT',
    'result',
    'resultado não referencia um snapshot de projeto',
  );
}

function commandResult(commandType: string, resultJson: string) {
  const parsed = JSON.parse(resultJson);
  if (commandType === 'ARCHIVE_PROJECT') {
    const snapshot = validateProjectSnapshot(parsed.snapshot);
    if (
      parsed.id !== snapshot.project.id ||
      parsed.latestVersion !== snapshot.project.version
    ) {
      throw failure(
        'INVALID_COMMAND_RESULT',
        'result',
        'resultado de arquivamento inconsistente',
      );
    }
    requireTimestamp(parsed.createdAt, 'result.createdAt');
    requireTimestamp(parsed.updatedAt, 'result.updatedAt');
    requireTimestamp(parsed.archivedAt, 'result.archivedAt');
    return deepFreeze({
      id: parsed.id,
      latestVersion: parsed.latestVersion,
      archivedAt: parsed.archivedAt,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      snapshot,
    });
  }
  return validateProjectSnapshot(parsed);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function failure(
  code: string,
  field: string,
  message: string,
  options?: ErrorOptions,
) {
  return new ProjectRepositoryError(code, field, message, options);
}

function mapSqliteError(caught: unknown) {
  if (caught instanceof ProjectRepositoryError) return caught;
  const message = String(caught instanceof Error ? caught.message : undefined);
  if (message.includes('UNIQUE constraint failed: projects.id')) {
    return failure(
      'PROJECT_ID_CONFLICT',
      'project.id',
      'identificador já existente',
      { cause: caught },
    );
  }
  if (message.includes('UNIQUE constraint failed: project_snapshots')) {
    return failure(
      'PROJECT_VERSION_CONFLICT',
      'project.version',
      'versão já existente',
      { cause: caught },
    );
  }
  if (message.includes('IMMUTABLE_PROJECT_SNAPSHOT')) {
    return failure(
      'IMMUTABLE_PROJECT_SNAPSHOT',
      'project.version',
      'snapshot persistido não pode ser alterado',
      { cause: caught },
    );
  }
  if (message.includes('IMMUTABLE_PROJECT_COMMAND')) {
    return failure(
      'IMMUTABLE_PROJECT_COMMAND',
      'idempotencyKey',
      'comando persistido não pode ser alterado',
      { cause: caught },
    );
  }
  return caught;
}
