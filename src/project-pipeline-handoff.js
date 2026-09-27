import { ContractValidationError } from "./domain/contracts.js";
import { validateProjectSnapshot } from "./domain/project-contracts.js";
import { ProjectRepositoryError } from "./project-repository.js";

export const PIPELINE_HANDOFF_CONTRACT_VERSION = "pipeline-handoff/1.0.0";

const REQUEST_FIELDS = Object.freeze([
  "schemaVersion",
  "pipelineRunId",
  "projectId",
  "projectVersion",
  "startedAt",
]);
const ARTIFACT_FIELDS = Object.freeze([
  "schemaVersion",
  "artifactId",
  "artifactType",
  "pipelineRunId",
  "projectId",
  "projectVersion",
  "createdAt",
]);

export class PipelineHandoffError extends Error {
  constructor(code, field, message, options) {
    super(`${code} em ${field}: ${message}`, options);
    this.name = "PipelineHandoffError";
    this.code = code;
    this.field = field;
  }
}

export class ProjectPipelineHandoffService {
  constructor(repository, consumer = new ProjectSnapshotConsumerStub()) {
    if (!repository || typeof repository.get !== "function") {
      throw failure("INVALID_REPOSITORY", "repository", "repositório de projetos obrigatório");
    }
    if (!consumer || typeof consumer.consume !== "function") {
      throw failure("INVALID_CONSUMER", "consumer", "consumidor do pipeline obrigatório");
    }
    this.repository = repository;
    this.consumer = consumer;
  }

  start(value) {
    try {
      const request = validatePipelineHandoffRequest(value);
      const selectedSnapshot = this.repository.get(request.projectId, request.projectVersion);
      if (!selectedSnapshot) {
        throw failure(
          "PROJECT_SNAPSHOT_NOT_FOUND",
          "projectVersion",
          "snapshot não encontrado para o projeto e versão explícitos",
        );
      }

      const validatedSnapshot = validateProjectSnapshot(selectedSnapshot);
      if (validatedSnapshot.project.id !== request.projectId) {
        throw failure("SNAPSHOT_PROJECT_MISMATCH", "projectId", "snapshot não corresponde ao projeto selecionado");
      }
      if (validatedSnapshot.project.version !== request.projectVersion) {
        throw failure("SNAPSHOT_VERSION_MISMATCH", "projectVersion", "snapshot não corresponde à versão selecionada");
      }

      const execution = deepFreeze({
        pipelineRunId: request.pipelineRunId,
        projectId: request.projectId,
        projectVersion: request.projectVersion,
        startedAt: request.startedAt,
      });
      const artifact = validateArtifact(this.consumer.consume(deepFreeze({
        execution,
        projectSnapshot: selectedSnapshot,
      })), execution);

      return deepFreeze({
        schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
        execution,
        artifacts: [artifact],
      });
    } catch (caught) {
      throw asHandoffError(caught);
    }
  }
}

export class ProjectSnapshotConsumerStub {
  consume({ execution }) {
    return {
      schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
      artifactId: `${execution.pipelineRunId}_project_snapshot`,
      artifactType: "project_snapshot_handoff",
      pipelineRunId: execution.pipelineRunId,
      projectId: execution.projectId,
      projectVersion: execution.projectVersion,
      createdAt: execution.startedAt,
    };
  }
}

export function validatePipelineHandoffRequest(value) {
  rejectSensitiveFields(value);
  requireRecord(value, "request");
  requireExactKeys(value, REQUEST_FIELDS, "request");
  if (value.schemaVersion !== PIPELINE_HANDOFF_CONTRACT_VERSION) {
    throw failure("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", "versão do contrato não suportada");
  }
  const pipelineRunId = requireIdentifier(value.pipelineRunId, "pipelineRunId");
  const projectId = requireIdentifier(value.projectId, "projectId");
  requirePositiveInteger(value.projectVersion, "projectVersion");
  const startedAt = requireTimestamp(value.startedAt, "startedAt");
  return deepFreeze({
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    pipelineRunId,
    projectId,
    projectVersion: value.projectVersion,
    startedAt,
  });
}

function validateArtifact(value, execution) {
  rejectSensitiveFields(value, "artifact");
  requireRecord(value, "artifact");
  requireExactKeys(value, ARTIFACT_FIELDS, "artifact");
  if (value.schemaVersion !== PIPELINE_HANDOFF_CONTRACT_VERSION) {
    throw failure("UNSUPPORTED_SCHEMA_VERSION", "artifact.schemaVersion", "versão do artefato não suportada");
  }
  const artifact = {
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    artifactId: requireIdentifier(value.artifactId, "artifact.artifactId", 200),
    artifactType: value.artifactType,
    pipelineRunId: requireIdentifier(value.pipelineRunId, "artifact.pipelineRunId"),
    projectId: requireIdentifier(value.projectId, "artifact.projectId"),
    projectVersion: value.projectVersion,
    createdAt: requireTimestamp(value.createdAt, "artifact.createdAt"),
  };
  if (artifact.artifactType !== "project_snapshot_handoff") {
    throw failure("INVALID_ARTIFACT_TYPE", "artifact.artifactType", "tipo de artefato não suportado");
  }
  requirePositiveInteger(artifact.projectVersion, "artifact.projectVersion");
  for (const field of ["pipelineRunId", "projectId", "projectVersion"]) {
    if (artifact[field] !== execution[field]) {
      throw failure("ARTIFACT_PROJECT_REFERENCE_MISMATCH", `artifact.${field}`, "artefato diverge da execução");
    }
  }
  if (artifact.createdAt !== execution.startedAt) {
    throw failure("ARTIFACT_TIMESTAMP_MISMATCH", "artifact.createdAt", "artefato diverge do instante da execução");
  }
  return deepFreeze(artifact);
}

function requireRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure("INVALID_TYPE", field, "deve ser um objeto");
  }
}

function requireExactKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw failure("UNKNOWN_FIELD", `${field}.${key}`, "campo não permitido");
  }
  for (const key of allowed) {
    if (!(key in value)) throw failure("REQUIRED_FIELD", key, "campo obrigatório");
  }
}

function requireIdentifier(value, field, maxLength = 80) {
  if (typeof value !== "string" || value.length > maxLength || !/^[a-z0-9][a-z0-9_-]{2,}$/.test(value)) {
    throw failure("INVALID_IDENTIFIER", field, "use identificador seguro em letras minúsculas, números, _ ou -");
  }
  return value;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw failure("INVALID_PROJECT_VERSION", field, "deve ser inteiro positivo");
  }
}

function requireTimestamp(value, field) {
  const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== "string" || !isoInstant.test(value) || !Number.isFinite(Date.parse(value))) {
    throw failure("INVALID_TIMESTAMP", field, "use um instante ISO 8601 válido");
  }
  return new Date(value).toISOString();
}

function rejectSensitiveFields(value, prefix = "") {
  const sensitive = /^(?:access|refresh)?token$|^api[_-]?key$|authorization|client[_-]?secret|credential|password|private[_-]?key|secret/i;
  const seen = new WeakSet();
  function visit(current, path) {
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (sensitive.test(key.replace(/[^a-zA-Z_-]/g, ""))) {
        throw failure("SENSITIVE_FIELD_REJECTED", childPath, "credenciais, tokens e segredos não pertencem ao handoff");
      }
      visit(child, childPath);
    }
  }
  visit(value, prefix);
}

function asHandoffError(caught) {
  if (caught instanceof PipelineHandoffError) return caught;
  if (caught instanceof ContractValidationError) {
    return failure(caught.code, caught.path, "snapshot selecionado é inválido", { cause: caught });
  }
  if (caught instanceof ProjectRepositoryError) {
    return failure(caught.code, caught.field, "snapshot selecionado não pôde ser lido", { cause: caught });
  }
  return caught;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function failure(code, field, message, options) {
  return new PipelineHandoffError(code, field, message, options);
}
