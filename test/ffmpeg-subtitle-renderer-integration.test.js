import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FfmpegSubtitleRenderer } from "../src/adapters/ffmpeg-subtitle-renderer.js";
import { LocalCompositionReferenceResolver } from "../src/adapters/local-composition-reference-resolver.js";
import { LocalVideoStorage } from "../src/adapters/local-video-storage.js";
import { SUBTITLE_RENDER_POLICY_VERSION } from "../src/domain/subtitle-render-contracts.js";
import { subtitleTrackContentHash } from "../src/domain/subtitle-track-contracts.js";
import { sha256 } from "../test-support/physical-fixtures.js";
import { SUBTITLE_STYLE_POLICY_VERSION } from "../src/domain/subtitle-track-contracts.js";

test("integração local queima legenda em MP4 real e reconcilia sem reencode", { skip: process.env.FFMPEG_SUBTITLE_INTEGRATION_TEST !== "1", timeout: 310000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-subtitle-integration-")); const renderRoot = join(root, "render"); mkdirSync(renderRoot, { recursive: true });
  try {
    const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg"; const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe"; const raw = join(root, "source.mp4");
    execFileSync(ffmpeg, ["-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=1080x1920:r=30:d=1", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.0", "-pix_fmt", "yuv420p", "-r", "30", "-g", "60", "-c:a", "aac", "-profile:a", "aac_low", "-ar", "48000", "-ac", "1", "-shortest", "-y", raw], { windowsHide: true });
    const bytes = readFileSync(raw); const sourceHash = sha256(bytes); const directory = join(renderRoot, "sha256", sourceHash.slice(0, 2)); mkdirSync(directory, { recursive: true }); renameSync(raw, join(directory, `${sourceHash}.mp4`));
    const fixture = input(sourceHash); const storage = new LocalVideoStorage({ root: renderRoot, maxBytes: 524288000 }); const adapter = new FfmpegSubtitleRenderer(config(ffmpeg, ffprobe, renderRoot), { storage, referenceResolver: new LocalCompositionReferenceResolver({ voiceRoot: root, mediaRoot: root, renderRoot }) });
    const first = await adapter.render(fixture); const second = await adapter.render(fixture);
    assert.deepEqual(second, first); assert.equal(first.contentHash, sha256(readFileSync(join(renderRoot, "sha256", first.contentHash.slice(0, 2), `${first.contentHash}.mp4`))));
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

function input(contentHash) { const request = { subtitleRenderRequestId: "subtitle_render_integration", contentHash: "a".repeat(64) }; const videoRender = { schemaVersion: "video-render/1.0.0", videoRenderId: "video_render_integration", pipelineRunId: "run_e07_integration", projectId: "project_e07", projectVersion: 1, compositionPlanId: "composition_plan_integration", compositionPlanContentHash: "b".repeat(64), outputAspectRatio: "9:16", durationMilliseconds: 1000, containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920, contentHash, logicalReference: `render:sha256_${contentHash}`, createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesVideoRenderId: null };
  const subtitleTrack = { schemaVersion: "subtitle-track/1.0.0", subtitleTrackId: "subtitle_track_integration", pipelineRunId: "run_e07_integration", projectId: "project_e07", projectVersion: 1, scriptId: "script_integration", scriptContentHash: "d".repeat(64), voiceTrackId: "voice_track_integration", voiceTrackContentHash: "e".repeat(64), language: "pt-BR", timeUnit: "MILLISECONDS", durationMilliseconds: 1000, stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION, cues: [{ position: 1, text: "Legenda física", startMilliseconds: 0, endMilliseconds: 880 }], createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesSubtitleTrackId: null, contentHash: "0".repeat(64) }; subtitleTrack.contentHash = subtitleTrackContentHash(subtitleTrack); return { request, videoRender, subtitleTrack }; }
function config(ffmpegPath, ffprobePath, renderRoot) { return { policyVersion: SUBTITLE_RENDER_POLICY_VERSION, ffmpegPath, ffprobePath, renderRoot, stagingRoot: join(renderRoot, ".staging"), widthPixels: 1080, heightPixels: 1920, frameRate: 30, videoCodec: "libx264", videoProfile: "high", videoLevel: "4.0", crf: 20, preset: "medium", pixelFormat: "yuv420p", audioCodec: "copy", audioSampleRate: 48000, audioChannels: 1, gopSize: 60, durationToleranceMilliseconds: 34, maxInputBytes: 524288000, maxOutputBytes: 524288000, timeoutMs: 300000, maxLogBytes: 65536, fontFamily: "Arial", fontProvider: "libass-default" }; }
