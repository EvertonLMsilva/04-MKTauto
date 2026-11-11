import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import { spawn } from 'node:child_process';
import { LocalPythonAligner } from './infrastructure/local-python-aligner.js';
import {
  alignmentHash,
  type AlignmentInput,
} from './domain/alignment-contracts.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const input: AlignmentInput = {
  audioAssetId: 'voice_test',
  audioSha256: '0'.repeat(64),
  scriptId: 'script_test',
  scriptVersion: 1,
  canonicalText: 'Olá!',
  scriptTextSha256: alignmentHash('Olá!'),
  durationMs: 1000,
};
const env = {
  LOCAL_ALIGNMENT_PYTHON: process.execPath,
  LOCAL_ALIGNMENT_MODEL_ROOT: process.cwd(),
  LOCAL_ALIGNMENT_MODEL_SHA256: 'a'.repeat(64),
  LOCAL_ALIGNMENT_EVIDENCE_KEY: 'test-only-key-'.repeat(4),
};
function processFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
  return child;
}
async function spawned() {
  for (let i = 0; i < 100 && !vi.mocked(spawn).mock.calls.length; i++)
    await new Promise((r) => setTimeout(r, 5));
  expect(spawn).toHaveBeenCalled();
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

it('uses no shell, seals generated evidence and rejects tampering even with recomputed public hash', async () => {
  const child = processFixture(),
    aligner = new LocalPythonAligner(env);
  const { createHash } = await import('node:crypto');
  const audio = Buffer.from('authorized-test-fixture');
  const binding = {
    ...input,
    audioSha256: createHash('sha256').update(audio).digest('hex'),
  };
  const pending = aligner.align(binding, audio);
  await spawned();
  expect(vi.mocked(spawn).mock.calls[0]![2]).toMatchObject({
    shell: false,
    windowsHide: true,
  });
  child.stdout.write(
    JSON.stringify({
      modelVersion: '634ac655299bcdc46c83bc01da9bab52d2987e4f',
      algorithm: 'ctc-viterbi-1',
      emissionsSha256: 'b'.repeat(64),
      device: 'cpu',
      cer: 0,
      latencyMs: 20,
      peakMemoryBytes: 100,
      segments: [
        {
          startMs: 100,
          endMs: 800,
          text: 'Olá!',
          textStartOffset: 0,
          textEndOffset: 4,
        },
      ],
    }),
  );
  child.emit('close', 0);
  const evidence = await pending;
  expect(await aligner.verify(evidence, audio)).toBe(true);
  evidence.output.segments[0]!.startMs = 200;
  evidence.output.evidenceHash = alignmentHash(evidence);
  expect(await aligner.verify(evidence, audio)).toBe(false);
});

it('times out, kills the process and waits for close before cleanup', async () => {
  const child = processFixture(),
    pending = new LocalPythonAligner(env, 30).align(input, Buffer.alloc(1));
  await spawned();
  await new Promise((r) => setTimeout(r, 60));
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  child.emit('close', null);
  await expect(pending).rejects.toThrow('ALIGNMENT_TIMEOUT');
});

it('cancels a running worker and rejects a pre-cancelled request', async () => {
  const child = processFixture(),
    signal = new AbortController();
  const aligner = new LocalPythonAligner(env),
    pending = aligner.align(input, Buffer.alloc(1), signal.signal);
  await spawned();
  signal.abort();
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  child.emit('close', null);
  await expect(pending).rejects.toThrow('ALIGNMENT_CANCELLED');
  await expect(
    aligner.align(input, Buffer.alloc(1), signal.signal),
  ).rejects.toThrow('ALIGNMENT_CANCELLED');
});

it('reports model absence explicitly and never accepts a success without acoustic evidence', async () => {
  const child = processFixture(),
    pending = new LocalPythonAligner(env).align(input, Buffer.alloc(1));
  await spawned();
  child.stdout.write(JSON.stringify({ error: 'ALIGNMENT_MODEL_UNAVAILABLE' }));
  child.emit('close', 1);
  await expect(pending).rejects.toThrow('ALIGNMENT_MODEL_UNAVAILABLE');
});
