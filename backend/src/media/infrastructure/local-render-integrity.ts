import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
function distributionFail(code: string): never {
  throw Object.assign(new Error(code), { code });
}
// Read-only evidence adapter; no network, rendering or publication capability.
export class LocalRenderIntegrity {
  private readonly renderRoot: string | null;
  constructor(renderRoot: string | null) {
    this.renderRoot = renderRoot ? realpathSync(resolve(renderRoot)) : null;
  }
  verifyMedia(reference: string): string {
    if (!this.renderRoot) distributionFail('DISTRIBUTION_RENDER_ROOT_REQUIRED');
    const match: any = /^render:sha256_([a-f0-9]{64})$/.exec(reference);
    if (!match) distributionFail('DISTRIBUTION_MEDIA_REFERENCE_INVALID');
    const hash: any = match[1],
      path: any = join(
        this.renderRoot,
        'sha256',
        hash.slice(0, 2),
        `${hash}.mp4`,
      ),
      stat: any = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 524288000 ||
      realpathSync(path) !== path
    )
      distributionFail('DISTRIBUTION_MEDIA_REFERENCE_INVALID');
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  }
}
