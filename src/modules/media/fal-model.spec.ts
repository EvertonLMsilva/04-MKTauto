import { FAL_VIDEO_MODEL, validateFalVideoModel } from './domain/fal-model.js';
describe('pinned existing fal image-to-video adapter profile', () => {
  it('accepts only the exact model and technical options already used by the adapter', () => {
    expect(validateFalVideoModel({ ...FAL_VIDEO_MODEL })).toEqual(
      FAL_VIDEO_MODEL,
    );
  });
  it.each([
    null,
    {},
    { ...FAL_VIDEO_MODEL, endpoint: 'text-to-video' },
    { ...FAL_VIDEO_MODEL, duration: 10 },
    { ...FAL_VIDEO_MODEL, resolution: '1080P' },
    { ...FAL_VIDEO_MODEL, fps: 30 },
    { ...FAL_VIDEO_MODEL, enable_safety_checker: false },
    { ...FAL_VIDEO_MODEL, prompt_expansion_mode: 'enabled' },
  ])('rejects unsupported or unproven settings %#', (value) => {
    expect(() => validateFalVideoModel(value)).toThrow(
      'PROVIDER_MODEL_UNSUPPORTED',
    );
  });
});
