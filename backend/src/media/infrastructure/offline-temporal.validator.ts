import { adaptationHash } from '../domain/media-hash.js';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseMediaIdentity } from '../domain/media-identity.js';
import type {
  TemporalEvidence,
  ReferenceImageEvidence,
  TemporalMediaIdentity,
  TemporalValidator,
} from '../domain/p4-qc-contracts.js';
import { LocalCompositionReferenceResolver } from './local-composition-reference-resolver.js';
import {
  LocalEvidenceStorage,
  digest,
  documentBytes,
} from './local-evidence-storage.js';
import { runProcess, type ProcessRunner } from './ffmpeg-process.js';

// Capacity/sampling bounds, not calibrated perceptual quality thresholds.
export const TEMPORAL_ANALYSIS_POLICY = Object.freeze({
  maxInputBytes: 33554432,
  maxDurationSeconds: 60,
  maxPixels: 2073600,
  maxDimension: 2048,
  maxFps: 60,
  maxFrames: 1800,
  sampleFps: 4,
  sampleWidth: 64,
  sampleHeight: 64,
  maxSamples: 241,
  translationRadius: 4,
  timeoutMs: 15000,
  cpuSeconds: 10,
  maxAllocationBytes: 67108864,
  threads: 1,
});
type Config = {
  ffmpegPath: string;
  ffprobePath: string;
  mediaRoot: string;
  evidenceRoot: string;
};
let analysisActive = false;
const fail = (): never => {
  throw new Error('TEMPORAL_ANALYSIS_INVALID');
};

export class OfflineTemporalValidator implements TemporalValidator {
  readonly id = 'offline-temporal-ffmpeg';
  readonly version = '1.1.0';
  constructor(
    private readonly config: Config,
    private readonly runner: ProcessRunner = runProcess,
  ) {}
  async verifyReferenceImage(
    identity: Readonly<
      Pick<TemporalMediaIdentity, 'mediaReference' | 'contentHash'>
    >,
  ): Promise<ReferenceImageEvidence> {
    if (analysisActive) throw new Error('TEMPORAL_ANALYSIS_BUSY');
    analysisActive = true;
    let staging: string | undefined;
    const p = TEMPORAL_ANALYSIS_POLICY,
      signal = AbortSignal.timeout(p.timeoutMs),
      started = performance.now();
    const execute: ProcessRunner = (command, args, options) => {
      signal.throwIfAborted();
      const remaining = Math.floor(p.timeoutMs - (performance.now() - started));
      if (remaining <= 0) throw new Error('TEMPORAL_ANALYSIS_TIMEOUT');
      return this.runner(command, args, {
        ...options,
        signal,
        timeoutMs: Math.min(remaining, options.timeoutMs),
      });
    };
    try {
      parseMediaIdentity(identity.mediaReference, {
        expectedHash: identity.contentHash,
      });
      const bytes = new LocalEvidenceStorage(this.config.mediaRoot).read(
        identity.contentHash,
        'png',
        p.maxInputBytes,
      );
      staging = await mkdtemp(join(tmpdir(), 'reference-analysis-'));
      const input = join(staging, 'reference.png');
      await writeFile(input, bytes, { flag: 'wx', signal });
      const options = {
        timeoutMs: p.timeoutMs,
        maxLogBytes: 65536,
        shell: false as const,
        windowsHide: true as const,
      };
      const probe = await execute(
        this.config.ffprobePath,
        [
          '-v',
          'error',
          '-max_alloc',
          String(p.maxAllocationBytes),
          '-threads',
          '1',
          '-protocol_whitelist',
          'file',
          '-show_entries',
          'stream=codec_type,codec_name,width,height',
          '-of',
          'json',
          input,
        ],
        options,
      );
      const streams = JSON.parse(probe.stdout).streams;
      const image = streams?.[0];
      if (
        streams?.length !== 1 ||
        image.codec_type !== 'video' ||
        image.codec_name !== 'png' ||
        ![image.width, image.height].every(
          (n) => Number.isSafeInteger(n) && n > 0 && n <= p.maxDimension,
        ) ||
        image.width * image.height > p.maxPixels
      )
        fail();
      const decoded = await execute(
        this.config.ffmpegPath,
        [
          '-v',
          'error',
          '-nostdin',
          '-xerror',
          '-max_alloc',
          String(p.maxAllocationBytes),
          '-timelimit',
          String(p.cpuSeconds),
          '-threads',
          '1',
          '-filter_threads',
          '1',
          '-protocol_whitelist',
          'file',
          '-i',
          input,
          '-map',
          '0:v:0',
          '-an',
          '-sn',
          '-dn',
          '-frames:v',
          '1',
          '-c:v',
          'rawvideo',
          '-threads',
          '1',
          '-pix_fmt',
          'rgb24',
          '-f',
          'framehash',
          '-hash',
          'sha256',
          '-',
        ],
        options,
      );
      const lines = decoded.stdout
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#'));
      const fields = lines[0]?.split(',').map((part) => part.trim());
      if (
        lines.length !== 1 ||
        fields?.length !== 6 ||
        Number(fields[4]) !== image.width * image.height * 3 ||
        !/^[a-f0-9]{64}$/.test(fields[5])
      )
        fail();
      signal.throwIfAborted();
      if (performance.now() - started >= p.timeoutMs) fail();
      return Object.freeze({
        schemaVersion: 'reference-image-analysis/1.0.0',
        validator: this.id,
        version: this.version,
        contentHash: identity.contentHash,
        width: image.width,
        height: image.height,
        frameHash: fields![5],
        policyHash: adaptationHash(p),
      });
    } finally {
      try {
        if (staging) await rm(staging, { recursive: true, force: true });
      } finally {
        analysisActive = false;
      }
    }
  }
  async evaluate(
    identity: Readonly<TemporalMediaIdentity>,
  ): Promise<TemporalEvidence> {
    if (analysisActive) throw new Error('TEMPORAL_ANALYSIS_BUSY');
    analysisActive = true;
    try {
      return await this.analyze(identity);
    } finally {
      analysisActive = false;
    }
  }
  private async analyze(
    identity: Readonly<TemporalMediaIdentity>,
  ): Promise<TemporalEvidence> {
    const signal = AbortSignal.timeout(TEMPORAL_ANALYSIS_POLICY.timeoutMs);
    const started = performance.now();
    const remainingBudget = () => {
      signal.throwIfAborted();
      const remaining = Math.floor(
        TEMPORAL_ANALYSIS_POLICY.timeoutMs - (performance.now() - started),
      );
      if (remaining <= 0) throw new Error('TEMPORAL_ANALYSIS_TIMEOUT');
      return remaining;
    };
    const execute: ProcessRunner = (command, args, options) => {
      const remaining = remainingBudget();
      return this.runner(command, args, {
        ...options,
        signal,
        timeoutMs: Math.min(remaining, options.timeoutMs),
      });
    };
    identity = Object.freeze({ ...identity });
    parseMediaIdentity(identity.mediaReference, {
      expectedHash: identity.contentHash,
    });
    const p = TEMPORAL_ANALYSIS_POLICY;
    const source = await new LocalCompositionReferenceResolver({
      mediaRoot: this.config.mediaRoot,
      voiceRoot: this.config.mediaRoot,
    }).resolveMedia(identity.mediaReference, 'mp4');
    if ((await stat(source)).size > p.maxInputBytes) fail();
    const staging = await mkdtemp(join(tmpdir(), 'temporal-analysis-'));
    try {
      const input = join(staging, 'input.mp4'),
        hash = createHash('sha256');
      let size = 0;
      await pipeline(
        createReadStream(source),
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            if (size > p.maxInputBytes) {
              callback(new Error('TEMPORAL_INPUT_LIMIT'));
              return;
            }
            hash.update(chunk);
            callback(null, chunk);
          },
        }),
        createWriteStream(input, { flags: 'wx' }),
        { signal },
      );
      if (hash.digest('hex') !== identity.contentHash) fail();
      const options = {
        timeoutMs: p.timeoutMs,
        maxLogBytes: 65536,
        shell: false as const,
        windowsHide: true as const,
      };
      const probe = await execute(
        this.config.ffprobePath,
        [
          '-v',
          'error',
          '-max_alloc',
          String(p.maxAllocationBytes),
          '-threads',
          '1',
          '-protocol_whitelist',
          'file',
          '-show_entries',
          'stream=codec_type,width,height,avg_frame_rate:format=duration',
          '-of',
          'json',
          input,
        ],
        options,
      );
      const metadata = JSON.parse(probe.stdout);
      const videos = metadata.streams?.filter(
        (s: { codec_type: string }) => s.codec_type === 'video',
      );
      if (videos?.length !== 1) fail();
      const video = videos[0],
        duration = Number(metadata.format?.duration);
      const rate = String(video.avg_frame_rate).split('/').map(Number),
        fps = rate[0] / rate[1];
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > p.maxDurationSeconds ||
        !Number.isFinite(fps) ||
        fps <= 0 ||
        fps > p.maxFps ||
        ![video.width, video.height].every(
          (n) => Number.isSafeInteger(n) && n > 0 && n <= p.maxDimension,
        ) ||
        video.width * video.height > p.maxPixels
      )
        fail();
      const tools = [
        await execute(this.config.ffmpegPath, ['-version'], options),
        await execute(this.config.ffprobePath, ['-version'], options),
      ];
      const base = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-xerror',
        '-max_alloc',
        String(p.maxAllocationBytes),
        '-timelimit',
        String(p.cpuSeconds),
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-protocol_whitelist',
        'file',
        '-i',
        input,
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-threads',
        '1',
      ];
      const framesPath = join(staging, 'frames.txt');
      await execute(
        this.config.ffmpegPath,
        [
          ...base,
          '-fps_mode',
          'passthrough',
          '-frames:v',
          String(p.maxFrames + 1),
          '-c:v',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          '-f',
          'framehash',
          '-hash',
          'sha256',
          framesPath,
        ],
        { ...options, outputPath: framesPath, maxOutputBytes: 524288 },
      );
      const frameBytes = await boundedRead(framesPath, 524288);
      const lines = frameBytes
        .toString('utf8')
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('#'));
      const timeBaseMatch = frameBytes
        .toString('utf8')
        .match(/^#tb 0: (\d+)\/(\d+)$/m);
      if (!timeBaseMatch) return fail();
      const timeBase = Number(timeBaseMatch[1]) / Number(timeBaseMatch[2]);
      if (!Number.isFinite(timeBase) || timeBase <= 0) fail();
      const timestamps: number[] = [],
        frameDurations: number[] = [];
      const hashes = lines.map((line) => {
        const parts = line.split(',').map((x) => x.trim());
        if (parts.length !== 6 || !/^[a-f0-9]{64}$/.test(parts[5])) fail();
        const pts = Number(parts[2]),
          frameDuration = Number(parts[3]);
        if (
          parts[0] !== '0' ||
          !Number.isSafeInteger(pts) ||
          !Number.isSafeInteger(frameDuration) ||
          Number(parts[4]) !== video.width * video.height * 3 ||
          frameDuration <= 0 ||
          (timestamps.length > 0 && pts <= timestamps[timestamps.length - 1])
        )
          fail();
        timestamps.push(pts);
        frameDurations.push(frameDuration);
        return parts[5];
      });
      if (!hashes.length || hashes.length > p.maxFrames) fail();
      const decodedDuration =
        (timestamps.at(-1)! + frameDurations.at(-1)! - timestamps[0]) *
        timeBase;
      if (
        !Number.isFinite(decodedDuration) ||
        decodedDuration <= 0 ||
        decodedDuration > p.maxDurationSeconds
      )
        fail();
      // Container and decoded presentation coverage may differ by one frame
      // due to muxer rounding, but a partial successful decode is not evidence.
      const coverageTolerance =
        Math.max(...frameDurations) * timeBase + timeBase;
      if (Math.abs(decodedDuration - duration) > coverageTolerance) fail();
      const freezeIntervals = [];
      for (let first = 0; first < hashes.length;) {
        let last = first;
        while (last + 1 < hashes.length && hashes[last + 1] === hashes[first])
          last++;
        if (last > first)
          freezeIntervals.push({
            firstFrame: first,
            lastFrame: last,
            startSeconds: timestamps[first] * timeBase,
            endSeconds: (timestamps[last] + frameDurations[last]) * timeBase,
          });
        first = last + 1;
      }
      const timestampGaps = timestamps.flatMap((pts, index) =>
        index > 0 && pts > timestamps[index - 1] + frameDurations[index - 1]
          ? [
              {
                afterFrame: index - 1,
                startSeconds:
                  (timestamps[index - 1] + frameDurations[index - 1]) *
                  timeBase,
                endSeconds: pts * timeBase,
              },
            ]
          : [],
      );
      const samplesPath = join(staging, 'samples.raw');
      await execute(
        this.config.ffmpegPath,
        [
          ...base,
          '-vf',
          'fps=4,scale=64:64:flags=neighbor,format=gray',
          '-frames:v',
          String(p.maxSamples + 1),
          '-c:v',
          'rawvideo',
          '-f',
          'rawvideo',
          samplesPath,
        ],
        { ...options, outputPath: samplesPath, maxOutputBytes: 1048576 },
      );
      const samples = await boundedRead(samplesPath, 1048576),
        frameSize = p.sampleWidth * p.sampleHeight,
        count = samples.length / frameSize;
      if (!Number.isInteger(count) || count < 1 || count > p.maxSamples) fail();
      let longestIdenticalRun = 1,
        run = 1,
        changedDecodedTransitions = 0;
      for (let i = 1; i < hashes.length; i++) {
        if (hashes[i] === hashes[i - 1]) run++;
        else {
          run = 1;
          changedDecodedTransitions++;
        }
        longestIdenticalRun = Math.max(longestIdenticalRun, run);
      }
      const samplePairs = [];
      for (let i = 1; i < count; i++)
        samplePairs.push(
          compare(
            samples.subarray((i - 1) * frameSize, i * frameSize),
            samples.subarray(i * frameSize, (i + 1) * frameSize),
          ),
        );
      const still =
        hashes.length >= 2 && count >= 2 && changedDecodedTransitions === 0;
      const parameters = { policy: p };
      // Timestamp gaps are objective missing presentation coverage. Image changes,
      // frozen intervals and global translation alone cannot prove perceptual failure.
      const continuity = timestampGaps.length
        ? ('FAIL' as const)
        : ('NOT_VALIDATED' as const);
      remainingBudget();
      const record = {
        schemaVersion: 'offline-temporal-analysis/1.1.0',
        identity,
        validator: this.id,
        version: this.version,
        parameters,
        tools: tools.map((tool) => tool.stdout.split(/\r?\n/)[0]),
        metadata: { width: video.width, height: video.height, duration, fps },
        resourceLimits: {
          maxConcurrentAnalysesPerProcess: 1,
          maxConcurrentChildren: 1,
          totalTimeoutMs: p.timeoutMs,
          hardRssLimitGuaranteed: false,
          memoryPolicy: 'BOUNDED_INPUT_OUTPUT_AND_SINGLE_ALLOCATION_ONLY',
          approvalPolicy: 'NO_PASS_WITHOUT_SEMANTIC_EVIDENCE',
        },
        measurements: {
          decodedDuration,
          timeBase,
          timestamps,
          frameDurations,
          timestampGaps,
          freezeIntervals,
          decodedFrames: hashes.length,
          uniqueDecodedFrames: new Set(hashes).size,
          changedDecodedTransitions,
          longestIdenticalRun,
          framehashDigest: digest(frameBytes),
          framehash: frameBytes.toString('utf8'),
          samplesDigest: digest(samples),
          sampleCount: count,
          samplePairs,
          globalChangeObservations: samplePairs.flatMap((pair, index) =>
            pair.changedTiles === 16
              ? [
                  {
                    samplePairIndex: index,
                    intent: 'UNKNOWN',
                    classification: 'NOT_VALIDATED',
                  },
                ]
              : [],
          ),
        },
        conclusions: {
          motion: still ? 'FAIL' : 'NOT_VALIDATED',
          continuity,
          fidelity: 'NOT_VALIDATED',
        },
      };
      remainingBudget();
      const evidenceHash = new LocalEvidenceStorage(
        this.config.evidenceRoot,
      ).put(documentBytes(record), 'json');
      return {
        mediaReference: identity.mediaReference,
        contentHash: identity.contentHash,
        motion: still ? 'FAIL' : 'NOT_VALIDATED',
        motionBasis: still ? 'STILL' : 'UNKNOWN',
        continuity,
        fidelity: 'NOT_VALIDATED',
        provenance: {
          reference: `temporal-evidence:sha256_${evidenceHash}`,
          contentHash: evidenceHash,
          validator: this.id,
          version: this.version,
          parameters,
        },
      };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
async function boundedRead(path: string, max: number) {
  if ((await stat(path)).size > max) fail();
  return readFile(path);
}
// Observations only: translation is searched over a fixed interior overlap so
// candidates have equal support. Neither translation nor residual proves subject motion.
function compare(a: Buffer, b: Buffer) {
  const tiles = new Set<number>();
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      if (a[y * 64 + x] !== b[y * 64 + x])
        tiles.add(Math.floor(y / 16) * 4 + Math.floor(x / 16));
  let translationResidualSum = Infinity,
    dx = 0,
    dy = 0;
  const r = TEMPORAL_ANALYSIS_POLICY.translationRadius;
  for (let sy = -r; sy <= r; sy++)
    for (let sx = -r; sx <= r; sx++) {
      let sum = 0;
      for (let y = r; y < 64 - r; y++)
        for (let x = r; x < 64 - r; x++)
          sum += Math.abs(a[y * 64 + x] - b[(y + sy) * 64 + x + sx]);
      if (sum < translationResidualSum) {
        translationResidualSum = sum;
        dx = sx;
        dy = sy;
      }
    }
  return { changedTiles: tiles.size, translationResidualSum, dx, dy };
}

export function createTemporalValidator(
  env: NodeJS.ProcessEnv,
  runner: ProcessRunner = runProcess,
) {
  const mode = env.TEMPORAL_QC_MODE ?? 'disabled';
  if (mode === 'disabled') return undefined;
  if (
    mode !== 'offline' ||
    !env.FFMPEG_PATH ||
    !env.FFPROBE_PATH ||
    !env.FFMPEG_MEDIA_ROOT ||
    !env.LOCAL_MEDIA_EVIDENCE_ROOT
  )
    throw new Error('TEMPORAL_CONFIGURATION_INVALID');
  return new OfflineTemporalValidator(
    {
      ffmpegPath: resolve(env.FFMPEG_PATH),
      ffprobePath: resolve(env.FFPROBE_PATH),
      mediaRoot: resolve(env.FFMPEG_MEDIA_ROOT),
      evidenceRoot: resolve(env.LOCAL_MEDIA_EVIDENCE_ROOT),
    },
    runner,
  );
}
