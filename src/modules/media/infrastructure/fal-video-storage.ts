import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, link, open, readFile, unlink, lstat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  canonicalMediaReference,
  parseMediaIdentity,
  assertNewPhysicalMediaIdentity,
} from '../domain/media-identity.js';
import { LocalCompositionReferenceResolver } from './local-composition-reference-resolver.js';
class PexelsVideoAdapterError extends Error {
  code: string;
  field: string;
  constructor(
    code: string,
    field: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.field = field;
  }
}
const execute = promisify(execFile);
export class FalVideoStorage {
  root: any;
  maxBytes: any;
  ffmpegPath: any;
  ffprobePath: any;
  execute: any;
  allowAudio: any;
  constructor(
    { root, maxBytes, ffmpegPath, ffprobePath, allowAudio = false }: any,
    { executeImpl = execute }: any = {},
  ) {
    this.root = resolve(root);
    this.maxBytes = maxBytes;
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.execute = executeImpl;
    this.allowAudio = allowAudio;
  }
  async store(value: any, { signal }: any = {}) {
    const bytes = Buffer.from(value ?? []);
    if (bytes.length === 0)
      fail('PROVIDER_INVALID_VIDEO', 'video', 'vídeo vazio');
    if (bytes.length > this.maxBytes)
      fail('PROVIDER_VIDEO_TOO_LARGE', 'video', 'vídeo excede o limite');
    const staging = join(this.root, '.staging');
    await this.prepareDirectory(['.staging']);
    const temporaryPath = inside(
      this.root,
      join(staging, `${randomUUID()}.mp4`),
    );
    let handle;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      const properties = await inspectVideo(
        temporaryPath,
        this.ffprobePath,
        this.ffmpegPath,
        signal,
        this.execute,
        this.allowAudio,
      );
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const directory = inside(
        this.root,
        join(this.root, 'sha256', contentHash.slice(0, 2)),
      );
      await this.prepareDirectory(['sha256', contentHash.slice(0, 2)]);
      const physicalPath = inside(
        this.root,
        join(directory, `${contentHash}.mp4`),
      );
      let reused = false;
      try {
        await link(temporaryPath, physicalPath);
      } catch (caught: any) {
        if (caught?.code !== 'EEXIST') throw caught;
        if ((await lstat(physicalPath)).isSymbolicLink())
          fail(
            'PROVIDER_STORAGE_HASH_CONFLICT',
            'storage',
            'link simbólico não autorizado',
          );
        const existing = await readFile(physicalPath);
        if (createHash('sha256').update(existing).digest('hex') !== contentHash)
          fail(
            'PROVIDER_STORAGE_HASH_CONFLICT',
            'storage',
            'objeto existente divergente',
          );
        await inspectVideo(
          physicalPath,
          this.ffprobePath,
          this.ffmpegPath,
          signal,
          this.execute,
          this.allowAudio,
        );
        reused = true;
      }
      return Object.freeze({
        contentHash,
        mediaReference: canonicalMediaReference(contentHash),
        physicalPath,
        reused,
        ...properties,
      });
    } catch (caught: any) {
      if (caught instanceof PexelsVideoAdapterError) throw caught;
      fail(
        'PROVIDER_STORAGE_FAILED',
        'storage',
        'não foi possível armazenar o vídeo',
        { cause: caught },
      );
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporaryPath).catch(() => {});
    }
  }
  private async prepareDirectory(parts: string[]) {
    await mkdir(this.root, { recursive: true });
    let path = this.root;
    for (let i = -1; i < parts.length; i++) {
      if (i >= 0) {
        path = join(path, parts[i]);
        try {
          await mkdir(path);
        } catch (error) {
          if ((error as { code?: string }).code !== 'EEXIST') throw error;
        }
      }
      const entry = await lstat(path);
      if (entry.isSymbolicLink() || !entry.isDirectory())
        fail(
          'PROVIDER_STORAGE_FAILED',
          'storage',
          'diretório físico não autorizado',
        );
    }
  }
  /** Copy verified bytes only. No MediaAsset, Finance operation, QC or approval is created. */
  async materializeHistorical(
    reference: string,
    {
      legacyRoot,
      contentHash,
      signal,
    }: { legacyRoot: string; contentHash: string; signal?: AbortSignal },
  ) {
    parseMediaIdentity(reference, {
      expectedHash: contentHash,
      allowLegacy: true,
    });
    if (signal?.aborted)
      fail('PROVIDER_CANCELLED', 'signal', 'operação cancelada');
    const resolver = new LocalCompositionReferenceResolver({
      voiceRoot: legacyRoot,
      mediaRoot: legacyRoot,
    });
    const path = await resolver.resolveHistoricalVideo(
      reference,
      contentHash,
      this.maxBytes,
    );
    const bytes = await readFile(path, { signal });
    // Verify again on the exact buffer passed to storage; never trust the reference alone.
    if (createHash('sha256').update(bytes).digest('hex') !== contentHash)
      fail(
        'PROVIDER_STORAGE_HASH_CONFLICT',
        'storage',
        'origem física divergente',
      );
    return this.store(bytes, { signal });
  }
  async verify(output: any, { signal }: any = {}) {
    try {
      const reference = canonicalMediaReference(output?.contentHash);
      if (typeof output.mediaReference === 'string')
        assertNewPhysicalMediaIdentity(
          output.mediaReference,
          output.contentHash,
        );
      const resolver = new LocalCompositionReferenceResolver({
        voiceRoot: this.root,
        mediaRoot: this.root,
      });
      const path = await resolver.resolveMedia(reference, 'mp4');
      const bytes = await readFile(path);
      if (
        createHash('sha256').update(bytes).digest('hex') !== output.contentHash
      )
        return false;
      const actual = await inspectVideo(
        path,
        this.ffprobePath,
        this.ffmpegPath,
        signal,
        this.execute,
        this.allowAudio,
      );
      return Object.entries(actual).every(
        ([key, value]: any) => output.technicalProperties[key] === value,
      );
    } catch {
      return false;
    }
  }
}
async function inspectVideo(
  path: any,
  ffprobePath: any,
  ffmpegPath: any,
  signal: any,
  executeImpl: any,
  allowAudio: any = false,
) {
  let body;
  try {
    const result = await executeImpl(
      ffprobePath,
      [
        '-v',
        'error',
        '-of',
        'json',
        '-show_entries',
        'format=format_name,duration,size:stream=codec_type,width,height,duration',
        '-show_streams',
        '-show_format',
        path,
      ],
      { signal, windowsHide: true, maxBuffer: 1048576 },
    );
    body = JSON.parse(result.stdout);
  } catch (caught: any) {
    fail('PROVIDER_INVALID_VIDEO', 'video', 'FFprobe rejeitou o vídeo', {
      cause: caught,
    });
  }
  const streams = Array.isArray(body?.streams) ? body.streams : [];
  const videos = streams.filter(
    ({ codec_type: type }: any) => type === 'video',
  );
  const hasAudio = streams.some(
    ({ codec_type: type }: any) => type === 'audio',
  );
  if (videos.length !== 1 || (!allowAudio && hasAudio))
    fail(
      'PROVIDER_VIDEO_STREAMS_INVALID',
      'video',
      'streams incompatíveis com a política de armazenamento',
    );
  const formatNames = String(body?.format?.format_name ?? '').split(',');
  const durationMilliseconds = Math.round(
    Number(body?.format?.duration) * 1000,
  );
  const widthPixels = videos[0].width;
  const heightPixels = videos[0].height;
  if (
    !formatNames.includes('mp4') ||
    !Number.isSafeInteger(durationMilliseconds) ||
    durationMilliseconds < 1 ||
    !Number.isSafeInteger(widthPixels) ||
    !Number.isSafeInteger(heightPixels)
  )
    fail('PROVIDER_INVALID_VIDEO', 'video', 'propriedades físicas inválidas');
  try {
    await executeImpl(
      ffmpegPath,
      [
        '-v',
        'error',
        '-nostdin',
        '-i',
        path,
        '-map',
        '0:v:0',
        ...(allowAudio ? ['-map', '0:a?'] : []),
        '-f',
        'null',
        '-',
      ],
      { signal, windowsHide: true, maxBuffer: 1048576 },
    );
  } catch (caught: any) {
    fail('PROVIDER_VIDEO_DECODE_FAILED', 'video', 'decode integral falhou', {
      cause: caught,
    });
  }
  return Object.freeze({
    format: 'mp4',
    mimeType: 'video/mp4',
    widthPixels,
    heightPixels,
    durationMilliseconds,
    hasAudio,
  });
}
function inside(root: any, candidate: any) {
  const normalizedRoot = resolve(root);
  const normalized = resolve(candidate);
  if (
    normalized !== normalizedRoot &&
    !normalized.startsWith(`${normalizedRoot}${sep}`)
  )
    fail('PROVIDER_STORAGE_FAILED', 'storage', 'localização inválida');
  return normalized;
}
function fail(code: any, field: any, message: any, options?: any): never {
  throw new PexelsVideoAdapterError(code, field, message, options);
}
