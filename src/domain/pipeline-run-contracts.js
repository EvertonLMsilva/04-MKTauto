import { ContractValidationError } from "./contracts.js";
import { validateProjectSnapshot } from "./project-contracts.js";

export const PIPELINE_RUN_CONTRACT_VERSION = "pipeline-run/1.0.0";
export const PIPELINE_RUN_STATES = Object.freeze(["RUNNING", "SUCCEEDED", "FAILED"]);

const RUN_FIELDS = Object.freeze([
  "schemaVersion",
  "pipelineRunId",
  "projectId",
  "projectVersion",
  "projectSnapshot",
  "state",
  "startedAt",
  "completedAt",
  "error",
  "transitions",
]);
const TRANSITION_FIELDS = Object.freeze(["previousState", "nextState", "changedAt", "error"]);
const ERROR_FIELDS = Object.freeze(["code", "field"]);

export function validatePipelineRun(value) {
  requireRecord(value, "pipelineRun");
  requireExactKeys(value, RUN_FIELDS, "pipelineRun");
  if (value.schemaVersion !== PIPELINE_RUN_CONTRACT_VERSION) {
    fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", "versão do contrato não suportada");
  }
  const pipelineRunId = requireIdentifier(value.pipelineRunId, "pipelineRunId");
  const projectId = requireIdentifier(value.projectId, "projectId");
  requireVersion(value.projectVersion, "projectVersion");
  const projectSnapshot = validateProjectSnapshot(value.projectSnapshot);
  if (projectSnapshot.project.id !== projectId) {
    fail("PROJECT_REFERENCE_MISMATCH", "projectSnapshot.project.id", "snapshot diverge da execução");
  }
  if (projectSnapshot.project.version !== value.projectVersion) {
    fail("PROJECT_REFERENCE_MISMATCH", "projectSnapshot.project.version", "snapshot diverge da execução");
  }
  const state = requireState(value.state, "state");
  const startedAt = requireTimestamp(value.startedAt, "startedAt");
  const completedAt = value.completedAt === null ? null : requireTimestamp(value.completedAt, "completedAt");
  const error = value.error === null ? null : validatePublicError(value.error, "error");
  validateTerminalFields(state, completedAt, error);
  if (!Array.isArray(value.transitions) || value.transitions.length === 0) {
    fail("INVALID_TRANSITIONS", "transitions", "histórico de transições obrigatório");
  }
  const transitions = value.transitions.map((transition, index) => validateTransition(transition, index));
  validateTransitionHistory(transitions, state, startedAt, completedAt, error);
  return deepFreeze({
    schemaVersion: PIPELINE_RUN_CONTRACT_VERSION,
    pipelineRunId,
    projectId,
    projectVersion: value.projectVersion,
    projectSnapshot,
    state,
    startedAt,
    completedAt,
    error,
    transitions,
  });
}

export function sanitizePipelineRunError(value) {
  const code = safePublicToken(value?.code) ? value.code : "PIPELINE_RUN_FAILED";
  const field = safePublicField(value?.field) ? value.field : "pipelineRun";
  return deepFreeze({ code, field });
}

function validateTransition(value, index) {
  const path = `transitions.${index}`;
  requireRecord(value, path);
  requireExactKeys(value, TRANSITION_FIELDS, path);
  const previousState = value.previousState === null
    ? null
    : requireState(value.previousState, `${path}.previousState`);
  const nextState = requireState(value.nextState, `${path}.nextState`);
  const changedAt = requireTimestamp(value.changedAt, `${path}.changedAt`);
  const error = value.error === null ? null : validatePublicError(value.error, `${path}.error`);
  const valid = (previousState === null && nextState === "RUNNING" && error === null)
    || (previousState === "RUNNING" && nextState === "SUCCEEDED" && error === null)
    || (previousState === "RUNNING" && nextState === "FAILED" && error !== null);
  if (!valid) fail("INVALID_PIPELINE_RUN_TRANSITION", path, "transição não permitida");
  return deepFreeze({ previousState, nextState, changedAt, error });
}

function validateTransitionHistory(transitions, state, startedAt, completedAt, error) {
  const initial = transitions[0];
  if (initial.previousState !== null || initial.nextState !== "RUNNING" || initial.changedAt !== startedAt) {
    fail("INVALID_TRANSITION_HISTORY", "transitions.0", "transição inicial inconsistente");
  }
  if (transitions.length > 2) fail("INVALID_TRANSITION_HISTORY", "transitions", "histórico excede o corte FND01");
  const last = transitions.at(-1);
  if (last.nextState !== state) fail("INVALID_TRANSITION_HISTORY", "state", "estado diverge do histórico");
  if (state === "RUNNING" && transitions.length !== 1) {
    fail("INVALID_TRANSITION_HISTORY", "transitions", "execução ativa possui transição terminal");
  }
  if (state !== "RUNNING") {
    if (transitions.length !== 2 || last.changedAt !== completedAt || !sameError(last.error, error)) {
      fail("INVALID_TRANSITION_HISTORY", "transitions", "transição terminal inconsistente");
    }
  }
}

function validateTerminalFields(state, completedAt, error) {
  const valid = (state === "RUNNING" && completedAt === null && error === null)
    || (state === "SUCCEEDED" && completedAt !== null && error === null)
    || (state === "FAILED" && completedAt !== null && error !== null);
  if (!valid) fail("INVALID_PIPELINE_RUN_STATE", "state", "estado, término e erro são inconsistentes");
}

function validatePublicError(value, path) {
  requireRecord(value, path);
  requireExactKeys(value, ERROR_FIELDS, path);
  if (!safePublicToken(value.code)) fail("INVALID_ERROR_CODE", `${path}.code`, "código público inválido");
  if (!safePublicField(value.field)) fail("INVALID_ERROR_FIELD", `${path}.field`, "campo público inválido");
  return deepFreeze({ code: value.code, field: value.field });
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
    if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`, "campo obrigatório");
  }
}

function requireIdentifier(value, path) {
  if (typeof value !== "string" || value.length > 80 || !/^[a-z0-9][a-z0-9_-]{2,}$/.test(value)) {
    fail("INVALID_IDENTIFIER", path, "use identificador seguro em letras minúsculas, números, _ ou -");
  }
  return value;
}

function requireVersion(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail("INVALID_PROJECT_VERSION", path, "deve ser inteiro positivo");
}

function requireState(value, path) {
  if (!PIPELINE_RUN_STATES.includes(value)) fail("INVALID_PIPELINE_RUN_STATE", path, "estado inválido");
  return value;
}

function requireTimestamp(value, path) {
  const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== "string" || !isoInstant.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("INVALID_TIMESTAMP", path, "use um instante ISO 8601 válido");
  }
  return new Date(value).toISOString();
}

function safePublicToken(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(value);
}

function safePublicField(value) {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_.]{0,79}$/.test(value);
}

function sameError(left, right) {
  return left === null ? right === null : right !== null && left.code === right.code && left.field === right.field;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, path, message) {
  throw new ContractValidationError(code, path, message);
}
