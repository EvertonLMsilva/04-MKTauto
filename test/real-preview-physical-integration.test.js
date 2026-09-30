import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FfmpegVideoComposer } from "../src/adapters/ffmpeg-video-composer.js";
import { FfmpegSubtitleRenderer } from "../src/adapters/ffmpeg-subtitle-renderer.js";
import { LocalCompositionReferenceResolver } from "../src/adapters/local-composition-reference-resolver.js";
import { LocalPreviewVerifier } from "../src/adapters/local-preview-verifier.js";
import { compositionPlanContentHash, validateCompositionPlan } from "../src/domain/composition-plan-contracts.js";
import { REAL_PREVIEW_REQUEST_VERSION, realPreviewRequestHash } from "../src/domain/real-preview-contracts.js";
import { subtitleTrackContentHash } from "../src/domain/subtitle-track-contracts.js";
import { RealPreviewService } from "../src/real-preview-service.js";
import { png, sha256, wav } from "../test-support/physical-fixtures.js";

test("uma chamada produz preview físico real com áudio, mídia, vídeo e legendas", {
  skip: process.env.REAL_PREVIEW_INTEGRATION_TEST !== "1", timeout: 310000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-real-preview-"));
  const roots = { voiceRoot: join(root, "voice"), mediaRoot: join(root, "media"), renderRoot: join(root, "render") };
  Object.values(roots).forEach((path) => mkdirSync(path, { recursive: true }));
  try {
    const voiceHash = store(roots.voiceRoot, wav({ durationMilliseconds: 1234 }), "wav");
    const mediaHash = store(roots.mediaRoot, png({ color: 72 }), "png");
    const script = { scriptId: "script:preview_e07_physical:script", pipelineRunId: "run_e07_physical", projectId: "project_e07", projectVersion: 1, ideaSelectionId: "selection_e07_physical", ideaSelectionContentHash: "9".repeat(64), contentHash: "a".repeat(64), createdAt: "2026-09-30T10:00:00.000Z", fullNarration: "Legenda física no preview final.", language: "pt-BR", visualDirections: [{ position: 1, blockPosition: 1, description: "Imagem autorizada." }] };
    const voice = { schemaVersion: "voice-track/1.0.0", voiceTrackId: "voice_track:preview_e07_physical:voice", pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: 1, scriptId: script.scriptId, scriptContentHash: script.contentHash, language: "pt-BR", voiceStyle: "informative", durationMilliseconds: 1234, audioFormat: "wav", contentHash: voiceHash, storageReference: `object:voice/sha256/${voiceHash}`, origin: "SYNTHETIC_TTS", provider: "authorized_local", rights: { usageBasis: "PROVIDER_TERMS", commercialUseAllowed: true }, createdAt: script.createdAt, revision: 1, supersedesVoiceTrackId: null };
    const media = { schemaVersion: "media-asset/1.0.0", mediaAssetId: "media_asset:preview_e07_physical:media:1", pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: 1, scriptId: script.scriptId, scriptContentHash: script.contentHash, visualDirectionPosition: 1, assetType: "IMAGE", technicalProperties: { format: "png", widthPixels: 90, heightPixels: 160, durationMilliseconds: null }, contentHash: mediaHash, mediaReference: `media:sha256_${mediaHash}`, origin: "OPERATOR_OWNED", provider: null, rights: { usageBasis: "OWNED", commercialUseAllowed: true }, createdAt: script.createdAt, revision: 1, supersedesMediaAssetId: null };
    const resolver = new LocalCompositionReferenceResolver(roots);
    const videoConfig = composerConfig(roots); const subtitleConfig = burnConfig(roots.renderRoot);
    const composer = new FfmpegVideoComposer(videoConfig, { artifactCatalog: { getVoiceTrack: () => voice, getMediaAsset: () => media }, referenceResolver: resolver });
    const renderer = new FfmpegSubtitleRenderer(subtitleConfig, { referenceResolver: resolver });
    let plan; let source; let track; let preview; const run = { pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: 1, state: "RUNNING", projectSnapshot: { project: { id: script.projectId, version: 1 }, channel: { aspectRatio: "9:16" } } };
    const service = new RealPreviewService({
      pipelineRuns: { get: () => run, succeed: () => { run.state = "SUCCEEDED"; }, fail: () => { run.state = "FAILED"; } },
      scripts: { generate: async () => script }, lookup: { getScript: () => null }, voices: { generate: async () => voice }, media: { acquire: async () => media },
      plans: { register: (value) => { plan = validateCompositionPlan({ ...value, contentHash: compositionPlanContentHash(value) }); return plan; } },
      videos: { compose: async (value, options) => { const output = await composer.compose({ logicalCallId: value.videoCompositionRequestId, compositionPlan: plan, output: { containerFormat: value.containerFormat, widthPixels: value.widthPixels, heightPixels: value.heightPixels } }, options); source = { schemaVersion: "video-render/1.0.0", videoRenderId: `video_render:${value.videoCompositionRequestId}`, pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: 1, compositionPlanId: plan.compositionPlanId, compositionPlanContentHash: plan.contentHash, outputAspectRatio: plan.outputAspectRatio, durationMilliseconds: output.durationMilliseconds, containerFormat: output.containerFormat, widthPixels: output.widthPixels, heightPixels: output.heightPixels, contentHash: output.contentHash, logicalReference: output.logicalReference, createdAt: script.createdAt, revision: 1, supersedesVideoRenderId: null }; return source; } },
      subtitles: { generate: (value) => { track = { schemaVersion: "subtitle-track/1.0.0", subtitleTrackId: "subtitle_track_physical", pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: 1, scriptId: script.scriptId, scriptContentHash: script.contentHash, voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voice.contentHash, language: "pt-BR", timeUnit: "MILLISECONDS", durationMilliseconds: 1234, stylePolicyVersion: value.stylePolicyVersion, cues: [{ position: 1, text: "Legenda física no preview final.", startMilliseconds: 0, endMilliseconds: 1100 }], createdAt: script.createdAt, revision: 1, supersedesSubtitleTrackId: null, contentHash: "" }; track.contentHash = subtitleTrackContentHash(track); return { subtitleTrack: track }; } },
      subtitleRendering: { render: async (value, options) => { const output = await renderer.render({ request: value, videoRender: source, subtitleTrack: track }, options); preview = { schemaVersion: "video-render/1.0.0", videoRenderId: `video_render:subtitle:${value.subtitleRenderRequestId.slice("subtitle_render:".length)}`, pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: 1, compositionPlanId: plan.compositionPlanId, compositionPlanContentHash: plan.contentHash, outputAspectRatio: output.outputAspectRatio, durationMilliseconds: source.durationMilliseconds, containerFormat: output.containerFormat, widthPixels: output.widthPixels, heightPixels: output.heightPixels, contentHash: output.contentHash, logicalReference: output.logicalReference, createdAt: script.createdAt, revision: 2, supersedesVideoRenderId: source.videoRenderId }; return preview; } },
      lineage: { get: (id) => physicalLineage(id, { script, voice, media, plan, source, track, preview }) },
      previewVerifier: new LocalPreviewVerifier(resolver), costs: { getLedgerByPipelineRun: () => ({ events: [] }) }, now: () => "2026-09-30T10:01:00.000Z",
    });
    const request = previewRequest(); const result = await service.execute(request);
    const finalPath = join(roots.renderRoot, "sha256", result.previewVideoRender.contentHash.slice(0, 2), `${result.previewVideoRender.contentHash}.mp4`);
    assert.equal(result.previewVideoRender.revision, 2); assert.equal(result.previewVideoRender.contentHash, sha256(readFileSync(finalPath)));
    assert.equal(result.sourceVideoRender.id, source.videoRenderId); assert.equal(run.state, "SUCCEEDED");
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

function previewRequest() { const value = { schemaVersion: REAL_PREVIEW_REQUEST_VERSION, previewRequestId: "preview_e07_physical", pipelineRunId: "run_e07_physical", projectId: "project_e07", projectVersion: 1, ideaSelectionId: "selection_e07_physical", requestedAt: "2026-09-30T10:00:00.000Z", contentHash: "" }; value.contentHash = realPreviewRequestHash(value); return value; }
function composerConfig(roots) { return { policyVersion: "ffmpeg-video-policy/1.0.0", ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg", ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe", ...roots, stagingRoot: join(roots.renderRoot, ".staging"), widthPixels: 1080, heightPixels: 1920, frameRate: 30, videoCodec: "libx264", videoProfile: "high", videoLevel: "4.0", crf: 20, preset: "medium", pixelFormat: "yuv420p", audioCodec: "aac", audioProfile: "aac_low", audioBitrate: "192k", audioSampleRate: 48000, audioChannels: 1, gopSize: 60, maxSegments: 60, maxDurationMilliseconds: 180000, maxVoiceBytes: 20971520, maxImageBytes: 20971520, maxTotalInputBytes: 536870912, maxOutputBytes: 524288000, timeoutMs: 300000, maxLogBytes: 65536, publicConfiguration: {} }; }
function burnConfig(renderRoot) { return { policyVersion: "ffmpeg-subtitle-render-policy/1.0.0", ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg", ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe", renderRoot, stagingRoot: join(renderRoot, ".staging"), widthPixels: 1080, heightPixels: 1920, frameRate: 30, videoCodec: "libx264", videoProfile: "high", videoLevel: "4.0", crf: 20, preset: "medium", pixelFormat: "yuv420p", audioCodec: "copy", audioSampleRate: 48000, audioChannels: 1, gopSize: 60, durationToleranceMilliseconds: 34, maxInputBytes: 524288000, maxOutputBytes: 524288000, timeoutMs: 300000, maxLogBytes: 65536, fontFamily: "Arial", fontProvider: "libass-default" }; }
function store(root, bytes, extension) { const hash = sha256(bytes); const directory = join(root, "sha256", hash.slice(0, 2)); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `${hash}.${extension}`), bytes); return hash; }
function physicalLineage(id, { script, voice, media, plan, source, track, preview }) {
  const internal = (position, inputId, contentHash) => ({ position, kind: "INTERNAL_ARTIFACT", inputId, contentHash });
  const entries = [
    [script.scriptId, script.contentHash, [internal(1, script.ideaSelectionId, script.ideaSelectionContentHash)]],
    [voice.voiceTrackId, voice.contentHash, [internal(1, script.scriptId, script.contentHash)]],
    [media.mediaAssetId, media.contentHash, [internal(1, script.scriptId, script.contentHash)]],
    ...(plan ? [[plan.compositionPlanId, plan.contentHash, [internal(1, script.scriptId, script.contentHash), internal(2, voice.voiceTrackId, voice.contentHash), internal(3, media.mediaAssetId, media.contentHash)]]] : []),
    ...(source && plan ? [[source.videoRenderId, source.contentHash, [internal(1, plan.compositionPlanId, plan.contentHash)]]] : []),
    ...(track ? [[track.subtitleTrackId, track.contentHash, [internal(1, script.scriptId, script.contentHash), internal(2, voice.voiceTrackId, voice.contentHash)]]] : []),
    ...(preview && plan && source && track ? [[preview.videoRenderId, preview.contentHash, [internal(1, plan.compositionPlanId, plan.contentHash), internal(2, source.videoRenderId, source.contentHash), internal(3, track.subtitleTrackId, track.contentHash)]]] : []),
  ];
  const entry = entries.find(([entryId]) => entryId === id); if (!entry) return null;
  return { artifactId: id, pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: 1, contentHash: entry[1], inputs: entry[2] };
}
