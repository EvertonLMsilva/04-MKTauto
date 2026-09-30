import {
  ContractValidationError,
  validateSourceRun,
  validateTopicCluster,
  validateTrendCandidate,
  validateTrendScore,
} from "./contracts.js";

export const RESEARCH_SHORTLIST_CONTRACT_VERSION = "research-shortlist/1.0.0";
export const RESEARCH_SHORTLIST_POLICY_VERSION = "research-shortlist-policy/1.0.0";
export const DEFAULT_RESEARCH_SHORTLIST_POLICY = Object.freeze({
  version: RESEARCH_SHORTLIST_POLICY_VERSION,
  shortlistLimit: 5,
  maxPerCluster: 2,
  maxPerPlatform: 3,
  maxPerRegion: 3,
  relaxation: "FILL_IN_BASE_ORDER",
});

const FIELDS = Object.freeze([
  "schemaVersion", "artifactId", "artifactType", "revision", "pipelineRunId",
  "projectId", "projectVersion", "logicalDate", "timezone", "createdAt", "createdBy",
  "researchInputHash", "researchTopicCatalogArtifactId", "researchTopicCatalogHash",
  "trendRunId", "trendCatalogHash", "policy", "state", "orderedCandidates",
  "decisions", "coverage", "gaps", "contentHash", "rights",
]);
const ITEM_FIELDS = Object.freeze(["position", "candidate", "cluster", "score", "inclusionReasons"]);
const DECISION_FIELDS = Object.freeze(["candidateId", "decision", "position", "reasons"]);
const POLICY_FIELDS = Object.freeze(["version", "shortlistLimit", "maxPerCluster", "maxPerPlatform", "maxPerRegion", "relaxation"]);
const INCLUSION_REASONS = Object.freeze(["BASE_RANK", "DIVERSITY_ACCEPTED", "DIVERSITY_RELAXED"]);
const EXCLUSION_REASONS = Object.freeze([
  "SOURCE_CATALOG_FAILED", "CATALOG_EXCLUSION", "MISSING_SCORE", "AMBIGUOUS_SCORE",
  "MISSING_CLUSTER", "AMBIGUOUS_CLUSTER", "DURATION_UNAVAILABLE", "DURATION_OUT_OF_RANGE",
  "DIVERSITY_DEFERRED", "SHORTLIST_LIMIT_REACHED",
]);

export function createResearchShortlist(value) {
  record(value, "shortlist");
  exact(value, FIELDS, "shortlist");
  if (value.schemaVersion !== RESEARCH_SHORTLIST_CONTRACT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  if (value.artifactType !== "research_shortlist") fail("INVALID_ARTIFACT_TYPE", "artifactType");
  identifier(value.artifactId, "artifactId", 200);
  identifier(value.pipelineRunId, "pipelineRunId");
  identifier(value.projectId, "projectId");
  identifier(value.researchTopicCatalogArtifactId, "researchTopicCatalogArtifactId", 200);
  identifier(value.trendRunId, "trendRunId", 200);
  if (value.revision !== 1) fail("INVALID_REVISION", "revision");
  if (!Number.isSafeInteger(value.projectVersion) || value.projectVersion < 1) fail("INVALID_PROJECT_VERSION", "projectVersion");
  date(value.logicalDate, "logicalDate");
  timezone(value.timezone);
  timestamp(value.createdAt, "createdAt");
  if (value.createdBy !== "SYSTEM") fail("INVALID_CREATED_BY", "createdBy");
  for (const field of ["researchInputHash", "researchTopicCatalogHash", "trendCatalogHash", "contentHash"]) hash(value[field], field);
  validatePolicy(value.policy);
  if (!["COMPLETED", "COMPLETED_WITH_GAPS", "FAILED"].includes(value.state)) fail("INVALID_STATE", "state");
  strings(value.gaps, "gaps");

  if (!Array.isArray(value.orderedCandidates)) fail("INVALID_TYPE", "orderedCandidates");
  const selectedIds = new Set();
  value.orderedCandidates.forEach((item, index) => {
    const path = `orderedCandidates[${index}]`;
    record(item, path);
    exact(item, ITEM_FIELDS, path);
    if (item.position !== index + 1) fail("INVALID_POSITION", `${path}.position`);
    validateTrendCandidate(item.candidate);
    validateTopicCluster(item.cluster, item.cluster.candidateIds, item.cluster.evidenceSnapshotIds);
    validateTrendScore(item.score);
    if (item.score.candidateId !== item.candidate.id || !item.cluster.candidateIds.includes(item.candidate.id)) {
      fail("LINEAGE_MISMATCH", path);
    }
    if (selectedIds.has(item.candidate.id)) fail("DUPLICATE_CANDIDATE", `${path}.candidate.id`);
    selectedIds.add(item.candidate.id);
    enums(item.inclusionReasons, INCLUSION_REASONS, `${path}.inclusionReasons`, true);
  });
  if (value.orderedCandidates.length > value.policy.shortlistLimit) fail("SHORTLIST_LIMIT_EXCEEDED", "orderedCandidates");
  if (value.state === "FAILED" && value.orderedCandidates.length > 0) fail("INVALID_FAILED_RESULT", "orderedCandidates");

  if (!Array.isArray(value.decisions)) fail("INVALID_TYPE", "decisions");
  const decisionIds = new Set();
  value.decisions.forEach((decision, index) => {
    const path = `decisions[${index}]`;
    record(decision, path);
    exact(decision, DECISION_FIELDS, path);
    externalIdentifier(decision.candidateId, `${path}.candidateId`);
    if (decisionIds.has(decision.candidateId)) fail("DUPLICATE_CANDIDATE", `${path}.candidateId`);
    decisionIds.add(decision.candidateId);
    if (!["INCLUDED", "EXCLUDED"].includes(decision.decision)) fail("INVALID_DECISION", `${path}.decision`);
    if (decision.decision === "INCLUDED") {
      if (!Number.isInteger(decision.position) || decision.position < 1 || !selectedIds.has(decision.candidateId)) fail("INVALID_POSITION", `${path}.position`);
      enums(decision.reasons, INCLUSION_REASONS, `${path}.reasons`, true);
    } else {
      if (decision.position !== null) fail("INVALID_POSITION", `${path}.position`);
      enums(decision.reasons, EXCLUSION_REASONS, `${path}.reasons`, true);
    }
  });
  if (decisionIds.size !== value.decisions.length || [...selectedIds].some((id) => !decisionIds.has(id))) fail("INCOMPLETE_DECISIONS", "decisions");
  if (!Array.isArray(value.coverage)) fail("INVALID_TYPE", "coverage");
  value.coverage.forEach(validateSourceRun);

  record(value.rights, "rights");
  exact(value.rights, ["usageCondition", "mediaDownloaded", "republicationAllowed"], "rights");
  if (value.rights.usageCondition !== "REFERENCE_ONLY" || value.rights.mediaDownloaded !== false || value.rights.republicationAllowed !== false) fail("INVALID_RIGHTS", "rights");
  return deepFreeze(structuredClone(value));
}

export function validateResearchShortlistPolicy(value) {
  record(value, "policy");
  exact(value, POLICY_FIELDS, "policy");
  if (value.version !== RESEARCH_SHORTLIST_POLICY_VERSION) fail("UNSUPPORTED_POLICY_VERSION", "policy.version");
  for (const [field, expected] of [["shortlistLimit", 5], ["maxPerCluster", 2], ["maxPerPlatform", 3], ["maxPerRegion", 3]]) {
    if (value[field] !== expected) fail("INVALID_POLICY", `policy.${field}`);
  }
  if (value.relaxation !== "FILL_IN_BASE_ORDER") fail("INVALID_POLICY", "policy.relaxation");
  return value;
}

function validatePolicy(value) { validateResearchShortlistPolicy(value); }
function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function externalIdentifier(value, path) { if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function strings(value, path) { if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) fail("INVALID_TYPE", path); }
function enums(value, allowed, path, nonempty = false) { strings(value, path); if ((nonempty && value.length === 0) || value.some((item) => !allowed.includes(item))) fail("INVALID_ENUM", path); }
function date(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) fail("INVALID_LOGICAL_DATE", path); }
function timezone(value) { try { if (typeof value !== "string" || value === "") throw new Error(); new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); } catch { fail("INVALID_TIMEZONE", "timezone"); } }
function timestamp(value, path) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
