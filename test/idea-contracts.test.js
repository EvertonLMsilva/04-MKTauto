import test from "node:test";
import assert from "node:assert/strict";
import {
  IDEA_CANDIDATE_CONTRACT_VERSION,
  IDEA_SCORE_CONTRACT_VERSION,
  IDEA_SCORING_POLICY_VERSION,
  validateIdeaCandidate,
  validateIdeaScore,
} from "../src/domain/idea-contracts.js";

test("valida e congela IdeaCandidate normalizado", () => {
  const idea = validateIdeaCandidate(candidate());
  assert.equal(idea.schemaVersion, IDEA_CANDIDATE_CONTRACT_VERSION);
  assert.equal(Object.isFrozen(idea), true);
  assert.equal(Object.isFrozen(idea.editorialIntent), true);
  assert.throws(() => { idea.title = "alterado"; }, TypeError);
});

test("rejeita campos desconhecidos, conteúdo sensível e evidência duplicada", () => {
  assert.throws(() => validateIdeaCandidate(candidate({ prompt: "privado" })), contractError("UNKNOWN_FIELD", "idea.prompt"));
  assert.throws(() => validateIdeaCandidate(candidate({ evidenceCandidateIds: ["candidate-1", "candidate-1"] })), contractError("DUPLICATE_VALUE", "evidenceCandidateIds.1"));
  assert.throws(() => validateIdeaCandidate(candidate({ title: "Bearer secret-token-value" })), contractError("SENSITIVE_CONTENT", "title"));
});

test("valida IdeaScore e mantém componentes indisponíveis sem valor inventado", () => {
  const value = score();
  value.components.novelty = {
    availability: "UNAVAILABLE", value: null, weight: 0.15,
    reason: "SINGLE_IDEA_BATCH", evidenceIds: [], contribution: null,
  };
  value.total = 0.823529;
  const validated = validateIdeaScore(value);
  assert.equal(validated.schemaVersion, IDEA_SCORE_CONTRACT_VERSION);
  assert.equal(validated.policyVersion, IDEA_SCORING_POLICY_VERSION);
  assert.equal(validated.components.novelty.value, null);
  assert.equal(validated.components.novelty.contribution, null);
  assert.equal(Object.isFrozen(validated), true);
});

test("rejeita contribuição ou política incoerentes", () => {
  const invalid = score();
  invalid.components.evidenceStrength.contribution = 0.99;
  assert.throws(() => validateIdeaScore(invalid), contractError("INVALID_CONTRIBUTION", "components.evidenceStrength.contribution"));
  assert.throws(() => validateIdeaScore(score({ policyVersion: "idea-scoring-policy/9.0.0" })), contractError("UNSUPPORTED_POLICY_VERSION", "policyVersion"));
});

function candidate(overrides = {}) {
  return {
    schemaVersion: IDEA_CANDIDATE_CONTRACT_VERSION,
    ideaCandidateId: "idea_candidate_1", ideaBatchId: "idea_batch_1",
    pipelineRunId: "run_e03_001", projectId: "project_curiosidades_ia", projectVersion: 1,
    contentIdentity: `idea:${"a".repeat(64)}`,
    title: "Três usos práticos de IA", editorialAngle: "Mostrar ganhos de produtividade sem promessas exageradas",
    editorialIntent: { audienceProfile: "Pessoas interessadas em tecnologia", language: "pt-BR" },
    researchShortlistId: "research-shortlist:001", evidenceCandidateIds: ["candidate-1"],
    referenceInsightId: null, referenceEvidenceIds: [], createdAt: "2026-09-28T12:00:00.000Z",
    origin: "OPERATOR", contentHash: "b".repeat(64),
    ...overrides,
  };
}

function score(overrides = {}) {
  const component = (value, weight, evidenceIds = []) => ({
    availability: "AVAILABLE", value, weight, reason: "DETERMINISTIC_RULE",
    evidenceIds, contribution: Number((value * weight).toFixed(6)),
  });
  return {
    schemaVersion: IDEA_SCORE_CONTRACT_VERSION,
    ideaScoreId: "idea_score_1", ideaCandidateId: "idea_candidate_1", ideaBatchId: "idea_batch_1",
    pipelineRunId: "run_e03_001", projectId: "project_curiosidades_ia", projectVersion: 1,
    policyVersion: IDEA_SCORING_POLICY_VERSION, calculatedAt: "2026-09-28T12:00:00.000Z",
    components: {
      nicheAudienceFit: component(0.8, 0.25), evidenceStrength: component(0.7, 0.25, ["candidate-1"]),
      novelty: component(0.6, 0.15, ["idea_candidate_2"]), editorialFeasibility: component(1, 0.15),
      editorialRightsRisk: { ...component(0.25, 0.1, ["research-shortlist:001"]), contribution: 0.075 },
      diversity: component(1, 0.1, ["idea_candidate_2"]),
    },
    total: 0.79, rank: 1,
    tieBreakRule: "TOTAL_DESC,EVIDENCE_DESC,FIT_DESC,CONTENT_IDENTITY_ASC,IDEA_ID_ASC",
    explanation: "idea-scoring-policy/1.0.0: componentes disponíveis ponderados; risco convertido em segurança",
    contentHash: "c".repeat(64),
    ...overrides,
  };
}

function contractError(code, field) {
  return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === field;
}
