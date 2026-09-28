import { createHash } from "node:crypto";
import {
  DEFAULT_IDEA_SCORING_POLICY,
  IDEA_CANDIDATE_CONTRACT_VERSION,
  IDEA_SCORE_CONTRACT_VERSION,
  IDEA_SCORING_TIE_BREAK,
  validateIdeaCandidate,
  validateIdeaScore,
  validateIdeaScoringPolicy,
} from "./domain/idea-contracts.js";

export class IdeaScoringError extends Error {
  constructor(code, field, message) {
    super(`${code}: ${message}`);
    this.name = "IdeaScoringError";
    this.code = code;
    this.field = field;
  }
}

export function createIdeaCandidates({
  ideaBatchId, pipelineRunId, projectId, projectVersion, researchShortlistId,
  origin, createdAt, projectSnapshot, shortlist, proposals,
}) {
  if (!Array.isArray(proposals) || proposals.length === 0 || proposals.length > 100) {
    throw failure("INVALID_IDEA_BATCH", "proposals", "informe de 1 a 100 ideias");
  }
  const ids = new Set();
  const identities = new Set();
  return proposals.map((proposal, index) => {
    exactProposal(proposal, index);
    const title = normalizeText(proposal.title);
    const editorialAngle = normalizeText(proposal.editorialAngle);
    const editorialIntent = {
      audienceProfile: projectSnapshot.project.audience.profile,
      language: projectSnapshot.project.audience.language,
    };
    const contentIdentity = `idea:${stableHash({ title: comparable(title), editorialAngle: comparable(editorialAngle), editorialIntent })}`;
    if (ids.has(proposal.ideaCandidateId)) throw failure("DUPLICATE_IDEA_ID", `proposals.${index}.ideaCandidateId`, "ID repetido");
    if (identities.has(contentIdentity)) throw failure("DUPLICATE_IDEA_CONTENT", `proposals.${index}.title`, "conteúdo normalizado repetido");
    ids.add(proposal.ideaCandidateId);
    identities.add(contentIdentity);
    const base = {
      schemaVersion: IDEA_CANDIDATE_CONTRACT_VERSION,
      ideaCandidateId: proposal.ideaCandidateId,
      ideaBatchId,
      pipelineRunId,
      projectId,
      projectVersion,
      contentIdentity,
      title,
      editorialAngle,
      editorialIntent,
      researchShortlistId,
      evidenceCandidateIds: sortedUnique(proposal.evidenceCandidateIds),
      referenceInsightId: proposal.referenceInsightId,
      referenceEvidenceIds: sortedUnique(proposal.referenceEvidenceIds),
      createdAt: new Date(createdAt).toISOString(),
      origin,
    };
    ensureEvidenceExists(base, shortlist, index);
    return validateIdeaCandidate({ ...base, contentHash: stableHash(base) });
  });
}

export function scoreIdeaCandidates({
  ideas, projectSnapshot, shortlist, policy = DEFAULT_IDEA_SCORING_POLICY,
}) {
  validateIdeaScoringPolicy(policy);
  if (!Array.isArray(ideas) || ideas.length === 0) throw failure("INVALID_IDEA_BATCH", "ideas", "lote vazio");
  const shortlistItems = new Map(shortlist.orderedCandidates.map((item) => [item.candidate.id, item]));
  const scores = ideas.map((idea) => {
    const components = {
      nicheAudienceFit: available(
        lexicalFit(idea, projectSnapshot), policy.weights.nicheAudienceFit,
        "TOKEN_OVERLAP_WITH_PROJECT_SNAPSHOT", [`project:${idea.projectId}:${idea.projectVersion}`],
      ),
      evidenceStrength: available(
        average(idea.evidenceCandidateIds.map((id) => {
          const score = shortlistItems.get(id).score;
          return (score.value / 100) * score.confidence;
        })),
        policy.weights.evidenceStrength, "PERSISTED_SHORTLIST_SCORE_AND_CONFIDENCE",
        idea.evidenceCandidateIds,
      ),
      novelty: relativeComponent(idea, ideas, policy.weights.novelty, textTokens, "TEXTUAL_JACCARD_DISTANCE"),
      editorialFeasibility: available(
        feasibility(idea, projectSnapshot), policy.weights.editorialFeasibility,
        "NORMALIZED_LENGTH_AND_CHANNEL_CONSTRAINTS", [`channel:${projectSnapshot.channel.format}`],
      ),
      editorialRightsRisk: riskComponent(idea, shortlist, policy.weights.editorialRightsRisk),
      diversity: relativeComponent(idea, ideas, policy.weights.diversity, evidenceTokens, "EVIDENCE_JACCARD_DISTANCE"),
    };
    const availableComponents = Object.values(components).filter(({ availability }) => availability === "AVAILABLE");
    const total = round(availableComponents.reduce((sum, item) => sum + item.contribution, 0)
      / availableComponents.reduce((sum, item) => sum + item.weight, 0));
    return { idea, components, total };
  });
  scores.sort(compareScores);
  return scores.map(({ idea, components, total }, index) => {
    const base = {
      schemaVersion: IDEA_SCORE_CONTRACT_VERSION,
      ideaScoreId: `idea-score:${idea.ideaCandidateId}`,
      ideaCandidateId: idea.ideaCandidateId,
      ideaBatchId: idea.ideaBatchId,
      pipelineRunId: idea.pipelineRunId,
      projectId: idea.projectId,
      projectVersion: idea.projectVersion,
      policyVersion: policy.version,
      calculatedAt: idea.createdAt,
      components,
      total,
      rank: index + 1,
      tieBreakRule: IDEA_SCORING_TIE_BREAK,
      explanation: `${policy.version}: componentes disponíveis ponderados; risco convertido em segurança`,
    };
    return validateIdeaScore({ ...base, contentHash: stableHash(base) });
  });
}

function ensureEvidenceExists(idea, shortlist, index) {
  if (shortlist.artifactId !== idea.researchShortlistId) {
    throw failure("RESEARCH_SHORTLIST_MISMATCH", "researchShortlistId", "shortlist divergente");
  }
  const allowed = new Set(shortlist.orderedCandidates.map(({ candidate }) => candidate.id));
  idea.evidenceCandidateIds.forEach((id, evidenceIndex) => {
    if (!allowed.has(id)) throw failure("IDEA_EVIDENCE_NOT_IN_SHORTLIST", `proposals.${index}.evidenceCandidateIds.${evidenceIndex}`, "evidência ausente da shortlist");
  });
}

function lexicalFit(idea, snapshot) {
  const ideaSet = new Set(textTokens(idea));
  const targets = tokens([
    snapshot.project.niche, ...snapshot.project.subniches,
    snapshot.project.audience.profile, snapshot.channel.editorialStyle,
  ].join(" "));
  if (targets.length === 0) return 0;
  return round(targets.filter((token) => ideaSet.has(token)).length / new Set(targets).size);
}

function feasibility(idea, snapshot) {
  const checks = [
    idea.title.length <= 100,
    idea.editorialAngle.length <= 240,
    snapshot.channel.format === "short_video",
    snapshot.channel.minDurationSeconds <= snapshot.channel.maxDurationSeconds,
  ];
  return round(checks.filter(Boolean).length / checks.length);
}

function riskComponent(idea, shortlist, weight) {
  const referenceUsed = idea.referenceInsightId !== null || idea.referenceEvidenceIds.length > 0;
  const risk = referenceUsed ? 0.5 : 0.25;
  const evidenceIds = [shortlist.artifactId, ...(idea.referenceInsightId === null ? [] : [idea.referenceInsightId])];
  return available(risk, weight, referenceUsed
    ? "STRATEGIC_REFERENCE_ONLY_REQUIRES_EDITORIAL_RIGHTS_REVIEW"
    : "SHORTLIST_REFERENCE_ONLY_NO_SOURCE_CONTENT_STORED", evidenceIds, true);
}

function relativeComponent(idea, ideas, weight, selector, reason) {
  const others = ideas.filter(({ ideaCandidateId }) => ideaCandidateId !== idea.ideaCandidateId);
  if (others.length === 0) return unavailable(weight, "SINGLE_IDEA_BATCH");
  const own = selector(idea);
  const similarity = Math.max(...others.map((other) => jaccard(own, selector(other))));
  return available(round(1 - similarity), weight, reason, others.map(({ ideaCandidateId }) => ideaCandidateId).sort());
}

function available(value, weight, reason, evidenceIds, risk = false) {
  return {
    availability: "AVAILABLE", value: round(value), weight, reason,
    evidenceIds: [...evidenceIds].sort(), contribution: round((risk ? 1 - value : value) * weight),
  };
}

function unavailable(weight, reason) {
  return { availability: "UNAVAILABLE", value: null, weight, reason, evidenceIds: [], contribution: null };
}

function compareScores(left, right) {
  return right.total - left.total
    || right.components.evidenceStrength.value - left.components.evidenceStrength.value
    || right.components.nicheAudienceFit.value - left.components.nicheAudienceFit.value
    || left.idea.contentIdentity.localeCompare(right.idea.contentIdentity)
    || left.idea.ideaCandidateId.localeCompare(right.idea.ideaCandidateId);
}

function textTokens(idea) { return tokens(`${idea.title} ${idea.editorialAngle}`); }
function evidenceTokens(idea) { return [...idea.evidenceCandidateIds, ...idea.referenceEvidenceIds]; }
function tokens(value) { return [...new Set(comparable(value).match(/[a-z0-9]+/g) ?? [])].filter((item) => item.length >= 3).sort(); }
function comparable(value) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR"); }
function normalizeText(value) { return typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ") : value; }
function sortedUnique(value) { return Array.isArray(value) ? [...new Set(value)].sort() : value; }
function jaccard(left, right) { const a = new Set(left); const b = new Set(right); const union = new Set([...a, ...b]); if (union.size === 0) return 1; return [...a].filter((item) => b.has(item)).length / union.size; }
function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function round(value) { return Number(value.toFixed(6)); }
function stableHash(value) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function exactProposal(value, index) { if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_IDEA_PROPOSAL", `proposals.${index}`, "objeto obrigatório"); const fields = ["ideaCandidateId", "title", "editorialAngle", "evidenceCandidateIds", "referenceInsightId", "referenceEvidenceIds"]; for (const key of Object.keys(value)) if (!fields.includes(key)) throw failure("UNKNOWN_IDEA_FIELD", `proposals.${index}.${key}`, "campo não permitido"); for (const key of fields) if (!(key in value)) throw failure("REQUIRED_IDEA_FIELD", `proposals.${index}.${key}`, "campo obrigatório"); }
function failure(code, field, message) { return new IdeaScoringError(code, field, message); }
