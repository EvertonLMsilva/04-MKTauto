import test from "node:test";
import assert from "node:assert/strict";
import {
  SCRIPT_GENERATION_REQUEST_VERSION,
  scriptGenerationRequestHash,
  validateScriptGenerationOutput,
  validateScriptGenerationRequest,
} from "../src/domain/script-generation-contracts.js";

test("valida solicitação de geração com identidade e hash reproduzível", () => {
  const value = request();
  const validated = validateScriptGenerationRequest(value);
  assert.deepEqual(validated, value);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(scriptGenerationRequestHash(value), value.contentHash);
});

test("rejeita identidade reutilizável inválida, campos desconhecidos e segredo", () => {
  assert.throws(
    () => validateScriptGenerationRequest({ ...request(), generationRequestId: "x" }),
    contractError("INVALID_IDENTIFIER", "generationRequestId"),
  );
  assert.throws(
    () => validateScriptGenerationRequest({ ...request(), latest: true }),
    contractError("UNKNOWN_FIELD", "request.latest"),
  );
  assert.throws(
    () => validateScriptGenerationRequest({ ...request(), apiKey: "sk-private-value" }),
    contractError("UNKNOWN_FIELD", "request.apiKey"),
  );
  assert.throws(
    () => validateScriptGenerationRequest({ ...request(), contentHash: "f".repeat(64) }),
    contractError("CONTENT_HASH_MISMATCH", "contentHash"),
  );
});

test("trata a saída do provider como entrada não confiável", () => {
  const validated = validateScriptGenerationOutput(output());
  assert.equal(Object.isFrozen(validated), true);
  assert.throws(
    () => validateScriptGenerationOutput({ ...output(), rawPayload: "private" }),
    contractError("UNKNOWN_FIELD", "output.rawPayload"),
  );
  assert.throws(
    () => validateScriptGenerationOutput({ ...output(), narrativeBlocks: [] }),
    contractError("INVALID_BLOCKS", "narrativeBlocks"),
  );
  assert.throws(
    () => validateScriptGenerationOutput({ ...output(), sensitiveClaims: [{
      position: 1, blockPosition: 1, summary: "Dado médico", sourceRequired: true,
      humanReviewRequired: false,
    }], reviewFlags: [] }),
    contractError("REVIEW_FLAG_REQUIRED", "reviewFlags"),
  );
});

function request(overrides = {}) {
  const value = {
    schemaVersion: SCRIPT_GENERATION_REQUEST_VERSION,
    generationRequestId: "generation_ai01_001",
    ideaSelectionId: "selection_001",
    requestedAt: "2026-09-28T15:00:00.000Z",
    contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = overrides.contentHash ?? scriptGenerationRequestHash(value);
  return value;
}

function output(overrides = {}) {
  return {
    hook: "Você pode organizar a rotina com três passos simples.",
    narrativeBlocks: [{ position: 1, purpose: "EXPLANATION", narration: "Escolha uma tarefa pequena e defina um resultado claro." }],
    visualDirections: [{ position: 1, blockPosition: 1, description: "Uma lista simples aparece em tela." }],
    cta: "Salve para testar depois.",
    estimatedDurationSeconds: 30,
    sensitiveClaims: [],
    reviewFlags: [],
    ...overrides,
  };
}

function contractError(code, path) {
  return (caught) => caught?.code === code && caught?.path === path;
}
