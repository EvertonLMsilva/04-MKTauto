import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseMediaIdentity } from '../domain/media-identity.js';
import type {
  TemporalEvidence,
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
const fail = (): never => {
  throw new Error('TEMPORAL_ANALYSIS_INVALID');
};

export class OfflineTemporalValidator implements TemporalValidator {
  readonly id = 'offline-temporal-ffmpeg';
  readonly version = '1.0.0';
  constructor(
    private readonly config: Config,
    private readonly runner: ProcessRunner = runProcess,
  ) {}
  async evaluate(
    identity: Readonly<TemporalMediaIdentity>,
  ): Promise<TemporalEvidence> {
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
      );
      if (hash.digest('hex') !== identity.contentHash) fail();
      const options = {
        timeoutMs: p.timeoutMs,
        maxLogBytes: 65536,
        shell: false as const,
        windowsHide: true as const,
      };
      const probe = await this.runner(
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
      const tools = await Promise.all([
        this.runner(this.config.ffmpegPath, ['-version'], options),
        this.runner(this.config.ffprobePath, ['-version'], options),
      ]);
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
      await this.runner(
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
      const hashes = lines.map((line) => {
        const parts = line.split(',').map((x) => x.trim());
        if (parts.length !== 6 || !/^[a-f0-9]{64}$/.test(parts[5])) fail();
        return parts[5];
      });
      if (!hashes.length || hashes.length > p.maxFrames) fail();
      const samplesPath = join(staging, 'samples.raw');
      await this.runner(
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
      if (!Number.isInteger(count) || count > p.maxSamples) fail();
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
      const record = {
        schemaVersion: 'offline-temporal-analysis/1.0.0',
        identity,
        validator: this.id,
        version: this.version,
        parameters,
        tools: tools.map((tool) => tool.stdout.split(/\r?\n/)[0]),
        metadata: { width: video.width, height: video.height, duration, fps },
        measurements: {
          decodedFrames: hashes.length,
          uniqueDecodedFrames: new Set(hashes).size,
          changedDecodedTransitions,
          longestIdenticalRun,
          framehashDigest: digest(frameBytes),
          framehash: frameBytes.toString('utf8'),
          samplesDigest: digest(samples),
          sampleCount: count,
          samplePairs,
        },
        conclusions: {
          motion: still ? 'FAIL' : 'NOT_VALIDATED',
          continuity: 'NOT_VALIDATED',
          fidelity: 'NOT_VALIDATED',
        },
      };
      const evidenceHash = new LocalEvidenceStorage(
        this.config.evidenceRoot,
      ).put(documentBytes(record), 'json');
      return {
        mediaReference: identity.mediaReference,
        contentHash: identity.contentHash,
        motion: still ? 'FAIL' : 'NOT_VALIDATED',
        motionBasis: still ? 'STILL' : 'UNKNOWN',
        continuity: 'NOT_VALIDATED',
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
