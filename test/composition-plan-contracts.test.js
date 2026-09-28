import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPOSITION_PLAN_CONTRACT_VERSION,
  compositionPlanContentHash,
  compositionPlanIdentityHash,
  validateCompositionPlan,
} from "../src/domain/composition-plan-contracts.js";

test("valida plano contínuo em milissegundos com hashes reproduzíveis", () => {
  const value = validateCompositionPlan(plan());
  assert.equal(value.schemaVersion, COMPOSITION_PLAN_CONTRACT_VERSION);
  assert.equal(value.timelineUnit, "MILLISECOND");
  assert.equal(value.continuityMode, "CONTIGUOUS");
  assert.equal(Object.isFrozen(value.segments), true);
  assert.equal(compositionPlanContentHash(value), value.contentHash);
  assert.equal(compositionPlanIdentityHash(value), compositionPlanIdentityHash(structuredClone(value)));
});

test("exige ordem explícita, início zero e duração positiva", () => {
  assert.throws(() => validateCompositionPlan(plan({ segments: segments([{ position: 2 }]) })), error("INVALID_SEGMENT_POSITION", "segments.0.position"));
  assert.throws(() => validateCompositionPlan(plan({ segments: segments([{ startMilliseconds: 1 }]) })), error("TIMELINE_MUST_START_AT_ZERO", "segments.0.startMilliseconds"));
  assert.throws(() => validateCompositionPlan(plan({ segments: segments([{ endMilliseconds: 0 }]) })), error("NON_POSITIVE_SEGMENT_DURATION", "segments.0.endMilliseconds"));
});

test("rejeita lacunas e sobreposição sob continuidade obrigatória", () => {
  assert.throws(() => validateCompositionPlan(plan({ segments: segments([{}, { startMilliseconds: 4001 }]) })), error("TIMELINE_GAP", "segments.1.startMilliseconds"));
  assert.throws(() => validateCompositionPlan(plan({ segments: segments([{}, { startMilliseconds: 3999 }]) })), error("TIMELINE_OVERLAP", "segments.1.startMilliseconds"));
  assert.throws(() => validateCompositionPlan(plan({ continuityMode: "INTENTIONAL_GAPS" })), error("UNSUPPORTED_CONTINUITY_MODE", "continuityMode"));
});

test("término e duração total precisam coincidir exatamente", () => {
  assert.throws(() => validateCompositionPlan(plan({ durationMilliseconds: 10001 })), error("TIMELINE_DURATION_MISMATCH", "durationMilliseconds"));
  assert.throws(() => validateCompositionPlan(plan({ timelineUnit: "SECOND" })), error("UNSUPPORTED_TIMELINE_UNIT", "timelineUnit"));
});

test("impede direções ou ativos duplicados e exige hashes exatos", () => {
  assert.throws(() => validateCompositionPlan(plan({ segments: segments([{}, { visualDirectionPosition: 1 }]) })), error("DUPLICATE_VISUAL_DIRECTION", "segments.1.visualDirectionPosition"));
  assert.throws(() => validateCompositionPlan(plan({ segments: segments([{}, { mediaAssetId: "media_asset_001" }]) })), error("DUPLICATE_MEDIA_ASSET", "segments.1.mediaAssetId"));
  assert.throws(() => validateCompositionPlan(plan({ voiceTrackContentHash: "x".repeat(64) })), error("INVALID_HASH", "voiceTrackContentHash"));
});

test("rejeita propriedades físicas, transformações e dados sensíveis", () => {
  for (const field of ["widthPixels", "heightPixels", "crop", "fit", "transition", "storageLocation", "bytes", "token"]) {
    assert.throws(() => validateCompositionPlan(plan({ [field]: "private" })), error("UNKNOWN_FIELD", `compositionPlan.${field}`));
  }
  assert.throws(() => validateCompositionPlan(plan({ segments: segments([{ mediaUrl: "https://private.example/a.png" }]) })), error("UNKNOWN_FIELD", "segments.0.mediaUrl"));
});

test("exige revisão e supersessão coerentes", () => {
  assert.throws(() => validateCompositionPlan(plan({ revision: 2 })), error("SUPERSEDED_COMPOSITION_PLAN_REQUIRED", "supersedesCompositionPlanId"));
  assert.throws(() => validateCompositionPlan(plan({ supersedesCompositionPlanId: "composition_plan_old" })), error("INVALID_SUPERSESSION", "supersedesCompositionPlanId"));
});

function segments(overrides = []) {
  const base = [
    { position: 1, visualDirectionPosition: 1, mediaAssetId: "media_asset_001", mediaAssetContentHash: "c".repeat(64), startMilliseconds: 0, endMilliseconds: 4000 },
    { position: 2, visualDirectionPosition: 2, mediaAssetId: "media_asset_002", mediaAssetContentHash: "d".repeat(64), startMilliseconds: 4000, endMilliseconds: 10000 },
  ];
  return base.map((item, index) => ({ ...item, ...(overrides[index] ?? {}) }));
}

function plan(overrides = {}) {
  const value = {
    schemaVersion: COMPOSITION_PLAN_CONTRACT_VERSION,
    compositionPlanId: "composition_plan_001", pipelineRunId: "run_e07_001",
    projectId: "project_curiosidades_ia", projectVersion: 1,
    scriptId: "script_001", scriptContentHash: "a".repeat(64),
    voiceTrackId: "voice_track_001", voiceTrackContentHash: "b".repeat(64),
    outputAspectRatio: "9:16", timelineUnit: "MILLISECOND",
    continuityMode: "CONTIGUOUS", durationMilliseconds: 10000,
    segments: segments(), createdAt: "2026-09-28T23:00:00.000Z",
    revision: 1, supersedesCompositionPlanId: null, contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = compositionPlanContentHash(value);
  return value;
}

function error(code, path) {
  return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === path;
}
