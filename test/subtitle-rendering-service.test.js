import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SubtitleRenderingError, SubtitleRenderingService } from "../src/subtitle-rendering-service.js";
import { SUBTITLE_RENDER_POLICY_VERSION, SUBTITLE_RENDER_REQUEST_VERSION, subtitleRenderIdentityHash, subtitleRenderRequestHash } from "../src/domain/subtitle-render-contracts.js";

test("serviço revalida cadeia exata e cria VideoRender revisão 2 append-only", async () => {
  const repository = fakeRepository(); const renderer = fakeRenderer();
  const created = await new SubtitleRenderingService(repository, renderer).render(request(repository));
  assert.equal(created.revision, 2); assert.equal(created.supersedesVideoRenderId, repository.video.videoRenderId);
  assert.equal(repository.video.revision, 1); assert.equal(repository.writes.length, 1); assert.equal(renderer.calls.length, 1);
});

test("retry terminal não chama renderer e conflito de request falha", async () => {
  const repository = fakeRepository(); const renderer = fakeRenderer(); const service = new SubtitleRenderingService(repository, renderer);
  const first = await service.render(request(repository)); repository.prior = { requestHash: request(repository).contentHash, videoRender: first };
  assert.deepEqual(await service.render(request(repository)), first); assert.equal(renderer.calls.length, 1);
  repository.prior.requestHash = "0".repeat(64);
  await assert.rejects(service.render(request(repository)), renderingError("SUBTITLE_RENDER_REQUEST_ID_REUSED"));
});

test("rejeita hashes, escopo, lineage, duração e política divergentes antes do adapter", async () => {
  for (const [mutate, code] of [
    [(r) => { r.video.contentHash = "0".repeat(64); }, "VIDEO_RENDER_CONTENT_HASH_MISMATCH"],
    [(r) => { r.track.projectId = "other_project"; }, "SUBTITLE_RENDER_SCOPE_MISMATCH"],
    [(r) => { r.track.durationMilliseconds = 9999; }, "SUBTITLE_RENDER_DURATION_MISMATCH"],
    [(r) => { r.track.stylePolicyVersion = "subtitle-style-policy/2.0.0"; }, "SUBTITLE_RENDER_STYLE_POLICY_MISMATCH"],
    [(r) => { r.videoLineage.inputs = []; }, "SUBTITLE_RENDER_LINEAGE_MISMATCH"],
  ]) {
    const repository = fakeRepository(); mutate(repository); const renderer = fakeRenderer();
    await assert.rejects(new SubtitleRenderingService(repository, renderer).render(request(repository)), renderingError(code));
    assert.equal(renderer.calls.length, 0); assert.equal(repository.writes.length, 0);
  }
});

function fakeRepository() {
  const plan = { compositionPlanId: "composition_plan_001", contentHash: "b".repeat(64), pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1,
    scriptId: "script_001", scriptContentHash: "d".repeat(64), voiceTrackId: "voice_track_001", voiceTrackContentHash: "e".repeat(64), durationMilliseconds: 10000, outputAspectRatio: "9:16" };
  const video = { schemaVersion: "video-render/1.0.0", videoRenderId: "video_render_001", pipelineRunId: plan.pipelineRunId, projectId: plan.projectId, projectVersion: 1,
    compositionPlanId: plan.compositionPlanId, compositionPlanContentHash: plan.contentHash, outputAspectRatio: "9:16", durationMilliseconds: 10000,
    containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920, contentHash: "a".repeat(64), logicalReference: "render:sha256_" + "a".repeat(64),
    createdAt: "2026-09-29T00:00:00.000Z", revision: 1, supersedesVideoRenderId: null };
  const track = { subtitleTrackId: "subtitle_track_001", contentHash: "c".repeat(64), pipelineRunId: plan.pipelineRunId, projectId: plan.projectId, projectVersion: 1,
    scriptId: plan.scriptId, scriptContentHash: plan.scriptContentHash, voiceTrackId: plan.voiceTrackId, voiceTrackContentHash: plan.voiceTrackContentHash,
    durationMilliseconds: 10000, stylePolicyVersion: "subtitle-style-policy/1.0.0", cues: [{ position: 1, text: "Teste", startMilliseconds: 0, endMilliseconds: 9880 }] };
  return { prior: null, writes: [], plan, video, track,
    run: { pipelineRunId: plan.pipelineRunId, projectId: plan.projectId, projectVersion: 1 },
    videoLineage: { inputs: [{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: plan.compositionPlanId, contentHash: plan.contentHash }] },
    trackLineage: { inputs: [{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: plan.scriptId, contentHash: plan.scriptContentHash }, { position: 2, kind: "INTERNAL_ARTIFACT", inputId: plan.voiceTrackId, contentHash: plan.voiceTrackContentHash }] },
    getSubtitleRendering() { return this.prior; }, getRun() { return this.run; }, getCompositionPlan() { return this.plan; }, getVideoRender() { return this.video; }, getSubtitleTrack() { return this.track; },
    getArtifact(id) { return id === video.videoRenderId ? this.videoLineage : this.trackLineage; },
    registerSubtitleRendering(value) { this.writes.push(value); return value.videoRender; },
  };
}

function request(repository) { const value = { schemaVersion: SUBTITLE_RENDER_REQUEST_VERSION, subtitleRenderRequestId: "pending",
  pipelineRunId: repository.run.pipelineRunId, projectId: repository.run.projectId, projectVersion: 1,
  videoRenderId: repository.video.videoRenderId, videoRenderContentHash: "a".repeat(64), compositionPlanId: repository.plan.compositionPlanId,
  compositionPlanContentHash: repository.plan.contentHash, subtitleTrackId: repository.track.subtitleTrackId, subtitleTrackContentHash: "c".repeat(64),
  scriptId: repository.plan.scriptId, scriptContentHash: repository.plan.scriptContentHash, voiceTrackId: repository.plan.voiceTrackId,
  voiceTrackContentHash: repository.plan.voiceTrackContentHash, stylePolicyVersion: "subtitle-style-policy/1.0.0", renderPolicyVersion: SUBTITLE_RENDER_POLICY_VERSION,
  requestedAt: "2026-09-29T12:00:00.000Z", contentHash: "0".repeat(64) };
  value.subtitleRenderRequestId = `subtitle_render:${subtitleRenderIdentityHash(value)}`; value.contentHash = subtitleRenderRequestHash(value); return value; }
function fakeRenderer() { return { calls: [], async render(input) { this.calls.push(input); return { schemaVersion: "subtitle-render-result/1.0.0", subtitleRenderRequestId: input.request.subtitleRenderRequestId,
  requestContentHash: input.request.contentHash, durationMilliseconds: 10000, containerFormat: "mp4", outputAspectRatio: "9:16", widthPixels: 1080, heightPixels: 1920,
  frameRate: 30, videoCodec: "h264", audioCodec: "aac", audioSampleRate: 48000, audioChannels: 1, contentHash: sha256("burned"), logicalReference: `render:sha256_${sha256("burned")}`,
  toolchain: { ffmpegVersion: "ffmpeg version test", libassFingerprint: "1".repeat(64), fontFamily: "Arial", fontProvider: "libass-default" } }; } }; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function renderingError(code) { return (caught) => caught instanceof SubtitleRenderingError && caught.code === code; }
