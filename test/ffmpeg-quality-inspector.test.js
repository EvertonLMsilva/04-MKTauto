import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { FfmpegQualityInspector } from "../src/adapters/ffmpeg-quality-inspector.js";

test("adapter retorna somente fatos técnicos sanitizados, sem classificar severidade", async () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-qc-inspector-")); const videoPath = join(root, "private-video.mp4"); const mediaPath = join(root, "private-media.png");
  const video = Buffer.from("video-fixture"); const media = Buffer.from("media-fixture"); writeFileSync(videoPath, video); writeFileSync(mediaPath, media);
  try {
    const calls = [];
    const inspector = new FfmpegQualityInspector(config(), {
      referenceResolver: { resolveVideo: async () => videoPath, resolveMedia: async () => mediaPath },
      processRunner: async (_command, args) => { calls.push(args); return args.includes("-show_streams") ? { stdout: JSON.stringify(probe()), stderr: "" } : { stdout: "", stderr: "" }; },
    });
    const facts = await inspector.inspect({ videoRender: { logicalReference: "render:safe" }, mediaAssets: [{ mediaAssetId: "media_asset:qc:001", mediaReference: "media:safe" }] });
    assert.equal(facts.video.sha256, sha256(video)); assert.equal(facts.video.decodeSucceeded, true); assert.equal(facts.video.probeSucceeded, true);
    assert.equal(facts.media[0].sha256, sha256(media)); assert.equal(calls.length, 2);
    assert.equal("status" in facts.video, false); assert.equal("severity" in facts.video, false); assert.equal(JSON.stringify(facts).includes(root), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("adapter converte ausência e falha de processo em fatos públicos", async () => {
  const inspector = new FfmpegQualityInspector(config(), { referenceResolver: { resolveVideo: async () => { const error = new Error("private C:\\Users\\secret"); error.code = "COMPOSER_INPUT_NOT_FOUND"; throw error; }, resolveMedia: async () => { const error = new Error("missing"); error.code = "COMPOSER_INPUT_NOT_FOUND"; throw error; } }, processRunner: async () => { throw new Error("não deveria executar"); } });
  const facts = await inspector.inspect({ videoRender: { logicalReference: "render:safe" }, mediaAssets: [{ mediaAssetId: "media_asset:qc:001", mediaReference: "media:safe" }] });
  assert.equal(facts.video.exists, false); assert.equal(facts.video.decodeSucceeded, false); assert.equal(facts.media[0].errorKind, "NOT_FOUND"); assert.equal(JSON.stringify(facts).includes("secret"), false);
});

function config() { return { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", maxOutputBytes: 1000000, maxMediaBytes: 1000000, timeoutMs: 1000, maxLogBytes: 10000 }; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function probe() { return { format: { format_name: "mov,mp4", duration: "1.000", size: "100", start_time: "0.000" }, streams: [{ index: 0, codec_type: "video", codec_name: "h264", profile: "High", level: 40, width: 1080, height: 1920, pix_fmt: "yuv420p", r_frame_rate: "30/1", avg_frame_rate: "30/1", duration: "1.000", start_time: "0.000" }, { index: 1, codec_type: "audio", codec_name: "aac", profile: "LC", sample_rate: "48000", channels: 1, duration: "1.000", start_time: "0.000" }] }; }
