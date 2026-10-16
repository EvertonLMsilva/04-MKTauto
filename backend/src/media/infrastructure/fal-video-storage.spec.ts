import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FalVideoStorage } from './fal-video-storage.js';
for (const hasAudio of [true, false])
  test(`original bytes preserved; observed audio=${hasAudio}`, async (t: any) => {
    const root = await mkdtemp(join(tmpdir(), 'fal-storage-'));
    t.onTestFinished(() => rm(root, { recursive: true, force: true }));
    const calls: any[] = [];
    const executeImpl = async (cmd: any, args: any) => {
      calls.push({ cmd, args });
      return {
        stdout:
          cmd === 'probe'
            ? JSON.stringify({
                streams: [
                  { codec_type: 'video', width: 768, height: 1024 },
                  ...(hasAudio ? [{ codec_type: 'audio' }] : []),
                ],
                format: { format_name: 'mov,mp4', duration: '5.0' },
              })
            : '',
      };
    };
    const storage = new FalVideoStorage(
      {
        root,
        maxBytes: 100,
        ffprobePath: 'probe',
        ffmpegPath: 'decode',
        allowAudio: true,
      },
      { executeImpl },
    );
    const bytes = Buffer.from('audiovisual-original');
    const result = await storage.store(bytes);
    assert.deepEqual(await readFile(result.physicalPath), bytes);
    assert.equal(result.hasAudio, hasAudio);
    assert.ok(
      calls.find((call: any) => call.cmd === 'decode').args.includes('0:a?'),
    );
    const output = {
      contentHash: result.contentHash,
      technicalProperties: Object.fromEntries(
        [
          'format',
          'mimeType',
          'widthPixels',
          'heightPixels',
          'durationMilliseconds',
          'hasAudio',
        ].map((key: any) => [key, result[key as keyof typeof result]]),
      ),
    };
    assert.equal(await storage.verify(output), true);
    assert.equal((await storage.store(bytes)).reused, true);
    await writeFile(result.physicalPath, 'corrupted');
    assert.equal(await storage.verify(output), false);
  });
test('existing Pexels default still rejects audio', async (t: any) => {
  const root = await mkdtemp(join(tmpdir(), 'fal-storage-'));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const storage = new FalVideoStorage(
    { root, maxBytes: 100, ffprobePath: 'probe', ffmpegPath: 'decode' },
    {
      executeImpl: async () => ({
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
        }),
      }),
    },
  );
  await assert.rejects(
    storage.store(Buffer.from('video')),
    (error: any) => error.code === 'PROVIDER_VIDEO_STREAMS_INVALID',
  );
});
