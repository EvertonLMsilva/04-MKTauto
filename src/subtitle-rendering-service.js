import { ContractValidationError } from "./domain/contracts.js";
import { SUBTITLE_RENDER_DURATION_TOLERANCE_MILLISECONDS, validateSubtitleRenderRequest, validateSubtitleRenderResult } from "./domain/subtitle-render-contracts.js";
import { VIDEO_RENDER_CONTRACT_VERSION, validateVideoRender } from "./domain/video-render-contracts.js";

export class SubtitleRenderingError extends Error {
  constructor(code, field, message, options) { super(`${code}: ${message}`, options); this.name = "SubtitleRenderingError"; this.code = code; this.field = field; }
}

export class SubtitleRenderingService {
  constructor(repository, renderer) {
    const methods = ["getSubtitleRendering", "getRun", "getCompositionPlan", "getVideoRender", "getSubtitleTrack", "getArtifact", "registerSubtitleRendering"];
    if (!repository || methods.some((method) => typeof repository[method] !== "function")) throw new TypeError("repositório de renderização de legenda obrigatório");
    if (!renderer || typeof renderer.render !== "function") throw new TypeError("SubtitleRenderer obrigatório");
    this.repository = repository; this.renderer = renderer;
  }

  async render(value, { signal } = {}) {
    let request; try { request = validateSubtitleRenderRequest(value); } catch (caught) { throw mapError(caught); }
    const prior = this.repository.getSubtitleRendering(request.subtitleRenderRequestId);
    if (prior) {
      if (prior.requestHash !== request.contentHash) throw failure("SUBTITLE_RENDER_REQUEST_ID_REUSED", "subtitleRenderRequestId", "identidade já usada com conteúdo divergente");
      return prior.videoRender;
    }
    if (signal?.aborted) throw failure("SUBTITLE_RENDER_CANCELLED", "signal", "operação cancelada");
    const chain = this.#loadAndVerify(request);
    let raw; try { raw = await this.renderer.render({ request, videoRender: chain.video, subtitleTrack: chain.track }, { signal }); }
    catch (caught) { throw mapRendererError(caught); }
    try {
      const result = validateSubtitleRenderResult(raw); verifyResult(request, chain.video, result);
      const videoRender = validateVideoRender({
        schemaVersion: VIDEO_RENDER_CONTRACT_VERSION, videoRenderId: `video_render:subtitle:${request.subtitleRenderRequestId.slice("subtitle_render:".length)}`,
        pipelineRunId: request.pipelineRunId, projectId: request.projectId, projectVersion: request.projectVersion,
        compositionPlanId: request.compositionPlanId, compositionPlanContentHash: request.compositionPlanContentHash,
        outputAspectRatio: result.outputAspectRatio, durationMilliseconds: chain.video.durationMilliseconds,
        containerFormat: result.containerFormat, widthPixels: result.widthPixels, heightPixels: result.heightPixels,
        contentHash: result.contentHash, logicalReference: result.logicalReference, createdAt: request.requestedAt,
        revision: 2, supersedesVideoRenderId: request.videoRenderId,
      });
      return this.repository.registerSubtitleRendering({ request, result, videoRender });
    } catch (caught) { throw mapError(caught); }
  }

  #loadAndVerify(request) {
    const run = this.repository.getRun(request.pipelineRunId); if (!run) throw failure("PIPELINE_RUN_NOT_FOUND", "pipelineRunId", "execução não encontrada");
    const plan = this.repository.getCompositionPlan(request.compositionPlanId); if (!plan) throw failure("COMPOSITION_PLAN_NOT_FOUND", "compositionPlanId", "plano não encontrado");
    const video = this.repository.getVideoRender(request.videoRenderId); if (!video) throw failure("VIDEO_RENDER_NOT_FOUND", "videoRenderId", "render não encontrado");
    const track = this.repository.getSubtitleTrack(request.subtitleTrackId); if (!track) throw failure("SUBTITLE_TRACK_NOT_FOUND", "subtitleTrackId", "legenda não encontrada");
    for (const item of [run, plan, video, track]) for (const field of ["pipelineRunId", "projectId", "projectVersion"]) if (item[field] !== request[field]) throw failure("SUBTITLE_RENDER_SCOPE_MISMATCH", field, "artefato fora do escopo");
    if (plan.contentHash !== request.compositionPlanContentHash || video.compositionPlanId !== plan.compositionPlanId || video.compositionPlanContentHash !== plan.contentHash) throw failure("COMPOSITION_PLAN_CONTENT_HASH_MISMATCH", "compositionPlanContentHash", "plano divergente");
    if (video.contentHash !== request.videoRenderContentHash) throw failure("VIDEO_RENDER_CONTENT_HASH_MISMATCH", "videoRenderContentHash", "hash do vídeo divergente");
    if (track.contentHash !== request.subtitleTrackContentHash) throw failure("SUBTITLE_TRACK_CONTENT_HASH_MISMATCH", "subtitleTrackContentHash", "hash da legenda divergente");
    for (const field of ["scriptId", "scriptContentHash", "voiceTrackId", "voiceTrackContentHash"]) if (plan[field] !== request[field] || track[field] !== request[field]) throw failure("SUBTITLE_RENDER_ANCESTRY_MISMATCH", field, "ascendência divergente");
    if (video.revision !== 1 || video.supersedesVideoRenderId !== null || video.containerFormat !== "mp4" || video.widthPixels !== 1080 || video.heightPixels !== 1920 || video.outputAspectRatio !== "9:16") throw failure("SUBTITLE_RENDER_VIDEO_POLICY_MISMATCH", "videoRenderId", "vídeo fora da política");
    if (track.stylePolicyVersion !== request.stylePolicyVersion) throw failure("SUBTITLE_RENDER_STYLE_POLICY_MISMATCH", "stylePolicyVersion", "política divergente");
    if (track.durationMilliseconds !== video.durationMilliseconds || plan.durationMilliseconds !== video.durationMilliseconds) throw failure("SUBTITLE_RENDER_DURATION_MISMATCH", "durationMilliseconds", "duração divergente");
    const videoLineage = this.repository.getArtifact(video.videoRenderId); const trackLineage = this.repository.getArtifact(track.subtitleTrackId);
    if (!videoLineage || JSON.stringify(videoLineage.inputs) !== JSON.stringify([{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: plan.compositionPlanId, contentHash: plan.contentHash }])
      || !trackLineage || JSON.stringify(trackLineage.inputs) !== JSON.stringify([{ position: 1, kind: "INTERNAL_ARTIFACT", inputId: request.scriptId, contentHash: request.scriptContentHash }, { position: 2, kind: "INTERNAL_ARTIFACT", inputId: request.voiceTrackId, contentHash: request.voiceTrackContentHash }])) throw failure("SUBTITLE_RENDER_LINEAGE_MISMATCH", "lineage", "linhagem divergente");
    return { video, track };
  }
}

function verifyResult(request, source, result) {
  if (result.subtitleRenderRequestId !== request.subtitleRenderRequestId || result.requestContentHash !== request.contentHash) throw failure("SUBTITLE_RENDER_RESULT_BINDING_MISMATCH", "requestContentHash", "resultado divergente");
  if (Math.abs(result.durationMilliseconds - source.durationMilliseconds) > SUBTITLE_RENDER_DURATION_TOLERANCE_MILLISECONDS) throw failure("SUBTITLE_RENDER_DURATION_MISMATCH", "durationMilliseconds", "duração fora da tolerância");
  for (const field of ["containerFormat", "outputAspectRatio", "widthPixels", "heightPixels"]) if (result[field] !== source[field]) throw failure("SUBTITLE_RENDER_OUTPUT_POLICY_MISMATCH", field, "saída divergente");
}
function mapRendererError(caught) { const allowed = new Set(["SUBTITLE_RENDER_CANCELLED", "SUBTITLE_RENDER_TIMEOUT", "SUBTITLE_RENDER_UNAVAILABLE"]); return allowed.has(caught?.code) ? failure(caught.code, "renderer", "falha sanitizada do renderer", { cause: caught }) : failure("SUBTITLE_RENDER_FAILED", "renderer", "renderização não concluída", { cause: caught }); }
function mapError(caught) { if (caught instanceof SubtitleRenderingError) return caught; if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "conteúdo inválido", { cause: caught }); if (caught?.code && caught?.field) return failure(caught.code, caught.field, "operação não concluída", { cause: caught }); return failure("SUBTITLE_RENDER_FAILED", "videoRender", "operação não concluída", { cause: caught }); }
function failure(code, field, message, options) { return new SubtitleRenderingError(code, field, message, options); }
