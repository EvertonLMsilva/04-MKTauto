import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FfmpegSubtitleRenderer } from "../src/adapters/ffmpeg-subtitle-renderer.js";
import { LocalCompositionReferenceResolver } from "../src/adapters/local-composition-reference-resolver.js";
import { LocalVideoStorage } from "../src/adapters/local-video-storage.js";
import { SUBTITLE_RENDER_POLICY_VERSION } from "../src/domain/subtitle-render-contracts.js";
import { subtitleTrackContentHash } from "../src/domain/subtitle-track-contracts.js";
import { sha256 } from "../test-support/physical-fixtures.js";
import { SUBTITLE_STYLE_POLICY_VERSION } from "../src/domain/subtitle-track-contracts.js";

test("burn-in usa ASS determinístico, allowlist, áudio copy, probe, hash e limpeza", async () => withRoot(async (root) => {
  const fixture = physicalFixture(root); const calls = []; let ass;
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === "-version") return { stdout: "ffmpeg version 8.0\n" };
    if (args.includes("filter=subtitles")) return { stdout: "Filter subtitles libass" };
    if (command === "ffprobe-bin") return { stdout: probeJson(10000) };
    if (args.includes("-vf")) { ass = readFileSync(join(options.cwd, "subtitles.ass"), "utf8"); writeFileSync(args.at(-1), Buffer.from("burned-mp4")); }
    return { stdout: "" };
  };
  const result = await renderer(fixture, runner).render(fixture.input);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:09\.88/);
  const encode = calls.find(({ args }) => args.includes("-vf"));
  assert.equal(encode.options.shell, false); assert.ok(encode.args.includes("copy"));
  assert.equal(encode.args[encode.args.indexOf("-vf") + 1], "subtitles=filename=subtitles.ass");
  for (const value of ["libx264", "high", "4.0", "20", "medium", "yuv420p", "30", "60", "+faststart"]) assert.ok(encode.args.includes(value), value);
  assert.equal(result.contentHash, sha256(Buffer.from("burned-mp4"))); assert.equal(result.toolchain.ffmpegVersion, "ffmpeg version 8.0");
  const staging = join(root, "render", ".staging"); assert.equal(!existsSync(staging) || readdirSync(staging).length === 0, true);
}));

test("rejeita hash físico, saída/probe/política, timeout e cancelamento sem staging residual", async () => withRoot(async (root) => {
  const fixture = physicalFixture(root); writeFileSync(fixture.videoPath, Buffer.from("tampered"));
  let calls = 0; await assert.rejects(renderer(fixture, async (_command, args) => { calls += 1; if (args[0] === "-version") return { stdout: "ffmpeg version 8" }; if (args.includes("filter=subtitles")) return { stdout: "subtitles libass" }; return { stdout: "" }; }).render(fixture.input), adapterError("SUBTITLE_RENDER_PHYSICAL_HASH_MISMATCH"));
  assert.equal(calls, 2);
  writeFileSync(fixture.videoPath, fixture.videoBytes);
  const badProbe = async (_command, args) => { if (args[0] === "-version") return { stdout: "ffmpeg version 8" }; if (args.includes("filter=subtitles")) return { stdout: "subtitles libass" }; if (args.includes("-vf")) writeFileSync(args.at(-1), Buffer.from("out")); if (args[0] === "-v") return { stdout: "{" }; return { stdout: "" }; };
  await assert.rejects(renderer(fixture, badProbe).render(fixture.input), adapterError("SUBTITLE_RENDER_PROBE_INVALID"));
  const timeout = Object.assign(new Error("PRIVATE"), { code: "COMPOSER_TIMEOUT" });
  await assert.rejects(renderer(fixture, async (_command, args) => { if (args[0] === "-version") return { stdout: "ffmpeg version 8" }; if (args.includes("filter=subtitles")) return { stdout: "subtitles libass" }; throw timeout; }).render(fixture.input), adapterError("SUBTITLE_RENDER_TIMEOUT"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderer(fixture, badProbe).render(fixture.input, { signal: controller.signal }), adapterError("SUBTITLE_RENDER_CANCELLED"));
  const staging = join(root, "render", ".staging"); assert.equal(!existsSync(staging) || readdirSync(staging).length === 0, true);
}));

test("storage reconcilia somente receipt, request hash, bytes e política íntegros", async () => withRoot(async (root) => {
  const storage = new LocalVideoStorage({ root: join(root, "render"), maxBytes: 1024 }); const staging = await storage.createStaging(); const source = join(staging, "render.mp4");
  writeFileSync(source, Buffer.from("physical")); const contentHash = sha256(Buffer.from("physical")); const requestHash = "a".repeat(64);
  const toolchain = { ffmpegVersion: "ffmpeg version test", libassFingerprint: "b".repeat(64), fontFamily: "Arial", fontProvider: "libass-default" };
  await storage.promote(source, contentHash, { reconciliation: { requestHash, policyVersion: SUBTITLE_RENDER_POLICY_VERSION, toolchain } });
  assert.equal((await storage.reconcile(requestHash, SUBTITLE_RENDER_POLICY_VERSION)).contentHash, contentHash);
  await assert.rejects(storage.reconcile(requestHash, "other-policy"), adapterError("SUBTITLE_RENDER_RECONCILIATION_INVALID"));
  await storage.cleanup(staging);
}));

function renderer(fixture, processRunner) { return new FfmpegSubtitleRenderer(config(fixture.root), { processRunner,
  referenceResolver: new LocalCompositionReferenceResolver({ voiceRoot: fixture.root, mediaRoot: fixture.root, renderRoot: join(fixture.root, "render") }),
  storage: new LocalVideoStorage({ root: join(fixture.root, "render"), maxBytes: 1024 * 1024 }) }); }
function config(root) { return { policyVersion: SUBTITLE_RENDER_POLICY_VERSION, ffmpegPath: "ffmpeg-bin", ffprobePath: "ffprobe-bin", renderRoot: join(root, "render"), stagingRoot: join(root, "render", ".staging"),
  widthPixels: 1080, heightPixels: 1920, frameRate: 30, videoCodec: "libx264", videoProfile: "high", videoLevel: "4.0", crf: 20, preset: "medium", pixelFormat: "yuv420p",
  audioCodec: "copy", audioSampleRate: 48000, audioChannels: 1, gopSize: 60, durationToleranceMilliseconds: 34, maxInputBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024, timeoutMs: 300000, maxLogBytes: 65536,
  fontFamily: "Arial", fontProvider: "libass-default" }; }
function physicalFixture(root) { const videoBytes = Buffer.from("source-mp4"); const hash = sha256(videoBytes); const directory = join(root, "render", "sha256", hash.slice(0, 2)); mkdirSync(directory, { recursive: true }); const videoPath = join(directory, `${hash}.mp4`); writeFileSync(videoPath, videoBytes);
  const request = { subtitleRenderRequestId: "subtitle_render_001", contentHash: "9".repeat(64) };
  const videoRender = { schemaVersion: "video-render/1.0.0", videoRenderId: "video_render_001", pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1, compositionPlanId: "composition_plan_001", compositionPlanContentHash: "b".repeat(64), outputAspectRatio: "9:16", durationMilliseconds: 10000, containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920, contentHash: hash, logicalReference: `render:sha256_${hash}`, createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesVideoRenderId: null };
  const subtitleTrack = { schemaVersion: "subtitle-track/1.0.0", subtitleTrackId: "subtitle_track_001", pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1, scriptId: "script_001", scriptContentHash: "d".repeat(64), voiceTrackId: "voice_track_001", voiceTrackContentHash: "e".repeat(64), language: "pt-BR", timeUnit: "MILLISECONDS", durationMilliseconds: 10000, stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION, cues: [{ position: 1, text: "Legenda segura", startMilliseconds: 0, endMilliseconds: 9880 }], createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesSubtitleTrackId: null, contentHash: "0".repeat(64) };
  subtitleTrack.contentHash = subtitleTrackContentHash(subtitleTrack);
  return { root, videoBytes, videoPath, input: { request, videoRender, subtitleTrack } }; }
function probeJson(duration) { return JSON.stringify({ streams: [{ index: 0, codec_name: "h264", profile: "High", codec_type: "video", width: 1080, height: 1920, pix_fmt: "yuv420p", level: 40, r_frame_rate: "30/1", avg_frame_rate: "30/1", duration: (duration / 1000).toFixed(6) }, { index: 1, codec_name: "aac", profile: "LC", codec_type: "audio", sample_rate: "48000", channels: 1, duration: (duration / 1000).toFixed(6) }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: (duration / 1000).toFixed(6), size: "12" } }); }
async function withRoot(run) { const root = mkdtempSync(join(tmpdir(), "mktauto-subtitle-render-")); mkdirSync(join(root, "render"), { recursive: true }); try { await run(root); } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); } }
function adapterError(code) { return (caught) => caught?.code === code && !caught.message.includes("PRIVATE"); }
