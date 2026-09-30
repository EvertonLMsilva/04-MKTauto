import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const REAL_PREVIEW_REQUEST_VERSION = "real-preview-request/1.0.0";
export const REAL_PREVIEW_RESULT_VERSION = "real-preview-result/1.0.0";

const REQUEST_FIELDS = Object.freeze([
  "schemaVersion", "previewRequestId", "pipelineRunId", "projectId", "projectVersion",
  "ideaSelectionId", "requestedAt", "contentHash",
]);
const RESULT_FIELDS = Object.freeze([
  "schemaVersion", "previewRequestId", "requestContentHash", "pipelineRunId", "projectId",
  "projectVersion", "script", "voiceTrack", "mediaAssets", "compositionPlan",
  "sourceVideoRender", "subtitleTrack", "previewVideoRender", "costs",
]);
const REF_FIELDS = Object.freeze(["id", "contentHash"]);
const MEDIA_REF_FIELDS = Object.freeze(["position", "id", "contentHash"]);
const VIDEO_REF_FIELDS = Object.freeze([
  "id", "contentHash", "revision", "logicalReference", "durationMilliseconds",
  "outputAspectRatio", "widthPixels", "heightPixels",
]);
const COST_FIELDS = Object.freeze(["known", "unavailableStages"]);
const KNOWN_COST_FIELDS = Object.freeze(["costEventId", "amount", "currency"]);

export function validateRealPreviewRequest(value) {
  record(value, "request"); exact(value, REQUEST_FIELDS, "request");
  if (value.schemaVersion !== REAL_PREVIEW_REQUEST_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.previewRequestId, "previewRequestId", 120); identifier(value.pipelineRunId, "pipelineRunId");
  identifier(value.projectId, "projectId"); positive(value.projectVersion, "projectVersion");
  identifier(value.ideaSelectionId, "ideaSelectionId", 200); timestamp(value.requestedAt, "requestedAt");
  hash(value.contentHash, "contentHash");
  if (realPreviewRequestHash(value) !== value.contentHash) fail("CONTENT_HASH_MISMATCH", "contentHash");
  return deepFreeze(structuredClone(value));
}

export function realPreviewRequestHash(value) {
  const { requestedAt: _at, contentHash: _hash, ...identity } = value;
  return sha256(stableJson(identity));
}

export function validateRealPreviewResult(value) {
  record(value, "result"); exact(value, RESULT_FIELDS, "result");
  if (value.schemaVersion !== REAL_PREVIEW_RESULT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.previewRequestId, "previewRequestId", 120); hash(value.requestContentHash, "requestContentHash");
  identifier(value.pipelineRunId, "pipelineRunId"); identifier(value.projectId, "projectId"); positive(value.projectVersion, "projectVersion");
  artifactRef(value.script, "script"); artifactRef(value.voiceTrack, "voiceTrack"); artifactRef(value.compositionPlan, "compositionPlan"); artifactRef(value.subtitleTrack, "subtitleTrack");
  if (!Array.isArray(value.mediaAssets) || value.mediaAssets.length === 0) fail("INVALID_MEDIA_ASSETS", "mediaAssets");
  value.mediaAssets.forEach((item, index) => { record(item, `mediaAssets.${index}`); exact(item, MEDIA_REF_FIELDS, `mediaAssets.${index}`); if (item.position !== index + 1) fail("INVALID_MEDIA_POSITION", `mediaAssets.${index}.position`); identifier(item.id, `mediaAssets.${index}.id`, 200); hash(item.contentHash, `mediaAssets.${index}.contentHash`); });
  videoRef(value.sourceVideoRender, "sourceVideoRender", 1); videoRef(value.previewVideoRender, "previewVideoRender", 2);
  if (value.previewVideoRender.id === value.sourceVideoRender.id) fail("INVALID_PREVIEW_REVISION", "previewVideoRender.id");
  record(value.costs, "costs"); exact(value.costs, COST_FIELDS, "costs");
  if (!Array.isArray(value.costs.known) || !Array.isArray(value.costs.unavailableStages)) fail("INVALID_COSTS", "costs");
  value.costs.known.forEach((item, index) => { const path = `costs.known.${index}`; record(item, path); exact(item, KNOWN_COST_FIELDS, path); identifier(item.costEventId, `${path}.costEventId`, 200); if (typeof item.amount !== "string" || !/^\d+(?:\.\d+)?$/.test(item.amount)) fail("INVALID_COST_AMOUNT", `${path}.amount`); if (typeof item.currency !== "string" || !/^[A-Z]{3}$/.test(item.currency)) fail("INVALID_CURRENCY", `${path}.currency`); });
  if (new Set(value.costs.unavailableStages).size !== value.costs.unavailableStages.length || value.costs.unavailableStages.some((stage) => typeof stage !== "string" || !/^[a-z][a-z0-9_:]{1,79}$/.test(stage))) fail("INVALID_UNAVAILABLE_COST_STAGES", "costs.unavailableStages");
  return deepFreeze(structuredClone(value));
}

function artifactRef(value, path) { record(value, path); exact(value, REF_FIELDS, path); identifier(value.id, `${path}.id`, 200); hash(value.contentHash, `${path}.contentHash`); }
function videoRef(value, path, revision) { record(value, path); exact(value, VIDEO_REF_FIELDS, path); identifier(value.id, `${path}.id`, 200); hash(value.contentHash, `${path}.contentHash`); if (value.revision !== revision) fail("INVALID_VIDEO_REVISION", `${path}.revision`); if (typeof value.logicalReference !== "string" || !value.logicalReference.startsWith("render:sha256_")) fail("INVALID_LOGICAL_REFERENCE", `${path}.logicalReference`); positive(value.durationMilliseconds, `${path}.durationMilliseconds`); if (!["9:16", "1:1", "16:9"].includes(value.outputAspectRatio)) fail("INVALID_OUTPUT_ASPECT_RATIO", `${path}.outputAspectRatio`); positive(value.widthPixels, `${path}.widthPixels`); positive(value.heightPixels, `${path}.heightPixels`); }
function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function positive(value, path) { if (!Number.isSafeInteger(value) || value < 1) fail("INVALID_POSITIVE_INTEGER", path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
