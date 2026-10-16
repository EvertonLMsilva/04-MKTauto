export const FAL_VIDEO_ENDPOINT = 'minimax/h3-max-turbo/image-to-video';
import { falFailure } from '../../finance/domain/fal-errors.js';
// The existing adapter's pinned image-to-video contract. No other model/options are inferred.
export const FAL_VIDEO_MODEL = Object.freeze({
  endpoint: FAL_VIDEO_ENDPOINT,
  duration: 5,
  resolution: '768P',
  prompt_expansion_mode: 'disabled',
  enable_safety_checker: true,
} as const);
export function validateFalVideoModel(input: unknown): typeof FAL_VIDEO_MODEL {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== Object.keys(FAL_VIDEO_MODEL).length ||
    Object.entries(FAL_VIDEO_MODEL).some(
      ([key, value]) =>
        !Object.hasOwn(input, key) ||
        (input as Record<string, unknown>)[key] !== value,
    )
  )
    throw falFailure('PROVIDER_MODEL_UNSUPPORTED');
  return FAL_VIDEO_MODEL;
}
