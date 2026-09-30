import test from "node:test";
import assert from "node:assert/strict";
import { RealPreviewError, RealPreviewService, buildDeterministicSegments } from "../src/real-preview-service.js";
import { REAL_PREVIEW_REQUEST_VERSION, realPreviewRequestHash } from "../src/domain/real-preview-contracts.js";

test("timeline preserva ordem, cobre exatamente a voz e é reproduzível", () => {
  const assets = [asset(1), asset(2), asset(3)];
  const expected = [
    segment(1, assets[0], 0, 3333),
    segment(2, assets[1], 3333, 6666),
    segment(3, assets[2], 6666, 10000),
  ];
  assert.deepEqual(buildDeterministicSegments(assets, 10000), expected);
  assert.deepEqual(buildDeterministicSegments(assets, 10000), expected);
  assert.throws(() => buildDeterministicSegments(assets, 2), previewError("PREVIEW_DURATION_INSUFFICIENT"));
});

test("orquestra em ordem e retorna somente render revisão 2 fisicamente verificado", async () => {
  const fixture = scenario();
  const result = await fixture.service.execute(request());
  assert.deepEqual(fixture.calls.map(({ stage }) => stage), [
    "script", "voice", "media:1", "media:2", "plan", "compose", "subtitles", "burn-in", "verify", "costs", "succeed",
  ]);
  assert.equal(result.previewVideoRender.id, fixture.final.videoRenderId);
  assert.equal(result.previewVideoRender.contentHash, fixture.final.contentHash);
  assert.equal(result.sourceVideoRender.revision, 1);
  assert.equal(result.previewVideoRender.revision, 2);
  assert.equal(result.costs.known.length, 1);
  assert.deepEqual(result.costs.unavailableStages, ["script", "voice", "video_composition", "subtitle_generation", "subtitle_rendering", "media:1", "media:2"]);
});

test("retry com novo requestedAt reutiliza timestamp original e efeitos terminais", async () => {
  const fixture = scenario();
  await fixture.service.execute(request());
  fixture.calls.length = 0;
  await fixture.service.execute(request({ requestedAt: "2026-09-30T11:00:00.000Z" }));
  assert.equal(fixture.seenTimestamps.every((value) => value === "2026-09-30T10:00:00.000Z"), true);
  assert.equal(fixture.effects.script, 1);
  assert.equal(fixture.effects.voice, 1);
  assert.equal(fixture.effects.media, 2);
  assert.equal(fixture.effects.compose, 1);
  assert.equal(fixture.effects.burn, 1);
});

test("cancelamento interrompe efeitos restantes, não falha run e não emite preview", async () => {
  const controller = new AbortController();
  const fixture = scenario({ cancelAfterVoice: controller });
  await assert.rejects(fixture.service.execute(request(), { signal: controller.signal }), previewError("PREVIEW_CANCELLED"));
  assert.equal(fixture.calls.some(({ stage }) => stage === "fail"), false);
  assert.equal(fixture.calls.some(({ stage }) => stage === "compose"), false);
  assert.equal(fixture.calls.some(({ stage }) => stage === "verify"), false);
});

test("falha definitiva sanitiza, terminaliza a run e não verifica preview", async () => {
  const fixture = scenario({ failAt: "compose" });
  await assert.rejects(fixture.service.execute(request()), previewError("PREVIEW_FAILED"));
  assert.equal(fixture.calls.some(({ stage }) => stage === "fail"), true);
  assert.equal(fixture.calls.some(({ stage }) => stage === "verify"), false);
});

test("falhas de provider, mídia, legenda e burn-in não deixam preview final falso", async () => {
  for (const failAt of ["voice", "media:1", "subtitles", "burn-in"]) {
    const fixture = scenario({ failAt });
    await assert.rejects(fixture.service.execute(request()), previewError("PREVIEW_FAILED"));
    assert.equal(fixture.calls.some(({ stage }) => stage === "fail"), true);
    assert.equal(fixture.calls.some(({ stage }) => stage === "verify"), false);
    assert.equal(fixture.calls.some(({ stage }) => stage === "succeed"), false);
  }
});

function scenario({ cancelAfterVoice = null, failAt = null } = {}) {
  const calls = []; const effects = { script: 0, voice: 0, media: 0, compose: 0, burn: 0 }; const seenTimestamps = [];
  const cache = new Map();
  const run = { pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1, state: "RUNNING", projectSnapshot: { project: { id: "project_e07", version: 1 } } };
  const script = { scriptId: "script:preview_e07_001:script", pipelineRunId: run.pipelineRunId, projectId: run.projectId, projectVersion: 1, ideaSelectionId: "selection_e07_001", ideaSelectionContentHash: "9".repeat(64), contentHash: "a".repeat(64), createdAt: "2026-09-30T10:00:00.000Z", visualDirections: [{ position: 1 }, { position: 2 }] };
  const voice = { voiceTrackId: "voice_track:preview_e07_001:voice", pipelineRunId: run.pipelineRunId, projectId: run.projectId, projectVersion: 1, scriptId: script.scriptId, scriptContentHash: script.contentHash, contentHash: "b".repeat(64), durationMilliseconds: 10000, createdAt: script.createdAt };
  const assets = [asset(1, script), asset(2, script)];
  const final = { videoRenderId: "video_render:subtitle:final", pipelineRunId: run.pipelineRunId, projectId: run.projectId, projectVersion: 1, compositionPlanId: "composition_plan:preview_e07_001", compositionPlanContentHash: "d".repeat(64), outputAspectRatio: "9:16", durationMilliseconds: 10000, containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920, contentHash: "f".repeat(64), logicalReference: `render:sha256_${"f".repeat(64)}`, revision: 2, supersedesVideoRenderId: "video_render:preview_e07_001:video" };
  const stage = (name, make, effect) => async (value) => {
    calls.push({ stage: name, value }); if (failAt === name) throw new Error("private payload"); seenTimestamps.push(value.requestedAt ?? value.createdAt);
    const key = `${name}:${JSON.stringify(value).replace(value.requestedAt ?? value.createdAt, script.createdAt)}`;
    if (!cache.has(key)) { if (effect) effects[effect] += 1; cache.set(key, make(value)); }
    return cache.get(key);
  };
  const dependencies = {
    pipelineRuns: { get: () => run, succeed: () => { calls.push({ stage: "succeed" }); run.state = "SUCCEEDED"; }, fail: () => { calls.push({ stage: "fail" }); run.state = "FAILED"; } },
    scripts: { generate: stage("script", () => script, "script") },
    voices: { generate: stage("voice", () => { cancelAfterVoice?.abort(); return voice; }, "voice") },
    media: { acquire: async (value) => { const name = `media:${value.visualDirectionPosition}`; calls.push({ stage: name, value }); if (failAt === name) throw new Error("private payload"); seenTimestamps.push(value.requestedAt); const key = name; if (!cache.has(key)) { effects.media += 1; cache.set(key, assets[value.visualDirectionPosition - 1]); } return cache.get(key); } },
    plans: { register: (value) => { calls.push({ stage: "plan", value }); seenTimestamps.push(value.createdAt); return { ...value, contentHash: "d".repeat(64) }; } },
    videos: { compose: stage("compose", () => ({ ...final, videoRenderId: final.supersedesVideoRenderId, contentHash: "e".repeat(64), revision: 1, supersedesVideoRenderId: null }), "compose") },
    subtitles: { generate: (value) => { calls.push({ stage: "subtitles", value }); if (failAt === "subtitles") throw new Error("private payload"); seenTimestamps.push(value.requestedAt); return { subtitleTrack: { subtitleTrackId: "subtitle_001", pipelineRunId: run.pipelineRunId, projectId: run.projectId, projectVersion: 1, contentHash: "c".repeat(64), scriptId: script.scriptId, scriptContentHash: script.contentHash, voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voice.contentHash, durationMilliseconds: 10000, stylePolicyVersion: "subtitle-style-policy/1.0.0" } }; } },
    subtitleRendering: { render: stage("burn-in", () => final, "burn") },
    previewVerifier: { verify: async (value) => { calls.push({ stage: "verify", value }); return { contentHash: value.contentHash }; } },
    costs: { getLedgerByPipelineRun: () => { calls.push({ stage: "costs" }); return { events: [{ costEventId: "cost_001", artifactId: null, amount: "0.01", currency: "USD" }] }; } },
    lookup: { getScript: () => cache.get("script:canonical") ?? null },
    lineage: { get: (id) => lineageFor(id, { run, script, voice, assets, final }) },
    now: () => "2026-09-30T10:01:00.000Z",
  };
  const originalGenerate = dependencies.scripts.generate;
  dependencies.scripts.generate = async (value, options) => { const result = await originalGenerate(value, options); cache.set("script:canonical", result); return result; };
  return { service: new RealPreviewService(dependencies), calls, effects, seenTimestamps, final };
}

function request(overrides = {}) { const value = { schemaVersion: REAL_PREVIEW_REQUEST_VERSION, previewRequestId: "preview_e07_001", pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1, ideaSelectionId: "selection_e07_001", requestedAt: "2026-09-30T10:00:00.000Z", contentHash: "0".repeat(64), ...overrides }; value.contentHash = realPreviewRequestHash(value); return value; }
function asset(position, script = { scriptId: "script_001", contentHash: "a".repeat(64), pipelineRunId: "run_e07_001", projectId: "project_e07", projectVersion: 1 }) { return { mediaAssetId: `media_asset_${position}`, pipelineRunId: script.pipelineRunId, projectId: script.projectId, projectVersion: script.projectVersion, scriptId: script.scriptId, scriptContentHash: script.contentHash, visualDirectionPosition: position, contentHash: String(position).repeat(64), rights: { usageBasis: "OWNED", commercialUseAllowed: true }, mediaReference: `media:asset_${position}` }; }
function segment(position, media, startMilliseconds, endMilliseconds) { return { position, visualDirectionPosition: media.visualDirectionPosition, mediaAssetId: media.mediaAssetId, mediaAssetContentHash: media.contentHash, startMilliseconds, endMilliseconds }; }
function previewError(code) { return (caught) => caught instanceof RealPreviewError && caught.code === code; }
function lineageFor(id, { run, script, voice, assets, final }) {
  const planId = "composition_plan:preview_e07_001"; const planHash = "d".repeat(64); const sourceId = final.supersedesVideoRenderId; const sourceHash = "e".repeat(64); const trackId = "subtitle_001"; const trackHash = "c".repeat(64);
  const internal = (position, inputId, contentHash) => ({ position, kind: "INTERNAL_ARTIFACT", inputId, contentHash });
  const values = new Map([
    [script.scriptId, [script.contentHash, [internal(1, script.ideaSelectionId, script.ideaSelectionContentHash)]]],
    [voice.voiceTrackId, [voice.contentHash, [internal(1, script.scriptId, script.contentHash)]]],
    ...assets.map((asset) => [asset.mediaAssetId, [asset.contentHash, [internal(1, script.scriptId, script.contentHash)]]]),
    [planId, [planHash, [internal(1, script.scriptId, script.contentHash), internal(2, voice.voiceTrackId, voice.contentHash), ...assets.map((asset, index) => internal(index + 3, asset.mediaAssetId, asset.contentHash))]]],
    [sourceId, [sourceHash, [internal(1, planId, planHash)]]],
    [trackId, [trackHash, [internal(1, script.scriptId, script.contentHash), internal(2, voice.voiceTrackId, voice.contentHash)]]],
    [final.videoRenderId, [final.contentHash, [internal(1, planId, planHash), internal(2, sourceId, sourceHash), internal(3, trackId, trackHash)]]],
  ]);
  const value = values.get(id); return value && { artifactId: id, pipelineRunId: run.pipelineRunId, projectId: run.projectId, projectVersion: 1, contentHash: value[0], inputs: value[1] };
}
