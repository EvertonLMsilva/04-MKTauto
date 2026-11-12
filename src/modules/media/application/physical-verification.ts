import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  projectMediaHandoff,
  type MediaHandoff,
  type MediaHandoffRequest,
} from './media-handoff.js';
import { validateVideoRender } from '../domain/video-render-contracts.js';
import {
  runProcess,
  type ProcessRunner,
} from '../infrastructure/ffmpeg-process.js';
import { adaptationHash } from '../domain/media-hash.js';

export interface PhysicalMediaInput {
  schemaVersion: 'physical-media-input/1.0.0';
  request: MediaHandoffRequest;
  /** Revision declared by the selected manifest, not read from an operational DB. */
  scriptRevision: number;
  render: unknown;
  compositionPlan: unknown;
  compositionPlans: unknown[];
  renders: unknown[];
  qc: unknown;
  compositionReceipt?: {
    requestId: string;
    requestHash: string;
    videoRender: import('../domain/render.types.js').CompositionRender;
  };
  expected: { videoCodec: string; audioCodec: string; audioRequired: boolean };
}
export interface PhysicalMediaReport {
  schemaVersion: 'physical-media-report/1.0.0';
  scope: 'OFFLINE_MANIFEST';
  manifestHash: string | null;
  expectedRender: {
    id: string;
    revision: number;
    contentHash: string;
    durationMs: number;
    width: number;
    height: number;
    aspectRatio: string;
  } | null;
  verificationPolicy: {
    durationToleranceMs: 250;
    demuxer: 'mov';
    fullDecodeRequested: boolean;
  };
  status: 'TECHNICAL_VALIDATED' | 'NOT_VALIDATED' | 'UNKNOWN';
  identity: {
    pipelineRunId: string;
    scriptId: string;
    scriptRevision: number;
    scriptContentHash: string;
    scriptRevisionSource: 'MANIFEST_DECLARATION';
  } | null;
  mp4Sha256: string | null;
  metadata: {
    format: string;
    containerBrand: string | null;
    durationMs: number;
    video: {
      codec: string;
      width: number;
      height: number;
      aspectRatio: string | null;
      sampleAspectRatio: string | null;
    };
    audio: {
      codec: string;
      sampleRate: number | null;
      channels: number | null;
    } | null;
  } | null;
  structure: 'PASS' | 'FAIL' | 'NOT_PERFORMED';
  decode: 'PASS' | 'FAIL' | 'NOT_PERFORMED';
  handoff: MediaHandoff | null;
  absent: string[];
  divergences: string[];
  humanAudiovisualApproval: 'PENDING';
  commercialApproval: 'NOT_GRANTED';
  publicationAuthorized: false;
  databaseCurrentness: 'NOT_CHECKED';
}
export interface PhysicalVerificationOptions {
  mp4Path: string;
  ffprobePath?: string;
  ffmpegPath?: string;
  decode?: boolean;
  runner?: ProcessRunner;
}
export const physicalHash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
export const explicitLocalPath = (path: string) =>
  isAbsolute(path) && !path.startsWith('\\\\') && !path.startsWith('//');
export function readExplicitFile(path: string, limit: number) {
  if (!explicitLocalPath(path))
    throw new Error('EXPLICIT_ABSOLUTE_PATH_REQUIRED');
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > limit ||
    realpathSync(path) !== resolve(path)
  )
    throw new Error('INVALID_INPUT_FILE');
  return readFileSync(path);
}
function executable(path: string | undefined): path is string {
  try {
    if (!path || !explicitLocalPath(path) || !lstatSync(path).isFile())
      return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** No database, directory discovery, synthesis, composition, QC creation or grants. */
export async function verifyPhysicalMedia(
  value: unknown,
  options: PhysicalVerificationOptions,
): Promise<PhysicalMediaReport> {
  const report: PhysicalMediaReport = {
    schemaVersion: 'physical-media-report/1.0.0',
    scope: 'OFFLINE_MANIFEST',
    manifestHash: null,
    expectedRender: null,
    verificationPolicy: {
      durationToleranceMs: 250,
      demuxer: 'mov',
      fullDecodeRequested: options.decode === true,
    },
    status: 'NOT_VALIDATED',
    identity: null,
    mp4Sha256: null,
    metadata: null,
    structure: 'NOT_PERFORMED',
    decode: 'NOT_PERFORMED',
    handoff: null,
    absent: [],
    divergences: [],
    humanAudiovisualApproval: 'PENDING',
    commercialApproval: 'NOT_GRANTED',
    publicationAuthorized: false,
    databaseCurrentness: 'NOT_CHECKED',
  };
  let input: PhysicalMediaInput;
  let render: ReturnType<typeof validateVideoRender>;
  try {
    report.manifestHash = adaptationHash(value);
    input = value as PhysicalMediaInput;
    if (
      input?.schemaVersion !== 'physical-media-input/1.0.0' ||
      !Number.isSafeInteger(input.scriptRevision) ||
      input.scriptRevision < 1 ||
      !Array.isArray(input.compositionPlans) ||
      !Array.isArray(input.renders) ||
      input.compositionPlans.length > 1000 ||
      input.renders.length > 1000 ||
      !input.expected ||
      typeof input.expected.audioRequired !== 'boolean' ||
      !/^[a-z0-9_]{1,40}$/.test(input.expected.videoCodec) ||
      !/^[a-z0-9_]{1,40}$/.test(input.expected.audioCodec)
    )
      throw Error();
    render = validateVideoRender(input.render);
    report.expectedRender = {
      id: render.videoRenderId,
      revision: render.revision,
      contentHash: render.contentHash,
      durationMs: render.durationMilliseconds,
      width: render.widthPixels,
      height: render.heightPixels,
      aspectRatio: render.outputAspectRatio,
    };
    report.identity = {
      pipelineRunId: input.request.pipelineRunId,
      scriptId: input.request.scriptId,
      scriptRevision: input.scriptRevision,
      scriptContentHash: input.request.scriptContentHash,
      scriptRevisionSource: 'MANIFEST_DECLARATION',
    };
  } catch {
    report.divergences.push('MANIFEST_INVALID');
    return report;
  }
  try {
    report.mp4Sha256 = physicalHash(
      readExplicitFile(options.mp4Path, 524288000),
    );
  } catch {
    report.absent.push('READABLE_MP4');
    return report;
  }
  report.handoff = projectMediaHandoff(
    {
      getVideoRender: (id) =>
        id === render.videoRenderId
          ? render
          : (input.renders
              .map(validateVideoRender)
              .find((r) => r.videoRenderId === id) ?? null),
      getCompositionPlan: () => input.compositionPlan,
      listCompositionPlansByScript: () => input.compositionPlans,
      report: () =>
        input.qc as ReturnType<
          import('./media.service.js').MediaService['report']
        >,
      verifyMedia: () => report.mp4Sha256!,
      compositionReceipt: (id) =>
        input.compositionReceipt?.requestId === id
          ? input.compositionReceipt
          : null,
    },
    input.request,
    () => input.renders,
  );
  if (report.mp4Sha256 !== render.contentHash)
    report.divergences.push('MP4_HASH_MISMATCH');
  if (report.handoff.status !== 'READY_TECHNICAL')
    report.divergences.push(...report.handoff.blockers);
  const runner = options.runner ?? runProcess;
  const limits = {
    timeoutMs: 120000,
    maxLogBytes: 1048576,
    shell: false as const,
  };
  // Pin the demuxer and disable network protocols and MOV external data references.
  const localInput = [
    '-protocol_whitelist',
    'file,pipe',
    '-f',
    'mov',
    '-enable_drefs',
    '0',
    '-i',
    options.mp4Path,
  ];
  if (!executable(options.ffprobePath)) report.absent.push('FFPROBE');
  else {
    try {
      const result = await runner(
        options.ffprobePath,
        [
          '-v',
          'error',
          ...localInput,
          '-show_streams',
          '-show_format',
          '-of',
          'json',
        ],
        limits,
      );
      const data = JSON.parse(result.stdout);
      const streams = data.streams;
      if (!Array.isArray(streams) || streams.length > 32) throw Error();
      const videos = streams.filter((s) => s.codec_type === 'video');
      const audios = streams.filter((s) => s.codec_type === 'audio');
      const durationMs = Number(data.format?.duration) * 1000;
      if (
        videos.length !== 1 ||
        audios.length > 1 ||
        !Number.isFinite(durationMs) ||
        durationMs <= 0 ||
        typeof data.format?.format_name !== 'string'
      )
        throw Error();
      const v = videos[0],
        a = audios[0];
      if (
        !Number.isSafeInteger(v.width) ||
        !Number.isSafeInteger(v.height) ||
        v.width < 1 ||
        v.height < 1 ||
        typeof v.codec_name !== 'string' ||
        (a && typeof a.codec_name !== 'string')
      )
        throw Error();
      const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
      const sar =
        typeof v.sample_aspect_ratio === 'string'
          ? /^(\d{1,6}):(\d{1,6})$/.exec(v.sample_aspect_ratio)
          : null;
      const sarN = sar ? Number(sar[1]) : 0,
        sarD = sar ? Number(sar[2]) : 0;
      const displayWidth = v.width * sarN,
        displayHeight = v.height * sarD;
      const divisor =
        sarN > 0 && sarD > 0 ? gcd(displayWidth, displayHeight) : null;
      const aspectRatio = divisor
        ? `${displayWidth / divisor}:${displayHeight / divisor}`
        : null;
      if (!aspectRatio) report.absent.push('DISPLAY_ASPECT_RATIO');
      const brand =
        typeof data.format.tags?.major_brand === 'string'
          ? data.format.tags.major_brand
          : null;
      report.metadata = {
        format: data.format.format_name,
        containerBrand: brand,
        durationMs,
        video: {
          codec: v.codec_name,
          width: v.width,
          height: v.height,
          aspectRatio,
          sampleAspectRatio: sar ? v.sample_aspect_ratio : null,
        },
        audio: a
          ? {
              codec: a.codec_name,
              sampleRate:
                a.sample_rate !== undefined &&
                Number.isFinite(Number(a.sample_rate))
                  ? Number(a.sample_rate)
                  : null,
              channels: Number.isSafeInteger(a.channels) ? a.channels : null,
            }
          : null,
      };
      if (!brand) report.absent.push('CONTAINER_BRAND');
      const mismatch =
        (aspectRatio !== null && aspectRatio !== render.outputAspectRatio) ||
        render.containerFormat !== 'mp4' ||
        !data.format.format_name.split(',').includes('mp4') ||
        (brand !== null &&
          ![
            'isom',
            'iso2',
            'mp41',
            'mp42',
            'avc1',
            'dash',
            'M4V ',
            'MSNV',
          ].includes(brand)) ||
        Math.abs(durationMs - render.durationMilliseconds) > 250 ||
        v.width !== render.widthPixels ||
        v.height !== render.heightPixels ||
        v.codec_name !== input.expected.videoCodec ||
        (input.expected.audioRequired && !a) ||
        (a && a.codec_name !== input.expected.audioCodec) ||
        streams.some(
          (s) =>
            s.duration !== undefined &&
            (!Number.isFinite(Number(s.duration)) ||
              Math.abs(
                Number(s.duration) * 1000 - render.durationMilliseconds,
              ) > 250),
        );
      if (mismatch) {
        report.structure = 'FAIL';
        report.divergences.push('METADATA_MISMATCH');
      } else report.structure = 'PASS';
    } catch {
      report.structure = 'FAIL';
      report.divergences.push('FFPROBE_FAILED');
    }
  }
  if (options.decode) {
    if (!executable(options.ffmpegPath)) report.absent.push('FFMPEG_DECODE');
    else
      try {
        await runner(
          options.ffmpegPath,
          [
            '-v',
            'error',
            '-nostdin',
            '-xerror',
            ...localInput,
            '-map',
            '0:v:0',
            '-map',
            '0:a?',
            '-f',
            'null',
            '-',
          ],
          limits,
        );
        report.decode = 'PASS';
      } catch {
        report.decode = 'FAIL';
        report.divergences.push('DECODE_FAILED');
      }
  } else report.absent.push('FULL_DECODE');
  try {
    if (
      physicalHash(readExplicitFile(options.mp4Path, 524288000)) !==
      report.mp4Sha256
    )
      report.divergences.push('MP4_CHANGED_DURING_INSPECTION');
  } catch {
    report.divergences.push('MP4_CHANGED_DURING_INSPECTION');
  }
  report.status = report.divergences.length
    ? 'NOT_VALIDATED'
    : report.absent.length
      ? 'UNKNOWN'
      : 'TECHNICAL_VALIDATED';
  return report;
}
