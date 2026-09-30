import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const SUBTITLE_TRACK_CONTRACT_VERSION = "subtitle-track/1.0.0";
export const SUBTITLE_STYLE_POLICY_VERSION = "subtitle-style-policy/1.1.0";

const FIELDS = Object.freeze([
  "schemaVersion", "subtitleTrackId", "pipelineRunId", "projectId", "projectVersion",
  "scriptId", "scriptContentHash", "voiceTrackId", "voiceTrackContentHash",
  "language", "timeUnit", "durationMilliseconds", "stylePolicyVersion", "cues",
  "createdAt", "revision", "supersedesSubtitleTrackId", "contentHash",
]);
const CUE_FIELDS = Object.freeze(["position", "text", "startMilliseconds", "endMilliseconds"]);
const SENSITIVE_VALUE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,}|[?&](?:token|signature|credential|key)=)/i;

export function validateSubtitleTrack(value) {
  record(value, "subtitleTrack");
  exact(value, FIELDS, "subtitleTrack");
  if (value.schemaVersion !== SUBTITLE_TRACK_CONTRACT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.subtitleTrackId, "subtitleTrackId", 200);
  identifier(value.pipelineRunId, "pipelineRunId");
  identifier(value.projectId, "projectId");
  positiveInteger(value.projectVersion, "projectVersion", "INVALID_PROJECT_VERSION");
  identifier(value.scriptId, "scriptId", 200);
  hash(value.scriptContentHash, "scriptContentHash");
  identifier(value.voiceTrackId, "voiceTrackId", 200);
  hash(value.voiceTrackContentHash, "voiceTrackContentHash");
  language(value.language, "language");
  if (value.timeUnit !== "MILLISECONDS") fail("INVALID_TIME_UNIT", "timeUnit");
  positiveInteger(value.durationMilliseconds, "durationMilliseconds", "INVALID_DURATION");
  if (value.stylePolicyVersion !== SUBTITLE_STYLE_POLICY_VERSION) fail("UNSUPPORTED_STYLE_POLICY", "stylePolicyVersion");
  validateCues(value.cues, value.durationMilliseconds);
  timestamp(value.createdAt, "createdAt");
  positiveInteger(value.revision, "revision", "INVALID_REVISION");
  if (value.supersedesSubtitleTrackId !== null) identifier(value.supersedesSubtitleTrackId, "supersedesSubtitleTrackId", 200);
  if (value.revision === 1 && value.supersedesSubtitleTrackId !== null) fail("INVALID_SUPERSESSION", "supersedesSubtitleTrackId");
  if (value.revision > 1 && value.supersedesSubtitleTrackId === null) fail("SUPERSEDED_SUBTITLE_TRACK_REQUIRED", "supersedesSubtitleTrackId");
  hash(value.contentHash, "contentHash");
  if (subtitleTrackContentHash(value) !== value.contentHash) fail("CONTENT_HASH_MISMATCH", "contentHash");
  return deepFreeze(structuredClone(value));
}

export function subtitleTrackContentHash(value) {
  const { contentHash: _contentHash, ...content } = value;
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

export function subtitleTrackIdentityHash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function validateCues(value, durationMilliseconds) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) fail("INVALID_CUES", "cues");
  let previousEnd = null;
  value.forEach((cue, index) => {
    const path = `cues.${index}`;
    record(cue, path);
    exact(cue, CUE_FIELDS, path);
    if (cue.position !== index + 1) fail("INVALID_CUE_POSITION", `${path}.position`);
    cueText(cue.text, `${path}.text`);
    nonNegativeInteger(cue.startMilliseconds, `${path}.startMilliseconds`);
    if (!Number.isSafeInteger(cue.endMilliseconds)) fail("INVALID_CUE_END", `${path}.endMilliseconds`);
    if (index === 0 && cue.startMilliseconds !== 0) fail("FIRST_CUE_MUST_START_AT_ZERO", `${path}.startMilliseconds`);
    if (cue.endMilliseconds <= cue.startMilliseconds) fail("INVALID_CUE_DURATION", `${path}.endMilliseconds`);
    if (previousEnd !== null && cue.startMilliseconds < previousEnd) fail("CUE_OVERLAP", `${path}.startMilliseconds`);
    if (cue.endMilliseconds > durationMilliseconds) fail("CUE_EXCEEDS_VOICE_DURATION", `${path}.endMilliseconds`);
    previousEnd = cue.endMilliseconds;
  });
}

function cueText(value, path) {
  const valid = typeof value === "string"
    && value.length >= 1 && value.length <= 1000
    && value === value.normalize("NFC").trim().replace(/\s+/gu, " ")
    && !/[\u0000-\u001f\u007f]/u.test(value);
  if (!valid) fail("INVALID_CUE_TEXT", path);
  if (SENSITIVE_VALUE.test(value)) fail("SENSITIVE_CONTENT", path);
}

function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function language(value, path) { if (typeof value !== "string" || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value)) fail("INVALID_LANGUAGE", path); }
function positiveInteger(value, path, code) { if (!Number.isSafeInteger(value) || value < 1) fail(code, path); }
function nonNegativeInteger(value, path) { if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_CUE_START", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
