import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_ACQUISITION_REQUEST_VERSION,
  mediaAcquisitionRequestHash,
  validateMediaAcquisitionRequest,
  validateMediaProviderOutput,
} from "../src/domain/media-acquisition-contracts.js";

test("valida solicitação explícita e reproduzível sem propriedades técnicas", () => {
  const value = validateMediaAcquisitionRequest(request());
  assert.equal(value.schemaVersion, MEDIA_ACQUISITION_REQUEST_VERSION);
  assert.equal(mediaAcquisitionRequestHash(value), value.contentHash);
  assert.equal("technicalProperties" in value, false);
  assert.equal(Object.isFrozen(value), true);
});

test("rejeita hash divergente, conteúdo livre e configuração privada", () => {
  assert.throws(() => validateMediaAcquisitionRequest({ ...request(), contentHash: "f".repeat(64) }), contractError("CONTENT_HASH_MISMATCH", "contentHash"));
  assert.throws(() => validateMediaAcquisitionRequest({ ...request(), researchText: "não usar" }), contractError("UNKNOWN_FIELD", "request.researchText"));
  assert.throws(() => validateMediaAcquisitionRequest({ ...request(), apiKey: "private" }), contractError("UNKNOWN_FIELD", "request.apiKey"));
  assert.throws(() => validateMediaAcquisitionRequest({ ...request(), format: "png" }), contractError("UNKNOWN_FIELD", "request.format"));
});

test("revalida integralmente evidência pública retornada pelo provider", () => {
  const value = validateMediaProviderOutput(output());
  assert.equal(value.technicalProperties.widthPixels, 1080);
  assert.equal(Object.isFrozen(value.rights), true);
  for (const [field, content] of [
    ["bytes", Buffer.from("private")], ["base64", "cHJpdmF0ZQ=="],
    ["signedUrl", "https://private.test/x?signature=y"], ["rawPayload", {}],
  ]) assert.throws(() => validateMediaProviderOutput({ ...output(), [field]: content }), contractError("UNKNOWN_FIELD", `output.${field}`));
  assert.throws(() => validateMediaProviderOutput({ ...output(), mediaReference: "https://private.test/a?token=x" }), contractError("INVALID_MEDIA_REFERENCE", "mediaReference"));
  assert.throws(() => validateMediaProviderOutput({ ...output(), technicalProperties: { ...output().technicalProperties, widthPixels: null } }), contractError("INVALID_MEDIA_DIMENSION", "technicalProperties.widthPixels"));
});

test("aceita observação genérica opcional sem expor payload do provider", () => {
  const value = validateMediaProviderOutput({ ...output(), telemetry: observation() });
  assert.equal(value.telemetry.usageOrigin, "provider_response");
  assert.equal(value.telemetry.costAmount, "0.0605");
  assert.throws(() => validateMediaProviderOutput({ ...output(), telemetry: { ...observation(), rawResponse: "private" } }), contractError("UNKNOWN_FIELD", "observation.rawResponse"));
});

test("não infere direito comercial nem provider", () => {
  const absent = output(); delete absent.rights;
  assert.throws(() => validateMediaProviderOutput(absent), contractError("REQUIRED_FIELD", "output.rights"));
  assert.throws(() => validateMediaProviderOutput({ ...output(), rights: { usageBasis: "UNKNOWN", commercialUseAllowed: true } }), contractError("INVALID_USAGE_BASIS", "rights.usageBasis"));
  assert.throws(() => validateMediaProviderOutput({ ...output(), rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: false } }), contractError("COMMERCIAL_USE_REQUIRED", "rights.commercialUseAllowed"));
  assert.throws(() => validateMediaProviderOutput({ ...output(), provider: null }), contractError("PROVIDER_REQUIRED", "provider"));
  assert.doesNotThrow(() => validateMediaProviderOutput({ ...output(), origin: "OPERATOR_OWNED", provider: null, rights: { usageBasis: "OWNED", commercialUseAllowed: true } }));
});

function request(overrides = {}) {
  const value = {
    schemaVersion: MEDIA_ACQUISITION_REQUEST_VERSION,
    mediaAcquisitionRequestId: "media_acquisition_001", scriptId: "script_001",
    scriptContentHash: "a".repeat(64), visualDirectionPosition: 1,
    assetType: "IMAGE", requestedAt: "2026-09-28T22:00:00.000Z",
    contentHash: "0".repeat(64), ...overrides,
  };
  value.contentHash = mediaAcquisitionRequestHash(value);
  return value;
}

function output() {
  return {
    assetType: "IMAGE",
    technicalProperties: { format: "png", widthPixels: 1080, heightPixels: 1920, durationMilliseconds: null },
    contentHash: "b".repeat(64), mediaReference: "media:acquired_001",
    origin: "PROVIDER_GENERATED", provider: "provider_test",
    rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true },
  };
}

function observation() {
  return {
    provider: "openai", model: "gpt-image-2.5-flare-2026-09-08",
    taskType: "image_generation", promptVersion: "openai-image-prompt/1.0.0",
    inputTokens: 100, outputTokens: 2000, cachedInputTokens: null,
    usageOrigin: "provider_response", costAmount: "0.0605", currency: "USD",
    costOrigin: "calculated_openai_image_pricing_2026_09_29", latencyMs: 125,
    occurredAt: "2026-09-29T12:00:00.000Z", fallback: false,
    inputHash: "c".repeat(64), outputHash: "b".repeat(64),
  };
}

function contractError(code, path) { return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === path; }
