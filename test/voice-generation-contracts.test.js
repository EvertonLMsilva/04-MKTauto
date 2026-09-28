import test from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_GENERATION_REQUEST_VERSION,
  validateVoiceGenerationRequest,
  validateVoiceProviderOutput,
  voiceGenerationRequestHash,
} from "../src/domain/voice-generation-contracts.js";

test("valida solicitação explícita com hash reproduzível", () => {
  const value = validateVoiceGenerationRequest(request());
  assert.equal(value.schemaVersion, VOICE_GENERATION_REQUEST_VERSION);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(voiceGenerationRequestHash(value), value.contentHash);
});

test("rejeita hash divergente, texto livre e configuração privada", () => {
  assert.throws(() => validateVoiceGenerationRequest({ ...request(), contentHash: "f".repeat(64) }), contractError("CONTENT_HASH_MISMATCH", "contentHash"));
  assert.throws(() => validateVoiceGenerationRequest({ ...request(), text: "não usar" }), contractError("UNKNOWN_FIELD", "request.text"));
  assert.throws(() => validateVoiceGenerationRequest({ ...request(), apiKey: "private" }), contractError("UNKNOWN_FIELD", "request.apiKey"));
});

test("valida apenas evidência pública do ativo gerado", () => {
  const value = validateVoiceProviderOutput(providerOutput());
  assert.equal(value.durationMilliseconds, 30125);
  assert.equal(Object.isFrozen(value.rights), true);
  assert.throws(() => validateVoiceProviderOutput({ ...providerOutput(), audioBytes: "base64" }), contractError("UNKNOWN_FIELD", "output.audioBytes"));
  assert.throws(() => validateVoiceProviderOutput({ ...providerOutput(), storageReference: "https://storage.test/audio?signature=private" }), contractError("INVALID_STORAGE_REFERENCE", "storageReference"));
});

test("bloqueia direitos ausentes, desconhecidos ou não comerciais e origem incompatível", () => {
  const absent = providerOutput();
  delete absent.rights;
  assert.throws(() => validateVoiceProviderOutput(absent), contractError("REQUIRED_FIELD", "output.rights"));
  assert.throws(() => validateVoiceProviderOutput({ ...providerOutput(), rights: { usageBasis: "UNKNOWN", commercialUseAllowed: true } }), contractError("INVALID_USAGE_BASIS", "rights.usageBasis"));
  assert.throws(() => validateVoiceProviderOutput({ ...providerOutput(), rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: false } }), contractError("COMMERCIAL_USE_REQUIRED", "rights.commercialUseAllowed"));
  assert.throws(() => validateVoiceProviderOutput({ ...providerOutput(), origin: "CLONED_VOICE" }), contractError("INVALID_VOICE_ORIGIN", "origin"));
});

function request(overrides = {}) {
  const value = {
    schemaVersion: VOICE_GENERATION_REQUEST_VERSION,
    generationRequestId: "voice_generation_001",
    scriptId: "script_001",
    scriptContentHash: "a".repeat(64),
    requestedAt: "2026-09-28T20:00:00.000Z",
    contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = voiceGenerationRequestHash(value);
  return value;
}

function providerOutput() {
  return {
    durationMilliseconds: 30125,
    audioFormat: "mp3",
    contentHash: "b".repeat(64),
    storageReference: "object:voice/voice_generation_001",
    provider: "provider_test",
    origin: "SYNTHETIC_TTS",
    rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true },
  };
}

function contractError(code, path) {
  return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === path;
}
