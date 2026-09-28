import test from "node:test";
import assert from "node:assert/strict";
import {
  IDEA_SELECTION_CONTRACT_VERSION,
  selectionContentHash,
  validateIdeaSelection,
} from "../src/domain/idea-selection-contracts.js";

test("valida e congela seleção humana explícita", () => {
  const validated = validateIdeaSelection(selection());
  assert.equal(validated.schemaVersion, IDEA_SELECTION_CONTRACT_VERSION);
  assert.equal(validated.decision, "SELECTED");
  assert.equal(validated.actor.type, "HUMAN");
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.actor), true);
});

test("rejeita ator não humano, decisão implícita e conteúdo sensível", () => {
  assert.throws(() => validateIdeaSelection(selection({ actor: { type: "SYSTEM", id: "operator_001" } })), contractError("HUMAN_ACTOR_REQUIRED", "actor.type"));
  assert.throws(() => validateIdeaSelection(selection({ decision: "AUTO_SELECTED" })), contractError("INVALID_DECISION", "decision"));
  assert.throws(() => validateIdeaSelection(selection({ editorialRationale: "Bearer private-token" })), contractError("SENSITIVE_CONTENT", "editorialRationale"));
});

test("exige cadeia de revisão explícita e hash reproduzível", () => {
  assert.throws(() => validateIdeaSelection(selection({ revision: 2 })), contractError("SUPERSEDED_SELECTION_REQUIRED", "supersedesIdeaSelectionId"));
  assert.throws(() => validateIdeaSelection(selection({ supersedesIdeaSelectionId: "selection_previous" })), contractError("INVALID_SUPERSESSION", "supersedesIdeaSelectionId"));
  assert.throws(() => validateIdeaSelection(selection({ contentHash: "f".repeat(64) }, false)), contractError("CONTENT_HASH_MISMATCH", "contentHash"));
});

function selection(overrides = {}, calculate = true) {
  const value = {
    schemaVersion: IDEA_SELECTION_CONTRACT_VERSION,
    ideaSelectionId: "selection_001", pipelineRunId: "run_e03_001",
    projectId: "project_curiosidades_ia", projectVersion: 1,
    ideaBatchId: "idea_batch_1", ideaCandidateId: "idea_candidate_1",
    ideaScoreId: "idea_score_1", ideaContentHash: "a".repeat(64),
    ideaScoreContentHash: "b".repeat(64), decision: "SELECTED",
    actor: { type: "HUMAN", id: "operator_001" },
    decidedAt: "2026-09-28T13:00:00.000Z", editorialRationale: "Melhor ângulo para o canal",
    revision: 1, supersedesIdeaSelectionId: null, contentHash: "0".repeat(64),
    ...overrides,
  };
  if (calculate) value.contentHash = selectionContentHash(value);
  return value;
}

function contractError(code, path) {
  return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === path;
}
