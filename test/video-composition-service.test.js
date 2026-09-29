import test from "node:test";
import assert from "node:assert/strict";
import { COMPOSITION_PLAN_CONTRACT_VERSION } from "../src/domain/composition-plan-contracts.js";
import { VIDEO_COMPOSITION_REQUEST_VERSION, videoCompositionRequestHash } from "../src/domain/video-composition-contracts.js";
import { VideoComposer } from "../src/video-composer.js";
import { VideoCompositionError, VideoCompositionService } from "../src/video-composition-service.js";

test("compõe uma vez com plano exato e requisitos explícitos", async () => {
  const repository = fakeRepository();
  const composer = fakeComposer();
  const created = await new VideoCompositionService(repository, composer).compose(request());
  assert.equal(composer.calls.length, 1);
  assert.deepEqual(composer.calls[0], {
    logicalCallId: "video_composition_001",
    compositionPlan: repository.plan,
    output: { containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920 },
  });
  assert.equal(Object.isFrozen(composer.calls[0]), true);
  assert.equal(Object.isFrozen(composer.calls[0].compositionPlan), true);
  assert.equal(created.videoRenderId, "video_render:video_composition_001");
  assert.equal(created.contentHash, "f".repeat(64));
  assert.equal(repository.persisted.length, 1);
});

test("retry terminal reutiliza render persistido sem nova chamada", async () => {
  const repository = fakeRepository();
  repository.prior = { requestHash: request().contentHash, videoRender: { videoRenderId: "persisted" } };
  const composer = fakeComposer();
  assert.deepEqual(await new VideoCompositionService(repository, composer).compose(request()), { videoRenderId: "persisted" });
  assert.equal(composer.calls.length, 0);
  assert.deepEqual(repository.reads, ["composition"]);
});

test("reutilização divergente e conflito de render falham antes do composer", async () => {
  const reused = fakeRepository();
  reused.prior = { requestHash: "e".repeat(64), videoRender: {} };
  const reusedComposer = fakeComposer();
  await assert.rejects(new VideoCompositionService(reused, reusedComposer).compose(request()), compositionError("VIDEO_COMPOSITION_REQUEST_ID_REUSED", "videoCompositionRequestId"));
  assert.equal(reusedComposer.calls.length, 0);

  const conflict = fakeRepository();
  conflict.renders = [{ revision: 1 }];
  const conflictComposer = fakeComposer();
  await assert.rejects(new VideoCompositionService(conflict, conflictComposer).compose(request()), compositionError("VIDEO_RENDER_REVISION_CONFLICT", "compositionPlanId"));
  assert.equal(conflictComposer.calls.length, 0);
});

test("revalida plano e cadeia persistida antes da chamada", async () => {
  const missing = fakeRepository(); missing.plan = null;
  await assert.rejects(new VideoCompositionService(missing, fakeComposer()).compose(request()), compositionError("COMPOSITION_PLAN_NOT_FOUND", "compositionPlanId"));
  const mismatch = fakeRepository(); mismatch.plan.contentHash = "b".repeat(64);
  await assert.rejects(new VideoCompositionService(mismatch, fakeComposer()).compose(request()), compositionError("COMPOSITION_PLAN_CONTENT_HASH_MISMATCH", "compositionPlanContentHash"));
  const ratio = fakeRepository();
  await assert.rejects(new VideoCompositionService(ratio, fakeComposer()).compose(request({ widthPixels: 1081 })), compositionError("VIDEO_DIMENSIONS_ASPECT_RATIO_MISMATCH", "widthPixels"));
});

test("revalida integralmente saída medida antes de persistir", async () => {
  for (const [change, code, field] of [
    [{ durationMilliseconds: 9999 }, "VIDEO_RENDER_DURATION_MISMATCH", "durationMilliseconds"],
    [{ containerFormat: "webm" }, "VIDEO_RENDER_CONTAINER_MISMATCH", "containerFormat"],
    [{ widthPixels: 720, heightPixels: 1280 }, "VIDEO_RENDER_DIMENSIONS_MISMATCH", "widthPixels"],
    [{ logicalReference: "https://private.example/video.mp4" }, "INVALID_LOGICAL_REFERENCE", "logicalReference"],
  ]) {
    const repository = fakeRepository();
    await assert.rejects(new VideoCompositionService(repository, fakeComposer(change)).compose(request()), compositionError(code, field));
    assert.equal(repository.persisted.length, 0);
  }
});

test("cancelamento e falha externa são sanitizados sem estado parcial", async () => {
  const cancelled = fakeRepository();
  const controller = new AbortController(); controller.abort();
  const composer = fakeComposer();
  await assert.rejects(new VideoCompositionService(cancelled, composer).compose(request(), { signal: controller.signal }), compositionError("COMPOSER_CANCELLED", "signal"));
  assert.equal(composer.calls.length, 0);
  assert.equal(cancelled.persisted.length, 0);

  const failed = fakeRepository();
  let caught;
  try { await new VideoCompositionService(failed, fakeComposer({}, new Error("PRIVATE token payload"))).compose(request()); } catch (error) { caught = error; }
  assert.equal(caught?.code, "COMPOSER_FAILED");
  assert.equal(caught?.message.includes("PRIVATE"), false);
  assert.equal(failed.persisted.length, 0);
});

function fakeRepository() {
  return {
    prior: null, renders: [], persisted: [], reads: [],
    plan: {
      schemaVersion: COMPOSITION_PLAN_CONTRACT_VERSION, compositionPlanId: "composition_plan_001",
      pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1,
      scriptId: "script_001", scriptContentHash: "b".repeat(64), voiceTrackId: "voice_track_001",
      voiceTrackContentHash: "c".repeat(64), outputAspectRatio: "9:16", timelineUnit: "MILLISECOND",
      continuityMode: "CONTIGUOUS", durationMilliseconds: 10000,
      segments: [{ position: 1, visualDirectionPosition: 1, mediaAssetId: "media_asset_001", mediaAssetContentHash: "d".repeat(64), startMilliseconds: 0, endMilliseconds: 10000 }],
      createdAt: "2026-09-28T23:00:00.000Z", revision: 1, supersedesCompositionPlanId: null,
      contentHash: "a".repeat(64),
    },
    getVideoComposition() { this.reads.push("composition"); return this.prior; },
    getCompositionPlan() { this.reads.push("plan"); return this.plan; },
    listVideoRendersByCompositionPlan() { this.reads.push("renders"); return this.renders; },
    registerVideoComposition(value) { this.persisted.push(value); return value.videoRender; },
  };
}

function fakeComposer(overrides = {}, failure = null) {
  return new class extends VideoComposer {
    constructor() { super(); this.calls = []; }
    async compose(input) {
      this.calls.push(input);
      if (failure) throw failure;
      return { durationMilliseconds: 10000, containerFormat: "mp4", widthPixels: 1080,
        heightPixels: 1920, contentHash: "f".repeat(64), logicalReference: "render:output_001", ...overrides };
    }
  }();
}

function request(overrides = {}) {
  const value = { schemaVersion: VIDEO_COMPOSITION_REQUEST_VERSION, videoCompositionRequestId: "video_composition_001",
    compositionPlanId: "composition_plan_001", compositionPlanContentHash: "a".repeat(64),
    containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920,
    requestedAt: "2026-09-29T00:00:00.000Z", contentHash: "0".repeat(64), ...overrides };
  value.contentHash = videoCompositionRequestHash(value); return value;
}
function compositionError(code, field) { return (caught) => caught instanceof VideoCompositionError && caught.code === code && caught.field === field; }
