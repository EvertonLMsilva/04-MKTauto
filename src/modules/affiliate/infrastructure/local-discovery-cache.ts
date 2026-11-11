import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { catalogError, errorCode } from './discovery-error.js';
import type { CatalogMetadata } from '../application/ports/discovery.port.js';
interface CacheMetadata extends CatalogMetadata {
  scope: string;
}
interface Snapshot {
  path: string;
  metadata: CacheMetadata;
}
interface Acquisition {
  key: string;
  scope: string;
  sourceUpdatedAt?: string | null;
  produce: (destination: string) => Promise<void>;
  validate: (path: string) => Promise<number>;
}
interface CacheOptions {
  root: string;
  clock: () => Date;
  isFresh: (metadata: CacheMetadata, now: Date) => boolean;
}

const inflight = new Map<string, Promise<Snapshot>>();
export function dailyCatalogPolicy({ timeZone }: { timeZone: string }) {
  if (typeof timeZone !== 'string' || !timeZone)
    throw new TypeError('timeZone obrigatório');
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (metadata: CatalogMetadata, now: Date) =>
    format.format(new Date(metadata.obtainedAt)) === format.format(now);
}

export async function fileDigest(path: string) {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    sizeBytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

export class LocalCatalogCache {
  readonly root: string;
  readonly clock: () => Date;
  readonly isFresh: CacheOptions['isFresh'];
  constructor({ root, clock, isFresh }: CacheOptions) {
    if (
      typeof root !== 'string' ||
      !root ||
      typeof clock !== 'function' ||
      typeof isFresh !== 'function'
    ) {
      throw new TypeError('root, clock e isFresh obrigatórios');
    }
    this.root = resolve(root);
    this.clock = clock;
    this.isFresh = isFresh;
  }

  async acquire({
    key,
    scope,
    sourceUpdatedAt,
    produce,
    validate,
  }: Acquisition): Promise<Snapshot> {
    if (
      typeof key !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(key) ||
      typeof scope !== 'string' ||
      typeof produce !== 'function' ||
      typeof validate !== 'function'
    )
      throw new TypeError('configuração de cache inválida');
    const directory = join(this.root, key);
    if (inflight.has(directory)) {
      await inflight.get(directory);
      return this.acquire({ key, scope, sourceUpdatedAt, produce, validate });
    }
    const operation = this.#acquire(directory, {
      scope,
      sourceUpdatedAt,
      produce,
      validate,
    });
    inflight.set(directory, operation);
    try {
      return await operation;
    } finally {
      inflight.delete(directory);
    }
  }

  async #acquire(
    directory: string,
    { scope, sourceUpdatedAt, produce, validate }: Omit<Acquisition, 'key'>,
  ): Promise<Snapshot> {
    await mkdir(directory, { recursive: true });
    const currentPath = join(directory, 'current.json');
    let prior = false;
    try {
      await stat(currentPath);
      prior = true;
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    const existing = await this.#readCurrent(directory, scope);
    if (existing) return existing;
    const lockPath = join(directory, 'refresh.lock');
    const staging = join(directory, `staging-${randomUUID()}`);
    const pointerTemp = join(directory, `pointer-${randomUUID()}.tmp`);
    let lock: Awaited<ReturnType<typeof open>> | undefined,
      promoted: string | null = null;
    try {
      try {
        lock = await open(lockPath, 'wx', 0o600);
      } catch (error) {
        if (errorCode(error) === 'EEXIST')
          throw catalogError('EXTERNAL_CATALOG_BUSY', error);
        throw error;
      }
      // Another process may have promoted after our first read, before lock acquisition.
      const refreshed = await this.#readCurrent(directory, scope);
      if (refreshed) return refreshed;
      await mkdir(staging);
      const path = join(staging, 'data.csv');
      await produce(path);
      const recordCount = await validate(path);
      const digest = await fileDigest(path);
      // Flush data before making the immutable generation visible.
      const handle = await open(path, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      const obtainedAt = this.clock().toISOString();
      const metadata = {
        scope,
        obtainedAt,
        sourceUpdatedAt: sourceUpdatedAt ?? null,
        ...digest,
        recordCount,
        validationState: 'VALID',
      };
      await writeFile(
        join(staging, 'metadata.json'),
        JSON.stringify(metadata),
        { flag: 'wx', mode: 0o600, flush: true },
      );
      const generation = `snapshot-${randomUUID()}`;
      promoted = join(directory, generation);
      await rename(staging, promoted);
      await writeFile(pointerTemp, JSON.stringify({ generation }), {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
      await rename(pointerTemp, currentPath);
      promoted = null;
      return {
        path: join(directory, generation, 'data.csv'),
        metadata: Object.freeze(metadata),
      };
    } catch (cause) {
      throw catalogError(
        prior ? 'EXTERNAL_CATALOG_STALE' : 'EXTERNAL_CATALOG_REFRESH_FAILED',
        cause,
      );
    } finally {
      await rm(staging, { recursive: true, force: true });
      await rm(pointerTemp, { force: true });
      if (promoted) await rm(promoted, { recursive: true, force: true });
      if (lock) {
        await lock.close();
        await rm(lockPath, { force: true });
      }
    }
  }

  async #readCurrent(
    directory: string,
    scope: string,
  ): Promise<Snapshot | null> {
    let generation: string, metadata: CacheMetadata;
    try {
      ({ generation } = JSON.parse(
        await readFile(join(directory, 'current.json'), 'utf8'),
      ));
      if (
        typeof generation !== 'string' ||
        !/^snapshot-[a-f0-9-]+$/.test(generation)
      )
        return null;
      metadata = JSON.parse(
        await readFile(join(directory, generation, 'metadata.json'), 'utf8'),
      );
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || error instanceof SyntaxError)
        return null;
      throw error;
    }
    if (
      !metadata ||
      metadata.scope !== scope ||
      metadata.validationState !== 'VALID' ||
      typeof metadata.obtainedAt !== 'string' ||
      !Number.isFinite(Date.parse(metadata.obtainedAt)) ||
      !Number.isSafeInteger(metadata.sizeBytes) ||
      metadata.sizeBytes < 0 ||
      !Number.isSafeInteger(metadata.recordCount) ||
      metadata.recordCount < 0 ||
      !this.isFresh(metadata, this.clock())
    )
      return null;
    const path = join(directory, generation, 'data.csv');
    let actual;
    try {
      actual = await fileDigest(path);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
    if (
      actual.sha256 !== metadata.sha256 ||
      actual.sizeBytes !== metadata.sizeBytes
    )
      return null;
    return { path, metadata: Object.freeze(metadata) };
  }
}
