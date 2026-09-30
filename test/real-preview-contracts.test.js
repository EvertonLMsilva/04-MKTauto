import test from "node:test";
import assert from "node:assert/strict";
import {
  REAL_PREVIEW_REQUEST_VERSION,
  realPreviewRequestHash,
  validateRealPreviewRequest,
} from "../src/domain/real-preview-contracts.js";

test("solicitação fechada possui identidade reproduzível independente de requestedAt", () => {
  const first = request();
  const retry = request({ requestedAt: "2026-09-30T11:00:00.000Z" });
  assert.equal(first.contentHash, retry.contentHash);
  assert.notEqual(first.contentHash, request({ previewRequestId: "preview_e07_002" }).contentHash);
  assert.deepEqual(validateRealPreviewRequest(first), first);
});

test("solicitação rejeita versão, campo extra e hash divergente", () => {
  assert.throws(() => validateRealPreviewRequest({ ...request(), schemaVersion: "real-preview-request/2.0.0" }), /UNSUPPORTED_SCHEMA_VERSION/);
  assert.throws(() => validateRealPreviewRequest({ ...request(), latest: true }), /UNKNOWN_FIELD/);
  assert.throws(() => validateRealPreviewRequest({ ...request(), contentHash: "f".repeat(64) }), /CONTENT_HASH_MISMATCH/);
});

function request(overrides = {}) {
  const value = {
    schemaVersion: REAL_PREVIEW_REQUEST_VERSION,
    previewRequestId: "preview_e07_001",
    pipelineRunId: "run_e07_001",
    projectId: "project_e07",
    projectVersion: 1,
    ideaSelectionId: "selection_e07_001",
    requestedAt: "2026-09-30T10:00:00.000Z",
    contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = realPreviewRequestHash(value);
  return value;
}
