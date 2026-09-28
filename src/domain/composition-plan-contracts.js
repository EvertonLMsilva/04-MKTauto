import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const COMPOSITION_PLAN_CONTRACT_VERSION = "composition-plan/1.0.0";

const FIELDS = Object.freeze([
  "schemaVersion", "compositionPlanId", "pipelineRunId", "projectId", "projectVersion",
  "scriptId", "scriptContentHash", "voiceTrackId", "voiceTrackContentHash",
  "outputAspectRatio", "timelineUnit", "continuityMode", "durationMilliseconds",
  "segments", "createdAt", "revision", "supersedesCompositionPlanId", "contentHash",
]);
const SEGMENT_FIELDS = Object.freeze([
  "position", "visualDirectionPosition", "mediaAssetId", "mediaAssetContentHash",
  "startMilliseconds", "endMilliseconds",
]);
const ASPECT_RATIOS = Object.freeze(["9:16", "1:1", "16:9"]);

export function validateCompositionPlan(value) {
  record(value, "compositionPlan");
  exact(value, FIELDS, "compositionPlan");
  if (value.schemaVersion !== COMPOSITION_PLAN_CONTRACT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.compositionPlanId, "compositionPlanId", 200);
  identifier(value.pipelineRunId, "pipelineRunId");
  identifier(value.projectId, "projectId");
  positiveInteger(value.projectVersion, "projectVersion", "INVALID_PROJECT_VERSION");
  identifier(value.scriptId, "scriptId", 200);
  hash(value.scriptContentHash, "scriptContentHash");
  identifier(value.voiceTrackId, "voiceTrackId", 200);
  hash(value.voiceTrackContentHash, "voiceTrackContentHash");
  if (!ASPECT_RATIOS.includes(value.outputAspectRatio)) fail("INVALID_OUTPUT_ASPECT_RATIO", "outputAspectRatio");
  if (value.timelineUnit !== "MILLISECOND") fail("UNSUPPORTED_TIMELINE_UNIT", "timelineUnit");
  if (value.continuityMode !== "CONTIGUOUS") fail("UNSUPPORTED_CONTINUITY_MODE", "continuityMode");
  boundedPositiveInteger(value.durationMilliseconds, "durationMilliseconds", "INVALID_DURATION", 86400000);
  validateSegments(value.segments, value.durationMilliseconds);
  timestamp(value.createdAt, "createdAt");
  positiveInteger(value.revision, "revision", "INVALID_REVISION");
  if (value.supersedesCompositionPlanId !== null) identifier(value.supersedesCompositionPlanId, "supersedesCompositionPlanId", 200);
  if (value.revision === 1 && value.supersedesCompositionPlanId !== null) fail("INVALID_SUPERSESSION", "supersedesCompositionPlanId");
  if (value.revision > 1 && value.supersedesCompositionPlanId === null) fail("SUPERSEDED_COMPOSITION_PLAN_REQUIRED", "supersedesCompositionPlanId");
  hash(value.contentHash, "contentHash");
  if (compositionPlanContentHash(value) !== value.contentHash) fail("CONTENT_HASH_MISMATCH", "contentHash");
  return deepFreeze(structuredClone(value));
}

export function compositionPlanContentHash(value) {
  const { contentHash: _contentHash, ...content } = value;
  return sha256(stableJson(content));
}

export function compositionPlanIdentityHash(value) {
  return sha256(stableJson(value));
}

function validateSegments(value, durationMilliseconds) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 300) fail("INVALID_SEGMENTS", "segments");
  const directions = new Set();
  const assets = new Set();
  let previousEnd = 0;
  value.forEach((segment, index) => {
    const path = `segments.${index}`;
    record(segment, path);
    exact(segment, SEGMENT_FIELDS, path);
    if (segment.position !== index + 1) fail("INVALID_SEGMENT_POSITION", `${path}.position`);
    positiveInteger(segment.visualDirectionPosition, `${path}.visualDirectionPosition`, "INVALID_VISUAL_DIRECTION_POSITION");
    if (directions.has(segment.visualDirectionPosition)) fail("DUPLICATE_VISUAL_DIRECTION", `${path}.visualDirectionPosition`);
    directions.add(segment.visualDirectionPosition);
    identifier(segment.mediaAssetId, `${path}.mediaAssetId`, 200);
    if (assets.has(segment.mediaAssetId)) fail("DUPLICATE_MEDIA_ASSET", `${path}.mediaAssetId`);
    assets.add(segment.mediaAssetId);
    hash(segment.mediaAssetContentHash, `${path}.mediaAssetContentHash`);
    nonNegativeInteger(segment.startMilliseconds, `${path}.startMilliseconds`);
    nonNegativeInteger(segment.endMilliseconds, `${path}.endMilliseconds`);
    if (index === 0 && segment.startMilliseconds !== 0) fail("TIMELINE_MUST_START_AT_ZERO", `${path}.startMilliseconds`);
    if (segment.endMilliseconds <= segment.startMilliseconds) fail("NON_POSITIVE_SEGMENT_DURATION", `${path}.endMilliseconds`);
    if (index > 0 && segment.startMilliseconds > previousEnd) fail("TIMELINE_GAP", `${path}.startMilliseconds`);
    if (index > 0 && segment.startMilliseconds < previousEnd) fail("TIMELINE_OVERLAP", `${path}.startMilliseconds`);
    previousEnd = segment.endMilliseconds;
  });
  if (previousEnd !== durationMilliseconds) fail("TIMELINE_DURATION_MISMATCH", "durationMilliseconds");
}

function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function positiveInteger(value, path, code) { if (!Number.isSafeInteger(value) || value < 1) fail(code, path); }
function boundedPositiveInteger(value, path, code, max) { if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(code, path); }
function nonNegativeInteger(value, path) { if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_TIME", path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
