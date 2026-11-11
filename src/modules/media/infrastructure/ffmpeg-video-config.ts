import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { ffmpegFailure } from './ffmpeg-video-error.js';

export const FFMPEG_VIDEO_POLICY_VERSION = 'ffmpeg-video-policy/1.0.0';

const POLICY = Object.freeze({
  widthPixels: 1080,
  heightPixels: 1920,
  frameRate: 30,
  videoCodec: 'libx264',
  videoProfile: 'high',
  videoLevel: '4.0',
  crf: 20,
  preset: 'medium',
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  audioProfile: 'aac_low',
  audioBitrate: '192k',
  audioSampleRate: 48000,
  audioChannels: 1,
  gopSize: 60,
  maxSegments: 60,
  maxDurationMilliseconds: 180000,
  maxVoiceBytes: 20971520,
  maxImageBytes: 20971520,
  maxTotalInputBytes: 536870912,
  maxOutputBytes: 524288000,
  timeoutMs: 300000,
  maxLogBytes: 65536,
});

export type FfmpegVideoConfig = Readonly<
  typeof POLICY & {
    policyVersion: string;
    ffmpegPath: string;
    ffprobePath: string;
    voiceRoot: string;
    mediaRoot: string;
    renderRoot: string;
    stagingRoot: string;
    maxVideoBytes?: number;
    publicConfiguration: Readonly<Record<string, string | number>>;
    configurationHash?: string;
  }
>;

export function loadFfmpegVideoConfig(
  env: NodeJS.ProcessEnv = process.env,
): FfmpegVideoConfig {
  if (env.FFMPEG_VIDEO_STAGING_ROOT !== undefined)
    invalid('FFMPEG_VIDEO_STAGING_ROOT');
  exactOptional(env.FFMPEG_VIDEO_FRAME_RATE, '30', 'FFMPEG_VIDEO_FRAME_RATE');
  exactOptional(
    env.FFMPEG_VIDEO_POLICY_VERSION,
    FFMPEG_VIDEO_POLICY_VERSION,
    'FFMPEG_VIDEO_POLICY_VERSION',
  );
  const ffmpegPath = resolve(required(env.FFMPEG_PATH, 'FFMPEG_PATH'));
  const ffprobePath = resolve(required(env.FFPROBE_PATH, 'FFPROBE_PATH'));
  const voiceRoot = resolve(
    required(env.FFMPEG_VOICE_ROOT, 'FFMPEG_VOICE_ROOT'),
  );
  const mediaRoot = resolve(
    required(env.FFMPEG_MEDIA_ROOT, 'FFMPEG_MEDIA_ROOT'),
  );
  const renderRoot = resolve(
    required(env.FFMPEG_RENDER_ROOT, 'FFMPEG_RENDER_ROOT'),
  );
  const stagingRoot = join(renderRoot, '.staging');
  const publicConfiguration = deepFreeze({
    policyVersion: FFMPEG_VIDEO_POLICY_VERSION,
    containerFormat: 'mp4',
    outputAspectRatio: '9:16',
    ...POLICY,
  });
  const configurationHash = createHash('sha256')
    .update(stableJson(publicConfiguration))
    .digest('hex');
  return deepFreeze({
    policyVersion: FFMPEG_VIDEO_POLICY_VERSION,
    ffmpegPath,
    ffprobePath,
    voiceRoot,
    mediaRoot,
    renderRoot,
    stagingRoot,
    ...POLICY,
    publicConfiguration,
    configurationHash,
  });
}

function required(value: any, field: any): any {
  if (typeof value !== 'string' || value.trim() === '')
    throw ffmpegFailure(
      'FFMPEG_CONFIGURATION_MISSING',
      field,
      'configuração obrigatória ausente',
    );
  return value.trim();
}
function exactOptional(value: any, expected: any, field: any): any {
  if (value !== undefined && value !== expected) invalid(field);
}
function invalid(field: any): any {
  throw ffmpegFailure(
    'FFMPEG_CONFIGURATION_INVALID',
    field,
    'configuração fora da política versionada',
  );
}
function stableJson(value: any): any {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key: any) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function deepFreeze(value: any): any {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
