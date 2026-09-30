import { COMPOSITION_PLAN_CONTRACT_VERSION, compositionPlanContentHash } from "./domain/composition-plan-contracts.js";
import { MEDIA_ACQUISITION_REQUEST_VERSION, mediaAcquisitionRequestHash } from "./domain/media-acquisition-contracts.js";
import { REAL_PREVIEW_RESULT_VERSION, validateRealPreviewRequest, validateRealPreviewResult } from "./domain/real-preview-contracts.js";
import { SCRIPT_GENERATION_REQUEST_VERSION, scriptGenerationRequestHash } from "./domain/script-generation-contracts.js";
import { SUBTITLE_RENDER_POLICY_VERSION, SUBTITLE_RENDER_REQUEST_VERSION, subtitleRenderIdentityHash, subtitleRenderRequestHash } from "./domain/subtitle-render-contracts.js";
import { SUBTITLE_STYLE_POLICY_VERSION } from "./domain/subtitle-track-contracts.js";
import { VIDEO_COMPOSITION_REQUEST_VERSION, videoCompositionRequestHash } from "./domain/video-composition-contracts.js";
import { VOICE_GENERATION_REQUEST_VERSION, voiceGenerationRequestHash } from "./domain/voice-generation-contracts.js";

const BASE_UNAVAILABLE_COST_STAGES = Object.freeze(["voice", "video_composition", "subtitle_generation", "subtitle_rendering"]);

export class RealPreviewError extends Error {
  constructor(code, field, message, options) { super(`${code}: ${message}`, options); this.name = "RealPreviewError"; this.code = code; this.field = field; }
}

export class RealPreviewService {
  constructor({ pipelineRuns, scripts, voices, media, plans, videos, subtitles, subtitleRendering, previewVerifier, costs, lookup, lineage, now = () => new Date().toISOString() }) {
    requireMethods(pipelineRuns, ["get", "succeed", "fail"], "pipelineRuns"); requireMethods(scripts, ["generate"], "scripts");
    requireMethods(voices, ["generate"], "voices"); requireMethods(media, ["acquire"], "media"); requireMethods(plans, ["register"], "plans");
    requireMethods(videos, ["compose"], "videos"); requireMethods(subtitles, ["generate"], "subtitles"); requireMethods(subtitleRendering, ["render"], "subtitleRendering");
    requireMethods(previewVerifier, ["verify"], "previewVerifier"); requireMethods(costs, ["getLedgerByPipelineRun"], "costs"); requireMethods(lookup, ["getScript"], "lookup"); requireMethods(lineage, ["get"], "lineage");
    Object.assign(this, { pipelineRuns, scripts, voices, media, plans, videos, subtitles, subtitleRendering, previewVerifier, costs, lookup, lineage, now });
  }

  async execute(value, { signal } = {}) {
    let request; try { request = validateRealPreviewRequest(value); } catch (caught) { throw mapError(caught); }
    const run = this.pipelineRuns.get(request.pipelineRunId);
    try {
      verifyRun(run, request); abort(signal);
      const generationRequestId = `${request.previewRequestId}:script`;
      const persistedScript = this.lookup.getScript(`script:${generationRequestId}`);
      const canonicalAt = persistedScript?.createdAt ?? request.requestedAt;
      const scriptRequest = withHash({ schemaVersion: SCRIPT_GENERATION_REQUEST_VERSION, generationRequestId, ideaSelectionId: request.ideaSelectionId, requestedAt: canonicalAt, contentHash: "" }, scriptGenerationRequestHash);
      const script = await this.scripts.generate(scriptRequest, { signal }); verifyScope(script, request); abort(signal);
      const voiceRequest = withHash({ schemaVersion: VOICE_GENERATION_REQUEST_VERSION, generationRequestId: `${request.previewRequestId}:voice`, scriptId: script.scriptId, scriptContentHash: script.contentHash, requestedAt: script.createdAt, contentHash: "" }, voiceGenerationRequestHash);
      const voice = await this.voices.generate(voiceRequest, { signal }); verifyAncestry(voice, request, script); abort(signal);
      const assets = [];
      for (const direction of script.visualDirections) {
        const mediaRequest = withHash({ schemaVersion: MEDIA_ACQUISITION_REQUEST_VERSION, mediaAcquisitionRequestId: `${request.previewRequestId}:media:${direction.position}`, scriptId: script.scriptId, scriptContentHash: script.contentHash, visualDirectionPosition: direction.position, assetType: "IMAGE", requestedAt: script.createdAt, contentHash: "" }, mediaAcquisitionRequestHash);
        const asset = await this.media.acquire(mediaRequest, { signal }); verifyMedia(asset, request, script, direction.position); assets.push(asset); abort(signal);
      }
      const plan = this.plans.register(buildPlan(request, script, voice, assets)); abort(signal);
      const videoRequest = withHash({ schemaVersion: VIDEO_COMPOSITION_REQUEST_VERSION, videoCompositionRequestId: `${request.previewRequestId}:video`, compositionPlanId: plan.compositionPlanId, compositionPlanContentHash: plan.contentHash, containerFormat: "mp4", widthPixels: 1080, heightPixels: 1920, requestedAt: script.createdAt, contentHash: "" }, videoCompositionRequestHash);
      const source = await this.videos.compose(videoRequest, { signal }); verifyVideo(source, request, plan, 1); abort(signal);
      const generated = this.subtitles.generate({ pipelineRunId: request.pipelineRunId, projectId: request.projectId, projectVersion: request.projectVersion, scriptId: script.scriptId, scriptContentHash: script.contentHash, voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voice.contentHash, stylePolicyVersion: SUBTITLE_STYLE_POLICY_VERSION, requestedAt: script.createdAt });
      const track = generated.subtitleTrack; verifyTrack(track, request, script, voice); abort(signal);
      const renderRequest = subtitleRequest(request, script, voice, plan, source, track);
      const preview = await this.subtitleRendering.render(renderRequest, { signal }); verifyVideo(preview, request, plan, 2); if (preview.supersedesVideoRenderId !== source.videoRenderId) throw failure("PREVIEW_SUPERSESSION_MISMATCH", "supersedesVideoRenderId", "render final não sucede a revisão 1"); abort(signal);
      verifyEndToEndLineage(this.lineage, request, script, voice, assets, plan, source, track, preview);
      const verified = await this.previewVerifier.verify({ logicalReference: preview.logicalReference, contentHash: preview.contentHash }, { signal });
      if (verified?.contentHash !== preview.contentHash) throw failure("PREVIEW_PHYSICAL_HASH_MISMATCH", "contentHash", "hash físico divergente"); abort(signal);
      const ledger = this.costs.getLedgerByPipelineRun(request.pipelineRunId);
      const result = validateRealPreviewResult(resultFor(request, script, voice, assets, plan, source, track, preview, ledger));
      const current = this.pipelineRuns.get(request.pipelineRunId); if (current.state === "RUNNING") this.pipelineRuns.succeed(request.pipelineRunId, { completedAt: this.now() });
      return result;
    } catch (caught) {
      const mapped = mapError(caught);
      if (mapped.code === "PREVIEW_CANCELLED") throw mapped;
      const current = this.pipelineRuns.get(request.pipelineRunId);
      if (current?.state === "RUNNING") this.pipelineRuns.fail(request.pipelineRunId, { completedAt: this.now(), error: mapped });
      throw mapped;
    }
  }
}

export function buildDeterministicSegments(assets, durationMilliseconds) {
  if (!Array.isArray(assets) || assets.length === 0) throw failure("PREVIEW_MEDIA_REQUIRED", "mediaAssets", "mídia obrigatória");
  if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds < assets.length) throw failure("PREVIEW_DURATION_INSUFFICIENT", "durationMilliseconds", "duração insuficiente para segmentos positivos");
  return assets.map((asset, index) => Object.freeze({ position: index + 1, visualDirectionPosition: asset.visualDirectionPosition, mediaAssetId: asset.mediaAssetId, mediaAssetContentHash: asset.contentHash, startMilliseconds: Math.floor(index * durationMilliseconds / assets.length), endMilliseconds: Math.floor((index + 1) * durationMilliseconds / assets.length) }));
}

function buildPlan(request, script, voice, assets) {
  const value = { schemaVersion: COMPOSITION_PLAN_CONTRACT_VERSION, compositionPlanId: `composition_plan:${request.previewRequestId}`, pipelineRunId: request.pipelineRunId, projectId: request.projectId, projectVersion: request.projectVersion, scriptId: script.scriptId, scriptContentHash: script.contentHash, voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voice.contentHash, outputAspectRatio: "9:16", timelineUnit: "MILLISECOND", continuityMode: "CONTIGUOUS", durationMilliseconds: voice.durationMilliseconds, segments: buildDeterministicSegments(assets, voice.durationMilliseconds), createdAt: script.createdAt, revision: 1, supersedesCompositionPlanId: null, contentHash: "" };
  value.contentHash = compositionPlanContentHash(value); return value;
}
function subtitleRequest(request, script, voice, plan, source, track) { const value = { schemaVersion: SUBTITLE_RENDER_REQUEST_VERSION, subtitleRenderRequestId: "pending", pipelineRunId: request.pipelineRunId, projectId: request.projectId, projectVersion: request.projectVersion, videoRenderId: source.videoRenderId, videoRenderContentHash: source.contentHash, compositionPlanId: plan.compositionPlanId, compositionPlanContentHash: plan.contentHash, subtitleTrackId: track.subtitleTrackId, subtitleTrackContentHash: track.contentHash, scriptId: script.scriptId, scriptContentHash: script.contentHash, voiceTrackId: voice.voiceTrackId, voiceTrackContentHash: voice.contentHash, stylePolicyVersion: track.stylePolicyVersion, renderPolicyVersion: SUBTITLE_RENDER_POLICY_VERSION, requestedAt: script.createdAt, contentHash: "" }; value.subtitleRenderRequestId = `subtitle_render:${subtitleRenderIdentityHash(value)}`; value.contentHash = subtitleRenderRequestHash(value); return value; }
function resultFor(request, script, voice, assets, plan, source, track, preview, ledger) { const events = ledger.events ?? []; const costed = new Set(events.map(({ artifactId }) => artifactId).filter(Boolean)); const unavailableStages = [...BASE_UNAVAILABLE_COST_STAGES]; if (!costed.has(script.scriptId)) unavailableStages.unshift("script"); for (const asset of assets) if (!costed.has(asset.mediaAssetId)) unavailableStages.push(`media:${asset.visualDirectionPosition}`); return { schemaVersion: REAL_PREVIEW_RESULT_VERSION, previewRequestId: request.previewRequestId, requestContentHash: request.contentHash, pipelineRunId: request.pipelineRunId, projectId: request.projectId, projectVersion: request.projectVersion, script: ref(script.scriptId, script.contentHash), voiceTrack: ref(voice.voiceTrackId, voice.contentHash), mediaAssets: assets.map((asset) => ({ position: asset.visualDirectionPosition, id: asset.mediaAssetId, contentHash: asset.contentHash })), compositionPlan: ref(plan.compositionPlanId, plan.contentHash), sourceVideoRender: videoRef(source), subtitleTrack: ref(track.subtitleTrackId, track.contentHash), previewVideoRender: videoRef(preview), costs: { known: events.map(({ costEventId, amount, currency }) => ({ costEventId, amount, currency })), unavailableStages } }; }
function ref(id, contentHash) { return { id, contentHash }; }
function videoRef(value) { return { id: value.videoRenderId, contentHash: value.contentHash, revision: value.revision, logicalReference: value.logicalReference, durationMilliseconds: value.durationMilliseconds, outputAspectRatio: value.outputAspectRatio, widthPixels: value.widthPixels, heightPixels: value.heightPixels }; }
function verifyRun(run, request) { if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada"); verifyScope(run, request); if (run.projectSnapshot?.project?.id !== request.projectId || run.projectSnapshot?.project?.version !== request.projectVersion) throw failure("PREVIEW_SNAPSHOT_SCOPE_MISMATCH", "projectVersion", "snapshot divergente"); if (run.state === "FAILED") throw failure("PREVIEW_RUN_FAILED", "pipelineRunId", "execução já falhou"); }
function verifyScope(value, request) { for (const field of ["pipelineRunId", "projectId", "projectVersion"]) if (value?.[field] !== request[field]) throw failure("PREVIEW_SCOPE_MISMATCH", field, "escopo divergente"); }
function verifyAncestry(value, request, script) { verifyScope(value, request); if (value.scriptId !== script.scriptId || value.scriptContentHash !== script.contentHash) throw failure("PREVIEW_ANCESTRY_MISMATCH", "scriptId", "roteiro divergente"); }
function verifyMedia(value, request, script, position) { verifyAncestry(value, request, script); if (value.visualDirectionPosition !== position) throw failure("PREVIEW_MEDIA_POSITION_MISMATCH", "visualDirectionPosition", "posição divergente"); if (value.rights?.commercialUseAllowed !== true) throw failure("PREVIEW_MEDIA_RIGHTS_INVALID", "rights", "direitos insuficientes"); }
function verifyVideo(value, request, plan, revision) { verifyScope(value, request); if (value.compositionPlanId !== plan.compositionPlanId || value.compositionPlanContentHash !== plan.contentHash) throw failure("PREVIEW_ANCESTRY_MISMATCH", "compositionPlanId", "plano divergente"); if (value.revision !== revision || value.durationMilliseconds !== plan.durationMilliseconds || value.outputAspectRatio !== plan.outputAspectRatio) throw failure("PREVIEW_VIDEO_POLICY_MISMATCH", "revision", "render divergente"); }
function verifyTrack(value, request, script, voice) { verifyAncestry(value, request, script); if (value.voiceTrackId !== voice.voiceTrackId || value.voiceTrackContentHash !== voice.contentHash || value.durationMilliseconds !== voice.durationMilliseconds) throw failure("PREVIEW_SUBTITLE_ANCESTRY_MISMATCH", "voiceTrackId", "legenda divergente"); }
function verifyEndToEndLineage(lineage, request, script, voice, assets, plan, source, track, preview) {
  const internal = (position, inputId, contentHash) => ({ position, kind: "INTERNAL_ARTIFACT", inputId, contentHash });
  const expected = [
    [script, script.scriptId, [internal(1, request.ideaSelectionId, script.ideaSelectionContentHash)]],
    [voice, voice.voiceTrackId, [internal(1, script.scriptId, script.contentHash)]],
    ...assets.map((asset) => [asset, asset.mediaAssetId, [internal(1, script.scriptId, script.contentHash)]]),
    [plan, plan.compositionPlanId, [internal(1, script.scriptId, script.contentHash), internal(2, voice.voiceTrackId, voice.contentHash), ...assets.map((asset, index) => internal(index + 3, asset.mediaAssetId, asset.contentHash))]],
    [source, source.videoRenderId, [internal(1, plan.compositionPlanId, plan.contentHash)]],
    [track, track.subtitleTrackId, [internal(1, script.scriptId, script.contentHash), internal(2, voice.voiceTrackId, voice.contentHash)]],
    [preview, preview.videoRenderId, [internal(1, plan.compositionPlanId, plan.contentHash), internal(2, source.videoRenderId, source.contentHash), internal(3, track.subtitleTrackId, track.contentHash)]],
  ];
  for (const [artifact, id, inputs] of expected) {
    const persisted = lineage.get(id); verifyScope(persisted, request);
    if (!persisted || persisted.artifactId !== id || persisted.contentHash !== artifact.contentHash || JSON.stringify(persisted.inputs) !== JSON.stringify(inputs)) throw failure("PREVIEW_LINEAGE_MISMATCH", "lineage", "linhagem divergente");
  }
}
function withHash(value, calculate) { value.contentHash = calculate(value); return value; }
function abort(signal) { if (signal?.aborted) throw failure("PREVIEW_CANCELLED", "signal", "operação cancelada"); }
function requireMethods(value, methods, name) { if (!value || methods.some((method) => typeof value[method] !== "function")) throw new TypeError(`${name} obrigatório`); }
function mapError(caught) { if (caught instanceof RealPreviewError) return caught; if (caught?.name === "AbortError" || /CANCELLED$/.test(caught?.code ?? "")) return failure("PREVIEW_CANCELLED", "signal", "operação cancelada", { cause: caught }); if (/^PROVIDER_[A-Z0-9_]+$/.test(caught?.code ?? "") && typeof caught?.field === "string") return failure(caught.code, caught.field, "provider não concluiu a etapa", { cause: caught }); if (caught?.code && caught?.field) return failure("PREVIEW_FAILED", caught.field, "preview não concluído", { cause: caught }); return failure("PREVIEW_FAILED", "preview", "preview não concluído", { cause: caught }); }
function failure(code, field, message, options) { return new RealPreviewError(code, field, message, options); }
