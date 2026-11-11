import { runProcess } from './infrastructure/ffmpeg-process.js';
it('preserves UTF-8 across native process stream chunk boundaries', async () => {
  const result = await runProcess(
    process.execPath,
    [
      '-e',
      `
    const value = Buffer.from('Conheça — narração');
    let i = 0;
    const next = () => { if (i === value.length) return;
      const chunk = value.subarray(i, ++i);
      process.stdout.write(chunk); process.stderr.write(chunk); setTimeout(next, 10); };
    next();
  `,
    ],
    { timeoutMs: 10000, maxLogBytes: 1024 },
  );
  expect(result.stdout).toBe('Conheça — narração');
  expect(result.stderr).toBe('Conheça — narração');
});

it('keeps native diagnostics bounded and removes terminal control bytes', async () => {
  const result = await runProcess(
    process.execPath,
    [
      '-e',
      `
    process.stdout.write('x'.repeat(100));
    process.stdout.write(Buffer.from([0, 1]));
    process.stdout.write('final');
  `,
    ],
    { timeoutMs: 10000, maxLogBytes: 16 },
  );
  expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(16);
  expect(result.stdout).toMatch(/final$/);
  expect(result.stdout).not.toContain(String.fromCharCode(0));
  expect(result.stdout).not.toContain(String.fromCharCode(1));
});
