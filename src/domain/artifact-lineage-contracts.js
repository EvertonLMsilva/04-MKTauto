import { ContractValidationError } from "./contracts.js";

export const ARTIFACT_LINEAGE_CONTRACT_VERSION = "artifact-lineage/1.0.0";
export const ARTIFACT_HASH_ALGORITHM = "sha256";

const ARTIFACT_FIELDS = Object.freeze([
  "schemaVersion", "artifactId", "artifactType", "artifactVersion",
  "pipelineRunId", "projectId", "projectVersion", "contentIdentity",
  "hashAlgorithm", "contentHash", "inputs", "generationMetadata", "createdAt",
]);
const INPUT_FIELDS = Object.freeze(["position", "kind", "inputId", "contentHash"]);
const GENERATION_FIELDS = Object.freeze([
  "provider", "model", "taskType", "promptVersion", "configurationHash",
  "publicConfiguration",
]);
const SENSITIVE_CONFIGURATION_KEY = /(?:api.?key|authorization|credential|secret|password|token|prompt|instruction|message|payload|transcript|media|private|content)/i;
const SENSITIVE_CONFIGURATION_VALUE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i;

export function validateArtifactLineage(value) {
  record(value, "artifact");
  exact(value, ARTIFACT_FIELDS, "artifact");
  if (value.schemaVersion !== ARTIFACT_LINEAGE_CONTRACT_VERSION) {
    fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", "versão do contrato não suportada");
  }
  const artifactId = identifier(value.artifactId, "artifactId", 200);
  const artifactType = typeName(value.artifactType, "artifactType");
  positiveInteger(value.artifactVersion, "artifactVersion", "INVALID_ARTIFACT_VERSION");
  const pipelineRunId = identifier(value.pipelineRunId, "pipelineRunId");
  const projectId = identifier(value.projectId, "projectId");
  positiveInteger(value.projectVersion, "projectVersion", "INVALID_PROJECT_VERSION");
  const contentIdentity = value.contentIdentity === null
    ? null
    : identifier(value.contentIdentity, "contentIdentity", 200);
  if (value.hashAlgorithm !== ARTIFACT_HASH_ALGORITHM) {
    fail("UNSUPPORTED_HASH_ALGORITHM", "hashAlgorithm", "algoritmo de hash não suportado");
  }
  const contentHash = hash(value.contentHash, "contentHash");
  const inputs = validateInputs(value.inputs);
  const generationMetadata = value.generationMetadata === null
    ? null
    : validateGenerationMetadata(value.generationMetadata);
  const createdAt = timestamp(value.createdAt, "createdAt");

  return deepFreeze({
    schemaVersion: ARTIFACT_LINEAGE_CONTRACT_VERSION,
    artifactId,
    artifactType,
    artifactVersion: value.artifactVersion,
    pipelineRunId,
    projectId,
    projectVersion: value.projectVersion,
    contentIdentity,
    hashAlgorithm: ARTIFACT_HASH_ALGORITHM,
    contentHash,
    inputs,
    generationMetadata,
    createdAt,
  });
}

function validateInputs(value) {
  if (!Array.isArray(value)) fail("INVALID_TYPE", "inputs", "deve ser uma lista");
  const identities = new Set();
  return value.map((input, index) => {
    const path = `inputs.${index}`;
    record(input, path);
    exact(input, INPUT_FIELDS, path);
    if (input.position !== index + 1) {
      fail("INVALID_INPUT_POSITION", `${path}.position`, "posição deve acompanhar a ordem da lista");
    }
    if (!["INTERNAL_ARTIFACT", "EXTERNAL_INPUT"].includes(input.kind)) {
      fail("INVALID_INPUT_KIND", `${path}.kind`, "tipo de entrada inválido");
    }
    const inputId = identifier(input.inputId, `${path}.inputId`, 200);
    const identity = `${input.kind}:${inputId}`;
    if (identities.has(identity)) fail("DUPLICATE_INPUT", `${path}.inputId`, "entrada duplicada");
    identities.add(identity);
    return deepFreeze({
      position: input.position,
      kind: input.kind,
      inputId,
      contentHash: hash(input.contentHash, `${path}.contentHash`),
    });
  });
}

export function validateGenerationMetadata(value) {
  record(value, "generationMetadata");
  exact(value, GENERATION_FIELDS, "generationMetadata");
  const provider = token(value.provider, "generationMetadata.provider");
  const model = token(value.model, "generationMetadata.model");
  const taskType = token(value.taskType, "generationMetadata.taskType");
  const promptVersion = token(value.promptVersion, "generationMetadata.promptVersion");
  const configurationHash = hash(value.configurationHash, "generationMetadata.configurationHash");
  const publicConfiguration = value.publicConfiguration === null
    ? null
    : sanitizePublicConfiguration(value.publicConfiguration, "generationMetadata.publicConfiguration", 0);
  return deepFreeze({ provider, model, taskType, promptVersion, configurationHash, publicConfiguration });
}

function sanitizePublicConfiguration(value, path, depth) {
  if (depth > 5) fail("INVALID_PUBLIC_CONFIGURATION", path, "configuração excede a profundidade permitida");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_PUBLIC_CONFIGURATION", path, "configuração pública deve ser um objeto");
  }
  const keys = Object.keys(value).sort();
  if (keys.length > 40) fail("INVALID_PUBLIC_CONFIGURATION", path, "configuração excede o limite de campos");
  const result = {};
  for (const key of keys) {
    const childPath = `${path}.${key}`;
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(key)) {
      fail("INVALID_PUBLIC_CONFIGURATION", childPath, "nome de campo inválido");
    }
    if (SENSITIVE_CONFIGURATION_KEY.test(key)) {
      fail("SENSITIVE_CONFIGURATION_FIELD", childPath, "campo sensível não permitido");
    }
    result[key] = sanitizePublicValue(value[key], childPath, depth + 1);
  }
  return deepFreeze(result);
}

function sanitizePublicValue(value, path, depth) {
  if (depth > 5) fail("INVALID_PUBLIC_CONFIGURATION", path, "configuração excede a profundidade permitida");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 500 && !SENSITIVE_CONFIGURATION_VALUE.test(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 40) fail("INVALID_PUBLIC_CONFIGURATION", path, "lista excede o limite permitido");
    return deepFreeze(value.map((item, index) => sanitizePublicValue(item, `${path}.${index}`, depth + 1)));
  }
  if (value && typeof value === "object") return sanitizePublicConfiguration(value, path, depth);
  fail("INVALID_PUBLIC_CONFIGURATION", path, "valor público inválido ou potencialmente sensível");
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_TYPE", path, "deve ser um objeto");
  }
}

function exact(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`, "campo não permitido");
  }
  for (const key of allowed) {
    if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`, "campo obrigatório");
  }
}

function identifier(value, path, max = 80) {
  if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) {
    fail("INVALID_IDENTIFIER", path, "identificador inválido");
  }
  return value;
}

function typeName(value, path) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_:-]{1,79}$/.test(value)) {
    fail("INVALID_ARTIFACT_TYPE", path, "tipo de artefato inválido");
  }
  return value;
}

function token(value, path) {
  if (typeof value !== "string" || value.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(value)) {
    fail("INVALID_GENERATION_METADATA", path, "valor de metadado inválido");
  }
  return value;
}

function positiveInteger(value, path, code) {
  if (!Number.isSafeInteger(value) || value < 1) fail(code, path, "deve ser inteiro positivo");
}

function hash(value, path) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    fail("INVALID_HASH", path, "use SHA-256 hexadecimal minúsculo");
  }
  return value;
}

function timestamp(value, path) {
  const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== "string" || !isoInstant.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("INVALID_TIMESTAMP", path, "use um instante ISO 8601 válido");
  }
  return new Date(value).toISOString();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, path, message) {
  throw new ContractValidationError(code, path, message);
}
