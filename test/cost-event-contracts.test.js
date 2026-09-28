import test from "node:test";
import assert from "node:assert/strict";
import {
  COST_EVENT_CATEGORIES,
  COST_EVENT_CONTRACT_VERSION,
  validateCostEvent,
} from "../src/domain/cost-event-contracts.js";

test("valida, normaliza e congela evento de custo exato", () => {
  const event = validateCostEvent(validEvent({ amount: "001.2300" }));

  assert.equal(event.schemaVersion, COST_EVENT_CONTRACT_VERSION);
  assert.equal(event.amount, "1.23");
  assert.equal(event.currency, "USD");
  assert.equal(Object.isFrozen(event), true);
  assert.deepEqual(COST_EVENT_CATEGORIES, [
    "production_cost", "ai_cost", "media_cost", "voice_cost", "publishing_cost",
  ]);
  for (const category of COST_EVENT_CATEGORIES) {
    assert.equal(validateCostEvent(validEvent({ category })).category, category);
  }
});

test("rejeita valores, moedas, categorias e campos desconhecidos com erro estável", () => {
  assert.throws(
    () => validateCostEvent(validEvent({ amount: "0" })),
    contractError("INVALID_COST_AMOUNT", "amount"),
  );
  assert.throws(
    () => validateCostEvent(validEvent({ amount: 0.1 })),
    contractError("INVALID_COST_AMOUNT", "amount"),
  );
  assert.throws(
    () => validateCostEvent(validEvent({ currency: "usd" })),
    contractError("INVALID_CURRENCY", "currency"),
  );
  assert.throws(
    () => validateCostEvent(validEvent({ category: "token_cost" })),
    contractError("INVALID_COST_CATEGORY", "category"),
  );
  assert.throws(
    () => validateCostEvent({ ...validEvent(), prompt: "privado" }),
    contractError("UNKNOWN_FIELD", "costEvent.prompt"),
  );
});

test("exige origem e regra de atribuição versionada explícitas", () => {
  assert.throws(
    () => validateCostEvent(validEvent({ origin: "" })),
    contractError("INVALID_COST_ORIGIN", "origin"),
  );
  assert.throws(
    () => validateCostEvent(validEvent({ attributionRuleVersion: "latest" })),
    contractError("INVALID_ATTRIBUTION_RULE_VERSION", "attributionRuleVersion"),
  );
});

function validEvent(overrides = {}) {
  return {
    schemaVersion: COST_EVENT_CONTRACT_VERSION,
    costEventId: "cost_fnd03_001",
    category: "ai_cost",
    pipelineRunId: "run_fnd03_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    contentIdentity: "content_001",
    artifactId: null,
    amount: "0.125",
    currency: "USD",
    occurredAt: "2026-09-28T12:00:00.000Z",
    origin: "openai_invoice",
    attributionRuleVersion: "direct-run/1.0.0",
    recordedAt: "2026-09-28T12:01:00.000Z",
    ...overrides,
  };
}

function contractError(code, path) {
  return (caught) => caught?.code === code && caught?.path === path;
}
