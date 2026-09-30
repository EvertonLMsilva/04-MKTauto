import test from "node:test";
import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { loadFfmpegVideoConfig, FFMPEG_VIDEO_POLICY_VERSION } from "../src/ffmpeg-video-config.js";

test("carrega política fechada sem expor localização em configuração pública", () => {
  const config = loadFfmpegVideoConfig(env("C:/private"));
  assert.equal(config.policyVersion, FFMPEG_VIDEO_POLICY_VERSION);
  assert.equal(config.widthPixels, 1080); assert.equal(config.heightPixels, 1920);
  assert.equal(config.frameRate, 30); assert.equal(config.videoCodec, "libx264");
  assert.equal(config.audioCodec, "aac"); assert.equal(config.maxSegments, 60);
  assert.ok(isAbsolute(config.renderRoot));
  assert.equal(config.stagingRoot, join(config.renderRoot, ".staging"));
  assert.equal(JSON.stringify(config.publicConfiguration).includes("private"), false);
});

test("rejeita configuração ausente, política divergente e staging configurável", () => {
  assert.throws(() => loadFfmpegVideoConfig({}), error("FFMPEG_CONFIGURATION_MISSING"));
  assert.throws(() => loadFfmpegVideoConfig(env("C:/private", { FFMPEG_VIDEO_FRAME_RATE: "25" })), error("FFMPEG_CONFIGURATION_INVALID"));
  assert.throws(() => loadFfmpegVideoConfig(env("C:/private", { FFMPEG_VIDEO_STAGING_ROOT: "C:/other" })), error("FFMPEG_CONFIGURATION_INVALID"));
});

function env(root, overrides = {}) { return {
  FFMPEG_PATH: "C:/bin/ffmpeg.exe", FFPROBE_PATH: "C:/bin/ffprobe.exe",
  FFMPEG_VOICE_ROOT: `${root}/voice`, FFMPEG_MEDIA_ROOT: `${root}/media`, FFMPEG_RENDER_ROOT: `${root}/render`,
  ...overrides,
}; }
function error(code) { return (caught) => caught?.code === code; }
