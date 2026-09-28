import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createProjectSnapshot, validateProjectSnapshot } from "./domain/project-contracts.js";

const PROJECT_SCHEMA_VERSION = 20;
const MIGRATIONS = new Map([
  [1, ["001_trend_catalog", migration("001_trend_catalog.sql")]],
  [2, ["002_daily_catalog", migration("002_daily_catalog.sql")]],
  [3, ["003_project_catalog", migration("003_project_catalog.sql")]],
  [4, ["004_project_commands", migration("004_project_commands.sql")]],
  [5, ["005_research_daily", migration("005_research_daily.sql")]],
  [6, ["006_reference_analysis", migration("006_reference_analysis.sql")]],
  [7, ["007_research_shortlist", migration("007_research_shortlist.sql")]],
  [8, ["008_pipeline_runs", migration("008_pipeline_runs.sql")]],
  [9, ["009_artifact_lineage", migration("009_artifact_lineage.sql")]],
  [10, ["010_cost_ledger", migration("010_cost_ledger.sql")]],
  [11, ["011_content_intelligence", migration("011_content_intelligence.sql")]],
  [12, ["012_idea_selection", migration("012_idea_selection.sql")]],
  [13, ["013_scripts", migration("013_scripts.sql")]],
  [14, ["014_script_generation", migration("014_script_generation.sql")]],
  [15, ["015_ai_call_telemetry", migration("015_ai_call_telemetry.sql")]],
  [16, ["016_voice_tracks", migration("016_voice_tracks.sql")]],
  [17, ["017_voice_generation", migration("017_voice_generation.sql")]],
  [18, ["018_media_assets", migration("018_media_assets.sql")]],
  [19, ["019_media_acquisition", migration("019_media_acquisition.sql")]],
  [20, ["020_composition_plans", migration("020_composition_plans.sql")]],
]);

export class ProjectRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "ProjectRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class ProjectRepository {
  constructor(path = resolve("data/mktauto.sqlite")) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    try {
      this.#migrate();
    } catch (caught) {
      this.db.close();
      throw caught;
    }
  }

  create(value, { createdAt = new Date().toISOString() } = {}) {
    const snapshot = normalizeSnapshot(value);
    if (snapshot.project.version !== 1) {
      throw failure("PROJECT_VERSION_CONFLICT", "project.version", "um projeto novo deve começar na versão 1");
    }
    requireTimestamp(createdAt, "createdAt");
    return this.#transaction(() => this.#create(snapshot, createdAt));
  }

  createVersion(value, { expectedVersion, createdAt = new Date().toISOString() } = {}) {
    const snapshot = normalizeSnapshot(value);
    requireExpectedVersion(expectedVersion);
    requireTimestamp(createdAt, "createdAt");
    return this.#transaction(() => this.#createVersion(snapshot, expectedVersion, createdAt));
  }

  get(projectId, version) {
    requireProjectId(projectId);
    if (version !== undefined) requireVersion(version, "project.version");
    const row = version === undefined
      ? this.db.prepare(`SELECT snapshot_json FROM project_snapshots
          WHERE project_id = ? ORDER BY version DESC LIMIT 1`).get(projectId)
      : this.db.prepare(`SELECT snapshot_json FROM project_snapshots
          WHERE project_id = ? AND version = ?`).get(projectId, version);
    return row ? normalizeSnapshot(JSON.parse(row.snapshot_json)) : null;
  }

  getProject(projectId) {
    requireProjectId(projectId);
    const row = this.#project(projectId);
    if (!row) return null;
    return Object.freeze({
      id: row.id,
      latestVersion: row.latest_version,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      snapshot: this.get(row.id, row.latest_version),
    });
  }

  archive(projectId, { expectedVersion, archivedAt = new Date().toISOString() } = {}) {
    requireProjectId(projectId);
    requireExpectedVersion(expectedVersion);
    requireTimestamp(archivedAt, "archivedAt");
    return this.#transaction(() => this.#archive(projectId, expectedVersion, archivedAt));
  }

  executeCommand({ idempotencyKey, commandType, payloadHash, actor, occurredAt }, operation) {
    requireCommandRecord({ idempotencyKey, commandType, payloadHash, actor, occurredAt });
    if (typeof operation !== "function") {
      throw failure("INVALID_COMMAND_OPERATION", "operation", "operação obrigatória");
    }
    return this.#transaction(() => {
      const prior = this.db.prepare(`SELECT command_type, payload_hash, result_json
        FROM project_commands WHERE idempotency_key = ?`).get(idempotencyKey);
      if (prior) {
        if (prior.command_type !== commandType || prior.payload_hash !== payloadHash) {
          throw failure("IDEMPOTENCY_KEY_REUSED", "idempotencyKey", "a chave já foi usada por outro comando ou conteúdo");
        }
        return commandResult(prior.command_type, prior.result_json);
      }

      const actions = Object.freeze({
        create: (value) => this.#create(normalizeSnapshot(value), occurredAt),
        createVersion: (value, expectedVersion) => {
          requireExpectedVersion(expectedVersion);
          return this.#createVersion(normalizeSnapshot(value), expectedVersion, occurredAt);
        },
        archive: (projectId, expectedVersion) => {
          requireProjectId(projectId);
          requireExpectedVersion(expectedVersion);
          return this.#archive(projectId, expectedVersion, occurredAt);
        },
      });
      const result = operation(actions);
      const reference = commandResultReference(result);
      const resultJson = JSON.stringify(result);
      this.db.prepare(`INSERT INTO project_commands
        (idempotency_key, command_type, payload_hash, actor, occurred_at,
         project_id, project_version, result_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(idempotencyKey, commandType, payloadHash, actor, occurredAt,
          reference.projectId, reference.projectVersion, resultJson);
      return commandResult(commandType, resultJson);
    });
  }

  close() {
    this.db.close();
  }

  #create(snapshot, createdAt) {
    this.db.prepare(`INSERT INTO projects
      (id, latest_version, archived_at, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)`)
      .run(snapshot.project.id, snapshot.project.version, createdAt, createdAt);
    this.#insertSnapshot(snapshot, createdAt);
    return this.get(snapshot.project.id, snapshot.project.version);
  }

  #createVersion(snapshot, expectedVersion, createdAt) {
    const project = this.#project(snapshot.project.id);
    if (!project) throw failure("PROJECT_NOT_FOUND", "project.id", "projeto não encontrado");
    if (project.archived_at) throw failure("PROJECT_ARCHIVED", "project.id", "projeto arquivado não aceita versões");
    if (project.latest_version !== expectedVersion) {
      throw failure("EXPECTED_VERSION_MISMATCH", "expectedVersion", `esperada ${expectedVersion}; atual ${project.latest_version}`);
    }
    if (snapshot.project.version !== expectedVersion + 1) {
      throw failure("PROJECT_VERSION_CONFLICT", "project.version", "a nova versão deve suceder a versão esperada");
    }

    this.#insertSnapshot(snapshot, createdAt);
    const result = this.db.prepare(`UPDATE projects SET latest_version = ?, updated_at = ?
      WHERE id = ? AND latest_version = ? AND archived_at IS NULL`)
      .run(snapshot.project.version, createdAt, snapshot.project.id, expectedVersion);
    if (result.changes !== 1) {
      throw failure("EXPECTED_VERSION_MISMATCH", "expectedVersion", "o projeto foi alterado concorrentemente");
    }
    return this.get(snapshot.project.id, snapshot.project.version);
  }

  #archive(projectId, expectedVersion, archivedAt) {
    const project = this.#project(projectId);
    if (!project) throw failure("PROJECT_NOT_FOUND", "project.id", "projeto não encontrado");
    if (project.archived_at) throw failure("PROJECT_ARCHIVED", "project.id", "projeto já arquivado");
    if (project.latest_version !== expectedVersion) {
      throw failure("EXPECTED_VERSION_MISMATCH", "expectedVersion", `esperada ${expectedVersion}; atual ${project.latest_version}`);
    }
    const result = this.db.prepare(`UPDATE projects SET archived_at = ?, updated_at = ?
      WHERE id = ? AND latest_version = ? AND archived_at IS NULL`)
      .run(archivedAt, archivedAt, projectId, expectedVersion);
    if (result.changes !== 1) {
      throw failure("EXPECTED_VERSION_MISMATCH", "expectedVersion", "o projeto foi alterado concorrentemente");
    }
    return this.getProject(projectId);
  }

  #insertSnapshot(snapshot, createdAt) {
    this.db.prepare(`INSERT INTO project_snapshots
      (project_id, version, schema_version, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(snapshot.project.id, snapshot.project.version, snapshot.schemaVersion, JSON.stringify(snapshot), createdAt);
  }

  #project(projectId) {
    return this.db.prepare(`SELECT id, latest_version, archived_at, created_at, updated_at
      FROM projects WHERE id = ?`).get(projectId);
  }

  #migrate() {
    const current = this.db.prepare("PRAGMA user_version").get().user_version;
    if (current > PROJECT_SCHEMA_VERSION) {
      throw failure("PROJECT_SCHEMA_VERSION_UNSUPPORTED", "schemaVersion", `versão ${current}; máximo suportado ${PROJECT_SCHEMA_VERSION}`);
    }
    try {
      this.db.exec("BEGIN IMMEDIATE");
      for (let version = current + 1; version <= PROJECT_SCHEMA_VERSION; version += 1) {
        const [name, sql] = MIGRATIONS.get(version) ?? [];
        if (!name) throw new Error(`migração ${version} ausente`);
        this.db.exec(sql);
        this.db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
          .run(version, name, new Date().toISOString());
        this.db.exec(`PRAGMA user_version = ${version}`);
      }
      this.db.exec("COMMIT");
    } catch (caught) {
      this.#rollback();
      if (caught instanceof ProjectRepositoryError) throw caught;
      throw failure("PROJECT_MIGRATION_FAILED", "schemaVersion", "migração não aplicada", { cause: caught });
    }
  }

  #transaction(operation) {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (caught) {
      this.#rollback();
      throw mapSqliteError(caught);
    }
  }

  #rollback() {
    if (this.db.isTransaction) this.db.exec("ROLLBACK");
  }
}

function normalizeSnapshot(value) {
  if (value?.project) return validateProjectSnapshot(value);
  return createProjectSnapshot(value);
}

function migration(name) {
  return readFileSync(new URL(`./db/migrations/${name}`, import.meta.url), "utf8");
}

function requireProjectId(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw failure("INVALID_PROJECT_ID", "project.id", "identificador obrigatório");
  }
}

function requireExpectedVersion(value) {
  requireVersion(value, "expectedVersion", "INVALID_EXPECTED_VERSION");
}

function requireVersion(value, field, code = "INVALID_PROJECT_VERSION") {
  if (!Number.isInteger(value) || value < 1) throw failure(code, field, "deve ser inteiro positivo");
}

function requireTimestamp(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw failure("INVALID_TIMESTAMP", field, "use um instante ISO 8601 válido");
  }
}

function requireCommandRecord({ idempotencyKey, commandType, payloadHash, actor, occurredAt }) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
    throw failure("INVALID_IDEMPOTENCY_KEY", "idempotencyKey", "chave obrigatória");
  }
  if (!["CREATE_PROJECT", "CREATE_PROJECT_VERSION", "ARCHIVE_PROJECT"].includes(commandType)) {
    throw failure("INVALID_COMMAND_TYPE", "commandType", "tipo de comando inválido");
  }
  if (typeof payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(payloadHash)) {
    throw failure("INVALID_PAYLOAD_HASH", "payloadHash", "hash SHA-256 inválido");
  }
  if (typeof actor !== "string" || actor.trim() === "") {
    throw failure("INVALID_ACTOR", "actor", "ator obrigatório");
  }
  requireTimestamp(occurredAt, "occurredAt");
}

function commandResultReference(result) {
  if (result?.project) {
    return { projectId: result.project.id, projectVersion: result.project.version };
  }
  if (result?.snapshot?.project) {
    return { projectId: result.id, projectVersion: result.latestVersion };
  }
  throw failure("INVALID_COMMAND_RESULT", "result", "resultado não referencia um snapshot de projeto");
}

function commandResult(commandType, resultJson) {
  const parsed = JSON.parse(resultJson);
  if (commandType === "ARCHIVE_PROJECT") {
    const snapshot = validateProjectSnapshot(parsed.snapshot);
    if (parsed.id !== snapshot.project.id || parsed.latestVersion !== snapshot.project.version) {
      throw failure("INVALID_COMMAND_RESULT", "result", "resultado de arquivamento inconsistente");
    }
    requireTimestamp(parsed.createdAt, "result.createdAt");
    requireTimestamp(parsed.updatedAt, "result.updatedAt");
    requireTimestamp(parsed.archivedAt, "result.archivedAt");
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

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function failure(code, field, message, options) {
  return new ProjectRepositoryError(code, field, message, options);
}

function mapSqliteError(caught) {
  if (caught instanceof ProjectRepositoryError) return caught;
  const message = String(caught?.message);
  if (message.includes("UNIQUE constraint failed: projects.id")) {
    return failure("PROJECT_ID_CONFLICT", "project.id", "identificador já existente", { cause: caught });
  }
  if (message.includes("UNIQUE constraint failed: project_snapshots")) {
    return failure("PROJECT_VERSION_CONFLICT", "project.version", "versão já existente", { cause: caught });
  }
  if (message.includes("IMMUTABLE_PROJECT_SNAPSHOT")) {
    return failure("IMMUTABLE_PROJECT_SNAPSHOT", "project.version", "snapshot persistido não pode ser alterado", { cause: caught });
  }
  if (message.includes("IMMUTABLE_PROJECT_COMMAND")) {
    return failure("IMMUTABLE_PROJECT_COMMAND", "idempotencyKey", "comando persistido não pode ser alterado", { cause: caught });
  }
  return caught;
}

export { PROJECT_SCHEMA_VERSION };
