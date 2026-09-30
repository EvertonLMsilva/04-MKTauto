import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";
import { SUBTITLE_STYLE_POLICY_VERSION } from "./subtitle-track-contracts.js";

export const SUBTITLE_RENDER_REQUEST_VERSION = "subtitle-render-request/1.0.0";
export const SUBTITLE_RENDER_RESULT_VERSION = "subtitle-render-result/1.0.0";
export const SUBTITLE_RENDER_POLICY_VERSION = "ffmpeg-subtitle-render-policy/1.0.0";
export const SUBTITLE_RENDER_DURATION_TOLERANCE_MILLISECONDS = 34;

const REQUEST_FIELDS = Object.freeze([
  "schemaVersion", "subtitleRenderRequestId", "pipelineRunId", "projectId", "projectVersion",
  "videoRenderId", "videoRenderContentHash", "compositionPlanId", "compositionPlanContentHash",
  "subtitleTrackId", "subtitleTrackContentHash", "scriptId", "scriptContentHash",
  "voiceTrackId", "voiceTrackContentHash", "stylePolicyVersion", "renderPolicyVersion",
  "requestedAt", "contentHash",
]);
const RESULT_FIELDS = Object.freeze([
  "schemaVersion", "subtitleRenderRequestId", "requestContentHash", "durationMilliseconds",
  "containerFormat", "outputAspectRatio", "widthPixels", "heightPixels", "frameRate",
  "videoCodec", "audioCodec", "audioSampleRate", "audioChannels", "contentHash",
  "logicalReference", "toolchain",
]);
const TOOLCHAIN_FIELDS = Object.freeze(["ffmpegVersion", "libassFingerprint", "fontFamily", "fontProvider"]);

export function validateSubtitleRenderRequest(value) {
  record(value, "request"); exact(value, REQUEST_FIELDS, "request");
  if (value.schemaVersion !== SUBTITLE_RENDER_REQUEST_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.subtitleRenderRequestId, "subtitleRenderRequestId", 200);
  identifier(value.pipelineRunId, "pipelineRunId"); identifier(value.projectId, "projectId");
  positive(value.projectVersion, "projectVersion", "INVALID_PROJECT_VERSION");
  for (const field of ["videoRenderId", "compositionPlanId", "subtitleTrackId", "scriptId", "voiceTrackId"]) identifier(value[field], field, 200);
  for (const field of ["videoRenderContentHash", "compositionPlanContentHash", "subtitleTrackContentHash", "scriptContentHash", "voiceTrackContentHash", "contentHash"]) hash(value[field], field);
  if (value.stylePolicyVersion !== SUBTITLE_STYLE_POLICY_VERSION) fail("UNSUPPORTED_STYLE_POLICY", "stylePolicyVersion");
  if (value.renderPolicyVersion !== SUBTITLE_RENDER_POLICY_VERSION) fail("UNSUPPORTED_RENDER_POLICY", "renderPolicyVersion");
  timestamp(value.requestedAt, "requestedAt");
  if (value.subtitleRenderRequestId !== `subtitle_render:${subtitleRenderIdentityHash(value)}`) fail("IDENTITY_MISMATCH", "subtitleRenderRequestId");
  if (value.contentHash !== subtitleRenderRequestHash(value)) fail("CONTENT_HASH_MISMATCH", "contentHash");
  return deepFreeze(structuredClone(value));
}

export function subtitleRenderIdentityHash(value) {
  const { subtitleRenderRequestId: _id, requestedAt: _at, contentHash: _hash, ...identity } = value;
  return sha256(stableJson(identity));
}

export function subtitleRenderRequestHash(value) {
  const { contentHash: _hash, ...content } = value;
  return sha256(stableJson(content));
}

export function validateSubtitleRenderResult(value) {
  record(value, "result"); exact(value, RESULT_FIELDS, "result");
  if (value.schemaVersion !== SUBTITLE_RENDER_RESULT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.subtitleRenderRequestId, "subtitleRenderRequestId", 200); hash(value.requestContentHash, "requestContentHash");
  positive(value.durationMilliseconds, "durationMilliseconds", "INVALID_DURATION");
  if (value.containerFormat !== "mp4") fail("INVALID_CONTAINER_FORMAT", "containerFormat");
  if (value.outputAspectRatio !== "9:16") fail("INVALID_OUTPUT_ASPECT_RATIO", "outputAspectRatio");
  if (value.widthPixels !== 1080 || value.heightPixels !== 1920) fail("INVALID_VIDEO_DIMENSION", "widthPixels");
  if (value.frameRate !== 30) fail("INVALID_FRAME_RATE", "frameRate");
  if (value.videoCodec !== "h264") fail("INVALID_VIDEO_CODEC", "videoCodec");
  if (value.audioCodec !== "aac" || value.audioSampleRate !== 48000 || value.audioChannels !== 1) fail("INVALID_AUDIO_POLICY", "audioCodec");
  hash(value.contentHash, "contentHash"); logicalReference(value.logicalReference);
  record(value.toolchain, "result.toolchain"); exact(value.toolchain, TOOLCHAIN_FIELDS, "result.toolchain");
  token(value.toolchain.ffmpegVersion, "result.toolchain.ffmpegVersion", 240);
  hash(value.toolchain.libassFingerprint, "result.toolchain.libassFingerprint");
  token(value.toolchain.fontFamily, "result.toolchain.fontFamily", 80); token(value.toolchain.fontProvider, "result.toolchain.fontProvider", 80);
  return deepFreeze(structuredClone(value));
}

function logicalReference(value) { if (typeof value !== "string" || !/^render:sha256_[a-f0-9]{64}$/.test(value)) fail("INVALID_LOGICAL_REFERENCE", "logicalReference"); }
function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function token(value, path, max) { if (typeof value !== "string" || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail("INVALID_TOOLCHAIN", path); }
function positive(value, path, code) { if (!Number.isSafeInteger(value) || value < 1) fail(code, path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
