import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPhysicalMedia } from './application/physical-verification.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import { qcReport } from '../../../test/support/media-qc-fixture.js';
import { qualityControlReportContentHash } from './domain/quality-control-contracts.js';
import { runProcess } from './infrastructure/ffmpeg-process.js';
import type { ProcessRunner } from './infrastructure/ffmpeg-process.js';
import { runPhysicalVerificationCommand } from './verify-physical-media.js';
import { DatabaseSync } from 'node:sqlite';
vi.mock('node:sqlite', () => ({
  DatabaseSync: vi.fn(() => {
    throw Error('DATABASE_FORBIDDEN');
  }),
}));

export function physicalManifest(hash: string) {
  const plan = {
    schemaVersion: 'composition-plan/1.0.0',
    compositionPlanId: 'plan_fixture',
    pipelineRunId: 'run_fixture',
    projectId: 'project_fixture',
    projectVersion: 1,
    scriptId: 'script_fixture',
    scriptContentHash: 'a'.repeat(64),
    voiceTrackId: 'voice_fixture',
    voiceTrackContentHash: 'b'.repeat(64),
    outputAspectRatio: '9:16',
    timelineUnit: 'MILLISECOND',
    continuityMode: 'CONTIGUOUS',
    durationMilliseconds: 1000,
    segments: [
      {
        position: 1,
        visualDirectionPosition: 1,
        mediaAssetId: 'media_fixture',
        mediaAssetContentHash: 'c'.repeat(64),
        startMilliseconds: 0,
        endMilliseconds: 1000,
      },
    ],
    createdAt: '2026-09-28T12:00:00Z',
    revision: 1,
    supersedesCompositionPlanId: null,
    contentHash: '',
  };
  plan.contentHash = compositionPlanContentHash(plan);
  const render = {
    schemaVersion: 'video-render/1.0.0',
    videoRenderId: 'render_fixture',
    pipelineRunId: plan.pipelineRunId,
    projectId: plan.projectId,
    projectVersion: 1,
    compositionPlanId: plan.compositionPlanId,
    compositionPlanContentHash: plan.contentHash,
    outputAspectRatio: '9:16',
    durationMilliseconds: 1000,
    containerFormat: 'mp4',
    widthPixels: 90,
    heightPixels: 160,
    contentHash: hash,
    logicalReference: `render:sha256_${hash}`,
    createdAt: plan.createdAt,
    revision: 1,
    supersedesVideoRenderId: null,
  };
  const qc = qcReport(plan.pipelineRunId);
  qc.projectId = plan.projectId;
  qc.videoRenderId = render.videoRenderId;
  qc.videoRenderContentHash = hash;
  qc.artifacts.videoRender = { id: render.videoRenderId, contentHash: hash };
  qc.artifacts.script = {
    id: plan.scriptId,
    contentHash: plan.scriptContentHash,
  };
  qc.artifacts.voiceTrack = {
    id: plan.voiceTrackId,
    contentHash: plan.voiceTrackContentHash,
  };
  qc.artifacts.compositionPlan = {
    id: plan.compositionPlanId,
    contentHash: plan.contentHash,
  };
  qc.artifacts.mediaAssets = [
    { position: 1, id: 'media_fixture', contentHash: 'c'.repeat(64) },
  ];
  qc.contentHash = qualityControlReportContentHash(qc);
  return {
    schemaVersion: 'physical-media-input/1.0.0' as const,
    request: {
      videoRenderId: render.videoRenderId,
      pipelineRunId: plan.pipelineRunId,
      scriptId: plan.scriptId,
      scriptContentHash: plan.scriptContentHash,
      renderRevision: 1,
      renderContentHash: hash,
      qualityControlReportId: qc.qualityControlReportId,
    },
    scriptRevision: 1,
    render,
    compositionPlan: plan,
    compositionPlans: [plan],
    renders: [render],
    qc,
    expected: { videoCodec: 'h264', audioCodec: 'aac', audioRequired: true },
  };
}
let root: string;
let mp4: string;
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const metadata = () => ({
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '1.000',
    tags: { major_brand: 'isom' },
  },
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      sample_aspect_ratio: '1:1',
      width: 90,
      height: 160,
      duration: '1.000',
    },
    {
      codec_type: 'audio',
      codec_name: 'aac',
      duration: '1.000',
      sample_rate: '48000',
      channels: 1,
    },
  ],
});
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'physical-check-'));
  mp4 = join(root, 'test.mp4');
  writeFileSync(mp4, 'TEST_ONLY_NOT_VIDEO');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function options(
  runner: ProcessRunner = vi.fn(async () => ({
    stdout: JSON.stringify(metadata()),
  })),
) {
  return {
    mp4Path: mp4,
    ffprobePath: process.execPath,
    ffmpegPath: process.execPath,
    decode: true,
    runner,
  };
}
it('produces reproducible evidence, separating fixture inspection, existing QC and pending human approval', async () => {
  const input = physicalManifest(hash(readFileSync(mp4)));
  const before = readFileSync(mp4);
  const a = await verifyPhysicalMedia(input, options());
  expect(a.status).toBe('TECHNICAL_VALIDATED');
  expect(a.humanAudiovisualApproval).toBe('PENDING');
  expect(a.commercialApproval).toBe('NOT_GRANTED');
  expect(a.databaseCurrentness).toBe('NOT_CHECKED');
  expect(a.decode).toBe('PASS');
  expect(await verifyPhysicalMedia(input, options())).toEqual(a);
  expect(readFileSync(mp4)).toEqual(before);
  expect(DatabaseSync).not.toHaveBeenCalled();
});
it('rejects absent files and mismatching hashes', async () => {
  const input = physicalManifest('a'.repeat(64));
  expect((await verifyPhysicalMedia(input, options())).status).toBe(
    'NOT_VALIDATED',
  );
  expect(
    (
      await verifyPhysicalMedia(input, {
        ...options(),
        mp4Path: join(root, 'missing.mp4'),
      })
    ).status,
  ).toBe('NOT_VALIDATED');
});
it.each(['duration', 'dimensions', 'codec', 'audio', 'aspect'] as const)(
  'rejects incompatible %s',
  async (kind) => {
    const data = metadata();
    if (kind === 'duration') data.format.duration = '3.000';
    if (kind === 'dimensions') data.streams[0].width = 100;
    if (kind === 'codec') data.streams[0].codec_name = 'vp9';
    if (kind === 'aspect') data.streams[0].sample_aspect_ratio = '2:1';
    if (kind === 'audio') data.streams.pop();
    const result = await verifyPhysicalMedia(
      physicalManifest(hash(readFileSync(mp4))),
      options(vi.fn(async () => ({ stdout: JSON.stringify(data) }))),
    );
    expect(result.status).toBe('NOT_VALIDATED');
  },
);
it('never equates metadata inspection with full decode', async () => {
  const result = await verifyPhysicalMedia(
    physicalManifest(hash(readFileSync(mp4))),
    { ...options(), decode: false },
  );
  expect(result.decode).toBe('NOT_PERFORMED');
  expect(result.status).toBe('UNKNOWN');
});
it.each(['FAIL', 'WARN'] as const)('rejects existing QC %s', async (status) => {
  const input = physicalManifest(hash(readFileSync(mp4)));
  input.qc.result = status;
  input.qc.approvalBlocked = status === 'FAIL';
  input.qc.findings[0].status = status;
  input.qc.contentHash = qualityControlReportContentHash(input.qc);
  expect((await verifyPhysicalMedia(input, options())).status).toBe(
    'NOT_VALIDATED',
  );
});
it('rejects stale revision and native decode failure', async () => {
  const input = physicalManifest(hash(readFileSync(mp4)));
  input.request.renderRevision = 2;
  expect((await verifyPhysicalMedia(input, options())).status).toBe(
    'NOT_VALIDATED',
  );
  input.request.renderRevision = 1;
  const runner = vi.fn(async (_cmd: string, args: string[]) => {
    if (args.includes('null')) throw Error('PRIVATE_DETAIL');
    return { stdout: JSON.stringify(metadata()) };
  });
  const report = await verifyPhysicalMedia(input, options(runner));
  expect(report.decode).toBe('FAIL');
  expect(JSON.stringify(report)).not.toContain('PRIVATE_DETAIL');
});
it('uses only explicit local subprocesses with no shell or network protocol', async () => {
  const runner = vi.fn(async () => ({ stdout: JSON.stringify(metadata()) }));
  await verifyPhysicalMedia(
    physicalManifest(hash(readFileSync(mp4))),
    options(runner),
  );
  for (const call of runner.mock.calls as unknown as [
    string,
    string[],
    object,
  ][]) {
    expect(call[1]).toContain('file,pipe');
    expect(call[2]).toMatchObject({ shell: false });
  }
});
const ffmpeg = process.env.MKTAUTO_TEST_FFMPEG;
const ffprobe = process.env.MKTAUTO_TEST_FFPROBE;
it.skipIf(!ffmpeg || !ffprobe)(
  'inspects a real disposable MP4 and rejects truncation with real FFmpeg/FFprobe',
  async () => {
    await runProcess(
      ffmpeg!,
      [
        '-v',
        'error',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=90x160:r=25',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=48000:cl=mono',
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-y',
        mp4,
      ],
      { timeoutMs: 30000, maxLogBytes: 8192 },
    );
    const input = physicalManifest(hash(readFileSync(mp4)));
    const opts = {
      mp4Path: mp4,
      ffprobePath: ffprobe!,
      ffmpegPath: ffmpeg!,
      decode: true,
    };
    expect((await verifyPhysicalMedia(input, opts)).status).toBe(
      'TECHNICAL_VALIDATED',
    );
    const bytes = readFileSync(mp4);
    writeFileSync(mp4, bytes.subarray(0, Math.floor(bytes.length / 2)));
    const broken = hash(readFileSync(mp4));
    input.render.contentHash = broken;
    input.render.logicalReference = `render:sha256_${broken}`;
    input.request.renderContentHash = broken;
    input.qc.videoRenderContentHash = broken;
    input.qc.artifacts.videoRender.contentHash = broken;
    input.qc.contentHash = qualityControlReportContentHash(input.qc);
    const truncatedReport = await verifyPhysicalMedia(input, opts);
    expect(truncatedReport.status).toBe('NOT_VALIDATED');
    expect(
      truncatedReport.decode === 'FAIL' || truncatedReport.structure === 'FAIL',
    ).toBe(true);
  },
);

it('protects inputs and an existing output and requires an exact manifest hash', async () => {
  const manifest = join(root, 'input.json');
  writeFileSync(
    manifest,
    JSON.stringify(physicalManifest(hash(readFileSync(mp4)))),
  );
  const sha = hash(readFileSync(manifest));
  const args = [
    '--manifest',
    manifest,
    '--manifest-sha256',
    sha,
    '--mp4',
    mp4,
    '--output',
    join(root, 'report.json'),
  ];
  expect(await runPhysicalVerificationCommand(args)).toBe(2);
  const output = readFileSync(join(root, 'report.json'));
  await expect(runPhysicalVerificationCommand(args)).rejects.toThrow();
  expect(readFileSync(join(root, 'report.json'))).toEqual(output);
  await expect(
    runPhysicalVerificationCommand([...args.slice(0, -1), mp4]),
  ).rejects.toThrow('OUTPUT_MUST_BE_NEW');
  await expect(
    runPhysicalVerificationCommand(
      args.map((v) => (v === sha ? 'e'.repeat(64) : v)),
    ),
  ).rejects.toThrow('MANIFEST_HASH_MISMATCH');
  expect(DatabaseSync).not.toHaveBeenCalled();
});

it('leaves unavailable inspection unproved and handles invalid manifests without inference', async () => {
  const input = physicalManifest(hash(readFileSync(mp4)));
  const report = await verifyPhysicalMedia(input, {
    mp4Path: mp4,
    decode: true,
  });
  expect(report.status).toBe('UNKNOWN');
  expect(report.absent).toEqual(['FFPROBE', 'FFMPEG_DECODE']);
  expect(
    (await verifyPhysicalMedia(undefined, options())).divergences,
  ).toContain('MANIFEST_INVALID');
  expect(
    (
      await verifyPhysicalMedia(input, {
        ...options(),
        mp4Path: '\\\\server\\share\\file.mp4',
      })
    ).absent,
  ).toContain('READABLE_MP4');
});
