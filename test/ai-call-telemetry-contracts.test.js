import test from "node:test";
import assert from "node:assert/strict";
import { ContractValidationError } from "../src/domain/contracts.js";
import {
  AI_CALL_TELEMETRY_CONTRACT_VERSION,
  validateAiCallObservation,
  validateAiCallTelemetry,
} from "../src/domain/ai-call-telemetry-contracts.js";

test("contrato preserva uso parcial e ausência de custo sem presumir zero", () => {
  const telemetry = validateAiCallTelemetry(value({
    inputTokens: 120, outputTokens: null, cachedInputTokens: 40,
    usageOrigin: "provider_response",
  }));
  assert.equal(telemetry.schemaVersion, AI_CALL_TELEMETRY_CONTRACT_VERSION);
  assert.equal(telemetry.inputTokens, 120);
  assert.equal(telemetry.outputTokens, null);
  assert.equal(telemetry.cachedInputTokens, 40);
  assert.equal(telemetry.costAmount, null);
  assert.equal(telemetry.currency, null);
  assert.equal(telemetry.costEventId, null);
  assert.equal(Object.isFrozen(telemetry), true);
});

test("contrato aceita custo conhecido somente com moeda, origem e evento explícitos", () => {
  const telemetry = validateAiCallTelemetry(value({
    costAmount: "0.012300", currency: "USD", costOrigin: "provider_reported",
    costEventId: "cost:ai_call:generation_ai03_001",
  }));
  assert.equal(telemetry.costAmount, "0.0123");
  assert.equal(telemetry.currency, "USD");
  assert.equal(telemetry.costOrigin, "provider_reported");
});

test("contrato rejeita custo ou uso incompletos, resultado incoerente e campos sensíveis", () => {
  assert.throws(() => validateAiCallObservation({ ...observation(), inputTokens: 10 }), contractError("INVALID_USAGE_ORIGIN", "usageOrigin"));
  assert.throws(() => validateAiCallObservation({ ...observation(), inputTokens: 10, cachedInputTokens: 11, usageOrigin: "provider_response" }), contractError("INVALID_USAGE_VALUE", "cachedInputTokens"));
  assert.throws(() => validateAiCallObservation({ ...observation(), costAmount: "0.01" }), contractError("INCOMPLETE_COST", "costAmount"));
  assert.throws(() => validateAiCallTelemetry(value({ outcome: "FAILURE" })), contractError("INVALID_AI_CALL_OUTCOME", "artifactId"));
  assert.throws(() => validateAiCallTelemetry({ ...value(), rawResponse: "private" }), contractError("UNKNOWN_FIELD", "telemetry.rawResponse"));
  assert.throws(() => validateAiCallTelemetry(value({ model: "sk-private-value" })), contractError("SENSITIVE_CONTENT", "model"));
});

function value(overrides = {}) {
  return {
    schemaVersion: AI_CALL_TELEMETRY_CONTRACT_VERSION,
    aiCallId: "ai_call:generation_ai03_001",
    logicalCallId: "generation_ai03_001",
    requestHash: "a".repeat(64),
    pipelineRunId: "run_ai03_001",
    projectId: "project_ai03",
    projectVersion: 1,
    artifactId: "script:generation_ai03_001",
    costEventId: null,
    ...observation(),
    outcome: "SUCCESS",
    failureCode: null,
    recordedAt: "2026-09-28T18:00:01.000Z",
    ...overrides,
  };
}

function observation() {
  return {
    provider: "openai", model: "model-test", taskType: "script_generation",
    promptVersion: "script-generation-prompt/1.0.0",
    inputTokens: null, outputTokens: null, cachedInputTokens: null, usageOrigin: null,
    costAmount: null, currency: null, costOrigin: null, latencyMs: 125,
    occurredAt: "2026-09-28T18:00:00.000Z", fallback: false,
    inputHash: "b".repeat(64), outputHash: "c".repeat(64),
  };
}

function contractError(code, path) {
  return (caught) => caught instanceof ContractValidationError && caught.code === code && caught.path === path;
}
