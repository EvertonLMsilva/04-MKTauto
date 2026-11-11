import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LocalVideoStorage } from './infrastructure/local-video-storage.js';
describe('initial render storage without FFmpeg', () => {
  it('promotes, reuses, rejects tampering and confines cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'render-storage-'));
    try {
      const storage = new LocalVideoStorage({ root, maxBytes: 100 });
      const staging = await storage.createStaging(),
        source = join(staging, 'render.mp4');
      const bytes = Buffer.from('fake render bytes');
      const hash = createHash('sha256').update(bytes).digest('hex');
      await writeFile(source, bytes);
      const promoted = await storage.promote(source, hash);
      expect(promoted.logicalReference).toBe(`render:sha256_${hash}`);
      expect((await storage.promote(source, hash)).reused).toBe(true);
      await storage.cleanup(staging);
      expect(await readFile(promoted.physicalPath)).toEqual(bytes);
      await expect(storage.cleanup(root)).rejects.toMatchObject({
        code: 'COMPOSER_STORAGE_FAILED',
      });
      const second = await storage.createStaging(),
        secondSource = join(second, 'render.mp4');
      await writeFile(secondSource, bytes);
      await writeFile(promoted.physicalPath, 'corrupt');
      await expect(storage.promote(secondSource, hash)).rejects.toMatchObject({
        code: 'COMPOSER_STORAGE_HASH_CONFLICT',
      });
      await expect(
        storage.promote(secondSource, '../bad'),
      ).rejects.toBeInstanceOf(Error);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
