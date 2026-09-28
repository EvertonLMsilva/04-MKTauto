import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const SCRIPT_GENERATION_REQUEST_VERSION = "script-generation-request/1.0.0";

const REQUEST_FIELDS = Object.freeze([
  "schemaVersion", "generationRequestId", "ideaSelectionId", "requestedAt", "contentHash",
]);
const OUTPUT_FIELDS = Object.freeze([
  "hook", "narrativeBlocks", "visualDirections", "cta", "estimatedDurationSeconds",
  "sensitiveClaims", "reviewFlags",
]);
const BLOCK_FIELDS = Object.freeze(["position", "purpose", "narration"]);
const VISUAL_FIELDS = Object.freeze(["position", "blockPosition", "description"]);
const CLAIM_FIELDS = Object.freeze(["position", "blockPosition", "summary", "sourceRequired", "humanReviewRequired"]);
const PURPOSES = Object.freeze(["INTRODUCTION", "EXPLANATION", "EXAMPLE", "CONCLUSION"]);
const REVIEW_FLAGS = Object.freeze(["SOURCE_VERIFICATION_REQUIRED", "HUMAN_REVIEW_REQUIRED", "ORIGINALITY_REVIEW_REQUIRED"]);
const SENSITIVE_VALUE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i;

export function validateScriptGenerationRequest(value) {
  record(value, "request");
  exact(value, REQUEST_FIELDS, "request");
  if (value.schemaVersion !== SCRIPT_GENERATION_REQUEST_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.generationRequestId, "generationRequestId", 180);
  identifier(value.ideaSelectionId, "ideaSelectionId", 200);
  timestamp(value.requestedAt, "requestedAt");
  hash(value.contentHash, "contentHash");
  rejectSensitive(value);
  if (scriptGenerationRequestHash(value) !== value.contentHash) fail("CONTENT_HASH_MISMATCH", "contentHash");
  return deepFreeze(structuredClone(value));
}

export function scriptGenerationRequestHash(value) {
  const { contentHash: _contentHash, ...content } = value;
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

export function validateScriptGenerationOutput(value) {
  record(value, "output");
  exact(value, OUTPUT_FIELDS, "output");
  normalizedText(value.hook, "hook", 2, 500);
  blocks(value.narrativeBlocks);
  visuals(value.visualDirections, value.narrativeBlocks.length);
  if (value.cta !== null) normalizedText(value.cta, "cta", 2, 500);
  positiveInteger(value.estimatedDurationSeconds, "estimatedDurationSeconds", "INVALID_DURATION");
  claims(value.sensitiveClaims, value.narrativeBlocks.length);
  flags(value.reviewFlags, value.sensitiveClaims);
  rejectSensitive(value);
  return deepFreeze(structuredClone(value));
}

function blocks(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) fail("INVALID_BLOCKS", "narrativeBlocks");
  value.forEach((block, index) => {
    const path = `narrativeBlocks.${index}`;
    record(block, path); exact(block, BLOCK_FIELDS, path);
    if (block.position !== index + 1) fail("INVALID_BLOCK_POSITION", `${path}.position`);
    if (!PURPOSES.includes(block.purpose)) fail("INVALID_BLOCK_PURPOSE", `${path}.purpose`);
    normalizedText(block.narration, `${path}.narration`, 2, 10000);
  });
}

function visuals(value, blockCount) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 300) fail("INVALID_VISUAL_DIRECTIONS", "visualDirections");
  value.forEach((visual, index) => {
    const path = `visualDirections.${index}`;
    record(visual, path); exact(visual, VISUAL_FIELDS, path);
    if (visual.position !== index + 1) fail("INVALID_VISUAL_POSITION", `${path}.position`);
    if (!Number.isSafeInteger(visual.blockPosition) || visual.blockPosition < 1 || visual.blockPosition > blockCount) fail("VISUAL_BLOCK_NOT_FOUND", `${path}.blockPosition`);
    normalizedText(visual.description, `${path}.description`, 2, 1000);
  });
}

function claims(value, blockCount) {
  if (!Array.isArray(value) || value.length > 100) fail("INVALID_SENSITIVE_CLAIMS", "sensitiveClaims");
  value.forEach((claim, index) => {
    const path = `sensitiveClaims.${index}`;
    record(claim, path); exact(claim, CLAIM_FIELDS, path);
    if (claim.position !== index + 1) fail("INVALID_CLAIM_POSITION", `${path}.position`);
    if (!Number.isSafeInteger(claim.blockPosition) || claim.blockPosition < 1 || claim.blockPosition > blockCount) fail("CLAIM_BLOCK_NOT_FOUND", `${path}.blockPosition`);
    normalizedText(claim.summary, `${path}.summary`, 2, 500);
    if (typeof claim.sourceRequired !== "boolean") fail("INVALID_TYPE", `${path}.sourceRequired`);
    if (typeof claim.humanReviewRequired !== "boolean") fail("INVALID_TYPE", `${path}.humanReviewRequired`);
    if (!claim.sourceRequired && !claim.humanReviewRequired) fail("SENSITIVE_CLAIM_REVIEW_REQUIRED", path);
  });
}

function flags(value, claimValues) {
  if (!Array.isArray(value) || value.length > REVIEW_FLAGS.length) fail("INVALID_REVIEW_FLAGS", "reviewFlags");
  const unique = new Set(value);
  if (unique.size !== value.length) fail("DUPLICATE_REVIEW_FLAG", "reviewFlags");
  value.forEach((flag, index) => { if (!REVIEW_FLAGS.includes(flag)) fail("INVALID_REVIEW_FLAG", `reviewFlags.${index}`); });
  if (claimValues.some(({ sourceRequired }) => sourceRequired) && !unique.has("SOURCE_VERIFICATION_REQUIRED")) fail("REVIEW_FLAG_REQUIRED", "reviewFlags");
  if (claimValues.some(({ humanReviewRequired }) => humanReviewRequired) && !unique.has("HUMAN_REVIEW_REQUIRED")) fail("REVIEW_FLAG_REQUIRED", "reviewFlags");
}

function rejectSensitive(value) {
  const forbiddenKey = /^(?:prompt|systemMessage|instruction|token|apiKey|secret|password|media|transcript|sourceText|payload|rawPayload|rawResponse)$/i;
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
function normalizedText(value, path, min, max) { if (typeof value !== "string" || value.length < min || value.length > max || value !== value.normalize("NFC").trim().replace(/\s+/g, " ")) fail("INVALID_TEXT", path); }
function positiveInteger(value, path, code) { if (!Number.isSafeInteger(value) || value < 1) fail(code, path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
