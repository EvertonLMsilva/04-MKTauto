import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBTITLE_RENDER_POLICY_VERSION, SUBTITLE_RENDER_REQUEST_VERSION,
  SUBTITLE_RENDER_RESULT_VERSION, subtitleRenderIdentityHash,
  subtitleRenderRequestHash, validateSubtitleRenderRequest,
  validateSubtitleRenderResult,
} from "../src/domain/subtitle-render-contracts.js";
import { SUBTITLE_STYLE_POLICY_VERSION } from "../src/domain/subtitle-track-contracts.js";

test("contratos de render físico são fechados, versionados e reproduzíveis", () => {
  const value = request();
  assert.deepEqual(validateSubtitleRenderRequest(value), value);
  assert.equal(value.subtitleRenderRequestId, `subtitle_render:${subtitleRenderIdentityHash(value)}`);
  assert.equal(subtitleRenderRequestHash(value), value.contentHash);
  assert.throws(() => validateSubtitleRenderRequest({ ...value, extra: true }), error("UNKNOWN_FIELD", "request.extra"));
  assert.throws(() => validateSubtitleRenderRequest({ ...value, schemaVersion: "subtitle-render-request/2.0.0" }), error("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion"));
  const changed = { ...value, videoRenderContentHash: "f".repeat(64), contentHash: value.contentHash };
  changed.subtitleRenderRequestId = `subtitle_render:${subtitleRenderIdentityHash(changed)}`;
  assert.throws(() => validateSubtitleRenderRequest(changed), error("CONTENT_HASH_MISMATCH", "contentHash"));
});

test("resultado fecha propriedades físicas, referência opaca e toolchain auditável", () => {
  const value = result();
  assert.deepEqual(validateSubtitleRenderResult(value), value);
  assert.throws(() => validateSubtitleRenderResult({ ...value, durationMilliseconds: 0 }), error("INVALID_DURATION", "durationMilliseconds"));
  assert.throws(() => validateSubtitleRenderResult({ ...value, logicalReference: "file:C:/private.mp4" }), error("INVALID_LOGICAL_REFERENCE", "logicalReference"));
  assert.throws(() => validateSubtitleRenderResult({ ...value, toolchain: { ...value.toolchain, privatePath: "C:/private" } }), error("UNKNOWN_FIELD", "result.toolchain.privatePath"));
});

function request(overrides = {}) {
  const value = {
    schemaVersion: SUBTITLE_RENDER_REQUEST_VERSION, subtitleRenderRequestId: "pending",
    pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1,
    videoRenderId: "video_render_001", videoRenderContentHash: "a".repeat(64),
    compositionPlanId: "composition_plan_001", compositionPlanContentHash: "b".repeat(64),
    subtitleTrackId: "subtitle_track_001", subtitleTrackContentHash: "c".repeat(64),
    scriptId: "script_001", scriptContentHash: "d".repeat(64),
    voiceTrackId: "voice_track_001", voiceTrackContentHash: "e".repeat(64),
    stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION, renderPolicyVersion: SUBTITLE_RENDER_POLICY_VERSION,
    requestedAt: "2026-09-29T12:00:00.000Z", contentHash: "0".repeat(64), ...overrides,
  };
  value.subtitleRenderRequestId = `subtitle_render:${subtitleRenderIdentityHash(value)}`;
  value.contentHash = subtitleRenderRequestHash(value);
  return value;
}

function result(overrides = {}) { return {
  schemaVersion: SUBTITLE_RENDER_RESULT_VERSION, subtitleRenderRequestId: request().subtitleRenderRequestId,
  requestContentHash: request().contentHash, durationMilliseconds: 10000, containerFormat: "mp4",
  outputAspectRatio: "9:16", widthPixels: 1080, heightPixels: 1920, frameRate: 30,
  videoCodec: "h264", audioCodec: "aac", audioSampleRate: 48000, audioChannels: 1,
  contentHash: "f".repeat(64), logicalReference: `render:sha256_${"f".repeat(64)}`,
  toolchain: { ffmpegVersion: "ffmpeg version 8.0", libassFingerprint: "1".repeat(64), fontFamily: "Arial", fontProvider: "libass-default" },
  ...overrides,
}; }

function error(code, path) { return (caught) => caught?.code === code && caught?.path === path; }
