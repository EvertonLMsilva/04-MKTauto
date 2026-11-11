export const ECONOMIC_VIDEO_PROFILE = 'kate-mkt-economic/1.0.0';
export const ECONOMIC_VIDEO_ENDPOINT =
  'fal-ai/ltx-2.3-22b/distilled/image-to-video';
export function economicVideoConfiguration(slot: any): any {
  return {
    resolution: { width: 720, height: 1280 },
    frames: 121,
    fps: 24,
    audio: false,
    multiscale: false,
    parameters: {
      seed: slot,
      scheduler: 'ltx2',
      acceleration: 'none',
      camera_lora: 'none',
      camera_lora_scale: 1,
      negative_prompt: '',
      enable_prompt_expansion: false,
      enable_safety_checker: true,
      video_output_type: 'X264 (.mp4)',
      video_quality: 'high',
      video_write_mode: 'balanced',
      distill_lora_second_pass_scale: 0.5,
      interpolation_direction: 'forward',
      image_strength: 1,
      end_image_strength: 1,
    },
  };
}
export function isEconomicVideoRequest(r: any): any {
  return (
    r?.schemaVersion === 'video-generation-request/3.0.0' &&
    r.profileVersion === ECONOMIC_VIDEO_PROFILE
  );
}
