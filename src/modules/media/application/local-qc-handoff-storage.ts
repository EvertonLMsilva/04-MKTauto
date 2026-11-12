import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LocalEvidenceStorage } from '../infrastructure/local-evidence-storage.js';
/** Reuse CAS byte/hash validation without creating missing directories on reads. */
export class LocalQcReadStorage extends LocalEvidenceStorage {
  constructor(root: string) {
    if (!lstatSync(root).isDirectory() || realpathSync(root) !== resolve(root))
      throw Error('LOCAL_ROOT_INVALID');
    super(root);
  }
  override path(hash: string, extension: string) {
    if (
      !/^[a-f0-9]{64}$/.test(hash) ||
      !['wav', 'json', 'srt', 'ass', 'mp4', 'png'].includes(extension)
    )
      throw Error('LOCAL_REFERENCE_INVALID');
    const directory = join(this.root, 'sha256', hash.slice(0, 2));
    if (
      !lstatSync(directory).isDirectory() ||
      realpathSync(directory) !== directory
    )
      throw Error('LOCAL_REFERENCE_INVALID');
    return join(directory, `${hash}.${extension}`);
  }
}
