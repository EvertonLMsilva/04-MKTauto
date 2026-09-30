import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FfmpegVideoComposer } from "../src/adapters/ffmpeg-video-composer.js";
import { compositionPlanContentHash } from "../src/domain/composition-plan-contracts.js";
import { png, sha256, wav } from "../test-support/physical-fixtures.js";

test("integração local produz MP4 real reproduzível", {
  skip: process.env.FFMPEG_COMPOSER_INTEGRATION_TEST !== "1",
  timeout: 310000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-ffmpeg-integration-"));
  const roots = { voiceRoot: join(root, "voice"), mediaRoot: join(root, "media"), renderRoot: join(root, "render") };
  Object.values(roots).forEach((path) => mkdirSync(path, { recursive: true }));
  try {
    const fixture = createFixture(roots);
    const composer = new FfmpegVideoComposer(config(roots), { artifactCatalog: fixture.catalog });
    const first = await composer.compose(fixture.input);
    const second = await composer.compose(fixture.input);
    assert.deepEqual(first, second);
    assert.equal(first.durationMilliseconds, 1234); assert.equal(first.containerFormat, "mp4");
    assert.equal(first.widthPixels, 1080); assert.equal(first.heightPixels, 1920);
    const path = join(roots.renderRoot, "sha256", first.contentHash.slice(0, 2), `${first.contentHash}.mp4`);
    assert.equal(sha256(readFileSync(path)), first.contentHash);
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

function createFixture(roots) {
  const voiceBytes = wav({ durationMilliseconds: 1234 }); const imageBytes = png({ color: 32 }); const image2Bytes = png({ color: 160 });
  const voiceHash = store(roots.voiceRoot, voiceBytes, "wav"); const imageHash = store(roots.mediaRoot, imageBytes, "png"); const image2Hash = store(roots.mediaRoot, image2Bytes, "png");
  const voice = { schemaVersion: "voice-track/1.0.0", voiceTrackId: "voice_track_integration", pipelineRunId: "run_e07_integration", projectId: "project_e07", projectVersion: 1,
    scriptId: "script_integration", scriptContentHash: "b".repeat(64), language: "pt-BR", voiceStyle: "informative", durationMilliseconds: 1234, audioFormat: "wav", contentHash: voiceHash,
    storageReference: `object:voice/sha256/${voiceHash}`, origin: "SYNTHETIC_TTS", provider: "openai", rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true }, createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesVoiceTrackId: null };
  const media = (id, hash, position) => ({ schemaVersion: "media-asset/1.0.0", mediaAssetId: id, pipelineRunId: "run_e07_integration", projectId: "project_e07", projectVersion: 1,
    scriptId: "script_integration", scriptContentHash: "b".repeat(64), visualDirectionPosition: position, assetType: "IMAGE", technicalProperties: { format: "png", widthPixels: 90, heightPixels: 160, durationMilliseconds: null },
    contentHash: hash, mediaReference: `media:sha256_${hash}`, origin: "PROVIDER_GENERATED", provider: "openai", rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true }, createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesMediaAssetId: null });
  const first = media("media_asset_integration_1", imageHash, 1); const second = media("media_asset_integration_2", image2Hash, 2);
  const plan = { schemaVersion: "composition-plan/1.0.0", compositionPlanId: "composition_plan_integration", pipelineRunId: "run_e07_integration", projectId: "project_e07", projectVersion: 1,
    scriptId: "script_integration", scriptContentHash: "b".repeat(64), voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voiceHash, outputAspectRatio: "9:16", timelineUnit: "MILLISECOND", continuityMode: "CONTIGUOUS", durationMilliseconds: 1234,
    segments: [{ position: 1, visualDirectionPosition: 1, mediaAssetId: first.mediaAssetId, mediaAssetContentHash: imageHash, startMilliseconds: 0, endMilliseconds: 517 }, { position: 2, visualDirectionPosition: 2, mediaAssetId: second.mediaAssetId, mediaAssetContentHash: image2Hash, startMilliseconds: 517, endMilliseconds: 1234 }],
    createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesCompositionPlanId: null, contentHash: "0".repeat(64) };
  plan.contentHash = compositionPlanContentHash(plan);
  return { catalog: { getVoiceTrack: () => voice, getMediaAsset: (id) => id === first.mediaAssetId ? first : second }, input: { logicalCallId: "video_composition_integration", compositionPlan: plan, output: { containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920 } } };
}
function config(roots) { return { policyVersion: "ffmpeg-video-policy/1.0.0", ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg", ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe", ...roots, stagingRoot: join(roots.renderRoot, ".staging"), widthPixels: 1080, heightPixels: 1920, frameRate: 30, videoCodec: "libx264", videoProfile: "high", videoLevel: "4.0", crf: 20, preset: "medium", pixelFormat: "yuv420p", audioCodec: "aac", audioProfile: "aac_low", audioBitrate: "192k", audioSampleRate: 48000, audioChannels: 1, gopSize: 60, maxSegments: 60, maxDurationMilliseconds: 180000, maxVoiceBytes: 20971520, maxImageBytes: 20971520, maxTotalInputBytes: 536870912, maxOutputBytes: 524288000, timeoutMs: 300000, maxLogBytes: 65536, publicConfiguration: {} }; }
function store(root, bytes, extension) { const hash = sha256(bytes); const directory = join(root, "sha256", hash.slice(0, 2)); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `${hash}.${extension}`), bytes); return hash; }
