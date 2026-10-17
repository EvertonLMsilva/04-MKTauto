import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { localFail } from '../domain/alignment-contracts.js';
import { createHash } from 'node:crypto';
// Hash-addressed, append-only files. Failed DB commits may leave reusable orphans.
export class LocalEvidenceStorage {
  constructor(readonly root: string) {
    if (!isAbsolute(root)) localFail('LOCAL_ROOT_INVALID');
    mkdirSync(root, { recursive: true });
    if (realpathSync(root) !== root || lstatSync(root).isSymbolicLink())
      localFail('LOCAL_ROOT_INVALID');
  }
  path(hash: string, extension: string) {
    if (
      !/^[a-f0-9]{64}$/.test(hash) ||
      !['wav', 'json', 'srt', 'ass', 'mp4', 'png'].includes(extension)
    )
      localFail('LOCAL_REFERENCE_INVALID');
    const dir = join(this.root, 'sha256', hash.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    if (
      !realpathSync(dir).startsWith(this.root + sep) ||
      realpathSync(dir) !== dir
    )
      localFail('LOCAL_REFERENCE_INVALID');
    return join(dir, `${hash}.${extension}`);
  }
  read(hash: string, extension: string, max = 524288000): Buffer {
    const path = this.path(hash, extension),
      stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > max ||
      realpathSync(path) !== path
    )
      localFail('LOCAL_FILE_INVALID');
    const bytes = readFileSync(path);
    if (digest(bytes) !== hash) localFail('LOCAL_FILE_HASH_MISMATCH');
    return bytes;
  }
  put(bytes: Buffer, extension: string) {
    const hash = digest(bytes),
      path = this.path(hash, extension);
    try {
      writeFileSync(path, bytes, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    this.read(hash, extension);
    return hash;
  }
}
export function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function documentBytes(value: unknown): Buffer {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, canonical(x)]),
      );
    return v;
  }
  return Buffer.from(JSON.stringify(canonical(value)));
}
