import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { QUALITY_CONTROL_POLICY_VERSION } from "./domain/quality-control-contracts.js";
import { executePreviewSelection, validateExecutionScope } from "./preview-execution.js";
import { createPreviewReadRuntime, createPreviewRuntime } from "./preview-runtime.js";

const STAGE_NAMES = Object.freeze(["Script", "Voice", "Media", "Composition", "Subtitles", "Preview", "QC"]);

export class OperatorPreviewConsole {
  constructor({
    database = resolve(process.env.PREVIEW_DATABASE ?? "data/mktauto.sqlite"), env = process.env,
    readRuntimeFactory = createPreviewReadRuntime, executionRuntimeFactory = createPreviewRuntime,
    executePreview = executePreviewSelection, now = () => new Date().toISOString(),
  } = {}) {
    this.database = database; this.env = env; this.readRuntimeFactory = readRuntimeFactory;
    this.executionRuntimeFactory = executionRuntimeFactory; this.executePreview = executePreview; this.now = now;
    this.active = new Map(); this.failures = new Map(); this.closed = false;
  }

  async catalog(value = {}) {
    const projectId = optionalIdentifier(value.projectId, "projectId", 80);
    const projectVersion = optionalVersion(value.projectVersion);
    const pipelineRunId = optionalIdentifier(value.pipelineRunId, "pipelineRunId", 80);
    return this.#read(({ catalog }) => {
      const projects = catalog.listProjects().map((item) => ({ id: item.id, name: item.snapshot.project.name, latestVersion: item.latestVersion, archived: item.archivedAt !== null }));
      const versions = projectId ? catalog.listProjectVersions(projectId).map(({ project }) => ({ projectId: project.id, version: project.version, name: project.name })) : [];
      const runs = projectId && projectVersion ? catalog.listRunsByProjectVersion(projectId, projectVersion).map((run) => ({ pipelineRunId: run.pipelineRunId, state: run.state, startedAt: run.startedAt, completedAt: run.completedAt })) : [];
      const selections = pipelineRunId ? catalog.listSelectionsByPipelineRun(pipelineRunId).map((item) => ({ selectionId: item.ideaSelectionId, revision: item.revision, decision: item.decision, decidedAt: item.decidedAt })) : [];
      return Object.freeze({ projects, versions, runs, selections });
    });
  }

  async status(value) {
    const scope = validateConsoleScope(value);
    const active = this.active.has(scopeKey(scope));
    const operationError = this.failures.get(scopeKey(scope)) ?? null;
    return this.#read(({ catalog }) => {
      const run = catalog.getRun(scope.pipelineRunId);
      const selection = catalog.getSelection(scope.selectionId);
      verifyScope(run, selection, scope);
      const scripts = catalog.listScriptsByPipelineRun(scope.pipelineRunId);
      const voiceTracks = catalog.listVoiceTracksByPipelineRun(scope.pipelineRunId);
      const mediaAssets = catalog.listMediaAssetsByPipelineRun(scope.pipelineRunId);
      const compositionPlans = catalog.listCompositionPlansByPipelineRun(scope.pipelineRunId);
      const subtitleTracks = catalog.listSubtitleTracksByPipelineRun(scope.pipelineRunId);
      const videoRenders = catalog.listVideoRendersByPipelineRun(scope.pipelineRunId);
      const persisted = { scripts, voiceTracks, mediaAssets, compositionPlans, subtitleTracks, videoRenders, qualityControl: null };
      const withoutQc = reconstructPreviewStatus({ scope, run, selection, artifacts: persisted, active, operationError });
      const final = withoutQc.videoRender
        ? videoRenders.find((item) => item.videoRenderId === withoutQc.videoRender.id && item.contentHash === withoutQc.videoRender.sha256)
        : null;
      const qualityControl = final ? catalog.findQualityControlReport(QUALITY_CONTROL_POLICY_VERSION, final.videoRenderId, final.contentHash) : null;
      return reconstructPreviewStatus({ scope, run, selection, artifacts: { ...persisted, qualityControl }, active, operationError });
    });
  }

  start(value) {
    if (this.closed) throw failure("CONSOLE_CLOSED", "preview", "console encerrada");
    const scope = validateConsoleScope(value); const key = scopeKey(scope);
    if (this.active.has(key)) return this.active.get(key);
    this.failures.delete(key);
    const job = (async () => {
      await this.status(scope);
      const runtime = this.executionRuntimeFactory({ database: this.database, env: this.env });
      try { const result = await this.executePreview(scope, { runtime, now: this.now }); this.failures.delete(key); return result; }
      finally { runtime.close(); }
    })().catch((caught) => { this.failures.set(key, publicOperationError(caught)); return null; }).finally(() => this.active.delete(key));
    this.active.set(key, job);
    return job;
  }

  async openVideo(videoRenderId, sha256) {
    const id = identifier(videoRenderId, "videoRenderId", 200);
    const hash = contentHash(sha256);
    return this.#read(async ({ catalog, referenceResolver }) => {
      const render = catalog.getVideoRender(id);
      if (!render || render.revision !== 2) throw failure("VIDEO_RENDER_NOT_FOUND", "videoRenderId", "render final não encontrado");
      if (render.contentHash !== hash) throw failure("VIDEO_RENDER_HASH_MISMATCH", "sha256", "hash não corresponde ao render solicitado");
      const path = await referenceResolver.resolveVideo(render.logicalReference);
      const details = await stat(path);
      if (!details.isFile()) throw failure("VIDEO_RENDER_NOT_FOUND", "videoRenderId", "render final não encontrado");
      return Object.freeze({ path, size: details.size, id: render.videoRenderId, sha256: render.contentHash });
    });
  }

  close() { this.closed = true; }

  async #read(operation) {
    const runtime = this.readRuntimeFactory({ database: this.database, env: this.env });
    try { return await operation(runtime); } finally { runtime.close(); }
  }
}

export function reconstructPreviewStatus({ scope, run, selection, artifacts, active, operationError = null }) {
  const script = artifacts.scripts.filter((item) => item.ideaSelectionId === selection.ideaSelectionId).at(-1) ?? null;
  const voice = script ? artifacts.voiceTracks.filter((item) => item.scriptId === script.scriptId).at(-1) ?? null : null;
  const media = script ? artifacts.mediaAssets.filter((item) => item.scriptId === script.scriptId) : [];
  const mediaExpected = script?.visualDirections?.length ?? 0;
  const mediaComplete = Boolean(script) && mediaExpected > 0 && new Set(media.map(({ visualDirectionPosition }) => visualDirectionPosition)).size === mediaExpected;
  const plan = script && voice && mediaComplete ? artifacts.compositionPlans.filter((item) => item.scriptId === script.scriptId && item.voiceTrackId === voice.voiceTrackId).at(-1) ?? null : null;
  const subtitle = script && voice ? artifacts.subtitleTracks.filter((item) => item.scriptId === script.scriptId && item.voiceTrackId === voice.voiceTrackId).at(-1) ?? null : null;
  const video = plan ? artifacts.videoRenders.filter((item) => item.compositionPlanId === plan.compositionPlanId && item.revision === 2).at(-1) ?? null : null;
  const qc = video && artifacts.qualityControl ? qualityControlView(artifacts.qualityControl, video) : null;
  const complete = [Boolean(script), Boolean(voice), mediaComplete, Boolean(plan), Boolean(subtitle), Boolean(video), Boolean(qc)];
  const partial = [false, false, media.length > 0 && !mediaComplete, false, false, false, false];
  const firstIncomplete = complete.findIndex((value) => !value);
  const stages = STAGE_NAMES.map((name, index) => {
    let state = complete[index] ? "SUCCEEDED" : partial[index] ? "RUNNING" : "PENDING";
    if (index === firstIncomplete && !complete[index]) {
      if (run.state === "FAILED" || operationError) state = "FAILED";
      else if (active || run.state === "RUNNING") state = "RUNNING";
    }
    return Object.freeze({ name, state });
  });
  const approvalBlocked = qc?.approvalBlocked === true;
  return Object.freeze({
    scope, pipelineRun: Object.freeze({ id: run.pipelineRunId, state: run.state, startedAt: run.startedAt, completedAt: run.completedAt }),
    stages, active: Boolean(active),
    videoRender: video ? Object.freeze({ id: video.videoRenderId, revision: video.revision, sha256: video.contentHash, logicalReference: video.logicalReference, streamUrl: `/api/operator-preview/videos/${encodeURIComponent(video.videoRenderId)}?sha256=${video.contentHash}` }) : null,
    qualityControl: qc,
    approval: Object.freeze({ available: false, blocked: approvalBlocked, message: approvalBlocked ? "FAIL bloqueia aprovação." : "Aprovação e rejeição pertencem ao tópico E08-A01." }),
    error: publicPersistedError(run.error) ?? operationError,
  });
}

function qualityControlView(report, video) {
  if (report.videoRenderId !== video.videoRenderId || report.videoRenderContentHash !== video.contentHash) throw failure("QC_BINDING_MISMATCH", "qualityControl", "QC não corresponde ao render final");
  return Object.freeze({
    reportId: report.qualityControlReportId, videoRenderId: report.videoRenderId,
    videoRenderContentHash: report.videoRenderContentHash, result: report.result,
    approvalBlocked: report.approvalBlocked,
    findings: report.findings.map(({ code, status, subjectType, subjectId, message, observed, expected }) => Object.freeze({ code, status, subjectType, subjectId, message, observed, expected })),
  });
}
function verifyScope(run, selection, scope) {
  if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
  if (!selection) throw failure("IDEA_SELECTION_NOT_FOUND", "selectionId", "seleção não encontrada");
  for (const [field, actual, expected] of [["projectId", run.projectId, scope.projectId], ["projectVersion", run.projectVersion, scope.projectVersion], ["pipelineRunId", selection.pipelineRunId, scope.pipelineRunId], ["projectId", selection.projectId, scope.projectId], ["projectVersion", selection.projectVersion, scope.projectVersion]]) if (actual !== expected) throw failure("SELECTION_SCOPE_MISMATCH", field, "seleção fora do escopo informado");
}
function validateConsoleScope(value) { const normalized = validateExecutionScope(value); if (!normalized.pipelineRunId) throw failure("REQUIRED_OPTION", "pipelineRunId", "informe a execução"); return normalized; }
function scopeKey(value) { return `${value.projectId}\n${value.projectVersion}\n${value.pipelineRunId}\n${value.selectionId}`; }
function publicPersistedError(value) { if (!value) return null; return Object.freeze({ code: safeToken(value.code), field: safeField(value.field), message: typeof value.message === "string" ? value.message : "execução não concluída" }); }
function publicOperationError(value) { const code = safeToken(value?.code, "INTERNAL_ERROR"); return Object.freeze({ code, field: safeField(value?.field), message: code === "INTERNAL_ERROR" ? "a operação local não foi concluída" : "a etapa não foi concluída; verifique a configuração e tente novamente" }); }
function optionalIdentifier(value, field, max) { return value === undefined || value === null || value === "" ? null : identifier(value, field, max); }
function optionalVersion(value) { return value === undefined || value === null || value === "" ? null : positiveInteger(value); }
function identifier(value, field, max) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("INVALID_IDENTIFIER", field, "identificador inválido"); return value; }
function positiveInteger(value) { const parsed = typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : value; if (!Number.isSafeInteger(parsed) || parsed < 1) throw failure("INVALID_VERSION", "projectVersion", "versão inválida"); return parsed; }
function contentHash(value) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw failure("INVALID_HASH", "sha256", "hash inválido"); return value; }
function safeToken(value, fallback = "PREVIEW_FAILED") { return typeof value === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(value) ? value : fallback; }
function safeField(value) { return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.]{0,119}$/.test(value) ? value : "preview"; }
export class OperatorPreviewError extends Error { constructor(code, field, publicMessage) { super(publicMessage); this.name = "OperatorPreviewError"; this.code = code; this.field = field; this.publicMessage = publicMessage; } }
function failure(code, field, message) { return new OperatorPreviewError(code, field, message); }
