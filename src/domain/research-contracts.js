import { ContractValidationError } from "./contracts.js";
import { validateProjectSnapshot } from "./project-contracts.js";

export const RESEARCH_INPUT_CONTRACT_VERSION = "research-input/1.0.0";

const INPUT_FIELDS = Object.freeze([
  "schemaVersion",
  "execution",
  "window",
  "projectSnapshot",
]);
const EXECUTION_FIELDS = Object.freeze([
  "pipelineRunId",
  "projectId",
  "projectVersion",
  "startedAt",
]);
const WINDOW_FIELDS = Object.freeze(["logicalDate"]);

export function createResearchInput(value) {
  rejectSensitiveFields(value);
  requireRecord(value, "researchInput");
  requireExactKeys(value, INPUT_FIELDS, "researchInput");
  if (value.schemaVersion !== RESEARCH_INPUT_CONTRACT_VERSION) {
    fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", "versão do contrato não suportada");
  }

  const execution = validateExecution(value.execution);
  const window = validateResearchWindow(value.window);
  const projectSnapshot = validateProjectSnapshot(value.projectSnapshot);
  if (projectSnapshot.project.id !== execution.projectId) {
    fail("PROJECT_REFERENCE_MISMATCH", "projectSnapshot.project.id", "snapshot diverge da execução");
  }
  if (projectSnapshot.project.version !== execution.projectVersion) {
    fail("PROJECT_REFERENCE_MISMATCH", "projectSnapshot.project.version", "snapshot diverge da execução");
  }

  return deepFreeze({
    schemaVersion: RESEARCH_INPUT_CONTRACT_VERSION,
    execution,
    window,
    projectSnapshot,
  });
}

export function validateResearchWindow(value) {
  requireRecord(value, "window");
  requireExactKeys(value, WINDOW_FIELDS, "window");
  if (typeof value.logicalDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.logicalDate)
    || new Date(`${value.logicalDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== value.logicalDate) {
    fail("INVALID_LOGICAL_DATE", "window.logicalDate", "use uma data válida em YYYY-MM-DD");
  }
  return deepFreeze({ logicalDate: value.logicalDate });
}

function validateExecution(value) {
  requireRecord(value, "execution");
  requireExactKeys(value, EXECUTION_FIELDS, "execution");
  const pipelineRunId = requireIdentifier(value.pipelineRunId, "execution.pipelineRunId");
  const projectId = requireIdentifier(value.projectId, "execution.projectId");
  if (!Number.isSafeInteger(value.projectVersion) || value.projectVersion < 1) {
    fail("INVALID_PROJECT_VERSION", "execution.projectVersion", "deve ser inteiro positivo");
  }
  const startedAt = requireTimestamp(value.startedAt, "execution.startedAt");
  return deepFreeze({ pipelineRunId, projectId, projectVersion: value.projectVersion, startedAt });
}

function requireRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_TYPE", path, "deve ser um objeto");
  }
}

function requireExactKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`, "campo não permitido");
  }
  for (const key of allowed) {
    if (!(key in value)) fail("REQUIRED_FIELD", path === "researchInput" ? key : `${path}.${key}`, "campo obrigatório");
  }
}

function requireIdentifier(value, path) {
  if (typeof value !== "string" || value.length > 80 || !/^[a-z0-9][a-z0-9_-]{2,}$/.test(value)) {
    fail("INVALID_IDENTIFIER", path, "use identificador seguro em letras minúsculas, números, _ ou -");
  }
  return value;
}

function requireTimestamp(value, path) {
  const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== "string" || !isoInstant.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("INVALID_TIMESTAMP", path, "use um instante ISO 8601 válido");
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
        fail("SENSITIVE_FIELD_REJECTED", childPath, "credenciais, tokens e segredos não pertencem ao contrato");
      }
      visit(child, childPath);
    }
  }
  visit(value, prefix);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, path, message) {
  throw new ContractValidationError(code, path, message);
}
