import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
} from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { RenderStorage } from '../application/video-composition.port.js';

function failure(code: string, field: string, cause?: unknown): Error {
  return Object.assign(
    new Error(`${code}: armazenamento de render inválido`, { cause }),
    { code, field },
  );
}
function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}
export async function hashFile(
  path: string,
  maxBytes = Number.MAX_SAFE_INTEGER,
): Promise<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes)
    throw failure('COMPOSER_OUTPUT_INVALID', 'output');
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) throw failure('COMPOSER_OUTPUT_INVALID', 'output');
    hash.update(chunk);
  }
  if (size !== info.size) throw failure('COMPOSER_OUTPUT_INVALID', 'output');
  return hash.digest('hex');
}
export class LocalVideoStorage implements RenderStorage {
  private readonly root: string;
  private readonly maxBytes: number;
  constructor({ root, maxBytes }: { root: string; maxBytes: number }) {
    if (typeof root !== 'string' || !root.length)
      throw failure('FFMPEG_CONFIGURATION_MISSING', 'renderRoot');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
      throw failure('FFMPEG_CONFIGURATION_INVALID', 'maxOutputBytes');
    this.root = resolve(root);
    this.maxBytes = maxBytes;
  }
  async createStaging(): Promise<string> {
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root),
      parent = join(root, '.staging');
    try {
      if ((await lstat(parent)).isSymbolicLink())
        throw failure('FFMPEG_CONFIGURATION_INVALID', 'stagingRoot');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(parent, { recursive: true });
    const actual = await realpath(parent);
    if (
      !inside(root, actual) ||
      (await stat(root)).dev !== (await stat(actual)).dev
    )
      throw failure('FFMPEG_CONFIGURATION_INVALID', 'stagingRoot');
    return mkdtemp(join(actual, 'compose-'));
  }
  async promote(
    sourcePath: string,
    contentHash: string,
    {
      validateExisting,
    }: { validateExisting?: (path: string) => Promise<void> } = {},
  ) {
    if (!/^[a-f0-9]{64}$/.test(contentHash))
      throw failure('COMPOSER_OUTPUT_INVALID', 'contentHash');
    const root = await realpath(this.root),
      source = await realpath(sourcePath);
    if (!inside(join(root, '.staging'), source))
      throw failure('COMPOSER_STORAGE_FAILED', 'storage');
    if ((await hashFile(source, this.maxBytes)) !== contentHash)
      throw failure('COMPOSER_OUTPUT_INVALID', 'contentHash');
    const directory = join(root, 'sha256', contentHash.slice(0, 2));
    await mkdir(directory, { recursive: true });
    if (!inside(root, await realpath(directory)))
      throw failure('COMPOSER_STORAGE_FAILED', 'storage');
    const physicalPath = join(directory, `${contentHash}.mp4`);
    let reused = false;
    try {
      await link(source, physicalPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EXDEV')
        throw failure('FFMPEG_CONFIGURATION_INVALID', 'stagingRoot', error);
      if (code !== 'EEXIST')
        throw failure('COMPOSER_STORAGE_FAILED', 'storage', error);
      if (
        (await lstat(physicalPath)).isSymbolicLink() ||
        (await hashFile(physicalPath, this.maxBytes)) !== contentHash
      )
        throw failure('COMPOSER_STORAGE_HASH_CONFLICT', 'storage');
      if (validateExisting) await validateExisting(physicalPath);
      reused = true;
    }
    return Object.freeze({
      logicalReference: `render:sha256_${contentHash}`,
      physicalPath,
      reused,
    });
  }
  async cleanup(stagingPath: string): Promise<void> {
    const root = await realpath(this.root),
      candidate = resolve(stagingPath),
      stagingRoot = join(root, '.staging');
    if (candidate === stagingRoot || !inside(stagingRoot, candidate))
      throw failure('COMPOSER_STORAGE_FAILED', 'staging');
    await rm(candidate, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  }
}
