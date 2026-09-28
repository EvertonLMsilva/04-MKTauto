import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const VOICE_TRACK_CONTRACT_VERSION = "voice-track/1.0.0";

const FIELDS = Object.freeze([
  "schemaVersion", "voiceTrackId", "pipelineRunId", "projectId", "projectVersion",
  "scriptId", "scriptContentHash", "language", "voiceStyle", "durationMilliseconds",
  "audioFormat", "contentHash", "storageReference", "origin", "provider", "rights",
  "createdAt", "revision", "supersedesVoiceTrackId",
]);
const RIGHTS_FIELDS = Object.freeze(["usageBasis", "commercialUseAllowed"]);
const AUDIO_FORMATS = Object.freeze(["mp3", "wav", "m4a", "ogg", "flac"]);
const VOICE_ORIGINS = Object.freeze(["SYNTHETIC_TTS", "OPERATOR_RECORDING", "AUTHORIZED_RECORDING"]);
const USAGE_BASES = Object.freeze(["OWNED", "LICENSED", "PROVIDER_TERMS"]);
const SENSITIVE_VALUE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,}|[?&](?:token|signature|credential|key)=)/i;
const SENSITIVE_REFERENCE_SEGMENT = /(?:^|[/:._-])(?:token|secret|credential|password|signature|api.?key)(?:[/:._-]|$)/i;

export function validateVoiceTrack(value) {
  record(value, "voiceTrack");
  exact(value, FIELDS, "voiceTrack");
  if (value.schemaVersion !== VOICE_TRACK_CONTRACT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.voiceTrackId, "voiceTrackId", 200);
  identifier(value.pipelineRunId, "pipelineRunId");
  identifier(value.projectId, "projectId");
  positiveInteger(value.projectVersion, "projectVersion", "INVALID_PROJECT_VERSION");
  identifier(value.scriptId, "scriptId", 200);
  hash(value.scriptContentHash, "scriptContentHash");
  language(value.language, "language");
  normalizedText(value.voiceStyle, "voiceStyle", 2, 100);
  positiveInteger(value.durationMilliseconds, "durationMilliseconds", "INVALID_DURATION");
  if (!AUDIO_FORMATS.includes(value.audioFormat)) fail("INVALID_AUDIO_FORMAT", "audioFormat");
  hash(value.contentHash, "contentHash");
  storageReference(value.storageReference);
  if (!VOICE_ORIGINS.includes(value.origin)) fail("INVALID_VOICE_ORIGIN", "origin");
  if (value.provider !== null) identifier(value.provider, "provider", 100);
  if (value.origin === "SYNTHETIC_TTS" && value.provider === null) fail("PROVIDER_REQUIRED", "provider");
  rights(value.rights);
  timestamp(value.createdAt, "createdAt");
  positiveInteger(value.revision, "revision", "INVALID_REVISION");
  if (value.supersedesVoiceTrackId !== null) identifier(value.supersedesVoiceTrackId, "supersedesVoiceTrackId", 200);
  if (value.revision === 1 && value.supersedesVoiceTrackId !== null) fail("INVALID_SUPERSESSION", "supersedesVoiceTrackId");
  if (value.revision > 1 && value.supersedesVoiceTrackId === null) fail("SUPERSEDED_VOICE_TRACK_REQUIRED", "supersedesVoiceTrackId");
  return deepFreeze(structuredClone(value));
}

export function voiceTrackIdentityHash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function rights(value) {
  record(value, "rights");
  exact(value, RIGHTS_FIELDS, "rights");
  if (!USAGE_BASES.includes(value.usageBasis)) fail("INVALID_USAGE_BASIS", "rights.usageBasis");
  if (value.commercialUseAllowed !== true) fail("COMMERCIAL_USE_REQUIRED", "rights.commercialUseAllowed");
}

function storageReference(value) {
  const safe = typeof value === "string"
    && value.length >= 3 && value.length <= 300
    && /^[a-z0-9][a-z0-9._:/-]+$/.test(value)
    && !value.includes("..")
    && !value.startsWith("/")
    && !/^[a-z]:\//i.test(value)
    && !/^(?:https?|file):/i.test(value)
    && !SENSITIVE_VALUE.test(value)
    && !SENSITIVE_REFERENCE_SEGMENT.test(value);
  if (!safe) fail("INVALID_STORAGE_REFERENCE", "storageReference");
}

function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function positiveInteger(value, path, code) { if (!Number.isSafeInteger(value) || value < 1) fail(code, path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function language(value, path) { if (typeof value !== "string" || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value)) fail("INVALID_LANGUAGE", path); }
function normalizedText(value, path, min, max) { if (typeof value !== "string" || value.length < min || value.length > max || value !== value.normalize("NFC").trim().replace(/\s+/g, " ")) fail("INVALID_TEXT", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
