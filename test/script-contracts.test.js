import test from "node:test";
import assert from "node:assert/strict";
import {
  SCRIPT_CONTRACT_VERSION,
  scriptContentHash,
  validateScript,
} from "../src/domain/script-contracts.js";

test("valida e congela roteiro completo com ordem e hash reproduzíveis", () => {
  const value = validateScript(script());
  assert.equal(value.schemaVersion, SCRIPT_CONTRACT_VERSION);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.narrativeBlocks), true);
  assert.equal(Object.isFrozen(value.visualDirections[0]), true);
  assert.equal(scriptContentHash(value), value.contentHash);
});

test("rejeita ordem, narração incoerente, duração e revisão inválidas", () => {
  assert.throws(() => validateScript(script({ narrativeBlocks: [block(2)] })), contractError("INVALID_BLOCK_POSITION", "narrativeBlocks.0.position"));
  assert.throws(() => validateScript(script({ fullNarration: "Texto diferente" })), contractError("NARRATION_MISMATCH", "fullNarration"));
  assert.throws(() => validateScript(script({ estimatedDurationSeconds: 0 })), contractError("INVALID_DURATION", "estimatedDurationSeconds"));
  assert.throws(() => validateScript(script({ revision: 2 })), contractError("SUPERSEDED_SCRIPT_REQUIRED", "supersedesScriptId"));
});

test("exige indicação visual vinculada e sinalização de afirmação sensível", () => {
  assert.throws(() => validateScript(script({ visualDirections: [visual(1, 2)] })), contractError("VISUAL_BLOCK_NOT_FOUND", "visualDirections.0.blockPosition"));
  assert.throws(() => validateScript(script({
    sensitiveClaims: [{ position: 1, blockPosition: 1, summary: "Dado que precisa de validação", sourceRequired: false, humanReviewRequired: false }],
  })), contractError("SENSITIVE_CLAIM_REVIEW_REQUIRED", "sensitiveClaims.0"));
  assert.throws(() => validateScript(script({
    sensitiveClaims: [{ position: 1, blockPosition: 1, summary: "Dado que precisa de fonte", sourceRequired: true, humanReviewRequired: false }],
  })), contractError("REVIEW_FLAG_REQUIRED", "reviewFlags"));
});

test("rejeita campos proibidos, conteúdo sensível e hash inexato", () => {
  assert.throws(() => validateScript(script({ prompt: "privado" })), contractError("UNKNOWN_FIELD", "script.prompt"));
  assert.throws(() => validateScript(script({ cta: "Bearer token-privado" })), contractError("SENSITIVE_CONTENT", "fullNarration"));
  assert.throws(() => validateScript(script({ contentHash: "f".repeat(64) }, false)), contractError("CONTENT_HASH_MISMATCH", "contentHash"));
});

function script(overrides = {}, calculate = true) {
  const hook = "Você pode organizar a rotina com três passos simples.";
  const blocks = [block(1)];
  const cta = "Salve para testar depois.";
  const value = {
    schemaVersion: SCRIPT_CONTRACT_VERSION,
    scriptId: "script_001", pipelineRunId: "run_e04_001",
    projectId: "project_curiosidades_ia", projectVersion: 1,
    ideaSelectionId: "selection_001", ideaSelectionContentHash: "a".repeat(64),
    ideaCandidateId: "idea_candidate_1", ideaContentHash: "b".repeat(64),
    language: "pt-BR", contentFormat: "short_video", hook,
    narrativeBlocks: blocks, fullNarration: narration(hook, blocks, cta),
    visualDirections: [visual(1, 1)], cta, estimatedDurationSeconds: 30,
    sensitiveClaims: [], reviewFlags: [], origin: "OPERATOR",
    createdAt: "2026-09-28T14:00:00.000Z", revision: 1,
    supersedesScriptId: null, contentHash: "0".repeat(64),
    ...overrides,
  };
  if (!("fullNarration" in overrides)) value.fullNarration = narration(value.hook, value.narrativeBlocks, value.cta);
  if (calculate) value.contentHash = scriptContentHash(value);
  return value;
}

function block(position) { return { position, purpose: "EXPLANATION", narration: "Primeiro, escolha uma tarefa pequena e defina um resultado claro." }; }
function visual(position, blockPosition) { return { position, blockPosition, description: "Lista simples aparecendo em tela." }; }
function narration(hook, blocks, cta) { return [hook, ...blocks.map(({ narration: text }) => text), cta].filter(Boolean).join("\n\n"); }
function contractError(code, path) { return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === path; }
