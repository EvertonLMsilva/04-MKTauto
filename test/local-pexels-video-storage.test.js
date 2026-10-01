import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalPexelsVideoStorage } from "../src/adapters/local-pexels-video-storage.js";

test("FFprobe mede MP4 sem áudio, FFmpeg decodifica e storage usa hash", async () => {
  await withRoot(async (root) => {
    const calls = [];
    const storage = new LocalPexelsVideoStorage({ root, maxBytes: 1024, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" }, { executeImpl: executor(calls) });
    const first = await storage.store(Buffer.from("valid-video"));
    const second = await storage.store(Buffer.from("valid-video"));
    assert.equal(first.contentHash, second.contentHash); assert.equal(second.reused, true);
    assert.deepEqual({ format: first.format, mimeType: first.mimeType, width: first.widthPixels, height: first.heightPixels, duration: first.durationMilliseconds, hasAudio: first.hasAudio }, { format: "mp4", mimeType: "video/mp4", width: 1080, height: 1920, duration: 30000, hasAudio: false });
    assert.equal(calls.some(({ command, args }) => command === "ffmpeg" && args.includes("-f") && args.includes("null")), true);
  });
});

test("rejeita áudio, probe inválido, decode falho, arquivo vazio e limite", async () => {
  await withRoot(async (root) => {
    const audio = new LocalPexelsVideoStorage({ root, maxBytes: 1024, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" }, { executeImpl: executor([], true) });
    await assert.rejects(audio.store(Buffer.from("audio-video")), (error) => error.code === "PROVIDER_VIDEO_STREAMS_INVALID");
    const decode = new LocalPexelsVideoStorage({ root, maxBytes: 1024, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" }, { executeImpl: async (command) => { if (command === "ffmpeg") throw new Error("private"); return probe(false); } });
    await assert.rejects(decode.store(Buffer.from("decode-video")), (error) => error.code === "PROVIDER_VIDEO_DECODE_FAILED" && !error.message.includes("private"));
    await assert.rejects(decode.store(Buffer.alloc(0)), (error) => error.code === "PROVIDER_INVALID_VIDEO");
    await assert.rejects(new LocalPexelsVideoStorage({ root, maxBytes: 2, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" }, { executeImpl: executor([]) }).store(Buffer.from("large")), (error) => error.code === "PROVIDER_VIDEO_TOO_LARGE");
  });
});

function executor(calls, withAudio = false) { return async (command, args) => { calls.push({ command, args }); return command === "ffprobe" ? probe(withAudio) : { stdout: "", stderr: "" }; }; }
function probe(withAudio) { return { stdout: JSON.stringify({ streams: [{ codec_type: "video", width: 1080, height: 1920, duration: "30" }, ...(withAudio ? [{ codec_type: "audio" }] : [])], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "30", size: "11" } }), stderr: "" }; }
async function withRoot(operation) { const root = mkdtempSync(join(tmpdir(), "mktauto-pexels-storage-")); try { await operation(root); } finally { rmSync(root, { recursive: true, force: true }); } }
