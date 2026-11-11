import { ContractValidationError } from '../../project/domain/project.errors.js';
import type {
  InitialRenderRepository,
  VideoComposer,
} from './video-composition.port.js';
import {
  validateVideoComposerOutput,
  validateVideoCompositionRequest,
} from '../domain/video-composition-contracts.js';
import {
  dimensionsMatchAspectRatio,
  VIDEO_RENDER_CONTRACT_VERSION,
  validateVideoRender,
} from '../domain/video-render-contracts.js';
export class VideoCompositionError extends Error {
  [key: string]: any;
  constructor(code: any, field: any, message: any, options?: any) {
    super(`${code}: ${message}`, options);
    this.name = 'VideoCompositionError';
    this.code = code;
    this.field = field;
  }
}
export class VideoCompositionService {
  constructor(
    private readonly repository: InitialRenderRepository,
    private readonly composer: VideoComposer,
  ) {
    const methods: (keyof InitialRenderRepository)[] = [
      'getVideoComposition',
      'getCompositionPlan',
      'listVideoRendersByCompositionPlan',
      'registerVideoComposition',
    ];
    if (
      !repository ||
      methods.some((method) => typeof repository[method] !== 'function')
    )
      throw new TypeError('repositório de composição de vídeo obrigatório');
    if (!composer || typeof composer.compose !== 'function')
      throw new TypeError('VideoComposer obrigatório');
  }
  async compose(value: any, { signal }: any = {}) {
    let request: any;
    try {
      request = validateVideoCompositionRequest(value);
    } catch (caught: any) {
      throw mapError(caught);
    }
    const prior: any = this.repository.getVideoComposition(
      request.videoCompositionRequestId,
    );
    if (prior) {
      if (prior.requestHash !== request.contentHash)
        throw failure(
          'VIDEO_COMPOSITION_REQUEST_ID_REUSED',
          'videoCompositionRequestId',
          'identidade já usada com conteúdo divergente',
        );
      return prior.videoRender;
    }
    if (signal?.aborted)
      throw failure('COMPOSER_CANCELLED', 'signal', 'operação cancelada');
    const plan: any = this.repository.getCompositionPlan(
      request.compositionPlanId,
    );
    if (!plan)
      throw failure(
        'COMPOSITION_PLAN_NOT_FOUND',
        'compositionPlanId',
        'plano não encontrado',
      );
    if (plan.contentHash !== request.compositionPlanContentHash)
      throw failure(
        'COMPOSITION_PLAN_CONTENT_HASH_MISMATCH',
        'compositionPlanContentHash',
        'hash do plano divergente',
      );
    if (
      !dimensionsMatchAspectRatio(
        request.widthPixels,
        request.heightPixels,
        plan.outputAspectRatio,
      )
    ) {
      throw failure(
        'VIDEO_DIMENSIONS_ASPECT_RATIO_MISMATCH',
        'widthPixels',
        'dimensões divergem da proporção do plano',
      );
    }
    if (
      this.repository
        .listVideoRendersByCompositionPlan(plan.compositionPlanId)
        .some(({ revision }: any) => revision === 1)
    ) {
      throw failure(
        'VIDEO_RENDER_REVISION_CONFLICT',
        'compositionPlanId',
        'plano já possui render inicial',
      );
    }
    const input: any = deepFreeze({
      logicalCallId: request.videoCompositionRequestId,
      compositionPlan: plan,
      output: {
        containerFormat: request.containerFormat,
        widthPixels: request.widthPixels,
        heightPixels: request.heightPixels,
      },
    });
    let rawOutput: any;
    try {
      rawOutput = await this.composer.compose(input, { signal });
    } catch (caught: any) {
      throw mapComposerError(caught);
    }
    try {
      const output: any = validateVideoComposerOutput(rawOutput);
      verifyOutput(request, plan, output);
      return this.repository.registerVideoComposition({
        request,
        videoRender: buildVideoRender(request, plan, output),
      });
    } catch (caught: any) {
      throw mapError(caught);
    }
  }
}
function verifyOutput(request: any, plan: any, output: any): any {
  if (output.durationMilliseconds !== plan.durationMilliseconds)
    throw failure(
      'VIDEO_RENDER_DURATION_MISMATCH',
      'durationMilliseconds',
      'duração medida diverge do plano',
    );
  if (output.containerFormat !== request.containerFormat)
    throw failure(
      'VIDEO_RENDER_CONTAINER_MISMATCH',
      'containerFormat',
      'container real diverge do solicitado',
    );
  if (
    output.widthPixels !== request.widthPixels ||
    output.heightPixels !== request.heightPixels
  )
    throw failure(
      'VIDEO_RENDER_DIMENSIONS_MISMATCH',
      'widthPixels',
      'dimensões reais divergem das solicitadas',
    );
  if (
    !dimensionsMatchAspectRatio(
      output.widthPixels,
      output.heightPixels,
      plan.outputAspectRatio,
    )
  )
    throw failure(
      'VIDEO_DIMENSIONS_ASPECT_RATIO_MISMATCH',
      'widthPixels',
      'dimensões reais divergem da proporção',
    );
}
function buildVideoRender(request: any, plan: any, output: any): any {
  return validateVideoRender({
    schemaVersion: VIDEO_RENDER_CONTRACT_VERSION,
    videoRenderId: `video_render:${request.videoCompositionRequestId}`,
    pipelineRunId: plan.pipelineRunId,
    projectId: plan.projectId,
    projectVersion: plan.projectVersion,
    compositionPlanId: plan.compositionPlanId,
    compositionPlanContentHash: plan.contentHash,
    outputAspectRatio: plan.outputAspectRatio,
    durationMilliseconds: output.durationMilliseconds,
    containerFormat: output.containerFormat,
    widthPixels: output.widthPixels,
    heightPixels: output.heightPixels,
    contentHash: output.contentHash,
    logicalReference: output.logicalReference,
    createdAt: request.requestedAt,
    revision: 1,
    supersedesVideoRenderId: null,
  });
}
function mapComposerError(caught: any): any {
  if (caught instanceof VideoCompositionError) return caught;
  const publicCodes: any = new Set([
    'COMPOSER_CANCELLED',
    'COMPOSER_TIMEOUT',
    'COMPOSER_UNAVAILABLE',
    'COMPOSER_RATE_LIMITED',
  ]);
  if (publicCodes.has(caught?.code))
    return failure(caught.code, 'composer', 'falha sanitizada do composer', {
      cause: caught,
    });
  return failure(
    'COMPOSER_FAILED',
    'composer',
    'não foi possível compor o vídeo',
    { cause: caught },
  );
}
function mapError(caught: any): any {
  if (caught instanceof VideoCompositionError) return caught;
  if (caught instanceof ContractValidationError)
    return failure(caught.code, caught.path, 'conteúdo inválido', {
      cause: caught,
    });
  if (typeof caught?.code === 'string' && typeof caught?.field === 'string')
    return failure(caught.code, caught.field, 'operação não concluída', {
      cause: caught,
    });
  return failure(
    'VIDEO_COMPOSITION_FAILED',
    'videoRender',
    'não foi possível concluir a composição',
    { cause: caught },
  );
}
function failure(code: any, field: any, message: any, options?: any): any {
  return new VideoCompositionError(code, field, message, options);
}
function deepFreeze(value: any): any {
  const clone: any = structuredClone(value);
  freeze(clone);
  return clone;
}
function freeze(value: any): any {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
