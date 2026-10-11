import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QUALITY_CONTROL_POLICY_VERSION,
  QUALITY_CONTROL_REPORT_VERSION,
  qualityControlReportContentHash,
  qualityControlReportId,
  validateQualityControlReport,
} from "../src/domain/quality-control-contracts.js";
import { QualityControlRepository } from "../src/quality-control-repository.js";
import { QualityControlService, evaluateQualityControl } from "../src/quality-control-service.js";

test("política versionada agrega PASS, WARN e FAIL de forma determinística", () => {
  const context = scenario();
  const pass = evaluateQualityControl(context);
  assert.equal(pass.every(({ status }) => status === "PASS"), true);
  assert.deepEqual(evaluateQualityControl(context), pass);

  const warning = evaluateQualityControl({ ...context, facts: { ...context.facts, video: { ...context.facts.video, sizeBytes: 480000000 } } });
  assert.equal(warning.find(({ code }) => code === "VIDEO_SIZE_HEADROOM").status, "WARN");
  assert.equal(warning.some(({ status }) => status === "FAIL"), false);

  const failed = evaluateQualityControl({ ...context, facts: { ...context.facts, video: { ...context.facts.video, sha256: "0".repeat(64) } } });
  assert.equal(failed.find(({ code }) => code === "VIDEO_SHA256_MATCH").status, "FAIL");
});

test("contrato vincula QC ao ID e SHA-256 exatos e bloqueia somente FAIL", () => {
  const base = scenario(); const findings = evaluateQualityControl(base);
  const report = reportFor(base, findings);
  assert.deepEqual(validateQualityControlReport(report), report);
  assert.equal(report.approvalBlocked, false);
  assert.notEqual(
    qualityControlReportId(QUALITY_CONTROL_POLICY_VERSION, base.videoRender.videoRenderId, base.videoRender.contentHash),
    qualityControlReportId(QUALITY_CONTROL_POLICY_VERSION, "video_render:final_two", base.videoRender.contentHash),
  );
  const failedFindings = findings.map((finding, index) => index === 0 ? { ...finding, status: "FAIL" } : finding);
  const failed = reportFor(base, failedFindings, { result: "FAIL", approvalBlocked: true });
  assert.equal(validateQualityControlReport(failed).result, "FAIL");
  assert.throws(() => validateQualityControlReport({ ...failed, approvalBlocked: false }), /INVALID_APPROVAL_BLOCK/);
});

test("service persiste uma vez, reutiliza retry e não reaproveita QC para hash divergente", async () => {
  const context = scenario(); const reports = new Map(); let inspections = 0;
  const repository = fakeRepository(context, reports);
  const service = new QualityControlService({
    repository, voices: { getVoiceTrack: () => context.voiceTrack },
    inspector: { inspect: async () => { inspections += 1; return context.facts; } },
    now: () => "2026-09-30T16:00:00.000Z",
  });
  const request = { pipelineRunId: context.run.pipelineRunId, videoRenderId: context.videoRender.videoRenderId, videoRenderContentHash: context.videoRender.contentHash };
  const first = await service.inspect(request); const retry = await service.inspect(request);
  assert.equal(first.result, "PASS"); assert.deepEqual(retry, first); assert.equal(inspections, 1); assert.equal(reports.size, 1);
  await assert.rejects(service.inspect({ ...request, videoRenderContentHash: "0".repeat(64) }), (error) => error.code === "QUALITY_CONTROL_VIDEO_BINDING_MISMATCH" && !error.message.includes("0".repeat(64)));
});

test("repository preserva QC após migration 25, persiste findings imutáveis e deduplica retry", () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-qc-repository-")); const path = join(root, "catalog.sqlite");
  class FixtureRepository extends QualityControlRepository { getVideoRender() { return scenario().videoRender; } }
  const repository = new FixtureRepository(path);
  try {
    assert.equal(repository.db.prepare("PRAGMA user_version").get().user_version, 32);
    repository.db.exec("PRAGMA foreign_keys = OFF; DROP TRIGGER quality_control_reports_validate_binding;");
    const context = scenario(); const report = reportFor(context, evaluateQualityControl(context));
    const first = repository.registerQualityControlReport(report); const retry = repository.registerQualityControlReport(report);
    assert.deepEqual(retry, first);
    assert.equal(repository.db.prepare("SELECT COUNT(*) AS total FROM quality_control_reports").get().total, 1);
    assert.equal(repository.db.prepare("SELECT COUNT(*) AS total FROM quality_control_findings").get().total, report.findings.length);
    assert.throws(() => repository.db.prepare("UPDATE quality_control_reports SET result = 'FAIL'").run(), /IMMUTABLE_QUALITY_CONTROL_REPORT/);
  } finally { repository.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); }
});

function scenario() {
  const h = (digit) => digit.repeat(64); const scope = { pipelineRunId: "run_qc_001", projectId: "project_qc", projectVersion: 1 };
  const run = { ...scope, projectSnapshot: { project: { id: scope.projectId, version: 1 } } };
  const script = { ...scope, scriptId: "script:qc:001", ideaSelectionId: "selection_qc_001", ideaSelectionContentHash: h("1"), contentHash: h("2") };
  const voiceTrack = { ...scope, voiceTrackId: "voice_track:qc:001", scriptId: script.scriptId, scriptContentHash: script.contentHash, durationMilliseconds: 1000, contentHash: h("3"), rights: { commercialUseAllowed: true } };
  const mediaAsset = { ...scope, mediaAssetId: "media_asset:qc:001", scriptId: script.scriptId, scriptContentHash: script.contentHash, visualDirectionPosition: 1, contentHash: h("4"), mediaReference: `media:sha256_${h("4")}`, origin: "OPERATOR_OWNED", rights: { commercialUseAllowed: true } };
  const compositionPlan = { ...scope, compositionPlanId: "composition_plan:qc:001", scriptId: script.scriptId, scriptContentHash: script.contentHash, voiceTrackId: voiceTrack.voiceTrackId, voiceTrackContentHash: voiceTrack.contentHash, timelineUnit: "MILLISECOND", continuityMode: "CONTIGUOUS", durationMilliseconds: 1000, contentHash: h("5"), segments: [{ position: 1, mediaAssetId: mediaAsset.mediaAssetId, mediaAssetContentHash: mediaAsset.contentHash, startMilliseconds: 0, endMilliseconds: 1000 }] };
  const sourceVideoRender = { ...scope, videoRenderId: "video_render:qc:source", compositionPlanId: compositionPlan.compositionPlanId, compositionPlanContentHash: compositionPlan.contentHash, contentHash: h("6"), revision: 1 };
  const subtitleTrack = { ...scope, subtitleTrackId: "subtitle_track:qc:001", scriptId: script.scriptId, scriptContentHash: script.contentHash, voiceTrackId: voiceTrack.voiceTrackId, voiceTrackContentHash: voiceTrack.contentHash, durationMilliseconds: 1000, contentHash: h("7") };
  const videoRender = { ...scope, videoRenderId: "video_render:qc:final", compositionPlanId: compositionPlan.compositionPlanId, compositionPlanContentHash: compositionPlan.contentHash, outputAspectRatio: "9:16", durationMilliseconds: 1000, containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920, contentHash: h("8"), logicalReference: `render:sha256_${h("8")}`, revision: 2, supersedesVideoRenderId: sourceVideoRender.videoRenderId };
  const internal = (position, artifact) => ({ position, kind: "INTERNAL_ARTIFACT", inputId: artifact.videoRenderId ?? artifact.subtitleTrackId ?? artifact.compositionPlanId ?? artifact.mediaAssetId ?? artifact.voiceTrackId ?? artifact.scriptId, contentHash: artifact.contentHash });
  const lineage = (artifact, inputs, generationMetadata = null) => ({ artifactId: internal(1, artifact).inputId, ...scope, contentHash: artifact.contentHash, inputs, generationMetadata });
  const lineages = new Map([
    [script.scriptId, lineage(script, [{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: script.ideaSelectionId, contentHash: script.ideaSelectionContentHash }])],
    [voiceTrack.voiceTrackId, lineage(voiceTrack, [internal(1, script)])],
    [mediaAsset.mediaAssetId, lineage(mediaAsset, [internal(1, script)])],
    [compositionPlan.compositionPlanId, lineage(compositionPlan, [internal(1, script), internal(2, voiceTrack), internal(3, mediaAsset)])],
    [sourceVideoRender.videoRenderId, lineage(sourceVideoRender, [internal(1, compositionPlan)])],
    [subtitleTrack.subtitleTrackId, lineage(subtitleTrack, [internal(1, script), internal(2, voiceTrack)])],
    [videoRender.videoRenderId, lineage(videoRender, [internal(1, compositionPlan), internal(2, sourceVideoRender), internal(3, subtitleTrack)], { taskType: "subtitle-burn-in", publicConfiguration: { renderPolicyVersion: "ffmpeg-subtitle-render-policy/1.0.0" } })],
  ]);
  const videoStream = { type: "video", codec: "h264", profile: "High", widthPixels: 1080, heightPixels: 1920, pixelFormat: "yuv420p", frameRate: "30/1", averageFrameRate: "30/1", durationMilliseconds: 1000, startMilliseconds: 0 };
  const audioStream = { type: "audio", codec: "aac", profile: "LC", sampleRate: 48000, channels: 1, durationMilliseconds: 1000, startMilliseconds: 0 };
  const facts = { video: { exists: true, accessible: true, regularFile: true, sizeBytes: 1000, readable: true, sha256: videoRender.contentHash, decodeSucceeded: true, probeSucceeded: true, containerNames: ["mp4", "mov"], durationMilliseconds: 1000, startMilliseconds: 0, streams: [videoStream, audioStream] }, media: [{ mediaAssetId: mediaAsset.mediaAssetId, exists: true, accessible: true, regularFile: true, sizeBytes: 100, readable: true, sha256: mediaAsset.contentHash, errorKind: null }] };
  return { run, script, voiceTrack, mediaAssets: [mediaAsset], compositionPlan, sourceVideoRender, subtitleTrack, videoRender, lineages, facts, maxOutputBytes: 524288000 };
}

function reportFor(context, findings, overrides = {}) {
  const ref = (id, contentHash) => ({ id, contentHash });
  const value = { schemaVersion: QUALITY_CONTROL_REPORT_VERSION, qualityControlReportId: qualityControlReportId(QUALITY_CONTROL_POLICY_VERSION, context.videoRender.videoRenderId, context.videoRender.contentHash), policyVersion: QUALITY_CONTROL_POLICY_VERSION, pipelineRunId: context.run.pipelineRunId, projectId: context.run.projectId, projectVersion: context.run.projectVersion, videoRenderId: context.videoRender.videoRenderId, videoRenderContentHash: context.videoRender.contentHash, artifacts: { script: ref(context.script.scriptId, context.script.contentHash), voiceTrack: ref(context.voiceTrack.voiceTrackId, context.voiceTrack.contentHash), mediaAssets: context.mediaAssets.map((asset, index) => ({ position: index + 1, id: asset.mediaAssetId, contentHash: asset.contentHash })), compositionPlan: ref(context.compositionPlan.compositionPlanId, context.compositionPlan.contentHash), subtitleTrack: ref(context.subtitleTrack.subtitleTrackId, context.subtitleTrack.contentHash), videoRender: ref(context.videoRender.videoRenderId, context.videoRender.contentHash) }, result: "PASS", approvalBlocked: false, findings, checkedAt: "2026-09-30T16:00:00.000Z", contentHash: "", ...overrides };
  value.contentHash = qualityControlReportContentHash(value); return value;
}

function fakeRepository(context, reports) {
  const artifacts = new Map([[context.videoRender.videoRenderId, context.videoRender], [context.sourceVideoRender.videoRenderId, context.sourceVideoRender]]);
  return {
    findQualityControlReport: (policy, id, hash) => reports.get(`${policy}:${id}:${hash}`) ?? null,
    registerQualityControlReport: (report) => { reports.set(`${report.policyVersion}:${report.videoRenderId}:${report.videoRenderContentHash}`, report); return report; },
    getRun: () => context.run, getScript: () => context.script, getMediaAsset: () => context.mediaAssets[0], getCompositionPlan: () => context.compositionPlan,
    getVideoRender: (id) => artifacts.get(id), getSubtitleTrack: () => context.subtitleTrack, getArtifact: (id) => context.lineages.get(id),
  };
}
