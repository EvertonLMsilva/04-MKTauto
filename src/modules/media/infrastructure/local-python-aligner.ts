import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AudioAligner,
  AlignmentProvenanceVerifier,
} from '../application/alignment.port.js';
import {
  alignmentHash,
  localFail,
  validateAlignment,
  type AlignmentEvidence,
  type AlignmentInput,
} from '../domain/alignment-contracts.js';

const REVISION = '634ac655299bcdc46c83bc01da9bab52d2987e4f';
const ALGORITHM = 'ctc-viterbi-1';
const MAX_OUTPUT = 1024 * 1024;

function receipt(evidence: AlignmentEvidence, key: string) {
  const copy = structuredClone(evidence);
  delete copy.parameters.receipt;
  return createHmac('sha256', key).update(alignmentHash(copy)).digest('hex');
}

export class LocalPythonAligner
  implements AudioAligner, AlignmentProvenanceVerifier
{
  readonly identity: string;
  private active = false;
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly timeoutMs = 180000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000)
      localFail('ALIGNMENT_CONFIGURATION_REQUIRED');
    this.identity = alignmentHash({
      revision: REVISION,
      algorithm: ALGORITHM,
      manifest: env.LOCAL_ALIGNMENT_MODEL_SHA256 ?? '',
      device: env.LOCAL_ALIGNMENT_DEVICE ?? 'cpu',
      implementation: 'local-python/1',
      ...(env.LOCAL_ALIGNMENT_TEXT_POLICY
        ? { textPolicy: env.LOCAL_ALIGNMENT_TEXT_POLICY }
        : {}),
      timeoutMs,
      maxMemoryBytes: 6 * 1024 ** 3,
      maxAudioBytes: 20971520,
      maxDurationMs: 60000,
      maxTextUnits: 6000,
      sampleRate: 16000,
      keyId: alignmentHash(env.LOCAL_ALIGNMENT_EVIDENCE_KEY ?? ''),
    });
  }
  async verify(evidence: AlignmentEvidence, audio: Buffer): Promise<boolean> {
    const key = this.env.LOCAL_ALIGNMENT_EVIDENCE_KEY;
    if (
      !key ||
      key.length < 32 ||
      evidence.output.provider !== 'local-ctc' ||
      evidence.output.modelVersion !== REVISION ||
      evidence.parameters.configuration !== this.identity ||
      !/^[a-f0-9]{64}$/.test(String(evidence.parameters.receipt))
    )
      return false;
    const { createHash } = await import('node:crypto');
    if (
      createHash('sha256').update(audio).digest('hex') !==
      evidence.input.audioSha256
    )
      return false;
    return timingSafeEqual(
      Buffer.from(String(evidence.parameters.receipt), 'hex'),
      Buffer.from(receipt(evidence, key), 'hex'),
    );
  }
  async align(
    input: AlignmentInput,
    audio: Buffer,
    signal?: AbortSignal,
  ): Promise<AlignmentEvidence> {
    const python = this.env.LOCAL_ALIGNMENT_PYTHON;
    const model = this.env.LOCAL_ALIGNMENT_MODEL_ROOT;
    const manifest = this.env.LOCAL_ALIGNMENT_MODEL_SHA256;
    const key = this.env.LOCAL_ALIGNMENT_EVIDENCE_KEY;
    const textPolicy = this.env.LOCAL_ALIGNMENT_TEXT_POLICY ?? 'strict/1';
    if (!['strict/1', 'pt-br-written/1'].includes(textPolicy))
      localFail('ALIGNMENT_CONFIGURATION_REQUIRED');
    if (
      !python ||
      !model ||
      !isAbsolute(python) ||
      !isAbsolute(model) ||
      !/^[a-f0-9]{64}$/.test(manifest ?? '') ||
      !key ||
      key.length < 32
    )
      localFail('ALIGNMENT_CONFIGURATION_REQUIRED');
    if (
      audio.length > 20971520 ||
      input.durationMs > 60000 ||
      input.canonicalText.length > 6000
    )
      localFail('ALIGNMENT_INPUT_LIMIT');
    const device = this.env.LOCAL_ALIGNMENT_DEVICE ?? 'cpu';
    if (!['cpu', 'auto'].includes(device))
      localFail('ALIGNMENT_CONFIGURATION_REQUIRED');
    if (signal?.aborted) localFail('ALIGNMENT_CANCELLED');
    if (this.active) localFail('ALIGNMENT_BUSY_CONFLICT');
    this.active = true;
    let root: string | undefined;
    try {
      root = await mkdtemp(join(tmpdir(), 'mktauto-align-'));
      const audioPath = join(root, 'audio.wav'),
        request = join(root, 'request.json');
      await writeFile(audioPath, audio, { mode: 0o600 });
      await writeFile(
        request,
        JSON.stringify({ input, audioPath, device, textPolicy }),
        {
          mode: 0o600,
        },
      );
      // Works in both src/ and dist/: deployment includes python/.
      const script = resolve(
        fileURLToPath(
          new URL('../../../../python/alignment/align.py', import.meta.url),
        ),
      );
      const result = await this.process(
        python,
        [script, request, model, manifest!],
        signal,
      );
      const evidence: AlignmentEvidence = {
        input,
        provenance: 'FORCED_ALIGNMENT',
        parameters: {
          algorithm: ALGORITHM,
          ...(textPolicy !== 'strict/1' ? { textPolicy } : {}),
          configuration: this.identity,
          modelManifestSha256: manifest!,
          emissionsSha256: result.emissionsSha256,
          device: result.device,
          cer: result.cer,
          latencyMs: result.latencyMs,
          peakMemoryBytes: result.peakMemoryBytes,
          receipt: '',
        },
        output: {
          alignmentId:
            'align_' + alignmentHash({ input, configuration: this.identity }),
          provider: 'local-ctc',
          modelVersion: REVISION,
          audioSha256: input.audioSha256,
          scriptTextSha256: input.scriptTextSha256,
          segments: result.segments,
          evidenceHash: '',
          status: 'VERIFIED',
        },
      };
      evidence.parameters.receipt = receipt(evidence, key);
      evidence.output.evidenceHash = alignmentHash(evidence);
      return validateAlignment(evidence);
    } finally {
      try {
        if (root) await rm(root, { recursive: true, force: true });
      } finally {
        this.active = false;
      }
    }
  }
  private process(
    python: string,
    args: string[],
    signal?: AbortSignal,
  ): Promise<{
    segments: AlignmentEvidence['output']['segments'];
    emissionsSha256: string;
    device: string;
    cer: number;
    latencyMs: number;
    peakMemoryBytes: number;
  }> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(python, ['-B', ...args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([name]) =>
              /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|HOME|COMSPEC)$/i.test(
                name,
              ),
            ),
          ),
          HF_HUB_OFFLINE: '1',
          TRANSFORMERS_OFFLINE: '1',
          HF_HUB_DISABLE_TELEMETRY: '1',
          PYTHONUTF8: '1',
          OMP_NUM_THREADS: '2',
          OPENBLAS_NUM_THREADS: '2',
        },
      });
      const stdout: Buffer[] = [];
      let bytes = 0,
        failure = '';
      const stop = (code: string) => {
        failure ||= code;
        child.kill('SIGKILL');
      };
      const cancel = () => stop('ALIGNMENT_CANCELLED');
      const timer = setTimeout(() => stop('ALIGNMENT_TIMEOUT'), this.timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT) stop('ALIGNMENT_OUTPUT_LIMIT');
        else stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT) stop('ALIGNMENT_OUTPUT_LIMIT');
      });
      child.on('error', () => {
        failure ||= 'ALIGNMENT_PYTHON_UNAVAILABLE';
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        try {
          if (failure) localFail(failure);
          const result = JSON.parse(Buffer.concat(stdout).toString('utf8'));
          if (code !== 0)
            localFail(
              /^ALIGNMENT_[A-Z_]+$/.test(result.error)
                ? result.error
                : 'ALIGNMENT_PROCESS_FAILED',
            );
          if (
            result.modelVersion !== REVISION ||
            result.algorithm !== ALGORITHM ||
            !/^[a-f0-9]{64}$/.test(result.emissionsSha256) ||
            !['cpu', 'cuda'].includes(result.device) ||
            typeof result.cer !== 'number' ||
            result.cer < 0 ||
            result.cer > 0.25 ||
            !Number.isSafeInteger(result.latencyMs) ||
            result.latencyMs < 0 ||
            !Number.isSafeInteger(result.peakMemoryBytes) ||
            result.peakMemoryBytes < 1
          )
            localFail('ALIGNMENT_OUTPUT_INVALID');
          resolveResult(result);
        } catch (error) {
          reject(
            error instanceof Error && 'code' in error
              ? error
              : Object.assign(new Error('ALIGNMENT_PROCESS_FAILED'), {
                  code: 'ALIGNMENT_PROCESS_FAILED',
                }),
          );
        }
      });
    });
  }
}
