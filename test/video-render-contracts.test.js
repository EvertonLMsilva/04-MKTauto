import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_RENDER_CONTRACT_VERSION,
  dimensionsMatchAspectRatio,
  validateVideoRender,
  videoRenderIdentityHash,
} from "../src/domain/video-render-contracts.js";

test("valida propriedades reais fornecidas e identidade reproduzível", () => {
  const value = validateVideoRender(render());
  assert.equal(value.schemaVersion, VIDEO_RENDER_CONTRACT_VERSION);
  assert.equal(value.durationMilliseconds, 10000);
  assert.equal(value.widthPixels, 1080);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(videoRenderIdentityHash(value), videoRenderIdentityHash(structuredClone(value)));
});

test("compara dimensões e proporção por aritmética inteira determinística", () => {
  assert.equal(dimensionsMatchAspectRatio(1080, 1920, "9:16"), true);
  assert.equal(dimensionsMatchAspectRatio(2160, 3840, "9:16"), true);
  assert.equal(dimensionsMatchAspectRatio(1920, 1080, "16:9"), true);
  assert.equal(dimensionsMatchAspectRatio(1000, 1000, "1:1"), true);
  assert.equal(dimensionsMatchAspectRatio(1080, 1919, "9:16"), false);
  assert.throws(() => validateVideoRender(render({ heightPixels: 1919 })), error("VIDEO_DIMENSIONS_ASPECT_RATIO_MISMATCH", "widthPixels"));
});

test("exige duração medida, dimensões e container sem inventar defaults", () => {
  for (const [change, code, path] of [
    [{ durationMilliseconds: null }, "INVALID_DURATION", "durationMilliseconds"],
    [{ widthPixels: null }, "INVALID_VIDEO_DIMENSION", "widthPixels"],
    [{ heightPixels: 0 }, "INVALID_VIDEO_DIMENSION", "heightPixels"],
    [{ containerFormat: "avi" }, "INVALID_CONTAINER_FORMAT", "containerFormat"],
  ]) assert.throws(() => validateVideoRender(render(change)), error(code, path));
});

test("hash de conteúdo é SHA-256 fornecido e não deriva da referência ou metadados", () => {
  const first = render();
  const second = render({ logicalReference: "render:output_002" });
  assert.equal(first.contentHash, second.contentHash);
  assert.notEqual(videoRenderIdentityHash(first), videoRenderIdentityHash(second));
  assert.throws(() => validateVideoRender(render({ contentHash: "not-content" })), error("INVALID_HASH", "contentHash"));
});

test("referência é lógica, opaca e não aceita localização física ou segredo", () => {
  for (const logicalReference of [
    "https://example.test/video.mp4", "file:c:/private/video.mp4", "data:video/mp4;base64,AAAA",
    "s3:private-bucket/key", "object:bucket/key", "path:server/share", "render:token_private",
    "C:\\private\\video.mp4", "/private/video.mp4",
  ]) assert.throws(() => validateVideoRender(render({ logicalReference })), error("INVALID_LOGICAL_REFERENCE", "logicalReference"));
});

test("rejeita bytes, propriedades não medidas, transformação, SDK e storage", () => {
  for (const field of [
    "bytes", "buffer", "base64", "url", "storageLocation", "bucket", "objectKey",
    "codec", "bitrate", "frameRate", "audio", "crop", "fit", "resize", "loop",
    "transition", "speed", "command", "process", "sdkObject", "token",
  ]) assert.throws(() => validateVideoRender(render({ [field]: "private" })), error("UNKNOWN_FIELD", `videoRender.${field}`));
});

test("exige revisão e supersessão coerentes", () => {
  assert.throws(() => validateVideoRender(render({ revision: 2 })), error("SUPERSEDED_VIDEO_RENDER_REQUIRED", "supersedesVideoRenderId"));
  assert.throws(() => validateVideoRender(render({ supersedesVideoRenderId: "video_render_old" })), error("INVALID_SUPERSESSION", "supersedesVideoRenderId"));
});

function render(overrides = {}) {
  return {
    schemaVersion: VIDEO_RENDER_CONTRACT_VERSION, videoRenderId: "video_render_001",
    pipelineRunId: "run_e07_001", projectId: "project_curiosidades_ia", projectVersion: 1,
    compositionPlanId: "composition_plan_001", compositionPlanContentHash: "a".repeat(64),
    outputAspectRatio: "9:16", durationMilliseconds: 10000, containerFormat: "mp4",
    widthPixels: 1080, heightPixels: 1920, contentHash: "b".repeat(64),
    logicalReference: "render:output_001", createdAt: "2026-09-28T23:30:00.000Z",
    revision: 1, supersedesVideoRenderId: null, ...overrides,
  };
}

function error(code, path) {
  return (caught) => caught?.name === "ContractValidationError" && caught.code === code && caught.path === path;
}
