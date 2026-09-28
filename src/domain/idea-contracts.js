import { ContractValidationError } from "./contracts.js";

export const IDEA_CANDIDATE_CONTRACT_VERSION = "idea-candidate/1.0.0";
export const IDEA_SCORE_CONTRACT_VERSION = "idea-score/1.0.0";
export const IDEA_SCORING_POLICY_VERSION = "idea-scoring-policy/1.0.0";
export const IDEA_SCORING_TIE_BREAK = "TOTAL_DESC,EVIDENCE_DESC,FIT_DESC,CONTENT_IDENTITY_ASC,IDEA_ID_ASC";

export const DEFAULT_IDEA_SCORING_POLICY = deepFreeze({
  version: IDEA_SCORING_POLICY_VERSION,
  weights: {
    nicheAudienceFit: 0.25,
    evidenceStrength: 0.25,
    novelty: 0.15,
    editorialFeasibility: 0.15,
    editorialRightsRisk: 0.1,
    diversity: 0.1,
  },
  unavailableHandling: "RENORMALIZE_AVAILABLE_WEIGHTS",
  rightsRiskContribution: "ONE_MINUS_RISK",
  tieBreakRule: IDEA_SCORING_TIE_BREAK,
});

const CANDIDATE_FIELDS = Object.freeze([
  "schemaVersion", "ideaCandidateId", "ideaBatchId", "pipelineRunId", "projectId",
  "projectVersion", "contentIdentity", "title", "editorialAngle", "editorialIntent",
  "researchShortlistId", "evidenceCandidateIds", "referenceInsightId",
  "referenceEvidenceIds", "createdAt", "origin", "contentHash",
]);
const SCORE_FIELDS = Object.freeze([
  "schemaVersion", "ideaScoreId", "ideaCandidateId", "ideaBatchId", "pipelineRunId",
  "projectId", "projectVersion", "policyVersion", "calculatedAt", "components", "total",
  "rank", "tieBreakRule", "explanation", "contentHash",
]);
const COMPONENT_NAMES = Object.freeze(Object.keys(DEFAULT_IDEA_SCORING_POLICY.weights));
const COMPONENT_FIELDS = Object.freeze([
  "availability", "value", "weight", "reason", "evidenceIds", "contribution",
]);
const SENSITIVE_VALUE = /(?:bearer\s+\S+|sk-[a-z0-9_-]{8,})/i;

export function validateIdeaCandidate(value) {
  record(value, "idea");
  exact(value, CANDIDATE_FIELDS, "idea");
  if (value.schemaVersion !== IDEA_CANDIDATE_CONTRACT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.ideaCandidateId, "ideaCandidateId", 200);
  identifier(value.ideaBatchId, "ideaBatchId", 200);
  identifier(value.pipelineRunId, "pipelineRunId");
  identifier(value.projectId, "projectId");
  positiveInteger(value.projectVersion, "projectVersion");
  contentIdentity(value.contentIdentity);
  normalizedText(value.title, "title", 8, 160);
  normalizedText(value.editorialAngle, "editorialAngle", 8, 400);
  record(value.editorialIntent, "editorialIntent");
  exact(value.editorialIntent, ["audienceProfile", "language"], "editorialIntent");
  normalizedText(value.editorialIntent.audienceProfile, "editorialIntent.audienceProfile", 2, 300);
  if (typeof value.editorialIntent.language !== "string" || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.editorialIntent.language)) {
    fail("INVALID_LANGUAGE", "editorialIntent.language");
  }
  identifier(value.researchShortlistId, "researchShortlistId", 200);
  identifiers(value.evidenceCandidateIds, "evidenceCandidateIds", true);
  if (value.referenceInsightId !== null) identifier(value.referenceInsightId, "referenceInsightId", 200);
  identifiers(value.referenceEvidenceIds, "referenceEvidenceIds", false);
  if (value.referenceInsightId === null && value.referenceEvidenceIds.length > 0) {
    fail("REFERENCE_INSIGHT_REQUIRED", "referenceInsightId");
  }
  timestamp(value.createdAt, "createdAt");
  if (!["OPERATOR", "EXTERNAL_CONSUMER"].includes(value.origin)) fail("INVALID_ORIGIN", "origin");
  hash(value.contentHash, "contentHash");
  rejectSensitive(value);
  return deepFreeze(structuredClone(value));
}

export function validateIdeaScore(value) {
  record(value, "score");
  exact(value, SCORE_FIELDS, "score");
  if (value.schemaVersion !== IDEA_SCORE_CONTRACT_VERSION) fail("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  identifier(value.ideaScoreId, "ideaScoreId", 200);
  identifier(value.ideaCandidateId, "ideaCandidateId", 200);
  identifier(value.ideaBatchId, "ideaBatchId", 200);
  identifier(value.pipelineRunId, "pipelineRunId");
  identifier(value.projectId, "projectId");
  positiveInteger(value.projectVersion, "projectVersion");
  if (value.policyVersion !== IDEA_SCORING_POLICY_VERSION) fail("UNSUPPORTED_POLICY_VERSION", "policyVersion");
  timestamp(value.calculatedAt, "calculatedAt");
  record(value.components, "components");
  exact(value.components, COMPONENT_NAMES, "components");
  for (const name of COMPONENT_NAMES) validateComponent(name, value.components[name]);
  decimal(value.total, "total");
  positiveInteger(value.rank, "rank");
  if (value.tieBreakRule !== IDEA_SCORING_TIE_BREAK) fail("INVALID_TIE_BREAK_RULE", "tieBreakRule");
  normalizedText(value.explanation, "explanation", 2, 500);
  hash(value.contentHash, "contentHash");
  const available = COMPONENT_NAMES.map((name) => value.components[name]).filter(({ availability }) => availability === "AVAILABLE");
  const expected = available.length === 0 ? null : round(
    available.reduce((sum, item) => sum + item.contribution, 0)
      / available.reduce((sum, item) => sum + item.weight, 0),
  );
  if (expected === null || value.total !== expected) fail("INVALID_TOTAL", "total");
  return deepFreeze(structuredClone(value));
}

export function validateIdeaScoringPolicy(value) {
  record(value, "policy");
  exact(value, ["version", "weights", "unavailableHandling", "rightsRiskContribution", "tieBreakRule"], "policy");
  if (value.version !== IDEA_SCORING_POLICY_VERSION) fail("UNSUPPORTED_POLICY_VERSION", "policy.version");
  record(value.weights, "policy.weights");
  exact(value.weights, COMPONENT_NAMES, "policy.weights");
  for (const name of COMPONENT_NAMES) if (value.weights[name] !== DEFAULT_IDEA_SCORING_POLICY.weights[name]) fail("INVALID_POLICY", `policy.weights.${name}`);
  if (value.unavailableHandling !== "RENORMALIZE_AVAILABLE_WEIGHTS") fail("INVALID_POLICY", "policy.unavailableHandling");
  if (value.rightsRiskContribution !== "ONE_MINUS_RISK") fail("INVALID_POLICY", "policy.rightsRiskContribution");
  if (value.tieBreakRule !== IDEA_SCORING_TIE_BREAK) fail("INVALID_POLICY", "policy.tieBreakRule");
  return value;
}

function validateComponent(name, value) {
  const path = `components.${name}`;
  record(value, path);
  exact(value, COMPONENT_FIELDS, path);
  if (!["AVAILABLE", "UNAVAILABLE"].includes(value.availability)) fail("INVALID_AVAILABILITY", `${path}.availability`);
  if (value.weight !== DEFAULT_IDEA_SCORING_POLICY.weights[name]) fail("INVALID_WEIGHT", `${path}.weight`);
  normalizedText(value.reason, `${path}.reason`, 2, 300);
  identifiers(value.evidenceIds, `${path}.evidenceIds`, false);
  if (value.availability === "UNAVAILABLE") {
    if (value.value !== null) fail("UNAVAILABLE_VALUE_PRESENT", `${path}.value`);
    if (value.contribution !== null) fail("UNAVAILABLE_CONTRIBUTION_PRESENT", `${path}.contribution`);
    return;
  }
  decimal(value.value, `${path}.value`);
  decimal(value.contribution, `${path}.contribution`);
  const quality = name === "editorialRightsRisk" ? 1 - value.value : value.value;
  if (value.contribution !== round(quality * value.weight)) fail("INVALID_CONTRIBUTION", `${path}.contribution`);
}

function rejectSensitive(value) {
  const forbiddenKey = /^(?:prompt|systemMessage|instruction|token|apiKey|secret|password|media|transcript|sourceText|payload)$/i;
  const visit = (current, path) => {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbiddenKey.test(key)) fail("FORBIDDEN_FIELD", childPath);
      if (typeof child === "string" && SENSITIVE_VALUE.test(child)) fail("SENSITIVE_CONTENT", childPath);
      visit(child, childPath);
    }
  };
  visit(value, "");
}

function record(value, path) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_TYPE", path); }
function exact(value, fields, path) { for (const key of Object.keys(value)) if (!fields.includes(key)) fail("UNKNOWN_FIELD", `${path}.${key}`); for (const key of fields) if (!(key in value)) fail("REQUIRED_FIELD", `${path}.${key}`); }
function identifier(value, path, max = 80) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) fail("INVALID_IDENTIFIER", path); }
function identifiers(value, path, nonempty) { if (!Array.isArray(value) || (nonempty && value.length === 0)) fail("INVALID_TYPE", path); const seen = new Set(); value.forEach((item, index) => { identifier(item, `${path}.${index}`, 200); if (seen.has(item)) fail("DUPLICATE_VALUE", `${path}.${index}`); seen.add(item); }); }
function contentIdentity(value) { if (typeof value !== "string" || !/^idea:[a-f0-9]{64}$/.test(value)) fail("INVALID_CONTENT_IDENTITY", "contentIdentity"); }
function positiveInteger(value, path) { if (!Number.isSafeInteger(value) || value < 1) fail("INVALID_INTEGER", path); }
function decimal(value, path) { if (!Number.isFinite(value) || value < 0 || value > 1 || value !== round(value)) fail("INVALID_NORMALIZED_VALUE", path); }
function normalizedText(value, path, min, max) { if (typeof value !== "string" || value.length < min || value.length > max || value !== value.normalize("NFC").trim().replace(/\s+/g, " ")) fail("INVALID_TEXT", path); }
function hash(value, path) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("INVALID_HASH", path); }
function timestamp(value, path) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail("INVALID_TIMESTAMP", path); }
function round(value) { return Number(value.toFixed(6)); }
function deepFreeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); }
function fail(code, path) { throw new ContractValidationError(code, path, "valor inválido"); }
