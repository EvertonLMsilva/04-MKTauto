import { socialFail } from './social-publication-contracts.js';
export function assertFacebookReelsProfile(probe: any): void {
  const video = probe.streams?.find((s: any) => s.codec_type === 'video');
  const audio = probe.streams?.find((s: any) => s.codec_type === 'audio');
  const duration = Number(probe.format?.duration),
    [n, d] = String(video?.avg_frame_rate).split('/').map(Number),
    fps = n / d;
  if (
    !probe.format?.format_name?.split(',').includes('mp4') ||
    !video ||
    video.codec_name !== 'h264' ||
    (audio && audio.codec_name !== 'aac') ||
    !Number.isInteger(video.width) ||
    !Number.isInteger(video.height) ||
    video.width < 540 ||
    video.height < 960 ||
    Math.abs(video.width / video.height - 9 / 16) > 0.005 ||
    !Number.isFinite(fps) ||
    fps < 23 ||
    !Number.isFinite(duration) ||
    duration < 4 ||
    duration > 60 ||
    Number(video.tags?.rotate ?? 0) !== 0 ||
    video.side_data_list?.some((x: any) => Number(x.rotation ?? 0) !== 0)
  )
    socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
}
