import { ContractValidationError } from "./domain/contracts.js";
import { validateVideoComposerOutput, validateVideoCompositionRequest } from "./domain/video-composition-contracts.js";
import { dimensionsMatchAspectRatio, VIDEO_RENDER_CONTRACT_VERSION, validateVideoRender } from "./domain/video-render-contracts.js";

export class VideoCompositionError extends Error {
  constructor(code, field, message, options) {
    super(`${code}: ${message}`, options);
    this.name = "VideoCompositionError";
    this.code = code;
    this.field = field;
  }
}

export class VideoCompositionService {
  constructor(repository, composer) {
    const methods = ["getVideoComposition", "getCompositionPlan", "listVideoRendersByCompositionPlan", "registerVideoComposition"];
    if (!repository || methods.some((method) => typeof repository[method] !== "function")) throw new TypeError("repositório de composição de vídeo obrigatório");
    if (!composer || typeof composer.compose !== "function") throw new TypeError("VideoComposer obrigatório");
    this.repository = repository;
    this.composer = composer;
  }

  async compose(value, { signal } = {}) {
    let request;
    try { request = validateVideoCompositionRequest(value); }
    catch (caught) { throw mapError(caught); }

    const prior = this.repository.getVideoComposition(request.videoCompositionRequestId);
    if (prior) {
      if (prior.requestHash !== request.contentHash) throw failure("VIDEO_COMPOSITION_REQUEST_ID_REUSED", "videoCompositionRequestId", "identidade já usada com conteúdo divergente");
      return prior.videoRender;
    }
    if (signal?.aborted) throw failure("COMPOSER_CANCELLED", "signal", "operação cancelada");

    const plan = this.repository.getCompositionPlan(request.compositionPlanId);
    if (!plan) throw failure("COMPOSITION_PLAN_NOT_FOUND", "compositionPlanId", "plano não encontrado");
    if (plan.contentHash !== request.compositionPlanContentHash) throw failure("COMPOSITION_PLAN_CONTENT_HASH_MISMATCH", "compositionPlanContentHash", "hash do plano divergente");
    if (!dimensionsMatchAspectRatio(request.widthPixels, request.heightPixels, plan.outputAspectRatio)) {
      throw failure("VIDEO_DIMENSIONS_ASPECT_RATIO_MISMATCH", "widthPixels", "dimensões divergem da proporção do plano");
    }
    if (this.repository.listVideoRendersByCompositionPlan(plan.compositionPlanId).some(({ revision }) => revision === 1)) {
      throw failure("VIDEO_RENDER_REVISION_CONFLICT", "compositionPlanId", "plano já possui render inicial");
    }

    const input = deepFreeze({
      logicalCallId: request.videoCompositionRequestId,
      compositionPlan: plan,
      output: { containerFormat: request.containerFormat, widthPixels: request.widthPixels, heightPixels: request.heightPixels },
    });
    let rawOutput;
    try { rawOutput = await this.composer.compose(input, { signal }); }
    catch (caught) { throw mapComposerError(caught); }

    try {
      const output = validateVideoComposerOutput(rawOutput);
      verifyOutput(request, plan, output);
      return this.repository.registerVideoComposition({ request, videoRender: buildVideoRender(request, plan, output) });
    } catch (caught) { throw mapError(caught); }
  }
}

function verifyOutput(request, plan, output) {
  if (output.durationMilliseconds !== plan.durationMilliseconds) throw failure("VIDEO_RENDER_DURATION_MISMATCH", "durationMilliseconds", "duração medida diverge do plano");
  if (output.containerFormat !== request.containerFormat) throw failure("VIDEO_RENDER_CONTAINER_MISMATCH", "containerFormat", "container real diverge do solicitado");
  if (output.widthPixels !== request.widthPixels || output.heightPixels !== request.heightPixels) throw failure("VIDEO_RENDER_DIMENSIONS_MISMATCH", "widthPixels", "dimensões reais divergem das solicitadas");
  if (!dimensionsMatchAspectRatio(output.widthPixels, output.heightPixels, plan.outputAspectRatio)) throw failure("VIDEO_DIMENSIONS_ASPECT_RATIO_MISMATCH", "widthPixels", "dimensões reais divergem da proporção");
}

function buildVideoRender(request, plan, output) {
  return validateVideoRender({
    schemaVersion: VIDEO_RENDER_CONTRACT_VERSION,
    videoRenderId: `video_render:${request.videoCompositionRequestId}`,
    pipelineRunId: plan.pipelineRunId, projectId: plan.projectId, projectVersion: plan.projectVersion,
    compositionPlanId: plan.compositionPlanId, compositionPlanContentHash: plan.contentHash,
    outputAspectRatio: plan.outputAspectRatio, durationMilliseconds: output.durationMilliseconds,
    containerFormat: output.containerFormat, widthPixels: output.widthPixels, heightPixels: output.heightPixels,
    contentHash: output.contentHash, logicalReference: output.logicalReference,
    createdAt: request.requestedAt, revision: 1, supersedesVideoRenderId: null,
  });
}

function mapComposerError(caught) {
  if (caught instanceof VideoCompositionError) return caught;
  const publicCodes = new Set(["COMPOSER_CANCELLED", "COMPOSER_TIMEOUT", "COMPOSER_UNAVAILABLE", "COMPOSER_RATE_LIMITED"]);
  if (publicCodes.has(caught?.code)) return failure(caught.code, "composer", "falha sanitizada do composer", { cause: caught });
  return failure("COMPOSER_FAILED", "composer", "não foi possível compor o vídeo", { cause: caught });
}
function mapError(caught) {
  if (caught instanceof VideoCompositionError) return caught;
  if (caught instanceof ContractValidationError) return failure(caught.code, caught.path, "conteúdo inválido", { cause: caught });
  if (typeof caught?.code === "string" && typeof caught?.field === "string") return failure(caught.code, caught.field, "operação não concluída", { cause: caught });
  return failure("VIDEO_COMPOSITION_FAILED", "videoRender", "não foi possível concluir a composição", { cause: caught });
}
function failure(code, field, message, options) { return new VideoCompositionError(code, field, message, options); }
function deepFreeze(value) { const clone = structuredClone(value); freeze(clone); return clone; }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(freeze); return Object.freeze(value); }
