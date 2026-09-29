import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_COMPOSITION_REQUEST_VERSION,
  validateVideoComposerOutput,
  validateVideoCompositionRequest,
  videoCompositionRequestHash,
} from "../src/domain/video-composition-contracts.js";

test("valida solicitação explícita, imutável e com hash reproduzível", () => {
  const value = request();
  const validated = validateVideoCompositionRequest(value);
  assert.deepEqual(validated, value);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(videoCompositionRequestHash(value), value.contentHash);
});

test("identidade considera plano, hash, propriedades técnicas e instante", () => {
  const original = request();
  for (const change of [
    { compositionPlanId: "composition_plan_002" },
    { compositionPlanContentHash: "b".repeat(64) },
    { containerFormat: "webm" },
    { widthPixels: 720, heightPixels: 1280 },
    { requestedAt: "2026-09-29T00:01:00.000Z" },
  ]) assert.notEqual(hash({ ...original, ...change }), original.contentHash);
});

test("rejeita propriedades inválidas e campos desconhecidos", () => {
  assert.throws(() => validateVideoCompositionRequest(request({ widthPixels: 0 })), error("INVALID_VIDEO_DIMENSION", "widthPixels"));
  assert.throws(() => validateVideoCompositionRequest(request({ codec: "h264" })), error("UNKNOWN_FIELD", "request.codec"));
});

test("trata saída do composer como contrato fechado e sanitizado", () => {
  const output = {
    durationMilliseconds: 10000, containerFormat: "mp4", widthPixels: 1080,
    heightPixels: 1920, contentHash: "f".repeat(64), logicalReference: "render:output_001",
  };
  assert.deepEqual(validateVideoComposerOutput(output), output);
  for (const change of [
    { logicalReference: "https://private.example/video.mp4" },
    { logicalReference: "C:/private/video.mp4" },
    { logicalReference: "s3:bucket-key" },
    { bytes: Buffer.from("private") },
    { command: "ffmpeg -i private" },
  ]) assert.throws(() => validateVideoComposerOutput({ ...output, ...change }));
});

function request(overrides = {}) {
  const value = {
    schemaVersion: VIDEO_COMPOSITION_REQUEST_VERSION,
    videoCompositionRequestId: "video_composition_001",
    compositionPlanId: "composition_plan_001",
    compositionPlanContentHash: "a".repeat(64),
    containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920,
    requestedAt: "2026-09-29T00:00:00.000Z", contentHash: "0".repeat(64),
    ...overrides,
  };
  value.contentHash = videoCompositionRequestHash(value);
  return value;
}

function hash(value) { return videoCompositionRequestHash({ ...value, contentHash: "0".repeat(64) }); }
function error(code, path) { return (caught) => caught?.code === code && caught?.path === path; }
