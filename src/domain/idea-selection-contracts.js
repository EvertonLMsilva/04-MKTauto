import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const IDEA_SELECTION_CONTRACT_VERSION = "idea-selection/1.0.0";

const FIELDS = Object.freeze([
  "schemaVersion", "ideaSelectionId", "pipelineRunId", "projectId", "projectVersion",
  "ideaBatchId", "ideaCandidateId", "ideaScoreId", "ideaContentHash",
  "ideaScoreContentHash", "decision", "actor", "decidedAt", "editorialRationale",
  "revision", "supersedesIdeaSelectionId", "contentHash",
]);
const ACTOR_FIELDS = Object.freeze(["type", "id"]);
const SENSITIVE_VALUE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i;

export function validateIdeaSelection(value) {
  record(value, "selection");
  exact(value, FIELDS, "selection");
  if (value.schemaVersion !== IDEA_SELECTION_CONTRACT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.ideaSelectionId, "ideaSelectionId", 200);
  identifier(value.pipelineRunId, "pipelineRunId");
  identifier(value.projectId, "projectId");
  positiveInteger(value.projectVersion, "projectVersion");
  identifier(value.ideaBatchId, "ideaBatchId", 200);
  identifier(value.ideaCandidateId, "ideaCandidateId", 200);
  identifier(value.ideaScoreId, "ideaScoreId", 200);
  hash(value.ideaContentHash, "ideaContentHash");
  hash(value.ideaScoreContentHash, "ideaScoreContentHash");
  if (value.decision !== "SELECTED") fail("INVALID_DECISION", "decision");
  record(value.actor, "actor");
  exact(value.actor, ACTOR_FIELDS, "actor");
  if (value.actor.type !== "HUMAN") fail("HUMAN_ACTOR_REQUIRED", "actor.type");
  identifier(value.actor.id, "actor.id", 120);
  timestamp(value.decidedAt, "decidedAt");
  if (value.editorialRationale !== null) normalizedText(value.editorialRationale, "editorialRationale", 2, 500);
  positiveInteger(value.revision, "revision");
  if (value.supersedesIdeaSelectionId !== null) identifier(value.supersedesIdeaSelectionId, "supersedesIdeaSelectionId", 200);
  if (value.revision === 1 && value.supersedesIdeaSelectionId !== null) fail("INVALID_SUPERSESSION", "supersedesIdeaSelectionId");
  if (value.revision > 1 && value.supersedesIdeaSelectionId === null) fail("SUPERSEDED_SELECTION_REQUIRED", "supersedesIdeaSelectionId");
  hash(value.contentHash, "contentHash");
  rejectSensitive(value);
  if (selectionContentHash(value) !== value.contentHash) fail("CONTENT_HASH_MISMATCH", "contentHash");
  return deepFreeze(structuredClone(value));
}

export function selectionContentHash(value) {
  const { contentHash: _contentHash, ...content } = value;
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

function rejectSensitive(value) {
  const forbiddenKey = /^(?:prompt|systemMessage|instruction|token|apiKey|secret|password|media|transcript|sourceText|payload)$/i;
  const visit = (current, path) => {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbiddenKey.test(key)) fail("FORBIDDEN_FIELD", childPath);
      if (typeof child === "string" && SENSITIVE_VALUE.test(child)) fail("SENSITIVE_CONTENT", childPath);
      visit(child, childPath);
    }
  };
  visit(value, "");
}

function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function positiveInteger(value, path) { if (!Number.isSafeInteger(value) || value < 1) fail("INVALID_INTEGER", path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function normalizedText(value, path, min, max) { if (typeof value !== "string" || value.length < min || value.length > max || value !== value.normalize("NFC").trim().replace(/\s+/g, " ")) fail("INVALID_TEXT", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
