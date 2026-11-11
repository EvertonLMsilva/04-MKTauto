import { historicalResidualPersistence } from './historical-residual-persistence.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './composition-plan-fixture.js';
import { compositionPlanContentHash } from '../../src/modules/media/domain/composition-plan-contracts.js';
import { videoCompositionRequestHash } from '../../src/modules/media/domain/video-composition-contracts.js';
import type { ProcessRunner } from '../../src/modules/media/infrastructure/ffmpeg-process.js';
const { png, sha256, wav } = await import(
  new URL('../../test-support/physical-fixtures.js', import.meta.url).href
);
const { VoiceTrackRepository } = historicalResidualPersistence(
  'voice-track-repository',
);

// Historical observations seed voice fixtures; all composition writes use TS.
export function ffmpegFixture() {
  const f = fixture(true);
  const roots = {
    voiceRoot: join(f.root, 'voice'),
    mediaRoot: join(f.root, 'media'),
    renderRoot: join(f.root, 'render'),
  };
  Object.values(roots).forEach((root) => mkdirSync(root));
  function store(root: string, bytes: Buffer, extension: string): string {
    const hash = sha256(bytes);
    const directory = join(root, 'sha256', hash.slice(0, 2));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${hash}.${extension}`), bytes);
    return hash;
  }
  const voiceHash = store(
    roots.voiceRoot,
    wav({ durationMilliseconds: 10000 }),
    'wav',
  );
  const voice = {
    ...f.voice,
    voiceTrackId: 'voice_native_002',
    audioFormat: 'wav',
    contentHash: voiceHash,
    storageReference: `object:voice/sha256/${voiceHash}`,
    revision: 2,
    supersedesVoiceTrackId: f.voice.voiceTrackId,
  };
  const voiceRepository = new VoiceTrackRepository(f.path);
  try {
    voiceRepository.getScript = () => f.script;
    voiceRepository.registerVoiceTrack(voice);
  } finally {
    voiceRepository.close();
  }
  const imageHash = store(roots.mediaRoot, png(), 'png');
  const videoHash = store(
    roots.mediaRoot,
    Buffer.from('local-authorized-video-fixture'),
    'mp4',
  );
  const assets = [
    {
      ...f.assets[0],
      mediaAssetId: 'media_native_001',
      contentHash: imageHash,
      mediaReference: `media:sha256_${imageHash}`,
      technicalProperties: {
        format: 'png',
        widthPixels: 90,
        heightPixels: 160,
        durationMilliseconds: null,
      },
      revision: 2,
      supersedesMediaAssetId: f.assets[0].mediaAssetId,
    },
    {
      ...f.assets[1],
      schemaVersion: 'media-asset/2.0.0',
      source: null,
      mediaAssetId: 'media_native_002',
      contentHash: videoHash,
      mediaReference: `media:sha256_${videoHash}`,
      technicalProperties: {
        format: 'mp4',
        mimeType: 'video/mp4',
        widthPixels: 720,
        heightPixels: 1280,
        durationMilliseconds: 6000,
        hasAudio: false,
      },
      revision: 2,
      supersedesMediaAssetId: f.assets[1].mediaAssetId,
    },
  ];
  const mediaRepository = f.store.open();
  try {
    assets.forEach((asset) => mediaRepository.registerMediaAsset(asset));
  } finally {
    mediaRepository.close();
  }
  const plan = {
    ...f.value,
    voiceTrackId: voice.voiceTrackId,
    voiceTrackContentHash: voiceHash,
    segments: f.value.segments.map((segment: any, index: number) => ({
      ...segment,
      mediaAssetId: assets[index].mediaAssetId,
      mediaAssetContentHash: assets[index].contentHash,
    })),
  };
  plan.contentHash = compositionPlanContentHash(plan);
  f.media.registerCompositionPlan(plan);
  const env = {
    FFMPEG_PATH: process.execPath,
    FFPROBE_PATH: process.execPath,
    FFMPEG_VOICE_ROOT: roots.voiceRoot,
    FFMPEG_MEDIA_ROOT: roots.mediaRoot,
    FFMPEG_RENDER_ROOT: roots.renderRoot,
  };
  const calls: { command: string; args: string[] }[] = [];
  const runner: ProcessRunner = async (command, args) => {
    calls.push({ command, args });
    if (args.includes('-filter_complex_script'))
      writeFileSync(args.at(-1)!, Buffer.from('native-composition-output'));
    const inputVideo = args.at(-1)!.includes('media-002');
    return {
      stdout: args.includes('-show_format')
        ? JSON.stringify(
            inputVideo
              ? {
                  streams: [
                    {
                      codec_type: 'video',
                      width: 720,
                      height: 1280,
                      duration: '6.000',
                    },
                  ],
                  format: { format_name: 'mov,mp4', duration: '6.000' },
                }
              : {
                  streams: [
                    {
                      index: 0,
                      codec_name: 'h264',
                      profile: 'High',
                      codec_type: 'video',
                      width: 1080,
                      height: 1920,
                      pix_fmt: 'yuv420p',
                      level: 40,
                      r_frame_rate: '30/1',
                      avg_frame_rate: '30/1',
                      duration: '9.999',
                    },
                    {
                      index: 1,
                      codec_name: 'aac',
                      profile: 'LC',
                      codec_type: 'audio',
                      sample_rate: '48000',
                      channels: 1,
                      duration: '10.000',
                    },
                  ],
                  format: { format_name: 'mov,mp4', duration: '10.000' },
                },
          )
        : '',
    };
  };
  function request(id = 'native_001') {
    const value = {
      schemaVersion: 'video-composition-request/1.0.0',
      videoCompositionRequestId: id,
      compositionPlanId: plan.compositionPlanId,
      compositionPlanContentHash: plan.contentHash,
      containerFormat: 'mp4',
      widthPixels: 1080,
      heightPixels: 1920,
      requestedAt: plan.createdAt,
    };
    return { ...value, contentHash: videoCompositionRequestHash(value) };
  }
  return { ...f, ...roots, plan, env, runner, calls, request };
}
