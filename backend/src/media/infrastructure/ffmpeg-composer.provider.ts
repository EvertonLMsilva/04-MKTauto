import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { VideoComposer } from '../application/video-composition.port.js';
import type { MediaPersistence } from './media.persistence.js';
import { FfmpegVideoComposer } from './ffmpeg-video-composer.js';
import { loadFfmpegVideoConfig } from './ffmpeg-video-config.js';
import type { ProcessRunner } from './ffmpeg-process.js';
import { ffmpegFailure } from './ffmpeg-video-error.js';

// Filesystem checks only: activation never invokes FFmpeg or opens the database.
export async function createVideoComposer(
  store: MediaPersistence,
  env: NodeJS.ProcessEnv = process.env,
  processRunner?: ProcessRunner,
): Promise<VideoComposer> {
  try {
    const config = loadFfmpegVideoConfig(env);
    for (const path of [config.ffmpegPath, config.ffprobePath]) {
      if (
        !isAbsolute(path) ||
        /\.(?:cmd|bat|ps1)$/i.test(path) ||
        !(await lstat(path)).isFile()
      )
        throw ffmpegFailure(
          'FFMPEG_CONFIGURATION_INVALID',
          'binary',
          'binário inválido',
        );
      await access(
        path,
        process.platform === 'win32' ? constants.R_OK : constants.X_OK,
      );
    }
    for (const path of [
      config.voiceRoot,
      config.mediaRoot,
      config.renderRoot,
    ]) {
      if (!(await lstat(path)).isDirectory())
        throw ffmpegFailure(
          'FFMPEG_CONFIGURATION_INVALID',
          'root',
          'diretório inválido',
        );
      await access(
        path,
        constants.R_OK | (path === config.renderRoot ? constants.W_OK : 0),
      );
    }
    try {
      const staging = join(await realpath(config.renderRoot), '.staging');
      if (
        !(await lstat(staging)).isDirectory() ||
        (await lstat(staging)).isSymbolicLink()
      )
        throw ffmpegFailure(
          'FFMPEG_CONFIGURATION_INVALID',
          'staging',
          'staging inválido',
        );
      await access(staging, constants.W_OK);
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') throw caught;
    }
    return new FfmpegVideoComposer(config, {
      processRunner,
      artifactCatalog: {
        getScript(id) {
          const repository = store.openComposition(true);
          try {
            return repository.getScript(id);
          } finally {
            repository.close();
          }
        },
        getVoiceTrack(id) {
          const repository = store.openComposition(true);
          try {
            return repository.getVoiceTrack(id);
          } finally {
            repository.close();
          }
        },
        getMediaAsset(id) {
          const repository = store.open(true);
          try {
            return repository.getMediaAsset(id);
          } finally {
            repository.close();
          }
        },
      },
    });
  } catch (cause) {
    return {
      async compose() {
        throw ffmpegFailure(
          'COMPOSER_UNAVAILABLE',
          'composer',
          'configuração operacional indisponível',
          { cause },
        );
      },
    };
  }
}
