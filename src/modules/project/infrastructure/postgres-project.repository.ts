import type { PoolClient, QueryResultRow } from 'pg';
import { PostgresDatabase } from '../../../infrastructure/database/postgres/index.js';
import {
  createProjectSnapshot,
  validateProjectSnapshot,
} from '../domain/project-contracts.js';
import type { ProjectSnapshot } from '../domain/project-contracts.js';
import { ProjectRepositoryError } from '../domain/project.errors.js';
import { assertProjectTransition } from '../domain/project-rules.js';
import type {
  CommandRecord,
  CommandResult,
  ProjectActions,
  ProjectRecord,
  ProjectRepository,
} from '../application/ports/project-repository.port.js';

interface ProjectRow extends QueryResultRow {
  id: string;
  latest_version: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  snapshot_json?: string;
}

/** A logical handle. Connections belong to the infrastructure pool, never this handle. */
export class PostgresProjectRepository implements ProjectRepository<true> {
  #closed = false;

  constructor(
    private readonly database: PostgresDatabase,
    private readonly readOnly = false,
  ) {}

  async create(value: unknown, { createdAt = new Date().toISOString() } = {}) {
    const snapshot = normalizeSnapshot(value);
    if (snapshot.project.version !== 1)
      throw failure(
        'PROJECT_VERSION_CONFLICT',
        'project.version',
        'um projeto novo deve começar na versão 1',
      );
    requireTimestamp(createdAt, 'createdAt');
    return this.#transaction((client) =>
      this.#create(client, snapshot, createdAt),
    );
  }

  async createVersion(
    value: unknown,
    {
      expectedVersion,
      createdAt = new Date().toISOString(),
    }: { expectedVersion: number; createdAt?: string },
  ) {
    const snapshot = normalizeSnapshot(value);
    requireVersion(
      expectedVersion,
      'expectedVersion',
      'INVALID_EXPECTED_VERSION',
    );
    requireTimestamp(createdAt, 'createdAt');
    return this.#transaction((client) =>
      this.#createVersion(client, snapshot, expectedVersion, createdAt),
    );
  }

  async archive(
    projectId: string,
    {
      expectedVersion,
      archivedAt = new Date().toISOString(),
    }: { expectedVersion: number; archivedAt?: string },
  ) {
    requireProjectId(projectId);
    requireVersion(
      expectedVersion,
      'expectedVersion',
      'INVALID_EXPECTED_VERSION',
    );
    requireTimestamp(archivedAt, 'archivedAt');
    return this.#transaction((client) =>
      this.#archive(client, projectId, expectedVersion, archivedAt),
    );
  }

  async get(
    projectId: string,
    version?: number,
  ): Promise<ProjectSnapshot | null> {
    this.#assertOpen();
    requireProjectId(projectId);
    if (version !== undefined) requireVersion(version, 'project.version');
    const result =
      version === undefined
        ? await this.database.query<{ snapshot_json: string }>(
            'SELECT snapshot_json::text AS snapshot_json FROM project.project_snapshots WHERE project_id=$1 ORDER BY version DESC LIMIT 1',
            [projectId],
          )
        : await this.database.query<{ snapshot_json: string }>(
            'SELECT snapshot_json::text AS snapshot_json FROM project.project_snapshots WHERE project_id=$1 AND version=$2',
            [projectId, version],
          );
    return result.rows[0]
      ? normalizeSnapshot(JSON.parse(result.rows[0].snapshot_json))
      : null;
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    this.#assertOpen();
    requireProjectId(projectId);
    const result = await this.database.query<ProjectRow>(
      `SELECT p.id,p.latest_version,p.archived_at,p.created_at,p.updated_at,s.snapshot_json::text AS snapshot_json
       FROM project.projects p JOIN project.project_snapshots s ON s.project_id=p.id AND s.version=p.latest_version WHERE p.id=$1`,
      [projectId],
    );
    return result.rows[0] ? projectRecord(result.rows[0]) : null;
  }

  async listProjects(): Promise<ProjectRecord[]> {
    this.#assertOpen();
    const result = await this.database.query<ProjectRow>(
      `SELECT p.id,p.latest_version,p.archived_at,p.created_at,p.updated_at,s.snapshot_json::text AS snapshot_json
       FROM project.projects p JOIN project.project_snapshots s ON s.project_id=p.id AND s.version=p.latest_version ORDER BY p.updated_at DESC,p.id`,
    );
    return result.rows.map(projectRecord);
  }

  async listProjectVersions(projectId: string): Promise<ProjectSnapshot[]> {
    this.#assertOpen();
    requireProjectId(projectId);
    const result = await this.database.query<{ snapshot_json: string }>(
      'SELECT snapshot_json::text AS snapshot_json FROM project.project_snapshots WHERE project_id=$1 ORDER BY version',
      [projectId],
    );
    return result.rows.map((row) =>
      normalizeSnapshot(JSON.parse(row.snapshot_json)),
    );
  }

  async executeCommand<T extends CommandResult>(
    record: CommandRecord,
    operation: (actions: ProjectActions<true>) => Promise<T>,
  ): Promise<T> {
    requireCommandRecord(record);
    if (typeof operation !== 'function')
      throw failure(
        'INVALID_COMMAND_OPERATION',
        'operation',
        'operação obrigatória',
      );
    return this.#transaction(async (client) => {
      // Lock before lookup: a concurrent identical request must observe the committed receipt.
      await client.query(
        'SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',
        ['mktauto.project.command:' + record.idempotencyKey],
      );
      const prior = await client.query<{
        command_type: string;
        payload_hash: string;
        result_json: string;
      }>(
        'SELECT command_type,payload_hash,result_json::text AS result_json FROM project.project_commands WHERE idempotency_key=$1',
        [record.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (
          prior.rows[0].command_type !== record.commandType ||
          prior.rows[0].payload_hash !== record.payloadHash
        )
          throw failure(
            'IDEMPOTENCY_KEY_REUSED',
            'idempotencyKey',
            'a chave já foi usada por outro comando ou conteúdo',
          );
        return commandResult(
          prior.rows[0].command_type,
          prior.rows[0].result_json,
        ) as T;
      }
      let active = true;
      const assertActive = () => {
        if (!active)
          throw failure(
            'PROJECT_TRANSACTION_CLOSED',
            'operation',
            'transação encerrada',
          );
      };
      const actions: ProjectActions<true> = Object.freeze({
        create: async (value: ProjectSnapshot) => {
          assertActive();
          return this.#create(
            client,
            normalizeSnapshot(value),
            record.occurredAt,
          );
        },
        createVersion: async (
          value: ProjectSnapshot,
          expectedVersion: number,
        ) => {
          assertActive();
          requireVersion(
            expectedVersion,
            'expectedVersion',
            'INVALID_EXPECTED_VERSION',
          );
          return this.#createVersion(
            client,
            normalizeSnapshot(value),
            expectedVersion,
            record.occurredAt,
          );
        },
        archive: async (projectId: string, expectedVersion: number) => {
          assertActive();
          requireProjectId(projectId);
          requireVersion(
            expectedVersion,
            'expectedVersion',
            'INVALID_EXPECTED_VERSION',
          );
          return this.#archive(
            client,
            projectId,
            expectedVersion,
            record.occurredAt,
          );
        },
      });
      try {
        const result = await operation(actions);
        const reference = commandResultReference(result);
        const resultJson = JSON.stringify(result);
        await client.query(
          `INSERT INTO project.project_commands
           (idempotency_key,command_type,payload_hash,actor,occurred_at,project_id,project_version,result_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::json)`,
          [
            record.idempotencyKey,
            record.commandType,
            record.payloadHash,
            record.actor,
            record.occurredAt,
            reference.projectId,
            reference.projectVersion,
            resultJson,
          ],
        );
        return commandResult(record.commandType, resultJson) as T;
      } finally {
        active = false;
      }
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
  }

  #assertOpen() {
    if (this.#closed)
      throw failure(
        'PROJECT_REPOSITORY_CLOSED',
        'repository',
        'repositório encerrado',
      );
  }

  async #transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    this.#assertOpen();
    if (this.readOnly)
      throw failure(
        'PROJECT_READ_ONLY',
        'repository',
        'repositório somente leitura',
      );
    try {
      return await this.database.transaction(operation);
    } catch (caught) {
      throw mapPostgresError(caught);
    }
  }

  async #create(
    client: PoolClient,
    snapshot: ProjectSnapshot,
    createdAt: string,
  ) {
    try {
      await client.query(
        'INSERT INTO project.projects (id,latest_version,archived_at,created_at,updated_at) VALUES ($1,$2,NULL,$3,$3)',
        [snapshot.project.id, snapshot.project.version, createdAt],
      );
    } catch (caught) {
      if (sqlState(caught) === '23505')
        throw failure(
          'PROJECT_ID_CONFLICT',
          'project.id',
          'identificador já existente',
        );
      throw caught;
    }
    await this.#insertSnapshot(client, snapshot, createdAt);
    return this.#readSnapshot(
      client,
      snapshot.project.id,
      snapshot.project.version,
    );
  }

  async #createVersion(
    client: PoolClient,
    snapshot: ProjectSnapshot,
    expectedVersion: number,
    createdAt: string,
  ) {
    const project = await this.#lockProject(client, snapshot.project.id);
    assertProjectTransition(
      project && {
        latestVersion: versionNumber(project.latest_version),
        archivedAt: project.archived_at,
      },
      expectedVersion,
      snapshot.project.version,
    );
    await this.#insertSnapshot(client, snapshot, createdAt);
    const changed = await client.query(
      'UPDATE project.projects SET latest_version=$1,updated_at=$2 WHERE id=$3 AND latest_version=$4 AND archived_at IS NULL',
      [
        snapshot.project.version,
        createdAt,
        snapshot.project.id,
        expectedVersion,
      ],
    );
    if (changed.rowCount !== 1)
      throw failure(
        'EXPECTED_VERSION_MISMATCH',
        'expectedVersion',
        'o projeto foi alterado concorrentemente',
      );
    return this.#readSnapshot(
      client,
      snapshot.project.id,
      snapshot.project.version,
    );
  }

  async #archive(
    client: PoolClient,
    projectId: string,
    expectedVersion: number,
    archivedAt: string,
  ) {
    const project = await this.#lockProject(client, projectId);
    assertProjectTransition(
      project && {
        latestVersion: versionNumber(project.latest_version),
        archivedAt: project.archived_at,
      },
      expectedVersion,
    );
    const changed = await client.query(
      'UPDATE project.projects SET archived_at=$1,updated_at=$1 WHERE id=$2 AND latest_version=$3 AND archived_at IS NULL',
      [archivedAt, projectId, expectedVersion],
    );
    if (changed.rowCount !== 1)
      throw failure(
        'EXPECTED_VERSION_MISMATCH',
        'expectedVersion',
        'o projeto foi alterado concorrentemente',
      );
    const row = await client.query<ProjectRow>(
      `SELECT p.id,p.latest_version,p.archived_at,p.created_at,p.updated_at,s.snapshot_json::text AS snapshot_json
       FROM project.projects p JOIN project.project_snapshots s ON s.project_id=p.id AND s.version=p.latest_version WHERE p.id=$1`,
      [projectId],
    );
    return projectRecord(row.rows[0]!);
  }

  async #insertSnapshot(
    client: PoolClient,
    snapshot: ProjectSnapshot,
    createdAt: string,
  ) {
    try {
      await client.query(
        'INSERT INTO project.project_snapshots (project_id,version,schema_version,snapshot_json,created_at) VALUES ($1,$2,$3,$4::json,$5)',
        [
          snapshot.project.id,
          snapshot.project.version,
          snapshot.schemaVersion,
          JSON.stringify(snapshot),
          createdAt,
        ],
      );
    } catch (caught) {
      if (sqlState(caught) === '23505')
        throw failure(
          'PROJECT_VERSION_CONFLICT',
          'project.version',
          'versão já existente',
        );
      throw caught;
    }
  }

  async #lockProject(client: PoolClient, projectId: string) {
    const result = await client.query<ProjectRow>(
      'SELECT id,latest_version,archived_at,created_at,updated_at FROM project.projects WHERE id=$1 FOR UPDATE',
      [projectId],
    );
    return result.rows[0];
  }

  async #readSnapshot(client: PoolClient, projectId: string, version: number) {
    const result = await client.query<{ snapshot_json: string }>(
      'SELECT snapshot_json::text AS snapshot_json FROM project.project_snapshots WHERE project_id=$1 AND version=$2',
      [projectId, version],
    );
    return normalizeSnapshot(JSON.parse(result.rows[0]!.snapshot_json));
  }
}

function normalizeSnapshot(value: unknown) {
  return value &&
    typeof value === 'object' &&
    'project' in value &&
    value.project
    ? validateProjectSnapshot(value)
    : createProjectSnapshot(value);
}
function requireProjectId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '')
    throw failure(
      'INVALID_PROJECT_ID',
      'project.id',
      'identificador obrigatório',
    );
}
function requireVersion(
  value: unknown,
  field: string,
  code = 'INVALID_PROJECT_VERSION',
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1)
    throw failure(code, field, 'deve ser inteiro positivo');
}
function versionNumber(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw failure(
      'INVALID_PROJECT_VERSION',
      'project.version',
      'versão persistida fora do contrato',
    );
  return number;
}
function requireTimestamp(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw failure(
      'INVALID_TIMESTAMP',
      field,
      'use um instante ISO 8601 válido',
    );
}
function requireCommandRecord(record: CommandRecord) {
  if (
    typeof record.idempotencyKey !== 'string' ||
    record.idempotencyKey.trim() === ''
  )
    throw failure(
      'INVALID_IDEMPOTENCY_KEY',
      'idempotencyKey',
      'chave obrigatória',
    );
  if (
    !['CREATE_PROJECT', 'CREATE_PROJECT_VERSION', 'ARCHIVE_PROJECT'].includes(
      record.commandType,
    )
  )
    throw failure(
      'INVALID_COMMAND_TYPE',
      'commandType',
      'tipo de comando inválido',
    );
  if (
    typeof record.payloadHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.payloadHash)
  )
    throw failure(
      'INVALID_PAYLOAD_HASH',
      'payloadHash',
      'hash SHA-256 inválido',
    );
  if (typeof record.actor !== 'string' || record.actor.trim() === '')
    throw failure('INVALID_ACTOR', 'actor', 'ator obrigatório');
  requireTimestamp(record.occurredAt, 'occurredAt');
}
function commandResultReference(result: CommandResult) {
  if (result && 'project' in result)
    return {
      projectId: result.project.id,
      projectVersion: result.project.version,
    };
  if (result && 'snapshot' in result)
    return { projectId: result.id, projectVersion: result.latestVersion };
  throw failure(
    'INVALID_COMMAND_RESULT',
    'result',
    'resultado não referencia um snapshot de projeto',
  );
}
function commandResult(commandType: string, resultJson: string): CommandResult {
  const parsed = JSON.parse(resultJson);
  if (commandType !== 'ARCHIVE_PROJECT') return validateProjectSnapshot(parsed);
  const snapshot = validateProjectSnapshot(parsed.snapshot);
  if (
    parsed.id !== snapshot.project.id ||
    parsed.latestVersion !== snapshot.project.version
  )
    throw failure(
      'INVALID_COMMAND_RESULT',
      'result',
      'resultado de arquivamento inconsistente',
    );
  requireTimestamp(parsed.createdAt, 'result.createdAt');
  requireTimestamp(parsed.updatedAt, 'result.updatedAt');
  requireTimestamp(parsed.archivedAt, 'result.archivedAt');
  return Object.freeze({
    id: parsed.id,
    latestVersion: parsed.latestVersion,
    archivedAt: parsed.archivedAt,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    snapshot,
  });
}
function projectRecord(row: ProjectRow): ProjectRecord {
  return Object.freeze({
    id: row.id,
    latestVersion: versionNumber(row.latest_version),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    snapshot: normalizeSnapshot(JSON.parse(row.snapshot_json!)),
  });
}
function failure(code: string, field: string, message: string) {
  return new ProjectRepositoryError(code, field, message);
}
function sqlState(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    if ('sqlState' in error && typeof error.sqlState === 'string')
      return error.sqlState;
    if ('code' in error && typeof error.code === 'string') return error.code;
  }
}
function mapPostgresError(error: unknown) {
  if (sqlState(error) === 'P1001')
    return failure(
      'IMMUTABLE_PROJECT_SNAPSHOT',
      'project.version',
      'snapshot persistido não pode ser alterado',
    );
  if (sqlState(error) === 'P1002')
    return failure(
      'IMMUTABLE_PROJECT_COMMAND',
      'idempotencyKey',
      'comando persistido não pode ser alterado',
    );
  return error;
}
