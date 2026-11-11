import { lstat, realpath, open } from 'node:fs/promises';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectMvpPng } from '../../media/infrastructure/physical-media-inspection.js';
import type { LocalImageSource } from '../../media/application/local-flow.port.js';

// Same hash-addressed PNG layout and inspector as Media, without mkdir/put.
export async function inspectQualificationImage(
  source: LocalImageSource | undefined,
) {
  if (!source)
    return { status: 'PENDING' as const, reason: 'LOCAL_IMAGE_REQUIRED' };
  const root = process.env.FFMPEG_MEDIA_ROOT;
  if (!root || !isAbsolute(root) || !/^[a-f0-9]{64}$/.test(source.contentHash))
    return {
      status: 'PENDING' as const,
      reason: 'LOCAL_IMAGE_STORAGE_UNVERIFIED',
    };
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const base = resolve(root);
    const path = join(
      base,
      'sha256',
      source.contentHash.slice(0, 2),
      source.contentHash + '.png',
    );
    for (const target of [base, dirname(path), path])
      if (
        (await realpath(target)) !== target ||
        (await lstat(target)).isSymbolicLink()
      )
        return {
          status: 'INVALID' as const,
          reason: 'LOCAL_IMAGE_PATH_INVALID',
        };
    file = await open(path, 'r');
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 20971520 || stat.size < 1)
      return { status: 'INVALID' as const, reason: 'LOCAL_IMAGE_FILE_INVALID' };
    const bytes = await file.readFile();
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== source.contentHash)
      return {
        status: 'INVALID' as const,
        reason: 'LOCAL_IMAGE_HASH_MISMATCH',
        actualHash,
      };
    const technical = inspectMvpPng(bytes);
    return {
      status: 'VERIFIED' as const,
      contentHash: actualHash,
      sizeBytes: bytes.length,
      technical,
    };
  } catch {
    return {
      status: 'PENDING' as const,
      reason: 'LOCAL_IMAGE_UNAVAILABLE_OR_INVALID',
    };
  } finally {
    await file?.close();
  }
}
