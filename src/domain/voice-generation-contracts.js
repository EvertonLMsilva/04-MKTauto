import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const VOICE_GENERATION_REQUEST_VERSION = "voice-generation-request/1.0.0";

const REQUEST_FIELDS = Object.freeze([
  "schemaVersion", "generationRequestId", "scriptId", "scriptContentHash", "requestedAt", "contentHash",
]);
const OUTPUT_FIELDS = Object.freeze([
  "durationMilliseconds", "audioFormat", "contentHash", "storageReference",
  "provider", "origin", "rights",
]);
const RIGHTS_FIELDS = Object.freeze(["usageBasis", "commercialUseAllowed"]);
const AUDIO_FORMATS = Object.freeze(["mp3", "wav", "m4a", "ogg", "flac"]);
const USAGE_BASES = Object.freeze(["OWNED", "LICENSED", "PROVIDER_TERMS"]);
const SENSITIVE_VALUE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,}|[?&](?:token|signature|credential|key)=)/i;
const SENSITIVE_REFERENCE_SEGMENT = /(?:^|[/:._-])(?:token|secret|credential|password|signature|api.?key)(?:[/:._-]|$)/i;

export function validateVoiceGenerationRequest(value) {
  record(value, "request");
  exact(value, REQUEST_FIELDS, "request");
  if (value.schemaVersion !== VOICE_GENERATION_REQUEST_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.generationRequestId, "generationRequestId", 180);
  identifier(value.scriptId, "scriptId", 200);
  hash(value.scriptContentHash, "scriptContentHash");
  timestamp(value.requestedAt, "requestedAt");
  hash(value.contentHash, "contentHash");
  if (voiceGenerationRequestHash(value) !== value.contentHash) fail("CONTENT_HASH_MISMATCH", "contentHash");
  return deepFreeze(structuredClone(value));
}

export function voiceGenerationRequestHash(value) {
  const { contentHash: _contentHash, ...content } = value;
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

export function validateVoiceProviderOutput(value) {
  record(value, "output");
  exact(value, OUTPUT_FIELDS, "output");
  positiveInteger(value.durationMilliseconds, "durationMilliseconds", "INVALID_DURATION");
  if (!AUDIO_FORMATS.includes(value.audioFormat)) fail("INVALID_AUDIO_FORMAT", "audioFormat");
  hash(value.contentHash, "contentHash");
  storageReference(value.storageReference);
  identifier(value.provider, "provider", 100);
  if (value.origin !== "SYNTHETIC_TTS") fail("INVALID_VOICE_ORIGIN", "origin");
  rights(value.rights);
  return deepFreeze(structuredClone(value));
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
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
