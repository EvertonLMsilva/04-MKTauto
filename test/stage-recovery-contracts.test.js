import test from "node:test";
import assert from "node:assert/strict";
import { ContractValidationError } from "../src/domain/contracts.js";
import { PIPELINE_STAGE_STATES, PIPELINE_STAGES, STAGE_DEPENDENCIES, STAGE_RECOVERY_CONTRACT_VERSION, descendantsOf, sanitizeStageFailure, stageExecutionIdentityHash, validateStageExecutionRequest } from "../src/domain/stage-recovery-contracts.js";

const HASH = "a".repeat(64);

test("contrato fecha estados, etapas, dependências e identidade explícita", () => {
  assert.deepEqual(PIPELINE_STAGE_STATES, ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]);
  assert.ok(PIPELINE_STAGES.includes("TREND_FORMAT_ANALYSIS"));
  assert.ok(STAGE_DEPENDENCIES.COMPOSITION.includes("BACKGROUND_MUSIC"));
  assert.ok(descendantsOf("VOICE").includes("QC"));
  const value = request();
  assert.deepEqual(validateStageExecutionRequest(value), value);
  assert.equal(stageExecutionIdentityHash(value), stageExecutionIdentityHash(structuredClone(value)));
});

test("rejeita latest implícito, hashes inválidos e dependência não declarada", () => {
  assert.throws(() => validateStageExecutionRequest({ ...request(), latest: true }), contract("UNKNOWN_FIELD"));
  assert.throws(() => validateStageExecutionRequest({ ...request(), requestHash: "latest" }), contract("INVALID_CONTENT_HASH"));
  assert.throws(() => validateStageExecutionRequest({ ...request(), inputs: [{ stage: "RESEARCH", artifactId: "research:1", contentHash: HASH }] }), contract("INVALID_STAGE_DEPENDENCY"));
});

test("sanitiza falha e classifica somente erro transitório", () => {
  assert.deepEqual(sanitizeStageFailure(Object.assign(new Error("token privado"), { code: "PROVIDER_TIMEOUT", field: "provider" })), { code: "PROVIDER_TIMEOUT", field: "provider", retryAllowed: true });
  assert.deepEqual(sanitizeStageFailure(Object.assign(new Error("payload"), { code: "POLICY_INCOMPATIBLE", field: "policy" })), { code: "POLICY_INCOMPATIBLE", field: "policy", retryAllowed: false });
  assert.deepEqual(sanitizeStageFailure(new Error("segredo")), { code: "STAGE_FAILED", field: "stage", retryAllowed: false });
});

function request() { return { schemaVersion: STAGE_RECOVERY_CONTRACT_VERSION, pipelineRunId: "run_stage_001", stage: "VOICE", requestHash: HASH, inputs: [{ stage: "SCRIPT", artifactId: "script:1", contentHash: HASH }], policyVersions: { voice: "voice-1" }, providerConfigHash: "b".repeat(64) }; }
function contract(code) { return (caught) => caught instanceof ContractValidationError && caught.code === code; }
