import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBTITLE_STYLE_POLICY_VERSION,
  SUBTITLE_TRACK_CONTRACT_VERSION,
  subtitleTrackContentHash,
  validateSubtitleTrack,
} from "../src/domain/subtitle-track-contracts.js";

test("aceita contrato fechado, imutável e com gaps intencionais", () => {
  const value = subtitleTrack();
  const validated = validateSubtitleTrack(value);
  assert.deepEqual(validated, value);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated.cues));
  assert.ok(Object.isFrozen(validated.cues[0]));
  assert.equal(validated.cues[1].startMilliseconds > validated.cues[0].endMilliseconds, true);
  assert.equal(validated.cues.at(-1).endMilliseconds < validated.durationMilliseconds, true);
});

test("produz hash reproduzível e sensível ao conteúdo", () => {
  const first = subtitleTrack();
  const second = subtitleTrack();
  assert.equal(subtitleTrackContentHash(first), subtitleTrackContentHash(second));
  const changed = { ...second, cues: second.cues.map((cue, index) => index ? cue : { ...cue, text: "Texto diferente." }) };
  changed.contentHash = subtitleTrackContentHash(changed);
  assert.notEqual(changed.contentHash, first.contentHash);
});

test("rejeita versão, campos desconhecidos, IDs e hashes inválidos", () => {
  assertContract({ schemaVersion: "subtitle-track/2.0.0" }, "UNSUPPORTED_SCHEMA_VERSION", "schemaVersion");
  assertContract({ extra: true }, "UNKNOWN_FIELD", "subtitleTrack.extra");
  assertContract({ subtitleTrackId: "X" }, "INVALID_IDENTIFIER", "subtitleTrackId");
  assertContract({ voiceTrackContentHash: "x".repeat(64) }, "INVALID_HASH", "voiceTrackContentHash");
});

test("rejeita idioma, unidade, política, duração e supersessão inválidos", () => {
  assertContract({ language: "português" }, "INVALID_LANGUAGE", "language");
  assertContract({ timeUnit: "SECONDS" }, "INVALID_TIME_UNIT", "timeUnit");
  assertContract({ stylePolicyVersion: "style/latest" }, "UNSUPPORTED_STYLE_POLICY", "stylePolicyVersion");
  assertContract({ durationMilliseconds: 0 }, "INVALID_DURATION", "durationMilliseconds");
  assertContract({ revision: 2 }, "SUPERSEDED_SUBTITLE_TRACK_REQUIRED", "supersedesSubtitleTrackId");
});

test("rejeita cues vazios, posições e ordem inválidas", () => {
  assertContract({ cues: [] }, "INVALID_CUES", "cues");
  assertCue([{ position: 2, text: "Primeiro.", startMilliseconds: 0, endMilliseconds: 1000 }], "INVALID_CUE_POSITION", "cues.0.position");
  assertCue([
    { position: 1, text: "Primeiro.", startMilliseconds: 0, endMilliseconds: 1000 },
    { position: 2, text: "Segundo.", startMilliseconds: 500, endMilliseconds: 1500 },
  ], "CUE_OVERLAP", "cues.1.startMilliseconds");
});

test("rejeita início diferente de zero, duração não positiva e fim após a voz", () => {
  assertCue([{ position: 1, text: "Primeiro.", startMilliseconds: 1, endMilliseconds: 1000 }], "FIRST_CUE_MUST_START_AT_ZERO", "cues.0.startMilliseconds");
  assertCue([{ position: 1, text: "Primeiro.", startMilliseconds: 0, endMilliseconds: 0 }], "INVALID_CUE_DURATION", "cues.0.endMilliseconds");
  assertCue([{ position: 1, text: "Primeiro.", startMilliseconds: 0, endMilliseconds: 30001 }], "CUE_EXCEEDS_VOICE_DURATION", "cues.0.endMilliseconds");
});

test("rejeita texto vazio, não normalizado, controles e conteúdo sensível", () => {
  assertCue([{ position: 1, text: "", startMilliseconds: 0, endMilliseconds: 1000 }], "INVALID_CUE_TEXT", "cues.0.text");
  assertCue([{ position: 1, text: " cafe\u0301 ", startMilliseconds: 0, endMilliseconds: 1000 }], "INVALID_CUE_TEXT", "cues.0.text");
  assertCue([{ position: 1, text: "linha\nprivada", startMilliseconds: 0, endMilliseconds: 1000 }], "INVALID_CUE_TEXT", "cues.0.text");
  assertCue([{ position: 1, text: "Bearer segredo-total", startMilliseconds: 0, endMilliseconds: 1000 }], "SENSITIVE_CONTENT", "cues.0.text");
});

test("rejeita hash divergente", () => {
  assert.throws(() => validateSubtitleTrack({ ...subtitleTrack(), contentHash: "f".repeat(64) }), error("CONTENT_HASH_MISMATCH", "contentHash"));
});

function subtitleTrack(overrides = {}) {
  const value = {
    schemaVersion: SUBTITLE_TRACK_CONTRACT_VERSION,
    subtitleTrackId: "subtitle_track_001",
    pipelineRunId: "run_e07_001",
    projectId: "project_curiosidades_ia",
    projectVersion: 1,
    scriptId: "script_001",
    scriptContentHash: "a".repeat(64),
    voiceTrackId: "voice_track_001",
    voiceTrackContentHash: "b".repeat(64),
    language: "pt-BR",
    timeUnit: "MILLISECONDS",
    durationMilliseconds: 30000,
    stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION,
    cues: [
      { position: 1, text: "Primeiro trecho.", startMilliseconds: 0, endMilliseconds: 9000 },
      { position: 2, text: "Segundo trecho.", startMilliseconds: 10000, endMilliseconds: 29000 },
    ],
    createdAt: "2026-09-29T20:00:00.000Z",
    revision: 1,
    supersedesSubtitleTrackId: null,
    contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = subtitleTrackContentHash(value);
  return value;
}

function assertCue(cues, code, path) { assertContract({ cues }, code, path); }
function assertContract(overrides, code, path) {
  assert.throws(() => validateSubtitleTrack(subtitleTrack(overrides)), error(code, path));
}
function error(code, path) {
  return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === path;
}
