import test from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_TRACK_CONTRACT_VERSION,
  validateVoiceTrack,
  voiceTrackIdentityHash,
} from "../src/domain/voice-track-contracts.js";

test("valida e congela faixa com identidade reproduzível", () => {
  const value = validateVoiceTrack(voiceTrack());
  assert.equal(value.schemaVersion, VOICE_TRACK_CONTRACT_VERSION);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.rights), true);
  assert.equal(voiceTrackIdentityHash(value), voiceTrackIdentityHash(structuredClone(value)));
});

test("aplica allowlists de formato, origem e direitos comerciais", () => {
  assert.throws(() => validateVoiceTrack(voiceTrack({ audioFormat: "exe" })), contractError("INVALID_AUDIO_FORMAT", "audioFormat"));
  assert.throws(() => validateVoiceTrack(voiceTrack({ origin: "CLONED_VOICE" })), contractError("INVALID_VOICE_ORIGIN", "origin"));
  assert.throws(() => validateVoiceTrack(voiceTrack({ rights: { usageBasis: "UNKNOWN", commercialUseAllowed: true } })), contractError("INVALID_USAGE_BASIS", "rights.usageBasis"));
  assert.throws(() => validateVoiceTrack(voiceTrack({ rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: false } })), contractError("COMMERCIAL_USE_REQUIRED", "rights.commercialUseAllowed"));
  const withoutRights = voiceTrack();
  delete withoutRights.rights;
  assert.throws(() => validateVoiceTrack(withoutRights), contractError("REQUIRED_FIELD", "voiceTrack.rights"));
});

test("exige duração, hashes, provider de síntese e revisão coerentes", () => {
  assert.throws(() => validateVoiceTrack(voiceTrack({ durationMilliseconds: 0 })), contractError("INVALID_DURATION", "durationMilliseconds"));
  assert.throws(() => validateVoiceTrack(voiceTrack({ contentHash: "x".repeat(64) })), contractError("INVALID_HASH", "contentHash"));
  assert.throws(() => validateVoiceTrack(voiceTrack({ provider: null })), contractError("PROVIDER_REQUIRED", "provider"));
  assert.throws(() => validateVoiceTrack(voiceTrack({ revision: 2 })), contractError("SUPERSEDED_VOICE_TRACK_REQUIRED", "supersedesVoiceTrackId"));
});

test("rejeita storage secreto, URL, caminho privado e campos inesperados", () => {
  for (const storageReference of [
    "https:opaque-reference",
    "C:\\private\\audio.mp3",
    "/var/private/audio.mp3",
    "object:voice/../secret",
    "object:voice/token/private",
  ]) {
    assert.throws(() => validateVoiceTrack(voiceTrack({ storageReference })), contractError("INVALID_STORAGE_REFERENCE", "storageReference"));
  }
  assert.throws(() => validateVoiceTrack(voiceTrack({ audioBytes: "private" })), contractError("UNKNOWN_FIELD", "voiceTrack.audioBytes"));
});

function voiceTrack(overrides = {}) {
  return {
    schemaVersion: VOICE_TRACK_CONTRACT_VERSION,
    voiceTrackId: "voice_track_001",
    pipelineRunId: "run_e05_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    scriptId: "script_001",
    scriptContentHash: "a".repeat(64),
    language: "pt-BR",
    voiceStyle: "informative",
    durationMilliseconds: 30125,
    audioFormat: "mp3",
    contentHash: "b".repeat(64),
    storageReference: "object:voice/voice_track_001",
    origin: "SYNTHETIC_TTS",
    provider: "provider_test",
    rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true },
    createdAt: "2026-09-28T19:00:00.000Z",
    revision: 1,
    supersedesVoiceTrackId: null,
    ...overrides,
  };
}

function contractError(code, path) {
  return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === path;
}
