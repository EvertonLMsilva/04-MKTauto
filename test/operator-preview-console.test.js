import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OperatorPreviewConsole, reconstructPreviewStatus } from "../src/operator-preview-console.js";

const HASH = "a".repeat(64);
const VIDEO_HASH = "b".repeat(64);
const scope = Object.freeze({
  projectId: "project_console",
  projectVersion: 1,
  pipelineRunId: "run_console",
  selectionId: "selection_console",
});

test("estado das sete etapas e QC e reconstruído somente de artefatos persistidos", () => {
  const status = reconstructPreviewStatus({
    scope,
    run: run("RUNNING"),
    selection: selection(),
    artifacts: {
      scripts: [{ scriptId: "script_console", ideaSelectionId: scope.selectionId, contentHash: HASH, visualDirections: [{ position: 1 }, { position: 2 }] }],
      voiceTracks: [{ voiceTrackId: "voice_console", scriptId: "script_console", contentHash: HASH }],
      mediaAssets: [{ mediaAssetId: "media_console_1", scriptId: "script_console", visualDirectionPosition: 1, contentHash: HASH }],
      compositionPlans: [], subtitleTracks: [], videoRenders: [], qualityControl: null,
    },
    active: false,
  });

  assert.deepEqual(status.stages.map(({ name, state }) => [name, state]), [
    ["Script", "SUCCEEDED"], ["Voice", "SUCCEEDED"], ["Media", "PENDING"],
    ["Composition", "PENDING"], ["Subtitles", "PENDING"], ["Preview", "PENDING"], ["QC", "PENDING"],
  ]);
  assert.equal(status.videoRender, null);
  assert.equal(status.qualityControl, null);
});

test("run persistida não simula etapa ativa antes de Gerar Preview", () => {
  const artifacts = { scripts: [], voiceTracks: [], mediaAssets: [], compositionPlans: [], subtitleTracks: [], videoRenders: [], qualityControl: null };
  const idle = reconstructPreviewStatus({ scope, run: run("RUNNING"), selection: selection(), artifacts, active: false });
  const executing = reconstructPreviewStatus({ scope, run: run("RUNNING"), selection: selection(), artifacts, active: true });

  assert.deepEqual(idle.stages.map(({ state }) => state), Array(7).fill("PENDING"));
  assert.equal(idle.active, false);
  assert.equal(executing.stages[0].state, "RUNNING");
  assert.equal(executing.active, true);
});

test("status vincula MP4 e QC ao mesmo VideoRender final por ID e SHA-256", () => {
  const artifacts = completedArtifacts("WARN");
  const status = reconstructPreviewStatus({ scope, run: run("SUCCEEDED"), selection: selection(), artifacts, active: false });

  assert.deepEqual(status.stages.map(({ state }) => state), Array(7).fill("SUCCEEDED"));
  assert.deepEqual(status.videoRender, {
    id: "video_console_final", revision: 2, sha256: VIDEO_HASH,
    logicalReference: `render:sha256_${VIDEO_HASH}`,
    streamUrl: `/api/operator-preview/videos/video_console_final?sha256=${VIDEO_HASH}`,
  });
  assert.equal(status.qualityControl.videoRenderId, status.videoRender.id);
  assert.equal(status.qualityControl.videoRenderContentHash, status.videoRender.sha256);
  assert.equal(status.qualityControl.result, "WARN");
  assert.equal(status.qualityControl.approvalBlocked, false);
  assert.equal(status.approval.available, true);
  assert.equal(status.approval.approveAllowed, true);
  assert.equal(status.approval.decision, null);
  assert.match(status.approval.message, /decisão humana/i);
});

test("FAIL permanece explícito e bloqueia visualmente aprovação", () => {
  const status = reconstructPreviewStatus({ scope, run: run("SUCCEEDED"), selection: selection(), artifacts: completedArtifacts("FAIL"), active: false });
  assert.equal(status.qualityControl.result, "FAIL");
  assert.equal(status.qualityControl.approvalBlocked, true);
  assert.equal(status.approval.blocked, true);
  assert.equal(status.approval.approveAllowed, false);
  assert.equal(status.approval.available, true);
  assert.match(status.approval.message, /bloqueia aprovação/i);
});

test("decisão usa render e QC exatos e refresh recupera persistência e histórico", async () => {
  const decisions = [];
  const runtimeFactory = () => {
    const runtime = fakeRuntime({ videoPath: null, calls: { resolved: [] } });
    runtime.catalog.findHumanApprovalDecision = () => decisions.at(-1) ?? null;
    runtime.catalog.listHumanApprovalDecisionsByPipelineRun = () => decisions;
    runtime.approvals = { decide: (value) => {
      const persisted = { humanApprovalDecisionId: "human_approval:console", ...value, decidedAt: "2026-09-30T18:00:00.000Z", contentHash: HASH };
      decisions.push(persisted); return persisted;
    } };
    return runtime;
  };
  const console = new OperatorPreviewConsole({ database: "fixture.sqlite", env: {}, readRuntimeFactory: runtimeFactory });
  const before = await console.status(scope);
  const request = {
    projectId: scope.projectId, projectVersion: scope.projectVersion, pipelineRunId: scope.pipelineRunId,
    videoRenderId: before.videoRender.id, videoRenderRevision: before.videoRender.revision,
    videoRenderContentHash: before.videoRender.sha256,
    qualityControlReportId: before.qualityControl.reportId,
    qualityControlReportContentHash: before.qualityControl.contentHash,
    decision: "APPROVED", actor: "operador_local", justification: null,
  };
  await console.decide(request);
  const refreshed = await console.status(scope);
  assert.equal(refreshed.approval.decision.decision, "APPROVED");
  assert.equal(refreshed.approval.history.length, 1);
  assert.equal(refreshed.approval.decision.videoRenderContentHash, before.videoRender.sha256);
  assert.equal(refreshed.approval.decision.qualityControlReportContentHash, before.qualityControl.contentHash);
});

test("status não associa QC de outro VideoRender da mesma execução", async () => {
  const fixture = consoleFixture();
  const runtimeFactory = () => {
    const runtime = fakeRuntime({ videoPath: null, calls: fixture.calls });
    runtime.catalog.listVideoRendersByPipelineRun = () => [
      ...completedArtifacts("PASS").videoRenders,
      { ...completedArtifacts("PASS").videoRenders[0], videoRenderId: "video_other", compositionPlanId: "plan_other", contentHash: "c".repeat(64), logicalReference: `render:sha256_${"c".repeat(64)}` },
    ];
    runtime.catalog.findQualityControlReport = (_policy, videoId, hash) => {
      assert.equal(videoId, "video_console_final"); assert.equal(hash, VIDEO_HASH);
      return completedArtifacts("PASS").qualityControl;
    };
    return runtime;
  };
  const console = new OperatorPreviewConsole({ database: "fixture.sqlite", env: {}, readRuntimeFactory: runtimeFactory });
  assert.equal((await console.status(scope)).qualityControl.videoRenderId, "video_console_final");
});

test("falha persistida marca somente a primeira etapa incompleta e usa mensagem pública", () => {
  const failed = run("FAILED");
  failed.error = { code: "PREVIEW_FAILED", field: "voice", message: "preview não concluído" };
  const status = reconstructPreviewStatus({
    scope, run: failed, selection: selection(),
    artifacts: { scripts: [{ scriptId: "script_console", ideaSelectionId: scope.selectionId, contentHash: HASH, visualDirections: [{ position: 1 }] }], voiceTracks: [], mediaAssets: [], compositionPlans: [], subtitleTracks: [], videoRenders: [], qualityControl: null },
    active: false,
  });
  assert.equal(status.stages[1].state, "FAILED");
  assert.deepEqual(status.error, failed.error);
});

test("start concorrente é idempotente e refresh consulta persistência novamente", async () => {
  const fixture = consoleFixture();
  const first = fixture.console.start(scope);
  const second = fixture.console.start(scope);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.calls.execute, 1);
  assert.equal((await fixture.console.status(scope)).active, true);
  fixture.finish();
  await Promise.all([first, second]);
  assert.equal(fixture.calls.execute, 1);
  assert.ok(fixture.calls.readRuntime >= 2);
});

test("falha de execução em run terminal permanece pública e sanitizada para retry", async () => {
  const secret = "sk-private C:\\Users\\operator payload";
  const calls = { resolved: [] };
  const readRuntimeFactory = () => {
    const runtime = fakeRuntime({ videoPath: null, calls });
    runtime.catalog.getRun = () => run("SUCCEEDED");
    for (const method of ["listScriptsByPipelineRun", "listVoiceTracksByPipelineRun", "listMediaAssetsByPipelineRun", "listCompositionPlansByPipelineRun", "listSubtitleTracksByPipelineRun", "listVideoRendersByPipelineRun"]) runtime.catalog[method] = () => [];
    runtime.catalog.findQualityControlReport = () => null;
    return runtime;
  };
  const console = new OperatorPreviewConsole({ database: "fixture.sqlite", env: {}, readRuntimeFactory, executionRuntimeFactory: readRuntimeFactory, executePreview: async () => { const error = new Error(secret); error.code = "PROVIDER_FAILED"; error.field = "provider"; throw error; } });
  await console.start(scope);
  const status = await console.status(scope);
  assert.equal(status.error.code, "PROVIDER_FAILED");
  assert.equal(status.error.field, "provider");
  assert.equal(status.stages[0].state, "FAILED");
  assert.equal(JSON.stringify(status).includes(secret), false);
});

test("vídeo aceita somente ID e hash válidos e resolve referência persistida", async () => {
  const root = mkdtempSync(join(tmpdir(), "mktauto-console-video-"));
  try {
    const file = join(root, "preview.mp4"); writeFileSync(file, "video");
    const fixture = consoleFixture({ videoPath: file });
    const opened = await fixture.console.openVideo("video_console_final", VIDEO_HASH);
    assert.equal(opened.path, file);
    assert.equal(opened.size, 5);
    assert.deepEqual(fixture.calls.resolved, [`render:sha256_${VIDEO_HASH}`]);
    await assert.rejects(() => fixture.console.openVideo("..\\secret", VIDEO_HASH), /identificador/i);
    await assert.rejects(() => fixture.console.openVideo("video_console_final", "c".repeat(64)), /hash/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("console cria run por bootstrap e persiste seleção por service sem lógica HTTP", async () => {
  const calls = [];
  const candidate = { idea: { ideaBatchId: "idea_batch_console", ideaCandidateId: "idea_candidate_console", title: "Ideia válida", editorialAngle: "Ângulo editorial válido", contentHash: HASH }, score: { ideaScoreId: "idea_score_console", rank: 1, total: 0.8, contentHash: VIDEO_HASH } };
  const console = new OperatorPreviewConsole({ database: "fixture.sqlite", env: {},
    bootstrapRuntimeFactory: () => ({ bootstrap: { start: async (value) => { calls.push(["bootstrap", value]); return { run: run("RUNNING"), candidates: [candidate] }; } }, close() { calls.push(["close-bootstrap"]); } }),
    selectionRuntimeFactory: () => ({ selections: { select: (value) => { calls.push(["select", value]); return value; } }, close() { calls.push(["close-selection"]); } }),
  });
  const created = await console.createRun({ pipelineRunId: scope.pipelineRunId });
  assert.equal(created.candidates[0].ideaCandidateId, candidate.idea.ideaCandidateId);
  const selected = await console.selectIdea({ ideaSelectionId: scope.selectionId });
  assert.equal(selected.ideaSelectionId, scope.selectionId);
  assert.deepEqual(calls.map(([name]) => name), ["bootstrap", "close-bootstrap", "select", "close-selection"]);
});

test("bootstrap preserva campo público indexado sem refletir detalhe privado", async () => {
  const console = new OperatorPreviewConsole({ database: "fixture.sqlite", env: {}, bootstrapRuntimeFactory: () => ({ bootstrap: { start: async () => { const error = new Error("C:\\private sk-secret"); error.code = "INVALID_IDENTIFIER"; error.field = "orderedCandidates[0].candidate.id"; throw error; } }, close() {} }) });
  await assert.rejects(() => console.createRun({}), (error) => error.code === "INVALID_IDENTIFIER" && error.field === "orderedCandidates[0].candidate.id" && !error.publicMessage.includes("private"));
});

function consoleFixture({ videoPath = null } = {}) {
  let resolveExecution;
  const execution = new Promise((resolve) => { resolveExecution = resolve; });
  const calls = { execute: 0, readRuntime: 0, resolved: [] };
  const readRuntimeFactory = () => {
    calls.readRuntime += 1;
    return fakeRuntime({ videoPath, calls });
  };
  const instance = new OperatorPreviewConsole({
    database: "fixture.sqlite", env: {}, readRuntimeFactory,
    executionRuntimeFactory: () => fakeRuntime({ videoPath, calls }),
    executePreview: async () => { calls.execute += 1; await execution; },
  });
  return { console: instance, calls, finish: () => resolveExecution() };
}

function fakeRuntime({ videoPath, calls }) {
  const artifacts = completedArtifacts("PASS");
  return {
    catalog: {
      listProjects: () => [{ id: scope.projectId, latestVersion: 1, archivedAt: null, snapshot: { project: { name: "Projeto Console" } } }],
      listProjectVersions: () => [{ project: { id: scope.projectId, version: 1, name: "Projeto Console" } }],
      listRunsByProjectVersion: () => [run("RUNNING")],
      listSelectionsByPipelineRun: () => [selection()],
      listIdeasByPipelineRun: () => [],
      listScriptsByPipelineRun: () => artifacts.scripts,
      listVoiceTracksByPipelineRun: () => artifacts.voiceTracks,
      listMediaAssetsByPipelineRun: () => artifacts.mediaAssets,
      listCompositionPlansByPipelineRun: () => artifacts.compositionPlans,
      listSubtitleTracksByPipelineRun: () => artifacts.subtitleTracks,
      listVideoRendersByPipelineRun: () => artifacts.videoRenders,
      findQualityControlReport: () => artifacts.qualityControl,
      findHumanApprovalDecision: () => null,
      listHumanApprovalDecisionsByPipelineRun: () => [],
      getRun: () => run("RUNNING"), getSelection: () => selection(),
      getVideoRender: () => artifacts.videoRenders.at(-1),
    },
    referenceResolver: { resolveVideo: async (reference) => { calls.resolved.push(reference); return videoPath; } },
    close() {},
  };
}

function completedArtifacts(result) {
  const script = { scriptId: "script_console", ideaSelectionId: scope.selectionId, contentHash: HASH, visualDirections: [{ position: 1 }] };
  const video = { videoRenderId: "video_console_final", pipelineRunId: scope.pipelineRunId, projectId: scope.projectId, projectVersion: 1, compositionPlanId: "plan_console", revision: 2, contentHash: VIDEO_HASH, logicalReference: `render:sha256_${VIDEO_HASH}` };
  return {
    scripts: [script], voiceTracks: [{ voiceTrackId: "voice_console", scriptId: script.scriptId, contentHash: HASH }],
    mediaAssets: [{ mediaAssetId: "media_console", scriptId: script.scriptId, visualDirectionPosition: 1, contentHash: HASH }],
    compositionPlans: [{ compositionPlanId: "plan_console", scriptId: script.scriptId, voiceTrackId: "voice_console", contentHash: HASH }],
    subtitleTracks: [{ subtitleTrackId: "subtitle_console", scriptId: script.scriptId, voiceTrackId: "voice_console", contentHash: HASH }],
    videoRenders: [video],
    qualityControl: { qualityControlReportId: "quality_control:console", contentHash: HASH, checkedAt: "2026-09-30T17:00:00.000Z", videoRenderId: video.videoRenderId, videoRenderContentHash: video.contentHash, result, approvalBlocked: result === "FAIL", findings: [{ code: "VIDEO_SHA256_MATCH", status: result, subjectType: "VIDEO_RENDER", subjectId: video.videoRenderId, message: "Hash conferido.", observed: video.contentHash, expected: video.contentHash }] },
  };
}

function run(state) { return { pipelineRunId: scope.pipelineRunId, projectId: scope.projectId, projectVersion: 1, state, startedAt: "2026-09-30T12:00:00.000Z", completedAt: state === "RUNNING" ? null : "2026-09-30T12:10:00.000Z", error: null }; }
function selection() { return { ideaSelectionId: scope.selectionId, pipelineRunId: scope.pipelineRunId, projectId: scope.projectId, projectVersion: 1, contentHash: HASH, revision: 1, decision: "SELECTED" }; }
