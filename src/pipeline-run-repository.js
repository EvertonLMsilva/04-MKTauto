import { createHash } from "node:crypto";
import { ContractValidationError } from "./domain/contracts.js";
import {
  PIPELINE_RUN_CONTRACT_VERSION,
  sanitizePipelineRunError,
  validatePipelineRun,
} from "./domain/pipeline-run-contracts.js";
import { validateProjectSnapshot } from "./domain/project-contracts.js";
import { ProjectRepository } from "./project-repository.js";

export class PipelineRunRepositoryError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "PipelineRunRepositoryError";
    this.code = code;
    this.field = field;
  }
}

export class PipelineRunRepository extends ProjectRepository {
  startRun({ execution, projectSnapshot }) {
    const run = initialRun(execution, projectSnapshot);
    const identityHash = stableHash({
      pipelineRunId: run.pipelineRunId,
      projectId: run.projectId,
      projectVersion: run.projectVersion,
      startedAt: run.startedAt,
      projectSnapshot: run.projectSnapshot,
    });
    return this.#transaction(() => {
      const prior = this.db.prepare(`SELECT identity_hash FROM pipeline_runs
        WHERE pipeline_run_id = ?`).get(run.pipelineRunId);
      if (prior) {
        if (prior.identity_hash !== identityHash) {
          throw failure("PIPELINE_RUN_ID_REUSED", "pipelineRunId", "identidade já usada com dados incompatíveis");
        }
        return this.getRun(run.pipelineRunId);
      }

      this.db.prepare(`INSERT INTO pipeline_runs
        (pipeline_run_id, schema_version, identity_hash, project_id, project_version,
         project_snapshot_json, state, started_at, completed_at, error_json)
        VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', ?, NULL, NULL)`)
        .run(run.pipelineRunId, run.schemaVersion, identityHash, run.projectId,
          run.projectVersion, JSON.stringify(run.projectSnapshot), run.startedAt);
      this.db.prepare(`INSERT INTO pipeline_run_transitions
        (pipeline_run_id, previous_state, next_state, changed_at, error_json)
        VALUES (?, NULL, 'RUNNING', ?, NULL)`)
        .run(run.pipelineRunId, run.startedAt);
      return this.getRun(run.pipelineRunId);
    });
  }

  getRun(pipelineRunId) {
    requireIdentifier(pipelineRunId);
    const row = this.db.prepare("SELECT * FROM pipeline_runs WHERE pipeline_run_id = ?").get(pipelineRunId);
    if (!row) return null;
    const transitions = this.db.prepare(`SELECT previous_state, next_state, changed_at, error_json
      FROM pipeline_run_transitions WHERE pipeline_run_id = ? ORDER BY id`).all(pipelineRunId);
    try {
      return validatePipelineRun({
        schemaVersion: row.schema_version,
        pipelineRunId: row.pipeline_run_id,
        projectId: row.project_id,
        projectVersion: row.project_version,
        projectSnapshot: JSON.parse(row.project_snapshot_json),
        state: row.state,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: parseNullableJson(row.error_json),
        transitions: transitions.map((transition) => ({
          previousState: transition.previous_state,
          nextState: transition.next_state,
          changedAt: transition.changed_at,
          error: parseNullableJson(transition.error_json),
        })),
      });
    } catch (caught) {
      if (caught instanceof PipelineRunRepositoryError) throw caught;
      if (caught instanceof ContractValidationError || caught instanceof SyntaxError) {
        throw failure("INVALID_PERSISTED_PIPELINE_RUN", "pipelineRunId", "execução persistida inválida", { cause: caught });
      }
      throw caught;
    }
  }

  listRunsByProjectVersion(projectId, projectVersion) {
    if (typeof projectId !== "string" || projectId.length > 80 || !/^[a-z0-9][a-z0-9_-]{2,}$/.test(projectId)) {
      throw failure("INVALID_PROJECT_ID", "projectId", "identificador inválido");
    }
    if (!Number.isSafeInteger(projectVersion) || projectVersion < 1) {
      throw failure("INVALID_PROJECT_VERSION", "projectVersion", "versão inválida");
    }
    return this.db.prepare(`SELECT pipeline_run_id FROM pipeline_runs
      WHERE project_id = ? AND project_version = ? ORDER BY started_at DESC, pipeline_run_id`)
      .all(projectId, projectVersion).map(({ pipeline_run_id: id }) => this.getRun(id));
  }

  transitionRun({ pipelineRunId, nextState, completedAt, error = null }) {
    requireIdentifier(pipelineRunId);
    if (!["SUCCEEDED", "FAILED"].includes(nextState)) {
      throw failure("INVALID_PIPELINE_RUN_TRANSITION", "state", "transição terminal inválida");
    }
    const normalizedCompletedAt = requireTimestamp(completedAt, "completedAt");
    const publicError = nextState === "FAILED" ? sanitizePipelineRunError(error) : null;
    const errorJson = publicError === null ? null : JSON.stringify(publicError);
    return this.#transaction(() => {
      const prior = this.db.prepare(`SELECT state, started_at, completed_at, error_json
        FROM pipeline_runs WHERE pipeline_run_id = ?`).get(pipelineRunId);
      if (!prior) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
      if (Date.parse(normalizedCompletedAt) < Date.parse(prior.started_at)) {
        throw failure("INVALID_COMPLETED_AT", "completedAt", "término anterior ao início");
      }
      if (prior.state === nextState
        && prior.completed_at === normalizedCompletedAt
        && prior.error_json === errorJson) {
        return this.getRun(pipelineRunId);
      }
      if (prior.state !== "RUNNING") {
        throw failure("INVALID_PIPELINE_RUN_TRANSITION", "state", "estado terminal não pode ser alterado");
      }
      this.db.prepare(`UPDATE pipeline_runs SET state = ?, completed_at = ?, error_json = ?
        WHERE pipeline_run_id = ? AND state = 'RUNNING'`)
        .run(nextState, normalizedCompletedAt, errorJson, pipelineRunId);
      this.db.prepare(`INSERT INTO pipeline_run_transitions
        (pipeline_run_id, previous_state, next_state, changed_at, error_json)
        VALUES (?, 'RUNNING', ?, ?, ?)`)
        .run(pipelineRunId, nextState, normalizedCompletedAt, errorJson);
      return this.getRun(pipelineRunId);
    });
  }

  #transaction(operation) {
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (caught) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw mapSqliteError(caught);
    }
  }
}

function initialRun(execution, snapshotValue) {
  const projectSnapshot = validateProjectSnapshot(snapshotValue);
  return validatePipelineRun({
    schemaVersion: PIPELINE_RUN_CONTRACT_VERSION,
    pipelineRunId: execution?.pipelineRunId,
    projectId: execution?.projectId,
    projectVersion: execution?.projectVersion,
    projectSnapshot,
    state: "RUNNING",
    startedAt: execution?.startedAt,
    completedAt: null,
    error: null,
    transitions: [{
      previousState: null,
      nextState: "RUNNING",
      changedAt: execution?.startedAt,
      error: null,
    }],
  });
}

function requireIdentifier(value) {
  if (typeof value !== "string" || value.length > 80 || !/^[a-z0-9][a-z0-9_-]{2,}$/.test(value)) {
    throw failure("INVALID_PIPELINE_RUN_ID", "pipelineRunId", "identificador inválido");
  }
}

function requireTimestamp(value, field) {
  const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== "string" || !isoInstant.test(value) || !Number.isFinite(Date.parse(value))) {
    throw failure("INVALID_TIMESTAMP", field, "use um instante ISO 8601 válido");
  }
  return new Date(value).toISOString();
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseNullableJson(value) {
  return value === null ? null : JSON.parse(value);
}

function mapSqliteError(caught) {
  if (caught instanceof PipelineRunRepositoryError) return caught;
  const message = String(caught?.message);
  if (message.includes("FOREIGN KEY constraint failed")) {
    return failure("PROJECT_SNAPSHOT_NOT_FOUND", "projectVersion", "snapshot explícito não encontrado", { cause: caught });
  }
  if (message.includes("IMMUTABLE_PIPELINE_RUN_IDENTITY")) {
    return failure("IMMUTABLE_PIPELINE_RUN_IDENTITY", "pipelineRunId", "identidade da execução é imutável", { cause: caught });
  }
  if (message.includes("INVALID_PIPELINE_RUN_TRANSITION")) {
    return failure("INVALID_PIPELINE_RUN_TRANSITION", "state", "transição não permitida", { cause: caught });
  }
  return caught;
}

function failure(code, field, message, options) {
  return new PipelineRunRepositoryError(code, field, message, options);
}
