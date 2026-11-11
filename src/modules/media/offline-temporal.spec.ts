import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  OfflineTemporalValidator,
  TEMPORAL_ANALYSIS_POLICY,
  createTemporalValidator,
} from './infrastructure/offline-temporal.validator.js';
import {
  runProcess,
  type ProcessRunner,
} from './infrastructure/ffmpeg-process.js';
import { canonicalMediaReference } from './domain/media-identity.js';
import { validateTemporalEvidence } from './domain/p4-qc-contracts.js';
import { LocalEvidenceStorage } from './infrastructure/local-evidence-storage.js';
import { fixture } from '../../../test/support/temporal-qc-fixture.js';
import { MediaPersistence } from './infrastructure/media.persistence.js';
import { MediaService } from './application/media.service.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';

let root: string,
  mediaRoot: string,
  evidenceRoot: string,
  ffmpegPath: string,
  ffprobePath: string;
const identity = (hash: string) => ({
  mediaAssetId: 'analysis_video',
  mediaReference: canonicalMediaReference(hash),
  contentHash: hash,
  scriptContentHash: 'a'.repeat(64),
  visualDirectionPosition: 1,
});
const clips = new Map<string, ReturnType<typeof identity>>();
const filters = {
  still: 'color=c=blue:s=64x64:r=8:d=2',
  local:
    "nullsrc=s=64x64:r=8:d=2,geq=lum='if(between(X,8+N,15+N)*between(Y,24,31),220,if(mod(floor(X/8)+floor(Y/8),2),80,40))':cb=128:cr=128",
  pan: "nullsrc=s=64x64:r=8:d=2,geq=lum='mod(X+N,64)*3+mod(Y,8)*4':cb=128:cr=128",
  zoom: "nullsrc=s=64x64:r=8:d=2,geq=lum='mod(X*7+Y*11,256)':cb=128:cr=128,zoompan=z='1+on*0.03':d=1:s=64x64:fps=8",
  freeze: 'testsrc2=s=64x64:r=8:d=1,tpad=stop_mode=clone:stop_duration=1',
  cut: 'color=black:s=64x64:r=8:d=1[a];color=white:s=64x64:r=8:d=1[b];[a][b]concat=n=2:v=1:a=0',
  heldFrame: "testsrc2=s=64x64:r=8:d=2,setpts='PTS+if(gte(N,4),1,0)'",
  transition: "nullsrc=s=64x64:r=8:d=2,geq=lum='16+N*10':cb=128:cr=128",
  short: 'color=blue:s=64x64:r=8:d=0.125',
};
beforeAll(async () => {
  const locate = (name: string) =>
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
      encoding: 'utf8',
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
  ffmpegPath = process.env.FFMPEG_PATH || locate('ffmpeg');
  ffprobePath = process.env.FFPROBE_PATH || locate('ffprobe');
  root = await mkdtemp(join(tmpdir(), 'temporal-real-'));
  mediaRoot = join(root, 'media');
  evidenceRoot = join(root, 'evidence');
  await mkdir(mediaRoot);
  for (const [name, filter] of Object.entries(filters)) {
    const path = join(root, `${name}.mp4`);
    await runProcess(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-f',
        'lavfi',
        '-i',
        filter,
        '-an',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-preset',
        'ultrafast',
        '-crf',
        '0',
        '-fps_mode',
        'passthrough',
        '-pix_fmt',
        'yuv420p',
        path,
      ],
      { timeoutMs: 15000, maxLogBytes: 8192 },
    );
    const bytes = await readFile(path),
      hash = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(mediaRoot, 'sha256', hash.slice(0, 2)), {
      recursive: true,
    });
    await writeFile(
      join(mediaRoot, 'sha256', hash.slice(0, 2), `${hash}.mp4`),
      bytes,
    );
    clips.set(name, identity(hash));
  }
}, 30000);
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
const analyzer = (runner: ProcessRunner = runProcess) =>
  new OfflineTemporalValidator(
    { ffmpegPath, ffprobePath, mediaRoot, evidenceRoot },
    runner,
  );
async function audit(name: string) {
  const input = clips.get(name)!,
    evidence = await analyzer().evaluate(input);
  validateTemporalEvidence(evidence, input);
  const bytes = new LocalEvidenceStorage(evidenceRoot).read(
    evidence.provenance!.contentHash,
    'json',
  );
  return { input, evidence, record: JSON.parse(bytes.toString('utf8')) };
}
describe('real offline temporal measurements, without automatic semantic approval', () => {
  it('is disabled by default and rejects incomplete or unknown configuration', () => {
    expect(createTemporalValidator({})).toBeUndefined();
    expect(() =>
      createTemporalValidator({ TEMPORAL_QC_MODE: 'live' }),
    ).toThrow();
    expect(() =>
      createTemporalValidator({ TEMPORAL_QC_MODE: 'offline' }),
    ).toThrow();
  });
  it.each(['frames', 'samples', 'malformed'])(
    'rejects %s output overflow or malformed decoded evidence',
    async (mode) => {
      const runner: ProcessRunner = async (command, args, options) => {
        const result = await runProcess(command, args, options);
        if (args.includes('framehash') && mode !== 'samples') {
          const file = options.outputPath!;
          const text = (await readFile(file)).toString('utf8');
          const line = text
            .split(/\r?\n/)
            .find((value) => value && !value.startsWith('#'))!;
          await writeFile(
            file,
            mode === 'malformed'
              ? 'invalid frame record'
              : Array(TEMPORAL_ANALYSIS_POLICY.maxFrames + 1)
                  .fill(line)
                  .join('\n'),
          );
        } else if (
          mode === 'samples' &&
          options.outputPath?.endsWith('samples.raw')
        ) {
          await writeFile(options.outputPath, Buffer.alloc(1048577));
        }
        return result;
      };
      await expect(
        analyzer(runner).evaluate(clips.get('local')!),
      ).rejects.toThrow();
    },
  );
  it.each(['probe', 'decode', 'sample'])(
    'propagates %s failure/timeout without returning evidence',
    async (stage) => {
      const runner: ProcessRunner = async (command, args, options) => {
        const target =
          stage === 'probe'
            ? command === ffprobePath && args.includes('-show_entries')
            : args.includes(stage === 'decode' ? 'framehash' : 'rawvideo') &&
              (stage !== 'sample' || !args.includes('framehash'));
        if (target) throw new Error('SIMULATED_PROCESS_TIMEOUT');
        return runProcess(command, args, options);
      };
      await expect(
        analyzer(runner).evaluate(clips.get('local')!),
      ).rejects.toThrow('SIMULATED_PROCESS_TIMEOUT');
    },
  );
  it.each([
    { duration: 61, width: 64, height: 64, fps: '8/1' },
    { duration: 2, width: 4096, height: 4096, fps: '8/1' },
    { duration: 2, width: 64, height: 64, fps: '120/1' },
    { duration: 2, width: 64, height: 64, fps: '0/0' },
  ])(
    'rejects capacity or invalid metadata before decoding: %j',
    async (value) => {
      const runner = vi.fn<ProcessRunner>(async () => ({
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              width: value.width,
              height: value.height,
              avg_frame_rate: value.fps,
            },
          ],
          format: { duration: value.duration },
        }),
      }));
      await expect(
        analyzer(runner).evaluate(clips.get('local')!),
      ).rejects.toThrow();
      expect(runner).toHaveBeenCalledTimes(1);
    },
  );
  it('bounds input size before spawning and verifies actual bytes, not just the reference', async () => {
    const { truncate } = await import('node:fs/promises');
    const hash = 'e'.repeat(64),
      path = join(mediaRoot, 'sha256', 'ee', `${hash}.mp4`);
    await mkdir(join(mediaRoot, 'sha256', 'ee'), { recursive: true });
    await writeFile(path, 'different bytes');
    const runner = vi.fn(runProcess);
    await expect(analyzer(runner).evaluate(identity(hash))).rejects.toThrow();
    await truncate(path, TEMPORAL_ANALYSIS_POLICY.maxInputBytes + 1);
    await expect(analyzer(runner).evaluate(identity(hash))).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });
  it('applies one-thread, allocation, CPU, wall time and output bounds to real decoding', async () => {
    const runner = vi.fn(runProcess);
    await analyzer(runner).evaluate(clips.get('still')!);
    const calls = runner.mock.calls.filter(([, args]) => args.includes('-i'));
    expect(calls).toHaveLength(2);
    for (const [, args, options] of calls) {
      expect(args).toEqual(
        expect.arrayContaining([
          '-threads',
          '1',
          '-max_alloc',
          String(TEMPORAL_ANALYSIS_POLICY.maxAllocationBytes),
          '-timelimit',
          '10',
          '-xerror',
        ]),
      );
      expect(options.timeoutMs).toBeLessThanOrEqual(15000);
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.shell).toBe(false);
      expect(options.maxOutputBytes).toBeLessThanOrEqual(1048576);
    }
  });
  it('proves absence of decoded movement in a real static video', async () => {
    const { evidence, record } = await audit('still');
    expect(evidence.motion).toBe('FAIL');
    expect(evidence.motionBasis).toBe('STILL');
    expect(record.measurements.uniqueDecodedFrames).toBe(1);
    expect(record.measurements.freezeIntervals).toEqual([
      { firstFrame: 0, lastFrame: 15, startSeconds: 0, endSeconds: 2 },
    ]);
    expect(record.resourceLimits.hardRssLimitGuaranteed).toBe(false);
    expect(evidence.continuity).toBe('NOT_VALIDATED');
    expect(record.measurements.decodedFrames).toBe(16);
    expect(evidence.fidelity).toBe('NOT_VALIDATED');
  });
  it('records a frozen interval without inventing semantic continuity approval', async () => {
    const { evidence, record } = await audit('freeze');
    expect(record.measurements.longestIdenticalRun).toBeGreaterThan(2);
    expect(record.measurements.freezeIntervals.length).toBeGreaterThan(0);
    expect(record.measurements.uniqueDecodedFrames).toBeGreaterThan(1);
    expect(evidence.motion).toBe('NOT_VALIDATED');
    expect(evidence.continuity).toBe('NOT_VALIDATED');
  });
  it('measures real localized changes without claiming product motion PASS', async () => {
    const { evidence, record } = await audit('local');
    expect(record.measurements.changedDecodedTransitions).toBeGreaterThan(0);
    expect(
      record.measurements.samplePairs.some(
        (p: any) => p.changedTiles > 0 && p.changedTiles < 16,
      ),
    ).toBe(true);
    expect(evidence.motion).toBe('NOT_VALIDATED');
    expect(evidence.fidelity).toBe('NOT_VALIDATED');
  });
  it.each(['pan', 'zoom'])('never approves %s-only movement', async (name) => {
    const { evidence, record } = await audit(name);
    expect(record.measurements.changedDecodedTransitions).toBeGreaterThan(0);
    expect(evidence.motion).toBe('NOT_VALIDATED');
    expect(evidence.continuity).toBe('NOT_VALIDATED');
    if (name === 'pan')
      expect(
        record.measurements.samplePairs.some(
          (p: any) =>
            p.translationResidualSum === 0 && (p.dx !== 0 || p.dy !== 0),
        ),
      ).toBe(true);
  });
  it('records abrupt full-frame changes but leaves continuity inconclusive', async () => {
    const { evidence, record } = await audit('cut');
    expect(
      record.measurements.samplePairs.some((p: any) => p.changedTiles === 16),
    ).toBe(true);
    expect(record.measurements.globalChangeObservations.length).toBeGreaterThan(
      0,
    );
    expect(
      record.measurements.globalChangeObservations.every(
        (item: any) =>
          item.intent === 'UNKNOWN' && item.classification === 'NOT_VALIDATED',
      ),
    ).toBe(true);
    expect(evidence.continuity).toBe('NOT_VALIDATED');
    expect(evidence.motion).not.toBe('PASS');
  });
  it('keeps a deliberate gradual transition inconclusive without trusted edit evidence', async () => {
    const { evidence, record } = await audit('transition');
    expect(record.measurements.changedDecodedTransitions).toBeGreaterThan(0);
    expect(evidence.continuity).toBe('NOT_VALIDATED');
    expect(evidence.fidelity).toBe('NOT_VALIDATED');
  });
  it('does not mistake a real longer frame presentation for missing coverage', async () => {
    const { evidence, record } = await audit('heldFrame');
    expect(record.measurements.frameDurations).toContain(2);
    expect(record.measurements.timestampGaps).toEqual([]);
    expect(evidence.continuity).toBe('NOT_VALIDATED');
  });
  it('fails continuity when decoded evidence reports missing presentation coverage', async () => {
    // Fault injection into successful decoder output, never a fabricated PASS.
    const runner: ProcessRunner = async (command, args, options) => {
      const result = await runProcess(command, args, options);
      if (args.includes('framehash')) {
        const text = await readFile(options.outputPath!, 'utf8');
        await writeFile(
          options.outputPath!,
          text
            .split('\n')
            .filter((line) => {
              if (!line || line.startsWith('#')) return true;
              return Number(line.split(',')[2]) !== 4;
            })
            .join('\n'),
        );
      }
      return result;
    };
    const evidence = await analyzer(runner).evaluate(clips.get('local')!);
    expect(evidence.continuity).toBe('FAIL');
    expect(evidence.fidelity).toBe('NOT_VALIDATED');
    const record = JSON.parse(
      new LocalEvidenceStorage(evidenceRoot)
        .read(evidence.provenance!.contentHash, 'json')
        .toString(),
    );
    expect(record.measurements.timestampGaps).toEqual([
      { afterFrame: 3, startSeconds: 0.5, endSeconds: 0.625 },
    ]);
  });
  it('does not classify clips with insufficient temporal coverage', async () => {
    const { evidence } = await audit('short');
    expect(evidence.motion).toBe('NOT_VALIDATED');
  });
  it('fails closed on concurrent analyses before spawning a second process', async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner: ProcessRunner = async (command, args, options) => {
      entered();
      await paused;
      return runProcess(command, args, options);
    };
    const first = analyzer(runner).evaluate(clips.get('local')!);
    await ready;
    try {
      await expect(analyzer().evaluate(clips.get('still')!)).rejects.toThrow(
        'TEMPORAL_ANALYSIS_BUSY',
      );
    } finally {
      release();
      await first;
    }
  });
  it('rejects regressing decoded timestamps without producing approval', async () => {
    const runner: ProcessRunner = async (command, args, options) => {
      const result = await runProcess(command, args, options);
      if (args.includes('framehash')) {
        const text = await readFile(options.outputPath!, 'utf8');
        let index = 0;
        await writeFile(
          options.outputPath!,
          text
            .split('\n')
            .map((line) => {
              if (!line || line.startsWith('#')) return line;
              const fields = line.split(',');
              if (index++ === 1) fields[2] = '-1';
              return fields.join(',');
            })
            .join('\n'),
        );
      }
      return result;
    };
    await expect(
      analyzer(runner).evaluate(clips.get('local')!),
    ).rejects.toThrow('TEMPORAL_ANALYSIS_INVALID');
  });
  it('produces repeatable, file-bound audit evidence', async () => {
    const input = clips.get('local')!,
      a = await analyzer().evaluate(input),
      b = await analyzer().evaluate(input);
    expect(a).toEqual(b);
    expect(a.contentHash).toBe(input.contentHash);
    expect(a.provenance!.parameters).toMatchObject({
      policy: TEMPORAL_ANALYSIS_POLICY,
    });
  });
  it('shares one total deadline across all subprocesses', async () => {
    let elapsed = 0;
    const clock = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => elapsed);
    const runner: ProcessRunner = async (command, args, options) => {
      const result = await runProcess(command, args, options);
      elapsed += 6000;
      return result;
    };
    try {
      await expect(
        analyzer(runner).evaluate(clips.get('local')!),
      ).rejects.toThrow('TEMPORAL_ANALYSIS_TIMEOUT');
    } finally {
      clock.mockRestore();
    }
  });
  it('rejects incomplete decoded coverage even when a subprocess returns success', async () => {
    const runner: ProcessRunner = async (command, args, options) => {
      const result = await runProcess(command, args, options);
      if (args.includes('framehash')) {
        let count = 0;
        const text = await readFile(options.outputPath!, 'utf8');
        await writeFile(
          options.outputPath!,
          text
            .split('\n')
            .filter((line) => line.startsWith('#') || (line && count++ < 4))
            .join('\n'),
        );
      }
      return result;
    };
    await expect(
      analyzer(runner).evaluate(clips.get('local')!),
    ).rejects.toThrow();
  });
  it('rejects divergent SHA-256 before executing any analyzer process', async () => {
    const runner = vi.fn(runProcess);
    await expect(
      analyzer(runner).evaluate({
        ...clips.get('still')!,
        contentHash: 'f'.repeat(64),
      }),
    ).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });
  it('rejects corrupt bytes even when the claimed SHA-256 matches', async () => {
    const bytes = Buffer.from('not a video'),
      hash = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(mediaRoot, 'sha256', hash.slice(0, 2)), {
      recursive: true,
    });
    await writeFile(
      join(mediaRoot, 'sha256', hash.slice(0, 2), `${hash}.mp4`),
      bytes,
    );
    await expect(analyzer().evaluate(identity(hash))).rejects.toThrow();
  });
  it('rejects a genuinely truncated file with a matching SHA-256', async () => {
    const original = clips.get('local')!;
    const full = await readFile(
      join(
        mediaRoot,
        'sha256',
        original.contentHash.slice(0, 2),
        original.contentHash + '.mp4',
      ),
    );
    const bytes = full.subarray(0, Math.floor(full.length / 2));
    const hash = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(mediaRoot, 'sha256', hash.slice(0, 2)), {
      recursive: true,
    });
    await writeFile(
      join(mediaRoot, 'sha256', hash.slice(0, 2), hash + '.mp4'),
      bytes,
    );
    await expect(analyzer().evaluate(identity(hash))).rejects.toThrow();
  });
  it('feeds existing QC persistence and keeps Composition V2 blocked', async () => {
    const f = fixture();
    try {
      const clip = clips.get('local')!,
        old = f.assets[1];
      const asset = {
        ...old,
        mediaAssetId: clip.mediaAssetId,
        contentHash: clip.contentHash,
        mediaReference: clip.mediaReference,
        revision: 2,
        supersedesMediaAssetId: old.mediaAssetId,
        technicalProperties: {
          ...old.technicalProperties,
          widthPixels: 64,
          heightPixels: 64,
          durationMilliseconds: 2000,
        },
      };
      f.media.register(asset);
      const service = new MediaService(
        new MediaPersistence(
          f.path,
          { get: (id) => f.repository.getRun(id)! },
          { getScript: () => f.script as any },
          null,
          analyzer(),
        ),
      );
      expect(
        await service.evaluateTemporalMedia(asset.mediaAssetId),
      ).toMatchObject({
        result: 'NOT_VALIDATED',
        evidence: { fidelity: 'NOT_VALIDATED' },
      });
      f.value.segments[1].mediaAssetId = asset.mediaAssetId;
      f.value.segments[1].mediaAssetContentHash = asset.contentHash;
      f.value.segments[1].movementRequirement = 'REAL_MOTION_REQUIRED';
      f.value.contentHash = compositionPlanContentHash(f.value);
      expect(() => service.registerCompositionPlan(f.value)).toThrow(
        'TEMPORAL_QC_REQUIRED',
      );
    } finally {
      f.close();
    }
  });
});
