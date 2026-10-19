import { createHash } from 'node:crypto';

import { createReadStream } from 'node:fs';
import { lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  COMPOSITION_PLAN_V2_CONTRACT_VERSION,
  validateCompositionPlan,
} from '../domain/composition-plan-contracts.js';
import {
  MEDIA_ASSET_V2_CONTRACT_VERSION,
  validateMediaAsset,
} from '../domain/media-asset-contracts.js';
import { validateVoiceTrack } from '../domain/voice-track-contracts.js';
import type {
  VideoComposer,
  RenderStorage,
} from '../application/video-composition.port.js';
import type { ProcessRunner } from './ffmpeg-process.js';
import type { FfmpegVideoConfig } from './ffmpeg-video-config.js';
import { inspectMvpPng } from './physical-media-inspection.js';
import { inspectMvpWav } from './physical-media-inspection.js';
import {
  FfmpegVideoAdapterError,
  ffmpegFailure,
} from './ffmpeg-video-error.js';
import { LocalCompositionReferenceResolver } from './local-composition-reference-resolver.js';
import { hashFile, LocalVideoStorage } from './local-video-storage.js';
import { validateScript } from '../../content/domain/script-contracts.js';
import { visualScriptMatches } from '../../content/domain/script-visual-lineage.js';

export { FfmpegVideoAdapterError } from './ffmpeg-video-error.js';
export { runProcess } from './ffmpeg-process.js';
import { runProcess } from './ffmpeg-process.js';

export class FfmpegVideoComposer implements VideoComposer {
  private readonly catalog: ArtifactCatalog;
  private readonly resolver: LocalCompositionReferenceResolver;
  private readonly storage: RenderStorage;
  private readonly processRunner: ProcessRunner;

  constructor(
    private readonly config: FfmpegVideoConfig,
    {
      artifactCatalog,
      referenceResolver,
      storage,
      processRunner = runProcess,
    }: ComposerDependencies,
  ) {
    validateConfig(config);
    if (
      !artifactCatalog ||
      typeof artifactCatalog.getVoiceTrack !== 'function' ||
      typeof artifactCatalog.getMediaAsset !== 'function'
    )
      throw new TypeError('catálogo de artefatos obrigatório');
    if (typeof processRunner !== 'function')
      throw new TypeError('executor de processo obrigatório');
    this.config = Object.freeze({ ...config });
    this.catalog = artifactCatalog;
    this.processRunner = processRunner;
    this.resolver =
      referenceResolver ?? new LocalCompositionReferenceResolver(config);
    this.storage =
      storage ??
      new LocalVideoStorage({
        root: config.renderRoot,
        maxBytes: config.maxOutputBytes,
      });
  }

  async compose(
    input: Parameters<VideoComposer['compose']>[0],
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<ComposerOutput> {
    if (input && 'commercialHybrid' in input)
      throw failure(
        'COMPOSER_POLICY_MISMATCH',
        'compositionPlan',
        'composição inicial obrigatória',
      );
    if (signal?.aborted)
      throw failure('COMPOSER_CANCELLED', 'signal', 'operação cancelada');
    const { plan, voice, media } = this.#validateInput(input);
    let staging: string | undefined;
    let result: ComposerOutput | undefined;
    let error: FfmpegVideoAdapterError | undefined;
    try {
      staging = await this.storage.createStaging();
      const staged = await this.#stageInputs(
        staging,
        plan,
        voice,
        media,
        signal,
      );
      const filterPath = join(staging, 'filtergraph.txt');
      const outputPath = join(staging, 'render.mp4');
      const graph = filterGraph(plan, this.config);
      await writeFile(filterPath, graph, { flag: 'wx', mode: 0o600 });
      await this.#execute(
        this.config.ffmpegPath,
        encodeArgs(staged, filterPath, outputPath, plan, this.config),
        staging,
        signal,
        'encode',
      );
      await requireOutput(outputPath, this.config.maxOutputBytes);
      await this.#decode(outputPath, staging, signal);
      const measured = await this.#probe(
        outputPath,
        staging,
        signal,
        plan.durationMilliseconds,
      );
      if (signal?.aborted)
        throw failure('COMPOSER_CANCELLED', 'signal', 'operação cancelada');
      const contentHash = await hashFile(
        outputPath,
        this.config.maxOutputBytes,
      );
      const promoted = await this.storage.promote(outputPath, contentHash, {
        validateExisting: async (path: any) => {
          await this.#decode(path, staging, signal);
          await this.#probe(path, staging, signal, plan.durationMilliseconds);
        },
      });
      if (
        (await hashFile(promoted.physicalPath, this.config.maxOutputBytes)) !==
        contentHash
      )
        throw failure(
          'COMPOSER_STORAGE_HASH_CONFLICT',
          'storage',
          'hash promovido divergente',
        );
      await this.#probe(
        promoted.physicalPath,
        staging,
        signal,
        plan.durationMilliseconds,
      );
      result = Object.freeze({
        ...measured,
        contentHash,
        logicalReference: promoted.logicalReference,
      });
    } catch (caught: unknown) {
      error = mapError(caught, signal);
    } finally {
      if (staging) {
        try {
          await this.storage.cleanup(staging);
        } catch (cause) {
          error = error
            ? failure(
                error.code,
                error.field,
                'composição e limpeza falharam',
                { cause: new AggregateError([error, cause]) },
              )
            : failure(
                'COMPOSER_STORAGE_FAILED',
                'staging',
                'limpeza temporária falhou',
                { cause },
              );
        }
      }
    }
    if (error) throw error;
    if (!result)
      throw failure('COMPOSER_FAILED', 'composer', 'composição incompleta');
    return result;
  }

  #validateInput(input: any): any {
    if (
      !input ||
      typeof input !== 'object' ||
      input.output?.containerFormat !== 'mp4' ||
      input.output?.widthPixels !== 1080 ||
      input.output?.heightPixels !== 1920
    )
      failureNow(
        'COMPOSER_POLICY_MISMATCH',
        'output',
        'saída fora da política',
      );
    let plan;
    try {
      plan = validateCompositionPlan(input.compositionPlan);
    } catch (caught: any) {
      failureNow(
        'COMPOSER_INPUT_INVALID',
        'compositionPlan',
        'plano inválido',
        { cause: caught },
      );
    }
    if (
      plan.outputAspectRatio !== '9:16' ||
      plan.segments.length > this.config.maxSegments ||
      plan.durationMilliseconds > this.config.maxDurationMilliseconds
    )
      failureNow(
        'COMPOSER_LIMIT_EXCEEDED',
        'compositionPlan',
        'plano fora dos limites',
      );
    let voice;
    try {
      voice = validateVoiceTrack(this.catalog.getVoiceTrack(plan.voiceTrackId));
    } catch (caught: any) {
      failureNow(
        'COMPOSER_INPUT_INVALID',
        'voiceTrack',
        'voz persistida inválida',
        { cause: caught },
      );
    }
    if (
      voice.voiceTrackId !== plan.voiceTrackId ||
      voice.contentHash !== plan.voiceTrackContentHash
    )
      failureNow(
        'COMPOSER_VOICE_HASH_MISMATCH',
        'voiceTrackContentHash',
        'voz divergente do plano',
      );
    verifyScope(plan, voice, 'voiceTrack');
    if (
      voice.audioFormat !== 'wav' ||
      voice.durationMilliseconds !== plan.durationMilliseconds
    )
      failureNow(
        'COMPOSER_VOICE_UNSUPPORTED',
        'voiceTrack',
        'voz fora da política',
      );
    const media = plan.segments.map((segment: any, index: any) => {
      let asset: any;
      try {
        asset = validateMediaAsset(
          this.catalog.getMediaAsset(segment.mediaAssetId),
        );
      } catch (caught: any) {
        failureNow(
          'COMPOSER_INPUT_INVALID',
          `segments.${index}.mediaAssetId`,
          'mídia persistida inválida',
          { cause: caught },
        );
      }
      if (
        asset.mediaAssetId !== segment.mediaAssetId ||
        asset.contentHash !== segment.mediaAssetContentHash
      )
        failureNow(
          'COMPOSER_MEDIA_HASH_MISMATCH',
          `segments.${index}.mediaAssetContentHash`,
          'mídia divergente do plano',
        );
      let visualRevision = false;
      if (asset.scriptId !== plan.scriptId && this.catalog.getScript) {
        const script = validateScript(this.catalog.getScript(plan.scriptId));
        visualRevision =
          script.contentHash === plan.scriptContentHash &&
          visualScriptMatches(
            script,
            asset.scriptId,
            asset.scriptContentHash,
            (id) => {
              const previous = this.catalog.getScript!(id);
              return previous ? validateScript(previous) : null;
            },
          );
      }
      verifyScope(plan, asset, `segments.${index}`, visualRevision);
      if (plan.schemaVersion === COMPOSITION_PLAN_V2_CONTRACT_VERSION) {
        if (asset.assetType !== segment.mediaType)
          failureNow(
            'COMPOSER_MEDIA_TYPE_MISMATCH',
            `segments.${index}.mediaType`,
            'tipo divergente do plano',
          );
        if (
          asset.assetType === 'VIDEO' &&
          (asset.schemaVersion !== MEDIA_ASSET_V2_CONTRACT_VERSION ||
            asset.technicalProperties.format !== 'mp4' ||
            asset.technicalProperties.mimeType !== 'video/mp4')
        )
          failureNow(
            'COMPOSER_MEDIA_UNSUPPORTED',
            `segments.${index}`,
            'vídeo fora da allowlist',
          );
        if (
          asset.assetType === 'IMAGE' &&
          (asset.technicalProperties.format !== 'png' ||
            (asset.schemaVersion === MEDIA_ASSET_V2_CONTRACT_VERSION &&
              asset.technicalProperties.mimeType !== 'image/png'))
        )
          failureNow(
            'COMPOSER_MEDIA_UNSUPPORTED',
            `segments.${index}`,
            'imagem fora da allowlist',
          );
        const duration = segment.endMilliseconds - segment.startMilliseconds;
        if (
          asset.assetType === 'VIDEO' &&
          segment.sourceStartMilliseconds >=
            asset.technicalProperties.durationMilliseconds
        )
          failureNow(
            'COMPOSER_TRIM_OUT_OF_RANGE',
            `segments.${index}.sourceStartMilliseconds`,
            'início fora do clipe',
          );
        if (
          asset.assetType === 'VIDEO' &&
          segment.playbackMode === 'TRIM' &&
          segment.sourceStartMilliseconds + duration >
            asset.technicalProperties.durationMilliseconds
        )
          failureNow(
            'COMPOSER_VIDEO_TOO_SHORT',
            `segments.${index}`,
            'clipe curto sem loop',
          );
      } else if (
        asset.assetType !== 'IMAGE' ||
        asset.technicalProperties.format !== 'png'
      )
        failureNow(
          'COMPOSER_MEDIA_UNSUPPORTED',
          `segments.${index}`,
          'mídia fora da allowlist',
        );
      return asset;
    });
    return { plan, voice, media };
  }

  async #stageInputs(
    staging: any,
    plan: any,
    voice: any,
    media: any,
    signal: any,
  ): Promise<any> {
    const items: any = [];
    let total = 0;
    const voiceSource = await this.resolver.resolveVoice(
      voice.storageReference,
    );
    items.push(
      await copyAndValidate(
        voiceSource,
        join(staging, 'voice.wav'),
        Math.min(this.config.maxVoiceBytes, this.config.maxTotalInputBytes),
        voice.contentHash,
        (bytes: any) => {
          const measured = inspectMvpWav(bytes);
          if (
            measured.durationMilliseconds !== voice.durationMilliseconds ||
            measured.audioFormat !== voice.audioFormat
          )
            failureNow(
              'COMPOSER_VOICE_PROPERTIES_MISMATCH',
              'voiceTrack',
              'propriedades físicas da voz divergentes',
            );
        },
        signal,
      ),
    );
    total += items[0].size;
    for (let index = 0; index < media.length; index += 1) {
      const asset = media[index];
      const video = asset.assetType === 'VIDEO';
      const extension = video ? 'mp4' : 'png';
      const source = await this.resolver.resolveMedia(
        asset.mediaReference,
        extension,
      );
      const item = await copyAndValidate(
        source,
        join(
          staging,
          `media-${String(index + 1).padStart(3, '0')}.${extension}`,
        ),
        Math.min(
          video
            ? (this.config.maxVideoBytes ?? this.config.maxTotalInputBytes)
            : this.config.maxImageBytes,
          this.config.maxTotalInputBytes - total,
        ),
        asset.contentHash,
        (bytes: any) => {
          if (!video) {
            const measured = inspectMvpPng(bytes);
            const expected = asset.technicalProperties;
            if (
              measured.format !== expected.format ||
              measured.widthPixels !== expected.widthPixels ||
              measured.heightPixels !== expected.heightPixels
            )
              failureNow(
                'COMPOSER_MEDIA_PROPERTIES_MISMATCH',
                `segments.${index}`,
                'propriedades físicas da mídia divergentes',
              );
          }
        },
        signal,
      );
      if (video) {
        await this.#decodeInputVideo(item.path, staging, signal);
        await this.#probeInputVideo(item.path, staging, signal, asset, index);
      }
      items.push({
        ...item,
        assetType: asset.assetType,
        segment: plan.segments[index],
      });
      total += item.size;
    }
    if (total > this.config.maxTotalInputBytes)
      failureNow(
        'COMPOSER_LIMIT_EXCEEDED',
        'inputs',
        'entradas excedem limite total',
      );
    return {
      voicePath: items[0].path,
      media: items.slice(1),
      mediaPaths: items.slice(1).map(({ path }: any) => path),
    };
  }

  async #execute(
    command: any,
    args: any,
    cwd: any,
    signal: any,
    phase: any,
  ): Promise<any> {
    try {
      if (signal?.aborted)
        throw failure('COMPOSER_CANCELLED', 'signal', 'operação cancelada');
      const result = await this.processRunner(command, args, {
        cwd,
        signal,
        timeoutMs: this.config.timeoutMs,
        maxLogBytes: this.config.maxLogBytes,
        outputPath: phase === 'encode' ? args.at(-1) : undefined,
        maxOutputBytes: this.config.maxOutputBytes,
        shell: false,
        windowsHide: true,
      });
      if (signal?.aborted)
        throw failure('COMPOSER_CANCELLED', 'signal', 'operação cancelada');
      return result;
    } catch (caught: any) {
      if (caught instanceof FfmpegVideoAdapterError) throw caught;
      if (
        [
          'COMPOSER_TIMEOUT',
          'COMPOSER_CANCELLED',
          'COMPOSER_OUTPUT_INVALID',
        ].includes(caught?.code)
      )
        throw caught;
      if (caught?.code === 'ENOENT')
        throw failure('COMPOSER_UNAVAILABLE', phase, 'binário indisponível', {
          cause: caught,
        });
      throw failure(
        'COMPOSER_PROCESS_FAILED',
        phase,
        'processo de mídia falhou',
        { cause: caught },
      );
    }
  }
  async #decode(path: any, cwd: any, signal: any): Promise<any> {
    await this.#execute(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-v',
        'error',
        '-xerror',
        '-i',
        path,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-f',
        'null',
        '-',
      ],
      cwd,
      signal,
      'decode',
    );
  }
  async #decodeInputVideo(path: any, cwd: any, signal: any): Promise<any> {
    await this.#execute(
      this.config.ffmpegPath,
      [
        '-hide_banner',
        '-v',
        'error',
        '-xerror',
        '-i',
        path,
        '-map',
        '0:v:0',
        '-an',
        '-f',
        'null',
        '-',
      ],
      cwd,
      signal,
      'inputDecode',
    );
  }
  async #probeInputVideo(
    path: any,
    cwd: any,
    signal: any,
    asset: any,
    index: any,
  ): Promise<any> {
    const result = await this.#execute(
      this.config.ffprobePath,
      [
        '-v',
        'error',
        '-of',
        'json',
        '-show_entries',
        'format=format_name,duration:stream=codec_type,width,height,duration',
        '-show_streams',
        '-show_format',
        path,
      ],
      cwd,
      signal,
      'inputProbe',
    );
    parseInputVideoProbe(result?.stdout, asset, index, this.config);
  }
  async #probe(
    path: any,
    cwd: any,
    signal: any,
    durationMilliseconds: any,
  ): Promise<any> {
    const result = await this.#execute(
      this.config.ffprobePath,
      [
        '-v',
        'error',
        '-of',
        'json',
        '-show_entries',
        'format=format_name,duration,size:stream=index,codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,sample_rate,channels',
        '-show_streams',
        '-show_format',
        path,
      ],
      cwd,
      signal,
      'probe',
    );
    return parseProbe(result?.stdout, durationMilliseconds, this.config);
  }
}

export interface ArtifactCatalog {
  getScript?(id: string): unknown;
  getVoiceTrack(id: string): unknown;
  getMediaAsset(id: string): unknown;
}

async function readBounded(
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of createReadStream(path, {
    signal,
    highWaterMark: 65536,
  })) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > maxBytes)
      throw failure(
        'COMPOSER_LIMIT_EXCEEDED',
        'input',
        'entrada fora do limite',
      );
    parts.push(bytes);
  }
  if (size < 1)
    throw failure('COMPOSER_INPUT_INVALID', 'input', 'entrada vazia');
  return Buffer.concat(parts, size);
}
export interface ComposerOutput {
  durationMilliseconds: number;
  containerFormat: string;
  widthPixels: number;
  heightPixels: number;
  contentHash: string;
  logicalReference: string;
}
export interface ComposerDependencies {
  artifactCatalog: ArtifactCatalog;
  referenceResolver?: LocalCompositionReferenceResolver;
  storage?: RenderStorage;
  processRunner?: ProcessRunner;
}

function filterGraph(plan: any, config: any): any {
  if (plan.schemaVersion === COMPOSITION_PLAN_V2_CONTRACT_VERSION)
    return mixedFilterGraph(plan, config);
  const duration = seconds(plan.durationMilliseconds);
  const filters = plan.segments.map(
    (_: any, index: any) =>
      `[${index}:v]scale=${config.widthPixels}:${config.heightPixels}:force_original_aspect_ratio=increase:flags=lanczos,crop=${config.widthPixels}:${config.heightPixels},setsar=1,fps=${config.frameRate},format=${config.pixelFormat},trim=duration=${duration},setpts=PTS-STARTPTS[i${index}]`,
  );
  let current = 'i0';
  for (let index = 1; index < plan.segments.length; index += 1) {
    const next = `v${index}`;
    filters.push(
      `[${current}][i${index}]overlay=enable='gte(t\\,${seconds(plan.segments[index].startMilliseconds)})':shortest=1:eof_action=repeat[${next}]`,
    );
    current = next;
  }
  if (current === 'i0') filters.push('[i0]null[vout]');
  else filters.push(`[${current}]null[vout]`);
  const audioIndex = plan.segments.length;
  filters.push(
    `[${audioIndex}:a:0]aresample=${config.audioSampleRate},atrim=duration=${duration},asetpts=PTS-STARTPTS[aout]`,
  );
  return `${filters.join(';\n')}\n`;
}

function mixedFilterGraph(plan: any, config: any): any {
  const filters = plan.segments.map((segment: any, index: any) => {
    const duration = seconds(
      segment.endMilliseconds - segment.startMilliseconds,
    );
    return `[${index}:v]scale=${config.widthPixels}:${config.heightPixels}:force_original_aspect_ratio=increase:flags=lanczos,crop=${config.widthPixels}:${config.heightPixels},setsar=1,fps=${config.frameRate},format=${config.pixelFormat},trim=duration=${duration},setpts=PTS-STARTPTS[i${index}]`;
  });
  filters.push(
    `${plan.segments.map((_: any, index: any) => `[i${index}]`).join('')}concat=n=${plan.segments.length}:v=1:a=0[vout]`,
  );
  filters.push(
    `[${plan.segments.length}:a:0]aresample=${config.audioSampleRate},atrim=duration=${seconds(plan.durationMilliseconds)},asetpts=PTS-STARTPTS[aout]`,
  );
  return `${filters.join(';\n')}\n`;
}

function encodeArgs(
  staged: any,
  filterPath: any,
  outputPath: any,
  plan: any,
  config: any,
): any {
  const duration = seconds(plan.durationMilliseconds);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n'];
  if (plan.schemaVersion === COMPOSITION_PLAN_V2_CONTRACT_VERSION) {
    for (const item of staged.media) {
      const segmentDuration = seconds(
        item.segment.endMilliseconds - item.segment.startMilliseconds,
      );
      if (item.assetType === 'IMAGE')
        args.push(
          '-loop',
          '1',
          '-framerate',
          String(config.frameRate),
          '-t',
          segmentDuration,
          '-i',
          item.path,
        );
      else {
        if (item.segment.playbackMode === 'LOOP')
          args.push('-stream_loop', '-1');
        if (item.segment.sourceStartMilliseconds > 0)
          args.push('-ss', seconds(item.segment.sourceStartMilliseconds));
        args.push('-t', segmentDuration, '-i', item.path);
      }
    }
  } else
    for (const path of staged.mediaPaths)
      args.push(
        '-loop',
        '1',
        '-framerate',
        String(config.frameRate),
        '-t',
        duration,
        '-i',
        path,
      );
  args.push(
    '-i',
    staged.voicePath,
    '-filter_complex_script',
    filterPath,
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-t',
    duration,
    '-fps_mode',
    'cfr',
    '-c:v',
    config.videoCodec,
    '-profile:v',
    config.videoProfile,
    '-level:v',
    config.videoLevel,
    '-crf',
    String(config.crf),
    '-preset',
    config.preset,
    '-pix_fmt',
    config.pixelFormat,
    '-r',
    String(config.frameRate),
    '-g',
    String(config.gopSize),
    '-keyint_min',
    String(config.gopSize),
    '-sc_threshold',
    '0',
    '-threads:v',
    '1',
    '-c:a',
    config.audioCodec,
    '-profile:a',
    config.audioProfile,
    '-b:a',
    config.audioBitrate,
    '-ar',
    String(config.audioSampleRate),
    '-ac',
    String(config.audioChannels),
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-metadata',
    'creation_time=1970-01-01T00:00:00Z',
    '-fflags',
    '+bitexact',
    '-flags:v',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    outputPath,
  );
  return args;
}

function parseInputVideoProbe(
  text: any,
  asset: any,
  index: any,
  config: any,
): any {
  if (typeof text !== 'string' || Buffer.byteLength(text) > config.maxLogBytes)
    failureNow(
      'COMPOSER_MEDIA_PROBE_INVALID',
      `segments.${index}`,
      'probe inválido',
    );
  let value;
  try {
    value = JSON.parse(text);
  } catch (caught: any) {
    failureNow(
      'COMPOSER_MEDIA_PROBE_INVALID',
      `segments.${index}`,
      'probe malformado',
      { cause: caught },
    );
  }
  const streams = Array.isArray(value?.streams) ? value.streams : [];
  const video = streams.filter(({ codec_type: type }: any) => type === 'video');
  const audio = streams.filter(({ codec_type: type }: any) => type === 'audio');
  const measuredDuration = milliseconds(value?.format?.duration);
  const expected = asset.technicalProperties;
  if (
    video.length !== 1 ||
    !String(value?.format?.format_name ?? '')
      .split(',')
      .includes('mp4') ||
    video[0].width !== expected.widthPixels ||
    video[0].height !== expected.heightPixels ||
    measuredDuration !== expected.durationMilliseconds ||
    audio.length > 0 !== expected.hasAudio
  )
    failureNow(
      'COMPOSER_MEDIA_PROPERTIES_MISMATCH',
      `segments.${index}`,
      'propriedades físicas do vídeo divergentes',
    );
}

async function copyAndValidate(
  source: any,
  destination: any,
  maxBytes: any,
  expectedHash: any,
  inspect: any,
  signal: any,
): Promise<any> {
  if (signal?.aborted)
    failureNow('COMPOSER_CANCELLED', 'signal', 'operação cancelada');
  const sourceInfo = await lstat(source);
  if (!sourceInfo.isFile() || sourceInfo.size < 1 || sourceInfo.size > maxBytes)
    failureNow('COMPOSER_LIMIT_EXCEEDED', 'input', 'entrada fora do limite');
  const bytes = await readBounded(source, maxBytes, signal);
  validateBytes(bytes, expectedHash, inspect);
  await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
  const consumed = await readBounded(destination, maxBytes, signal);
  validateBytes(consumed, expectedHash, inspect);
  return { path: destination, size: consumed.length };
}
function validateBytes(bytes: any, expectedHash: any, inspect: any): any {
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash)
    failureNow(
      'COMPOSER_PHYSICAL_HASH_MISMATCH',
      'input',
      'hash físico divergente',
    );
  try {
    inspect(bytes);
  } catch (caught: any) {
    if (caught instanceof FfmpegVideoAdapterError) throw caught;
    failureNow('COMPOSER_INPUT_INVALID', 'input', 'conteúdo físico inválido', {
      cause: caught,
    });
  }
}
function parseProbe(text: any, expectedDuration: any, config: any): any {
  if (typeof text !== 'string' || Buffer.byteLength(text) > config.maxLogBytes)
    failureNow('COMPOSER_PROBE_INVALID', 'probe', 'resposta do probe inválida');
  let value;
  try {
    value = JSON.parse(text);
  } catch (caught: any) {
    failureNow(
      'COMPOSER_PROBE_INVALID',
      'probe',
      'resposta do probe malformada',
      { cause: caught },
    );
  }
  const streams = Array.isArray(value?.streams) ? value.streams : [];
  const video = streams.filter(({ codec_type: type }: any) => type === 'video');
  const audio = streams.filter(({ codec_type: type }: any) => type === 'audio');
  const format = value?.format;
  const duration = milliseconds(format?.duration);
  const valid =
    video.length === 1 &&
    audio.length === 1 &&
    streams.length === 2 &&
    String(format?.format_name).split(',').includes('mp4') &&
    durationWithinFrameTolerance(
      duration,
      expectedDuration,
      config.frameRate,
    ) &&
    video[0].codec_name === 'h264' &&
    video[0].profile === 'High' &&
    video[0].level === 40 &&
    video[0].width === config.widthPixels &&
    video[0].height === config.heightPixels &&
    video[0].pix_fmt === config.pixelFormat &&
    video[0].r_frame_rate === '30/1' &&
    video[0].avg_frame_rate === '30/1' &&
    durationWithinFrameTolerance(
      Number(video[0].duration) * 1000,
      expectedDuration,
      config.frameRate,
    ) &&
    audio[0].codec_name === 'aac' &&
    audio[0].profile === 'LC' &&
    audio[0].sample_rate === String(config.audioSampleRate) &&
    audio[0].channels === config.audioChannels &&
    milliseconds(audio[0].duration) === expectedDuration;
  if (!valid)
    failureNow(
      'COMPOSER_OUTPUT_POLICY_MISMATCH',
      'output',
      'saída medida diverge da política',
    );
  return Object.freeze({
    durationMilliseconds: expectedDuration,
    containerFormat: 'mp4',
    widthPixels: video[0].width,
    heightPixels: video[0].height,
  });
}
function milliseconds(value: any): any {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.round(number * 1000)
    : NaN;
}
function seconds(millisecondsValue: any): any {
  return (millisecondsValue / 1000).toFixed(3);
}
async function requireOutput(path: any, maxBytes: any): Promise<any> {
  const value = await lstat(path).catch((caught: any) => {
    failureNow('COMPOSER_OUTPUT_INVALID', 'output', 'saída ausente', {
      cause: caught,
    });
  });
  if (!value?.isFile() || value.size < 1 || value.size > maxBytes)
    failureNow('COMPOSER_OUTPUT_INVALID', 'output', 'saída inválida');
}
function verifyScope(
  plan: any,
  artifact: any,
  field: any,
  visualRevision = false,
): any {
  for (const key of [
    'pipelineRunId',
    'projectId',
    'projectVersion',
    'scriptId',
    'scriptContentHash',
  ])
    if (
      !(visualRevision && ['scriptId', 'scriptContentHash'].includes(key)) &&
      artifact[key] !== plan[key]
    )
      failureNow(
        'COMPOSER_ARTIFACT_SCOPE_MISMATCH',
        `${field}.${key}`,
        'artefato fora do escopo do plano',
      );
}
function validateConfig(config: any): any {
  const exact = {
    policyVersion: 'ffmpeg-video-policy/1.0.0',
    widthPixels: 1080,
    heightPixels: 1920,
    frameRate: 30,
    videoCodec: 'libx264',
    videoProfile: 'high',
    videoLevel: '4.0',
    crf: 20,
    preset: 'medium',
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    audioProfile: 'aac_low',
    audioBitrate: '192k',
    audioSampleRate: 48000,
    audioChannels: 1,
    gopSize: 60,
    maxSegments: 60,
    maxDurationMilliseconds: 180000,
  };
  const strings = [
    'ffmpegPath',
    'ffprobePath',
    'voiceRoot',
    'mediaRoot',
    'renderRoot',
    'stagingRoot',
  ];
  const limits = [
    'maxVoiceBytes',
    'maxImageBytes',
    'maxTotalInputBytes',
    'maxOutputBytes',
    'timeoutMs',
    'maxLogBytes',
  ];
  const invalid =
    !config ||
    Object.entries(exact).some(([key, value]: any) => config[key] !== value) ||
    strings.some(
      (key: any) => typeof config[key] !== 'string' || config[key].length === 0,
    ) ||
    limits.some(
      (key: any) => !Number.isSafeInteger(config[key]) || config[key] < 1,
    ) ||
    config.stagingRoot !== join(config.renderRoot, '.staging');
  if (invalid)
    throw failure(
      'FFMPEG_CONFIGURATION_INVALID',
      'config',
      'configuração fora da política',
    );
}
function mapError(caught: any, signal: any): any {
  if (caught instanceof FfmpegVideoAdapterError) return caught;
  if (typeof caught?.code === 'string' && typeof caught?.field === 'string')
    return failure(caught.code, caught.field, 'falha de armazenamento', {
      cause: caught,
    });
  if (caught?.code === 'COMPOSER_TIMEOUT')
    return failure('COMPOSER_TIMEOUT', 'process', 'processo excedeu o limite', {
      cause: caught,
    });
  if (
    signal?.aborted ||
    caught?.name === 'AbortError' ||
    caught?.code === 'COMPOSER_CANCELLED'
  )
    return failure('COMPOSER_CANCELLED', 'signal', 'operação cancelada', {
      cause: caught,
    });
  return failure('COMPOSER_FAILED', 'composer', 'composição não concluída', {
    cause: caught,
  });
}
function durationWithinFrameTolerance(
  measuredDuration: any,
  expectedDuration: any,
  frameRate: any,
): boolean {
  if (!Number.isFinite(measuredDuration)) return false;

  const tolerance = 1000 / frameRate + 0.5;

  return Math.abs(measuredDuration - expectedDuration) <= tolerance;
}
function failure(code: any, field: any, message: any, options?: any): any {
  return ffmpegFailure(code, field, message, options);
}
function failureNow(code: any, field: any, message: any, options?: any): never {
  throw failure(code, field, message, options);
}
