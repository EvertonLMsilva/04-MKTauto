import { createHash } from "node:crypto";
import { REAL_PREVIEW_REQUEST_VERSION, realPreviewRequestHash } from "./domain/real-preview-contracts.js";
import { PIPELINE_HANDOFF_CONTRACT_VERSION } from "./project-pipeline-handoff.js";
import { STAGE_RECOVERY_CONTRACT_VERSION } from "./domain/stage-recovery-contracts.js";
import { QUALITY_CONTROL_POLICY_VERSION } from "./domain/quality-control-contracts.js";

export async function executePreviewSelection(value, { runtime, now = () => new Date().toISOString(), onProgress } = {}) {
  const scope = validateExecutionScope(value);
  progress(onProgress, "VALIDATING");
  const selection = runtime.selections.get(scope.selectionId);
  if (!selection) throw failure("IDEA_SELECTION_NOT_FOUND", "selectionId", "seleção não encontrada");
  verifySelection(selection, scope);
  const existingRun = runtime.pipelineRuns.get(selection.pipelineRunId);
  if (!existingRun) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução da seleção não encontrada");
  if (scope.pipelineRunId && scope.pipelineRunId !== existingRun.pipelineRunId) throw failure("SELECTION_SCOPE_MISMATCH", "pipelineRunId", "seleção pertence a outra execução");
  if (existingRun.state === "FAILED") throw failure("PREVIEW_RUN_FAILED", "pipelineRunId", "execução já falhou");

  progress(onProgress, "PREPARING");
  const previewRequestId = previewIdentity(selection);
  const executionMode = existingRun.state === "SUCCEEDED"
    ? "REUSED_TERMINAL"
    : runtime.lookup.getScript(`script:${previewRequestId}:script`) ? "RESUMED" : "NEW";
  runtime.pipelineRuns.resume({
    schemaVersion: PIPELINE_HANDOFF_CONTRACT_VERSION,
    pipelineRunId: existingRun.pipelineRunId,
    projectId: scope.projectId,
    projectVersion: scope.projectVersion,
    startedAt: existingRun.startedAt,
  });
  const request = previewRequest({
    previewRequestId, pipelineRunId: existingRun.pipelineRunId,
    projectId: scope.projectId, projectVersion: scope.projectVersion,
    ideaSelectionId: selection.ideaSelectionId, requestedAt: now(),
  });
  progress(onProgress, "EXECUTING");
  const result = await runtime.previews.execute(request);
  const video = result.previewVideoRender;
  progress(onProgress, "QUALITY_CONTROL");
  const inspect = () => runtime.qualityControl.inspect({ pipelineRunId: existingRun.pipelineRunId, videoRenderId: video.id, videoRenderContentHash: video.contentHash });
  const qualityControl = runtime.stages ? (await runtime.stages.execute({
    schemaVersion: STAGE_RECOVERY_CONTRACT_VERSION, pipelineRunId: existingRun.pipelineRunId, stage: "QC",
    requestHash: createHash("sha256").update(`${video.id}\n${video.contentHash}\n${QUALITY_CONTROL_POLICY_VERSION}`).digest("hex"),
    inputs: [{ stage: "PREVIEW", artifactId: video.id, contentHash: video.contentHash }], policyVersions: { qualityControl: QUALITY_CONTROL_POLICY_VERSION }, providerConfigHash: null,
  }, async () => { const value = await inspect(); return { artifactId: value.qualityControlReportId, contentHash: value.contentHash, value }; })).value : await inspect();
  progress(onProgress, "COMPLETED");
  return Object.freeze({
    status: runtime.pipelineRuns.get(existingRun.pipelineRunId).state,
    executionMode,
    pipelineRunId: existingRun.pipelineRunId,
    videoRender: Object.freeze({
      id: video.id, revision: video.revision, sha256: video.contentHash,
      logicalReference: video.logicalReference,
    }),
    qualityControl,
  });
}

export function validateExecutionScope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_PREVIEW_SCOPE", "scope", "escopo inválido");
  return Object.freeze({
    projectId: identifier(value.projectId, "projectId", 80),
    projectVersion: positiveInteger(value.projectVersion, "projectVersion"),
    pipelineRunId: value.pipelineRunId === undefined ? null : identifier(value.pipelineRunId, "pipelineRunId", 80),
    selectionId: identifier(value.selectionId, "selectionId", 200),
  });
}

function verifySelection(selection, scope) {
  if (selection.projectId !== scope.projectId) throw failure("SELECTION_SCOPE_MISMATCH", "projectId", "seleção pertence a outro projeto");
  if (selection.projectVersion !== scope.projectVersion) throw failure("SELECTION_SCOPE_MISMATCH", "projectVersion", "seleção pertence a outra versão");
}
function previewIdentity(selection) { return `preview:${createHash("sha256").update(`${selection.projectId}\n${selection.projectVersion}\n${selection.ideaSelectionId}\n${selection.contentHash}`).digest("hex")}`; }
function previewRequest(value) { const request = { schemaVersion: REAL_PREVIEW_REQUEST_VERSION, ...value, contentHash: "0".repeat(64) }; request.contentHash = realPreviewRequestHash(request); return request; }
function identifier(value, field, max) { if (typeof value !== "string" || value.length > max || !/^[a-z0-9][a-z0-9_:-]{2,}$/.test(value)) throw failure("REQUIRED_OPTION", field, "informe um identificador válido"); return value; }
function positiveInteger(value, field) { const parsed = typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : value; if (!Number.isSafeInteger(parsed) || parsed < 1) throw failure("INVALID_VERSION", field, "use um inteiro positivo"); return parsed; }
function progress(callback, stage) { callback?.(Object.freeze({ event: "preview_progress", stage })); }

export class PreviewExecutionError extends Error {
  constructor(code, field, publicMessage) { super(code); this.name = "PreviewExecutionError"; this.code = code; this.field = field; this.publicMessage = publicMessage; }
}
function failure(code, field, message) { return new PreviewExecutionError(code, field, message); }
