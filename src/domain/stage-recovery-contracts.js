import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const STAGE_RECOVERY_CONTRACT_VERSION = "stage-recovery/1.0.0";
export const PIPELINE_STAGE_STATES = Object.freeze(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]);
export const STAGE_ATTEMPT_TRIGGERS = Object.freeze(["INITIAL", "AUTOMATIC", "MANUAL"]);
export const PIPELINE_STAGES = Object.freeze([
  "RESEARCH", "TREND_FORMAT_ANALYSIS", "IDEA_GENERATION", "IDEA_SELECTION",
  "SCRIPT", "VOICE", "MEDIA", "VISUAL_MOTION_PLAN", "BACKGROUND_MUSIC",
  "COMPOSITION", "SUBTITLES", "PREVIEW", "QC",
]);
export const STAGE_DEPENDENCIES = deepFreeze({
  RESEARCH: [],
  TREND_FORMAT_ANALYSIS: ["RESEARCH"],
  IDEA_GENERATION: ["RESEARCH", "TREND_FORMAT_ANALYSIS"],
  IDEA_SELECTION: ["IDEA_GENERATION"],
  SCRIPT: ["IDEA_SELECTION"],
  VOICE: ["SCRIPT"],
  MEDIA: ["SCRIPT"],
  VISUAL_MOTION_PLAN: ["SCRIPT", "MEDIA"],
  BACKGROUND_MUSIC: ["SCRIPT"],
  COMPOSITION: ["VOICE", "MEDIA", "VISUAL_MOTION_PLAN", "BACKGROUND_MUSIC"],
  SUBTITLES: ["SCRIPT", "VOICE"],
  PREVIEW: ["COMPOSITION", "SUBTITLES"],
  QC: ["PREVIEW"],
});

const REQUEST_FIELDS = Object.freeze(["schemaVersion", "pipelineRunId", "stage", "requestHash", "inputs", "policyVersions", "providerConfigHash"]);
const INPUT_FIELDS = Object.freeze(["stage", "artifactId", "contentHash"]);

export function validateStageExecutionRequest(value) {
  record(value, "stageRequest"); exact(value, REQUEST_FIELDS, "stageRequest");
  if (value.schemaVersion !== STAGE_RECOVERY_CONTRACT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", "versão não suportada");
  const pipelineRunId = identifier(value.pipelineRunId, "pipelineRunId", 80);
  const stage = enumValue(value.stage, PIPELINE_STAGES, "stage");
  const requestHash = hash(value.requestHash, "requestHash");
  if (!Array.isArray(value.inputs)) fail("INVALID_TYPE", "inputs", "deve ser array");
  const positions = new Set();
  const inputs = value.inputs.map((input, index) => {
    const path = `inputs.${index}`; record(input, path); exact(input, INPUT_FIELDS, path);
    const dependency = enumValue(input.stage, PIPELINE_STAGES, `${path}.stage`);
    if (!STAGE_DEPENDENCIES[stage].includes(dependency)) fail("INVALID_STAGE_DEPENDENCY", `${path}.stage`, "dependência não declarada");
    const key = `${dependency}:${input.artifactId}`;
    if (positions.has(key)) fail("DUPLICATE_STAGE_INPUT", path, "entrada duplicada"); positions.add(key);
    return deepFreeze({ stage: dependency, artifactId: identifier(input.artifactId, `${path}.artifactId`, 200), contentHash: hash(input.contentHash, `${path}.contentHash`) });
  }).sort((left, right) => left.stage.localeCompare(right.stage) || left.artifactId.localeCompare(right.artifactId));
  record(value.policyVersions, "policyVersions");
  const policyVersions = {};
  for (const key of Object.keys(value.policyVersions).sort()) {
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(key)) fail("INVALID_POLICY_NAME", `policyVersions.${key}`, "nome inválido");
    policyVersions[key] = identifier(value.policyVersions[key], `policyVersions.${key}`, 120);
  }
  const providerConfigHash = value.providerConfigHash === null ? null : hash(value.providerConfigHash, "providerConfigHash");
  return deepFreeze({ schemaVersion: STAGE_RECOVERY_CONTRACT_VERSION, pipelineRunId, stage, requestHash, inputs, policyVersions, providerConfigHash });
}

export function stageExecutionIdentityHash(value) {
  const request = validateStageExecutionRequest(value);
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export function sanitizeStageFailure(value) {
  const code = typeof value?.code === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(value.code) ? value.code : "STAGE_FAILED";
  const field = typeof value?.field === "string" && /^[A-Za-z][A-Za-z0-9_.\[\]]{0,119}$/.test(value.field) ? value.field : "stage";
  return deepFreeze({ code, field, retryAllowed: isTransientStageFailure(value) });
}

export function isTransientStageFailure(value) {
  let current = value;
  for (let depth = 0; current && depth < 5; depth += 1, current = current.cause) {
    if (current.transient === true) return true;
    if ([429, 500, 502, 503, 504].includes(current.status ?? current.statusCode)) return true;
    const code = typeof current.code === "string" ? current.code : "";
    if (/(?:TIMEOUT|RATE_LIMIT|TOO_MANY_REQUESTS|NETWORK|CONNECTION|TEMPORAR|_5\d\d$)/.test(code)
      && !/(?:INVALID|REJECTED|POLICY|CONTRACT|AUTH|PERMISSION)/.test(code)) return true;
  }
  return false;
}

export function descendantsOf(stage) {
  enumValue(stage, PIPELINE_STAGES, "stage");
  const result = new Set(); const pending = [stage];
  while (pending.length > 0) {
    const parent = pending.shift();
    for (const [candidate, dependencies] of Object.entries(STAGE_DEPENDENCIES)) {
      if (dependencies.includes(parent) && !result.has(candidate)) { result.add(candidate); pending.push(candidate); }
    }
  }
  return Object.freeze([...result]);
}

function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path, "deve ser objeto"); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`, "campo não permitido"); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`, "campo obrigatório"); }
function identifier(value, path, max) { if (typeof value !== "string" || value.length > max || !/^[a-zA-Z0-9][a-zA-Z0-9_:.\/-]{1,}$/.test(value)) fail("INVALID_IDENTIFIER", path, "identificador inválido"); return value; }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_CONTENT_HASH", path, "SHA-256 inválido"); return value; }
function enumValue(value, allowed, path) { if (!allowed.includes(value)) fail("INVALID_ENUM", path, "valor inválido"); return value; }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const child of Object.values(value)) deepFreeze(child); return Object.freeze(value); }
function fail(code, path, message) { throw new ContractValidationError(code, path, message); }
