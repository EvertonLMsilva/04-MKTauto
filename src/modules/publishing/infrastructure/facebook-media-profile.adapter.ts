import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { assertFacebookReelsProfile } from '../domain/facebook-reels-profile.js';
import { socialFail } from '../domain/social-publication-contracts.js';
export async function inspectFacebookMp4(bytes: Buffer) {
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp')
    socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
  const root = await mkdtemp(join(tmpdir(), 'facebook-profile-'));
  try {
    const file = join(root, 'video.mp4');
    await writeFile(file, bytes);
    const { stdout } = await promisify(execFile)(
      'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
      { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    assertFacebookReelsProfile(JSON.parse(stdout));
    return {
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      result: 'PASS',
      policyVersion: 'facebook-reels-profile/1.0.0',
    };
  } catch {
    socialFail('SOCIAL_MEDIA_INCOMPATIBLE');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
