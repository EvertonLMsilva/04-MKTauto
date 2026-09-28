import { ContractValidationError } from "./contracts.js";

export const REFERENCE_INSIGHT_CONTRACT_VERSION = "reference-insight/1.0.0";
export const REFERENCE_ANALYSIS_POLICY_VERSION = "reference-analysis-policy/1.0.0";

const TOP_FIELDS = [
  "schemaVersion", "artifactType", "artifactId", "revision", "pipelineRunId",
  "projectId", "projectVersion", "logicalDate", "researchInputHash",
  "projectSnapshotHash", "policyVersion", "analysisWindow", "createdAt",
  "createdBy", "state", "references", "patterns", "gaps", "contentHash", "rights",
];
const REFERENCE_FIELDS = [
  "referenceKey", "platform", "configuredHandle", "purpose", "usage",
  "grantsUsageRights", "capability", "status", "observedItems", "evidence", "gaps",
];
const EVIDENCE_FIELDS = [
  "evidenceId", "providerContentId", "canonicalUrl", "publishedAt", "observedAt",
  "mediaType", "durationBand",
];
const PATTERN_FIELDS = [
  "dimension", "value", "itemCount", "referenceCount", "referenceKeys", "evidenceIds",
];
const NETWORKS = ["facebook", "instagram", "threads", "tiktok", "youtube"];
const REFERENCE_STATES = ["SUCCESS", "PARTIAL", "BLOCKED_BY_PROVIDER", "UNSUPPORTED", "FAILED"];
const ARTIFACT_STATES = ["COMPLETED", "COMPLETED_WITH_GAPS", "FAILED"];
const DIMENSIONS = [
  "PUBLISHING_CADENCE", "FORMAT_MIX", "DURATION_BAND", "CAPTION_OPENING_FORM",
  "CTA_STYLE", "PROJECT_TOPIC_AFFINITY",
];
const DURATION_BANDS = ["UNDER_15S", "15_30S", "31_60S", "61_180S", "OVER_180S", "UNAVAILABLE"];

export function createReferenceInsight(value) {
  record(value, "artifact");
  exact(value, TOP_FIELDS, "artifact");
  if (value.schemaVersion !== REFERENCE_INSIGHT_CONTRACT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  if (value.artifactType !== "strategic_reference_analysis") fail("INVALID_ARTIFACT_TYPE", "artifactType");
  identifier(value.artifactId, "artifactId", 200);
  identifier(value.pipelineRunId, "pipelineRunId");
  identifier(value.projectId, "projectId");
  if (value.revision !== 1) fail("INVALID_REVISION", "revision");
  if (!Number.isSafeInteger(value.projectVersion) || value.projectVersion < 1) fail("INVALID_PROJECT_VERSION", "projectVersion");
  date(value.logicalDate, "logicalDate");
  hash(value.researchInputHash, "researchInputHash");
  hash(value.projectSnapshotHash, "projectSnapshotHash");
  hash(value.contentHash, "contentHash");
  if (value.policyVersion !== REFERENCE_ANALYSIS_POLICY_VERSION) fail("UNSUPPORTED_POLICY_VERSION", "policyVersion");
  timestamp(value.createdAt, "createdAt");
  if (value.createdBy !== "SYSTEM") fail("INVALID_CREATED_BY", "createdBy");
  member(value.state, ARTIFACT_STATES, "state");
  strings(value.gaps, "gaps");
  validateWindow(value.analysisWindow);

  if (!Array.isArray(value.references)) fail("INVALID_TYPE", "references");
  const referenceKeys = new Set();
  const evidenceIds = new Set();
  value.references.forEach((reference, index) => validateReference(reference, index, referenceKeys, evidenceIds));

  if (!Array.isArray(value.patterns)) fail("INVALID_TYPE", "patterns");
  value.patterns.forEach((pattern, index) => validatePattern(pattern, index, referenceKeys, evidenceIds));
  validateRights(value.rights);
  rejectSensitiveOrSourceText(value);
  return deepFreeze(structuredClone(value));
}

function validateWindow(value) {
  record(value, "analysisWindow");
  exact(value, ["start", "end", "timezone", "maxItemsPerReference"], "analysisWindow");
  timestamp(value.start, "analysisWindow.start");
  timestamp(value.end, "analysisWindow.end");
  if (Date.parse(value.start) >= Date.parse(value.end)) fail("INVALID_WINDOW", "analysisWindow.end");
  text(value.timezone, "analysisWindow.timezone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).format(); } catch { fail("INVALID_TIMEZONE", "analysisWindow.timezone"); }
  integer(value.maxItemsPerReference, 1, 100, "analysisWindow.maxItemsPerReference");
}

function validateReference(value, index, referenceKeys, evidenceIds) {
  const path = `references[${index}]`;
  record(value, path);
  exact(value, REFERENCE_FIELDS, path);
  identifier(value.referenceKey, `${path}.referenceKey`, 200);
  if (referenceKeys.has(value.referenceKey)) fail("DUPLICATE_REFERENCE", `${path}.referenceKey`);
  referenceKeys.add(value.referenceKey);
  member(value.platform, NETWORKS, `${path}.platform`);
  text(value.configuredHandle, `${path}.configuredHandle`);
  if (value.purpose !== "strategic_reference" || value.usage !== "strategic_reference_only"
    || value.grantsUsageRights !== false) fail("INVALID_REFERENCE_RIGHTS", path);
  text(value.capability, `${path}.capability`);
  member(value.status, REFERENCE_STATES, `${path}.status`);
  integer(value.observedItems, 0, Number.MAX_SAFE_INTEGER, `${path}.observedItems`);
  strings(value.gaps, `${path}.gaps`);
  if (!Array.isArray(value.evidence)) fail("INVALID_TYPE", `${path}.evidence`);
  value.evidence.forEach((evidence, evidenceIndex) => {
    const evidencePath = `${path}.evidence[${evidenceIndex}]`;
    record(evidence, evidencePath);
    exact(evidence, EVIDENCE_FIELDS, evidencePath);
    identifier(evidence.evidenceId, `${evidencePath}.evidenceId`, 200);
    if (evidenceIds.has(evidence.evidenceId)) fail("DUPLICATE_EVIDENCE", `${evidencePath}.evidenceId`);
    evidenceIds.add(evidence.evidenceId);
    if (typeof evidence.providerContentId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(evidence.providerContentId)) {
      fail("INVALID_PROVIDER_CONTENT_ID", `${evidencePath}.providerContentId`);
    }
    canonicalUrl(evidence.canonicalUrl, value.platform, `${evidencePath}.canonicalUrl`);
    timestamp(evidence.publishedAt, `${evidencePath}.publishedAt`);
    timestamp(evidence.observedAt, `${evidencePath}.observedAt`);
    text(evidence.mediaType, `${evidencePath}.mediaType`);
    member(evidence.durationBand, DURATION_BANDS, `${evidencePath}.durationBand`);
  });
}

function validatePattern(value, index, referenceKeys, evidenceIds) {
  const path = `patterns[${index}]`;
  record(value, path);
  exact(value, PATTERN_FIELDS, path);
  member(value.dimension, DIMENSIONS, `${path}.dimension`);
  if (typeof value.value !== "string" || !/^[A-Z0-9_:.-]{2,100}$/.test(value.value)) fail("INVALID_PATTERN_VALUE", `${path}.value`);
  integer(value.itemCount, 3, Number.MAX_SAFE_INTEGER, `${path}.itemCount`);
  integer(value.referenceCount, 1, Number.MAX_SAFE_INTEGER, `${path}.referenceCount`);
  uniqueStrings(value.referenceKeys, `${path}.referenceKeys`);
  uniqueStrings(value.evidenceIds, `${path}.evidenceIds`);
  if (value.referenceKeys.length !== value.referenceCount) fail("INVALID_PATTERN_SUPPORT", `${path}.referenceCount`);
  if (value.evidenceIds.length !== value.itemCount) fail("INVALID_PATTERN_SUPPORT", `${path}.itemCount`);
  value.referenceKeys.forEach((key) => { if (!referenceKeys.has(key)) fail("UNKNOWN_REFERENCE", `${path}.referenceKeys`); });
  value.evidenceIds.forEach((id) => { if (!evidenceIds.has(id)) fail("UNKNOWN_EVIDENCE", `${path}.evidenceIds`); });
}

function validateRights(value) {
  record(value, "rights");
  exact(value, ["usageCondition", "grantsUsageRights", "mediaDownloaded", "sourceTextStored", "republicationAllowed"], "rights");
  if (value.usageCondition !== "strategic_reference_only" || value.grantsUsageRights !== false
    || value.mediaDownloaded !== false || value.sourceTextStored !== false || value.republicationAllowed !== false) {
    fail("INVALID_RIGHTS", "rights");
  }
}

function rejectSensitiveOrSourceText(value) {
  const forbidden = /^(?:(?:access|refresh)?token|api[_-]?key|authorization|secret|password|caption|title|description|biography|bio|text|source[_-]?text|transcript|thumbnail|media[_-]?url)$/i;
  const seen = new WeakSet();
  function visit(current, path) {
    if (!current || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbidden.test(key)) fail("FORBIDDEN_SOURCE_FIELD", childPath);
      visit(child, childPath);
    }
  }
  visit(value, "");
}

function canonicalUrl(value, platform, path) {
  let url;
  try { url = new URL(value); } catch { fail("INVALID_URL", path); }
  const hosts = {
    facebook: ["facebook.com"], instagram: ["instagram.com"], threads: ["threads.net", "threads.com"],
    tiktok: ["tiktok.com"], youtube: ["youtube.com", "youtu.be"],
  };
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts[platform].includes(host)) fail("INVALID_URL", path);
  const validPath = platform === "youtube"
    ? (host === "youtube.com" && url.pathname === "/watch" && url.searchParams.size === 1 && /^[A-Za-z0-9._-]{1,128}$/.test(url.searchParams.get("v") ?? ""))
      || (host === "youtu.be" && /^\/[A-Za-z0-9._-]{1,128}\/?$/.test(url.pathname) && url.search === "")
    : platform === "instagram" ? /^\/(?:p|reel|tv)\/[A-Za-z0-9._-]+\/?$/.test(url.pathname) && url.search === ""
      : platform === "threads" ? /^\/@[A-Za-z0-9._-]{1,30}\/post\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) && url.search === ""
        : platform === "tiktok" ? /^\/@[A-Za-z0-9._]{1,24}\/video\/\d{5,32}\/?$/.test(url.pathname) && url.search === ""
          : platform === "facebook" && url.search === "";
  if (!validPath || url.hash !== "") fail("INVALID_URL", path);
}

function exact(value, fields, path) {
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`);
  for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`);
}
function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function text(value, path) { if (typeof value !== "string" || value.trim() === "") fail("REQUIRED_FIELD", path); }
function strings(value, path) { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) fail("INVALID_TYPE", path); }
function uniqueStrings(value, path) { strings(value, path); if (new Set(value).size !== value.length) fail("DUPLICATE_VALUE", path); }
function member(value, allowed, path) { if (!allowed.includes(value)) fail("INVALID_ENUM", path); }
function integer(value, min, max, path) { if (!Number.isSafeInteger(value) || value < min || value > max) fail("INVALID_INTEGER", path); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function date(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) fail("INVALID_DATE", path); }
function timestamp(value, path) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
