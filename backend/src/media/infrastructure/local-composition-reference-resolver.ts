import { lstat, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { ffmpegFailure } from './ffmpeg-video-error.js';
import { parseMediaIdentity } from '../domain/media-identity.js';
import { hashFile } from './local-video-storage.js';

const VOICE_REFERENCE = /^object:voice\/sha256\/([a-f0-9]{64})$/;

export class LocalCompositionReferenceResolver {
  private readonly voiceRoot: string;
  private readonly mediaRoot: string;

  constructor({
    voiceRoot,
    mediaRoot,
  }: {
    voiceRoot: string;
    mediaRoot: string;
  }) {
    this.voiceRoot = requiredRoot(voiceRoot, 'voiceRoot');
    this.mediaRoot = requiredRoot(mediaRoot, 'mediaRoot');
  }

  async resolveVoice(reference: string): Promise<string> {
    return this.#resolve(reference, VOICE_REFERENCE, this.voiceRoot, 'wav');
  }
  async resolveMedia(
    reference: string,
    extension: string = 'png',
  ): Promise<string> {
    if (!['png', 'mp4'].includes(extension))
      throw ffmpegFailure(
        'COMPOSER_REFERENCE_INVALID',
        'reference',
        'extensão não autorizada',
      );
    let identity;
    try {
      identity = parseMediaIdentity(reference);
    } catch {
      throw ffmpegFailure(
        'COMPOSER_REFERENCE_INVALID',
        'reference',
        'referência lógica não reconhecida',
      );
    }
    return safeFile(
      join(
        this.mediaRoot,
        'sha256',
        identity.contentHash.slice(0, 2),
        `${identity.contentHash}.${extension}`,
      ),
      this.mediaRoot,
    );
  }

  /** Explicit historical read only. Current composition never falls back to an old layout. */
  async resolveHistoricalVideo(
    reference: string,
    contentHash: string,
    maxBytes = 524288000,
  ): Promise<string> {
    const identity = parseMediaIdentity(reference, {
      expectedHash: contentHash,
      allowLegacy: true,
    });
    const canonical = join(
      this.mediaRoot,
      'sha256',
      contentHash.slice(0, 2),
      `${contentHash}.mp4`,
    );
    const candidates =
      identity.format === 'LEGACY_LTX_VIDEO'
        ? [join(this.mediaRoot, 'sha256', `${contentHash}.mp4`), canonical]
        : [canonical];
    for (let i = 0; i < candidates.length; i++) {
      let path;
      try {
        path = await safeFile(candidates[i], this.mediaRoot);
      } catch (error) {
        if (
          i < candidates.length - 1 &&
          (error as { code?: string }).code === 'COMPOSER_INPUT_NOT_FOUND'
        )
          continue;
        throw error;
      }
      if ((await hashFile(path, maxBytes)) !== contentHash)
        throw ffmpegFailure(
          'COMPOSER_MEDIA_HASH_MISMATCH',
          'reference',
          'hash físico divergente',
        );
      return path;
    }
    throw ffmpegFailure(
      'COMPOSER_INPUT_NOT_FOUND',
      'reference',
      'arquivo físico não encontrado',
    );
  }

  async #resolve(
    reference: string,
    pattern: RegExp,
    root: string,
    extension: string,
  ): Promise<string> {
    const match =
      typeof reference === 'string' ? pattern.exec(reference) : null;
    if (!match)
      throw ffmpegFailure(
        'COMPOSER_REFERENCE_INVALID',
        'reference',
        'referência lógica não reconhecida',
      );
    const hash = match[1];
    return safeFile(
      join(root, 'sha256', hash.slice(0, 2), `${hash}.${extension}`),
      root,
    );
  }
}

async function safeFile(candidate: string, root: string): Promise<string> {
  let rootReal;
  let candidateReal;
  let entry;
  try {
    [rootReal, entry, candidateReal] = await Promise.all([
      realpath(root),
      lstat(candidate),
      realpath(candidate),
    ]);
  } catch (caught: any) {
    if (caught?.code === 'ENOENT')
      throw ffmpegFailure(
        'COMPOSER_INPUT_NOT_FOUND',
        'reference',
        'arquivo físico não encontrado',
        { cause: caught },
      );
    throw ffmpegFailure(
      'COMPOSER_REFERENCE_INVALID',
      'reference',
      'referência física inválida',
      { cause: caught },
    );
  }
  if (entry.isSymbolicLink())
    throw ffmpegFailure(
      'COMPOSER_REFERENCE_OUTSIDE_ROOT',
      'reference',
      'link simbólico não autorizado',
    );
  if (!entry.isFile())
    throw ffmpegFailure(
      'COMPOSER_REFERENCE_INVALID',
      'reference',
      'entrada não é arquivo regular',
    );
  const normalizedRoot = resolve(rootReal);
  const normalized = resolve(candidateReal);
  if (
    normalized !== normalizedRoot &&
    !normalized.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw ffmpegFailure(
      'COMPOSER_REFERENCE_OUTSIDE_ROOT',
      'reference',
      'arquivo fora do root autorizado',
    );
  }
  return normalized;
}
function requiredRoot(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw ffmpegFailure(
      'FFMPEG_CONFIGURATION_MISSING',
      field,
      'root obrigatório',
    );
  return resolve(value);
}
