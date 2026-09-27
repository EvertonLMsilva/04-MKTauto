import { createHash } from "node:crypto";
import { ContractValidationError } from "./domain/contracts.js";
import { createProjectSnapshot } from "./domain/project-contracts.js";
import { ProjectRepositoryError } from "./project-repository.js";

const COMMAND_FIELDS = Object.freeze({
  CREATE_PROJECT: ["idempotencyKey", "actor", "occurredAt", "project"],
  CREATE_PROJECT_VERSION: ["idempotencyKey", "actor", "occurredAt", "expectedVersion", "project"],
  ARCHIVE_PROJECT: ["idempotencyKey", "actor", "occurredAt", "projectId", "expectedVersion"],
});

export class ProjectApplicationError extends Error {
  constructor(code, field, message, options) {
    super(`${code} em ${field}: ${message}`, options);
    this.name = "ProjectApplicationError";
    this.code = code;
    this.field = field;
  }
}

export class ProjectApplicationService {
  constructor(repository) {
    if (!repository || typeof repository.executeCommand !== "function") {
      throw applicationFailure("INVALID_REPOSITORY", "repository", "ProjectRepository obrigatório");
    }
    this.repository = repository;
  }

  createProject(command) {
    return this.#execute("CREATE_PROJECT", command, ({ project }) => {
      const snapshot = createProjectSnapshot(project);
      if (snapshot.project.version !== 1) {
        throw applicationFailure("PROJECT_VERSION_CONFLICT", "project.version", "um projeto novo deve começar na versão 1");
      }
      return {
        payload: { snapshot },
        operation: (actions) => actions.create(snapshot),
      };
    });
  }

  createProjectVersion(command) {
    return this.#execute("CREATE_PROJECT_VERSION", command, ({ project, expectedVersion }) => {
      requireExpectedVersion(expectedVersion);
      const snapshot = createProjectSnapshot(project);
      return {
        payload: { expectedVersion, snapshot },
        operation: (actions) => actions.createVersion(snapshot, expectedVersion),
      };
    });
  }

  archiveProject(command) {
    return this.#execute("ARCHIVE_PROJECT", command, ({ projectId, expectedVersion }) => {
      requireProjectId(projectId);
      requireExpectedVersion(expectedVersion);
      return {
        payload: { projectId, expectedVersion },
        operation: (actions) => actions.archive(projectId, expectedVersion),
      };
    });
  }

  #execute(commandType, command, prepare) {
    try {
      requireRecord(command, "command");
      rejectSensitiveFields(command);
      requireExactKeys(command, COMMAND_FIELDS[commandType], "command");
      const idempotencyKey = requireIdempotencyKey(command.idempotencyKey);
      const actor = requireActor(command.actor);
      const occurredAt = requireTimestamp(command.occurredAt, "occurredAt");
      const prepared = prepare(command);
      const payloadHash = stableHash({ actor, occurredAt, ...prepared.payload });
      return this.repository.executeCommand({
        idempotencyKey,
        commandType,
        payloadHash,
        actor,
        occurredAt,
      }, prepared.operation);
    } catch (caught) {
      throw asApplicationError(caught);
    }
  }
}

function stableHash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireIdempotencyKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.trim())) {
    throw applicationFailure("INVALID_IDEMPOTENCY_KEY", "idempotencyKey", "use de 1 a 200 caracteres seguros");
  }
  return value.trim();
}

function requireActor(value) {
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > 160) {
    throw applicationFailure("INVALID_ACTOR", "actor", "ator obrigatório com até 160 caracteres");
  }
  return value.trim().replace(/\s+/g, " ");
}

function requireTimestamp(value, field) {
  const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== "string" || !isoInstant.test(value) || !Number.isFinite(Date.parse(value))) {
    throw applicationFailure("INVALID_TIMESTAMP", field, "use um instante ISO 8601 válido");
  }
  return new Date(value).toISOString();
}

function requireProjectId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(value)) {
    throw applicationFailure("INVALID_PROJECT_ID", "projectId", "identificador de projeto inválido");
  }
}

function requireExpectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw applicationFailure("INVALID_EXPECTED_VERSION", "expectedVersion", "deve ser inteiro positivo");
  }
}

function requireRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw applicationFailure("INVALID_TYPE", field, "deve ser um objeto");
  }
}

function requireExactKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw applicationFailure("UNKNOWN_FIELD", `${field}.${key}`, "campo não permitido");
  }
  for (const key of allowed) {
    if (!(key in value)) throw applicationFailure("REQUIRED_FIELD", key, "campo obrigatório");
  }
}

function rejectSensitiveFields(value) {
  const sensitive = /^(?:access|refresh)?token$|^api[_-]?key$|authorization|client[_-]?secret|credential|password|private[_-]?key|secret/i;
  const seen = new WeakSet();
  function visit(current, path) {
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (sensitive.test(key.replace(/[^a-zA-Z_-]/g, ""))) {
        throw applicationFailure("SENSITIVE_FIELD_REJECTED", childPath, "credenciais, tokens e segredos não pertencem ao comando");
      }
      visit(child, childPath);
    }
  }
  visit(value, "");
}

function asApplicationError(caught) {
  if (caught instanceof ProjectApplicationError) return caught;
  if (caught instanceof ContractValidationError) {
    return applicationFailure(caught.code, caught.path, "payload de projeto inválido", { cause: caught });
  }
  if (caught instanceof ProjectRepositoryError) {
    return applicationFailure(caught.code, caught.field, "comando de projeto rejeitado", { cause: caught });
  }
  return caught;
}

function applicationFailure(code, field, message, options) {
  return new ProjectApplicationError(code, field, message, options);
}
