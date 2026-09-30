import { createHash } from "node:crypto";
import { ContractValidationError } from "./contracts.js";

export const HUMAN_APPROVAL_DECISION_VERSION = "human-approval-decision/1.0.0";
export const HUMAN_APPROVAL_DECISIONS = Object.freeze(["APPROVED", "REJECTED"]);

const IDENTITY_FIELDS = Object.freeze([
  "projectId", "projectVersion", "pipelineRunId", "videoRenderId",
  "videoRenderRevision", "videoRenderContentHash", "qualityControlReportId",
  "qualityControlReportContentHash",
]);
const FIELDS = Object.freeze([
  "schemaVersion", "humanApprovalDecisionId", ...IDENTITY_FIELDS,
  "decision", "actor", "justification", "decidedAt", "contentHash",
]);
const SENSITIVE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{3,}|[?&](?:token|signature|credential|key)=|(?:^|[\\/])users[\\/]|[a-z]:[\\/])/i;

export function validateHumanApprovalDecision(value) {
  record(value, "decision"); exact(value, FIELDS, "decision");
  if (value.schemaVersion !== HUMAN_APPROVAL_DECISION_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  validateHumanApprovalIdentity(value);
  identifier(value.humanApprovalDecisionId, "humanApprovalDecisionId", 200);
  if (value.humanApprovalDecisionId !== humanApprovalDecisionId(value)) fail("DECISION_ID_MISMATCH", "humanApprovalDecisionId");
  if (!HUMAN_APPROVAL_DECISIONS.includes(value.decision)) fail("INVALID_DECISION", "decision");
  publicText(value.actor, "actor", 100);
  if (value.justification !== null) publicText(value.justification, "justification", 1000);
  if (value.decision === "REJECTED" && value.justification === null) fail("JUSTIFICATION_REQUIRED", "justification");
  timestamp(value.decidedAt, "decidedAt"); hash(value.contentHash, "contentHash");
  if (humanApprovalDecisionContentHash(value) !== value.contentHash) fail("CONTENT_HASH_MISMATCH", "contentHash");
  return deepFreeze(structuredClone(value));
}

export function validateHumanApprovalIdentity(value) {
  record(value, "identity");
  identifier(value.projectId, "projectId"); positiveInteger(value.projectVersion, "projectVersion");
  identifier(value.pipelineRunId, "pipelineRunId"); identifier(value.videoRenderId, "videoRenderId", 200);
  positiveInteger(value.videoRenderRevision, "videoRenderRevision"); hash(value.videoRenderContentHash, "videoRenderContentHash");
  identifier(value.qualityControlReportId, "qualityControlReportId", 200); hash(value.qualityControlReportContentHash, "qualityControlReportContentHash");
  return Object.freeze(Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, value[field]])));
}

export function humanApprovalDecisionId(value) {
  const identity = validateHumanApprovalIdentity(value);
  return `human_approval:${sha256(stableJson(identity))}`;
}

export function humanApprovalDecisionContentHash(value) {
  const { contentHash: _contentHash, ...content } = value;
  return sha256(stableJson(content));
}

export function humanApprovalDecisionIdentityHash(value) { return sha256(stableJson(value)); }

function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function positiveInteger(value, path) { if (!Number.isSafeInteger(value) || value < 1) fail("INVALID_POSITIVE_INTEGER", path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function publicText(value, path, max) { if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || SENSITIVE.test(value)) fail("INVALID_PUBLIC_TEXT", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
