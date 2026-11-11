import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { ffmpegFailure } from './ffmpeg-video-error.js';

export const FFMPEG_PROCESS_RUNNER = Symbol('FFMPEG_PROCESS_RUNNER');
// Terminal control bytes are intentionally removed from process diagnostics.
// oxlint-disable-next-line no-control-regex
const CONTROL_BYTES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

export interface ProcessOptions {
  stdin?: string;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxLogBytes: number;
  shell?: false;
  windowsHide?: true;
  outputPath?: string;
  maxOutputBytes?: number;
}
export type ProcessRunner = (
  command: string,
  args: string[],
  options: ProcessOptions,
) => Promise<{ stdout: string; stderr?: string }>;

// Settle only after close, so staging cleanup never races a live writer.
export const runProcess: ProcessRunner = (command, args, options) => {
  if (
    options.stdin !== undefined &&
    (typeof options.stdin !== 'string' ||
      Buffer.byteLength(options.stdin) > 65536)
  )
    return Promise.reject(
      ffmpegFailure(
        'FFMPEG_CONFIGURATION_INVALID',
        'stdin',
        'entrada inválida',
      ),
    );
  if (options.signal?.aborted)
    return Promise.reject(
      ffmpegFailure('COMPOSER_CANCELLED', 'signal', 'operação cancelada'),
    );
  if (
    ![options.timeoutMs, options.maxLogBytes].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    )
  )
    return Promise.reject(
      ffmpegFailure(
        'FFMPEG_CONFIGURATION_INVALID',
        'process',
        'limites inválidos',
      ),
    );
  if (
    options.outputPath &&
    (!Number.isSafeInteger(options.maxOutputBytes) ||
      options.maxOutputBytes! < 1)
  )
    return Promise.reject(
      ffmpegFailure(
        'FFMPEG_CONFIGURATION_INVALID',
        'process',
        'limite de saída inválido',
      ),
    );
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    let reason: string | undefined;
    let processError: Error | undefined;
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    const stop = (code: string) => {
      reason ??= code;
      child?.kill('SIGKILL');
    };
    const cancel = () => stop('COMPOSER_CANCELLED');
    const timer = setTimeout(() => stop('COMPOSER_TIMEOUT'), options.timeoutMs);
    let monitor: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      if (monitor) clearInterval(monitor);
      options.signal?.removeEventListener('abort', cancel);
    };
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        stdio: [
          options.stdin === undefined ? 'ignore' : 'pipe',
          'pipe',
          'pipe',
        ],
      });
    } catch (caught) {
      cleanup();
      reject(caught);
      return;
    }
    if (options.stdin !== undefined) {
      child.stdin?.on('error', (caught) => {
        processError = caught;
      });
      child.stdin?.end(options.stdin);
    }
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const collect = (current: Buffer, chunk: Buffer): Buffer => {
      return Buffer.concat([
        current,
        chunk.subarray(-options.maxLogBytes),
      ]).subarray(-options.maxLogBytes);
    };
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout = collect(stdout, chunk);
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr = collect(stderr, chunk);
    });
    child.on('error', (caught) => {
      processError = caught;
    });
    if (options.outputPath && options.maxOutputBytes) {
      monitor = setInterval(() => {
        void stat(options.outputPath!)
          .then((info) => {
            if (info.size > options.maxOutputBytes!)
              stop('COMPOSER_OUTPUT_INVALID');
          })
          .catch((caught: NodeJS.ErrnoException) => {
            if (caught.code !== 'ENOENT') stop('COMPOSER_OUTPUT_INVALID');
          });
      }, 25);
    }
    child.on('close', (code) => {
      cleanup();
      if (reason)
        reject(ffmpegFailure(reason, 'process', 'execução interrompida'));
      else if (processError) reject(processError);
      else if (code !== 0)
        reject(
          ffmpegFailure(
            'COMPOSER_PROCESS_FAILED',
            'process',
            'processo encerrou com falha',
          ),
        );
      else
        resolve({
          stdout: stdout.toString('utf8').replace(CONTROL_BYTES, ''),
          stderr: stderr.toString('utf8').replace(CONTROL_BYTES, ''),
        });
    });
  });
};
