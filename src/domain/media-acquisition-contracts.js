import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const MEDIA_ACQUISITION_REQUEST_VERSION = "media-acquisition-request/1.0.0";

const REQUEST_FIELDS = Object.freeze([
  "schemaVersion", "mediaAcquisitionRequestId", "scriptId", "scriptContentHash",
  "visualDirectionPosition", "assetType", "requestedAt", "contentHash",
]);
const OUTPUT_FIELDS = Object.freeze([
  "assetType", "technicalProperties", "contentHash", "mediaReference", "origin",
  "provider", "rights",
]);
const TECHNICAL_FIELDS = Object.freeze(["format", "widthPixels", "heightPixels", "durationMilliseconds"]);
const RIGHTS_FIELDS = Object.freeze(["usageBasis", "commercialUseAllowed"]);
const ASSET_TYPES = Object.freeze(["IMAGE", "VIDEO"]);
const FORMATS = Object.freeze({ IMAGE: ["jpeg", "png", "webp"], VIDEO: ["mp4", "webm", "mov"] });
const ORIGINS = Object.freeze(["OPERATOR_OWNED", "AUTHORIZED_THIRD_PARTY", "PROVIDER_GENERATED", "PROVIDER_LICENSED"]);
const PROVIDER_ORIGINS = new Set(["PROVIDER_GENERATED", "PROVIDER_LICENSED"]);
const USAGE_BASES = Object.freeze(["OWNED", "LICENSED", "EXPLICIT_PERMISSION", "PROVIDER_TERMS"]);
const FORBIDDEN_REFERENCE_SCHEME = /^(?:https?|file|data|s3|gs|az|blob|bucket|object|storage|path):/i;
const SENSITIVE_REFERENCE = /(?:^|[:._-])(?:token|secret|credential|password|signature|api.?key)(?:[:._-]|$)/i;

export function validateMediaAcquisitionRequest(value) {
  record(value, "request");
  exact(value, REQUEST_FIELDS, "request");
  if (value.schemaVersion !== MEDIA_ACQUISITION_REQUEST_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.mediaAcquisitionRequestId, "mediaAcquisitionRequestId", 180);
  identifier(value.scriptId, "scriptId", 200);
  hash(value.scriptContentHash, "scriptContentHash");
  positiveInteger(value.visualDirectionPosition, "visualDirectionPosition", "INVALID_VISUAL_DIRECTION_POSITION");
  if (!ASSET_TYPES.includes(value.assetType)) fail("INVALID_ASSET_TYPE", "assetType");
  timestamp(value.requestedAt, "requestedAt");
  hash(value.contentHash, "contentHash");
  if (mediaAcquisitionRequestHash(value) !== value.contentHash) fail("CONTENT_HASH_MISMATCH", "contentHash");
  return deepFreeze(structuredClone(value));
}

export function mediaAcquisitionRequestHash(value) {
  const { contentHash: _contentHash, ...content } = value;
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

export function validateMediaProviderOutput(value) {
  record(value, "output");
  exact(value, OUTPUT_FIELDS, "output");
  if (!ASSET_TYPES.includes(value.assetType)) fail("INVALID_ASSET_TYPE", "assetType");
  technicalProperties(value.technicalProperties, value.assetType);
  hash(value.contentHash, "contentHash");
  mediaReference(value.mediaReference);
  if (!ORIGINS.includes(value.origin)) fail("INVALID_MEDIA_ORIGIN", "origin");
  if (value.provider !== null) identifier(value.provider, "provider", 100);
  if (PROVIDER_ORIGINS.has(value.origin) && value.provider === null) fail("PROVIDER_REQUIRED", "provider");
  if (!PROVIDER_ORIGINS.has(value.origin) && value.provider !== null) fail("PROVIDER_NOT_APPLICABLE", "provider");
  rights(value.rights);
  validateRightsOrigin(value.origin, value.rights.usageBasis);
  return deepFreeze(structuredClone(value));
}

function technicalProperties(value, assetType) {
  record(value, "technicalProperties");
  exact(value, TECHNICAL_FIELDS, "technicalProperties");
  if (!FORMATS[assetType].includes(value.format)) fail("INVALID_MEDIA_FORMAT", "technicalProperties.format");
  boundedPositiveInteger(value.widthPixels, "technicalProperties.widthPixels", "INVALID_MEDIA_DIMENSION", 100000);
  boundedPositiveInteger(value.heightPixels, "technicalProperties.heightPixels", "INVALID_MEDIA_DIMENSION", 100000);
  if (assetType === "IMAGE" && value.durationMilliseconds !== null) fail("DURATION_NOT_APPLICABLE", "technicalProperties.durationMilliseconds");
  if (assetType === "VIDEO") boundedPositiveInteger(value.durationMilliseconds, "technicalProperties.durationMilliseconds", "INVALID_DURATION", 86400000);
}

function rights(value) {
  record(value, "rights");
  exact(value, RIGHTS_FIELDS, "rights");
  if (!USAGE_BASES.includes(value.usageBasis)) fail("INVALID_USAGE_BASIS", "rights.usageBasis");
  if (value.commercialUseAllowed !== true) fail("COMMERCIAL_USE_REQUIRED", "rights.commercialUseAllowed");
}

function validateRightsOrigin(origin, usageBasis) {
  const allowed = {
    OPERATOR_OWNED: ["OWNED"], AUTHORIZED_THIRD_PARTY: ["LICENSED", "EXPLICIT_PERMISSION"],
    PROVIDER_GENERATED: ["PROVIDER_TERMS"], PROVIDER_LICENSED: ["LICENSED", "PROVIDER_TERMS"],
  };
  if (!allowed[origin].includes(usageBasis)) fail("RIGHTS_ORIGIN_MISMATCH", "rights.usageBasis");
}

function mediaReference(value) {
  const safe = typeof value === "string" && value.length >= 7 && value.length <= 250
    && /^[a-z][a-z0-9_-]{2,40}:[a-z0-9][a-z0-9._-]{2,200}$/.test(value)
    && !FORBIDDEN_REFERENCE_SCHEME.test(value) && !SENSITIVE_REFERENCE.test(value);
  if (!safe) fail("INVALID_MEDIA_REFERENCE", "mediaReference");
}

function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function positiveInteger(value, path, code) { if (!Number.isSafeInteger(value) || value < 1) fail(code, path); }
function boundedPositiveInteger(value, path, code, max) { if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(code, path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
