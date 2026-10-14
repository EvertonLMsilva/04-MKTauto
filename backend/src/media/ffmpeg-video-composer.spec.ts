import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FfmpegVideoComposer } from './infrastructure/ffmpeg-video-composer.js';
import { runProcess } from './infrastructure/ffmpeg-video-composer.js';

import { LocalCompositionReferenceResolver } from './infrastructure/local-composition-reference-resolver.js';
import { LocalVideoStorage } from './infrastructure/local-video-storage.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import { loadFfmpegVideoConfig } from './infrastructure/ffmpeg-video-config.js';
import { createVideoComposer } from './infrastructure/ffmpeg-composer.provider.js';
import { ffmpegFixture } from '../../test/support/ffmpeg-composition-fixture.js';
import { MediaService } from './application/media.service.js';

const { png, sha256, wav } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);
const { FfmpegVideoComposer: LegacyComposer } = await import(
  new URL('../../../src/adapters/ffmpeg-video-composer.js', import.meta.url)
    .href
);

test.each([false, true])(
  'native composition serializes overlapping requests, conflicting=%s',
  async (conflicting) => {
    const f = ffmpegFixture();
    try {
      const service = new MediaService(
        f.store,
        await createVideoComposer(f.store, f.env, f.runner),
      );
      const a = f.request(),
        b = f.request(conflicting ? 'native_002' : 'native_001');
      const results = await Promise.allSettled([
        service.compose(a),
        service.compose(b),
      ]);
      const successful = results.filter((r) => r.status === 'fulfilled');
      assert.equal(successful.length, conflicting ? 1 : 2);
      if (conflicting)
        assert.equal(
          (
            results.find(
              (r) => r.status === 'rejected',
            ) as PromiseRejectedResult
          ).reason.code,
          'VIDEO_RENDER_REVISION_CONFLICT',
        );
      else assert.deepEqual(successful[0].value, successful[1].value);
      const winner = successful[0].value;
      const winnerRequest =
        winner.videoRenderId === 'video_render:native_001' ? a : b;
      const callsBefore = f.calls.length;
      assert.deepEqual(await service.compose(winnerRequest), winner);
      assert.equal(f.calls.length, callsBefore);
      assert.deepEqual(
        service.compositionReceipt(winnerRequest.videoCompositionRequestId),
        { requestHash: winnerRequest.contentHash, videoRender: winner },
      );
      const repository = f.store.openInitialRender(true);
      try {
        assert.equal(
          repository.listVideoRendersByCompositionPlan(f.plan.compositionPlanId)
            .length,
          1,
        );
        const lineage = repository.getArtifact(winner.videoRenderId);
        assert.equal(lineage.contentHash, winner.contentHash);
        assert.deepEqual(
          lineage.inputs.map((i: any) => i.inputId),
          [f.plan.compositionPlanId],
        );
        assert.deepEqual(
          repository
            .getArtifact(f.plan.compositionPlanId)
            .inputs.map((i: any) => i.inputId),
          [
            f.plan.scriptId,
            f.plan.voiceTrackId,
            ...f.plan.segments.map((s: any) => s.mediaAssetId),
          ],
        );
      } finally {
        repository.close();
      }
      assert.deepEqual(readdirSync(join(f.renderRoot, '.staging')), []);
    } finally {
      f.close();
    }
  },
);

test('receipt write failure rolls back native render and lineage and permits retry', async () => {
  const f = ffmpegFixture();
  const repository = f.store.openInitialRender();
  try {
    const composer = await createVideoComposer(f.store, f.env, f.runner);
    const { VideoCompositionService } =
      await import('./application/video-composition.service.js');
    const service = new VideoCompositionService(repository, composer);
    const prepare = repository.db.prepare.bind(repository.db);
    const fault = vi
      .spyOn(repository.db, 'prepare')
      .mockImplementation((sql: any) => {
        if (sql.includes('INSERT INTO video_composition_requests'))
          throw Object.assign(new Error('fixture storage failure'), {
            code: 'ERR_SQLITE_ERROR',
          });
        return prepare(sql);
      });
    await assert.rejects(
      service.compose(f.request()),
      adapterError('VIDEO_RENDER_PERSISTENCE_FAILED'),
    );
    fault.mockRestore();
    assert.equal(repository.getVideoRender('video_render:native_001'), null);
    assert.equal(repository.getArtifact('video_render:native_001'), null);
    assert.equal(repository.getVideoComposition('native_001'), null);
    assert.equal(repository.db.isTransaction, false);
    assert.deepEqual(readdirSync(join(f.renderRoot, '.staging')), []);
    assert.equal(
      (await service.compose(f.request())).videoRenderId,
      'video_render:native_001',
    );
  } finally {
    repository.close();
    f.close();
  }
});

test('CFR frame quantization retains exact plan duration; excessive duration is rejected', async () =>
  withRoots(async (roots: any) => {
    const f = physicalFixture(roots);
    for (const measured of ['1.033333', '1.100000']) {
      const runner = async (command: string, args: string[]) => {
        if (args.includes('-filter_complex_script'))
          writeFileSync(args.at(-1)!, Buffer.from('quantized-output'));
        const probe = JSON.parse(probeJson(1000));
        probe.format.duration = measured;
        probe.streams[0].duration = measured;
        return {
          stdout: command === 'ffprobe-bin' ? JSON.stringify(probe) : '',
        };
      };
      const pending = makeComposer(roots, f.catalog, runner).compose(input(f));
      if (measured === '1.033333')
        assert.equal((await pending).durationMilliseconds, 1000);
      else
        await assert.rejects(
          pending,
          adapterError('COMPOSER_OUTPUT_POLICY_MISMATCH'),
        );
    }
  }));

test('mid-encode cancellation, input/output limits and cleanup failure are explicit', async () =>
  withRoots(async (roots: any) => {
    const f = physicalFixture(roots);
    const controller = new AbortController();
    const runner = async (_command: string, args: string[]) => {
      if (args.includes('-filter_complex_script')) {
        writeFileSync(args.at(-1)!, Buffer.from('output'));
        controller.abort();
        throw Object.assign(new Error('PRIVATE details'), {
          code: 'COMPOSER_CANCELLED',
        });
      }
      return { stdout: '' };
    };
    await assert.rejects(
      makeComposer(roots, f.catalog, runner).compose(input(f), {
        signal: controller.signal,
      }),
      adapterError('COMPOSER_CANCELLED'),
    );
    const limited = new FfmpegVideoComposer(
      { ...config(roots), maxTotalInputBytes: 1 },
      { artifactCatalog: f.catalog, processRunner: runner },
    );
    await assert.rejects(
      limited.compose(input(f)),
      adapterError('COMPOSER_LIMIT_EXCEEDED'),
    );
    const oversized = new FfmpegVideoComposer(
      { ...config(roots), maxOutputBytes: 1 },
      {
        artifactCatalog: f.catalog,
        processRunner: async (_command, args) => {
          if (args.includes('-filter_complex_script'))
            writeFileSync(args.at(-1)!, Buffer.from('oversized'));
          return { stdout: '' };
        },
      },
    );
    await assert.rejects(
      oversized.compose(input(f)),
      adapterError('COMPOSER_OUTPUT_INVALID'),
    );
    const storage = new LocalVideoStorage({
      root: roots.renderRoot,
      maxBytes: 1024,
    });
    const cleanup = storage.cleanup.bind(storage);
    storage.cleanup = async (path) => {
      await cleanup(path);
      throw new Error('PRIVATE cleanup');
    };
    const composer = new FfmpegVideoComposer(config(roots), {
      artifactCatalog: f.catalog,
      storage,
      processRunner: async () => {
        throw new Error('PRIVATE process');
      },
    });
    await assert.rejects(
      composer.compose(input(f)),
      (caught: any) =>
        adapterError('COMPOSER_PROCESS_FAILED')(caught) &&
        caught.cause instanceof AggregateError,
    );
    assert.deepEqual(readdirSync(join(roots.renderRoot, '.staging')), []);
  }));

test('process runner passes shell metacharacters literally and stops oversized writers before cleanup', async () =>
  withRoots(async (roots: any) => {
    const literal = '& echo PRIVATE';
    const result = await runProcess(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', literal],
      { timeoutMs: 2000, maxLogBytes: 128 },
    );
    assert.equal(result.stdout, literal);
    const outputPath = join(roots.renderRoot, 'process-output');
    await assert.rejects(
      runProcess(
        process.execPath,
        [
          '-e',
          'require("node:fs").writeFileSync(process.argv[1], Buffer.alloc(2048));setInterval(()=>{},1000)',
          outputPath,
        ],
        { timeoutMs: 2000, maxLogBytes: 128, outputPath, maxOutputBytes: 1024 },
      ),
      adapterError('COMPOSER_OUTPUT_INVALID'),
    );
    // The rejection waits for close, so the writer no longer owns the file.
    rmSync(outputPath);
  }));

test.each(['V1', 'TRIM', 'LOOP'])(
  'JS/TS initial adapter parity: %s',
  async (mode) => {
    async function capture(Composer: typeof FfmpegVideoComposer) {
      return withRoots(async (roots: any) => {
        const f =
          mode === 'V1'
            ? physicalFixture(roots)
            : mixedPhysicalFixture(roots, mode);
        const calls: any[] = [];
        let graph = '';
        const runner = async (
          command: string,
          args: string[],
          options: any,
        ) => {
          calls.push({
            command,
            args: args.map((v) =>
              v
                .replaceAll(options.cwd, '<stage>')
                .replaceAll(roots.renderRoot, '<render>'),
            ),
            shell: options.shell,
            windowsHide: options.windowsHide,
            timeoutMs: options.timeoutMs,
            maxLogBytes: options.maxLogBytes,
          });
          if (args.includes('-filter_complex_script')) {
            graph = readFileSync(
              args[args.indexOf('-filter_complex_script') + 1],
              'utf8',
            );
            writeFileSync(args.at(-1)!, Buffer.from('parity-mp4'));
          }
          return {
            stdout:
              command === 'ffprobe-bin'
                ? args.at(-1)!.includes('media-001')
                  ? inputVideoProbeJson(1000, mode === 'TRIM')
                  : probeJson(1000)
                : '',
          };
        };
        const output = await new Composer(config(roots), {
          artifactCatalog: f.catalog,
          processRunner: runner,
        }).compose(mode === 'V1' ? input(f) : mixedInput(f, mode));
        return { calls, graph, output };
      });
    }
    assert.deepEqual(
      await capture(FfmpegVideoComposer),
      await capture(LegacyComposer),
    );
  },
);

test('config retains legacy policy identity and provider activates only with valid local configuration', async () =>
  withRoots(async (roots: any) => {
    const env = {
      FFMPEG_PATH: process.execPath,
      FFPROBE_PATH: process.execPath,
      FFMPEG_VOICE_ROOT: roots.voiceRoot,
      FFMPEG_MEDIA_ROOT: roots.mediaRoot,
      FFMPEG_RENDER_ROOT: roots.renderRoot,
    };
    const legacyConfig = await import(
      new URL('../../../src/ffmpeg-video-config.js', import.meta.url).href
    );
    assert.deepEqual(
      loadFfmpegVideoConfig(env),
      legacyConfig.loadFfmpegVideoConfig(env),
    );
    const store: any = {};
    const disabled = await createVideoComposer(store, {});
    await assert.rejects(
      disabled.compose({} as any),
      adapterError('COMPOSER_UNAVAILABLE'),
    );
    for (const bad of [
      { FFMPEG_VIDEO_FRAME_RATE: '25' },
      { FFMPEG_PATH: join(roots.outside, 'missing.exe') },
      { FFMPEG_VOICE_ROOT: join(roots.outside, 'missing') },
    ]) {
      const provider = await createVideoComposer(store, { ...env, ...bad });
      await assert.rejects(
        provider.compose({} as any),
        adapterError('COMPOSER_UNAVAILABLE'),
      );
    }
    assert.ok(
      (await createVideoComposer(store, env)) instanceof FfmpegVideoComposer,
    );
  }));

test('resolver aceita referências exatas e bloqueia desconhecida, traversal, ausência e symlink fora do root', async () =>
  withRoots(async ({ voiceRoot, mediaRoot, outside }: any) => {
    const voice = wav();
    const image = png();
    const voiceHash = store(voiceRoot, voice, 'wav');
    const imageHash = store(mediaRoot, image, 'png');
    const resolver = new LocalCompositionReferenceResolver({
      voiceRoot,
      mediaRoot,
    });
    assert.equal(
      await resolver.resolveVoice(`object:voice/sha256/${voiceHash}`),
      join(voiceRoot, 'sha256', voiceHash.slice(0, 2), `${voiceHash}.wav`),
    );
    assert.equal(
      await resolver.resolveMedia(`media:sha256_${imageHash}`),
      join(mediaRoot, 'sha256', imageHash.slice(0, 2), `${imageHash}.png`),
    );
    await assert.rejects(
      resolver.resolveMedia('media:../../private'),
      adapterError('COMPOSER_REFERENCE_INVALID'),
    );
    await assert.rejects(
      resolver.resolveMedia(`media:sha256_${'a'.repeat(64)}`),
      adapterError('COMPOSER_INPUT_NOT_FOUND'),
    );
    const escapedRoot = join(outside, 'escaped');
    const escapedHash = 'e'.repeat(64);
    const escapedPrefix = join(escapedRoot, escapedHash.slice(0, 2));
    mkdirSync(escapedPrefix, { recursive: true });
    writeFileSync(join(escapedPrefix, `${escapedHash}.png`), image);
    const linkedMediaRoot = join(outside, 'linked-media-root');
    mkdirSync(linkedMediaRoot);
    symlinkSync(escapedRoot, join(linkedMediaRoot, 'sha256'), 'junction');
    const linkedResolver = new LocalCompositionReferenceResolver({
      voiceRoot,
      mediaRoot: linkedMediaRoot,
    });
    await assert.rejects(
      linkedResolver.resolveMedia(`media:sha256_${escapedHash}`),
      adapterError('COMPOSER_REFERENCE_OUTSIDE_ROOT'),
    );
  }));

test('storage promove por hard-link, reutiliza conteúdo íntegro e recusa conflito', async () =>
  withRoots(async ({ renderRoot }: any) => {
    const storage = new LocalVideoStorage({ root: renderRoot, maxBytes: 1024 });
    const staging = await storage.createStaging();
    const source = join(staging, 'render.mp4');
    const bytes = Buffer.from('real-mp4');
    writeFileSync(source, bytes);
    const hash = sha256(bytes);
    const first = await storage.promote(source, hash);
    const second = await storage.promote(source, hash);
    assert.equal(first.logicalReference, `render:sha256_${hash}`);
    assert.equal(second.reused, true);
    writeFileSync(first.physicalPath, Buffer.from('corrupt'));
    // Use a fresh source inode: corrupting a hard link also corrupts its source.
    rmSync(source);
    writeFileSync(source, bytes);
    await assert.rejects(
      storage.promote(source, hash),
      adapterError('COMPOSER_STORAGE_HASH_CONFLICT'),
    );
    await storage.cleanup(staging);
  }));

test('adapter valida cadeia, cópias consumidas, timeline e argumentos allowlisted', async () =>
  withRoots(async (roots: any) => {
    const fixture = physicalFixture(roots);
    const calls: any = [];
    let consumed: string[] = [];
    let graph: string = '';
    const runner = async (command: any, args: any, options?: any) => {
      calls.push({ command, args, options });
      if (command === 'ffmpeg-bin' && args.includes('-filter_complex_script')) {
        const inputs = args.flatMap((value: any, index: any) =>
          value === '-i' ? [args[index + 1]] : [],
        );
        consumed = inputs.map((path: any) => sha256(readFileSync(path)));
        graph = readFileSync(
          args[args.indexOf('-filter_complex_script') + 1],
          'utf8',
        );
        writeFileSync(args.at(-1), Buffer.from('physical-mp4'));
      }
      if (command === 'ffprobe-bin') return { stdout: probeJson(1000) };
      return { stdout: '', stderr: '' };
    };
    const composer = makeComposer(roots, fixture.catalog, runner);
    const output = await composer.compose(input(fixture));
    assert.deepEqual(consumed, [
      fixture.imageHash,
      fixture.image2Hash,
      fixture.voiceHash,
    ]);
    assert.equal(output.contentHash, sha256(Buffer.from('physical-mp4')));
    assert.match(output.logicalReference, /^render:sha256_[a-f0-9]{64}$/);
    const encode = calls.find(({ args }: any) =>
      args.includes('-filter_complex_script'),
    );
    assert.equal(encode.options.shell, false);
    assert.equal(encode.options.windowsHide, true);
    for (const value of [
      'libx264',
      'high',
      '4.0',
      '20',
      'medium',
      'yuv420p',
      'aac',
      '192k',
      '48000',
      '60',
      '+faststart',
    ])
      assert.ok(encode.args.includes(value), value);
    assert.match(graph, /gte\(t\\,0\.517\)/);
    assert.match(graph, /fps=30/);
    assert.doesNotMatch(
      encode.args.join(' '),
      /object:voice|media:sha256|PRIVATE/,
    );
  }));

test('V2 compõe VIDEO seguido de IMAGE com trim ou loop, crop, cortes e somente voz mapeada', async () =>
  withRoots(async (roots: any) => {
    for (const mode of ['TRIM', 'LOOP']) {
      const fixture = mixedPhysicalFixture(roots, mode);
      const calls: any = [];
      let graph: string = '';
      const runner = async (command: any, args: any, options?: any) => {
        calls.push({ command, args, options });
        if (
          command === 'ffprobe-bin' &&
          String(args.at(-1)).endsWith('.mp4') &&
          String(args.at(-1)).includes('media-001')
        )
          return { stdout: inputVideoProbeJson(1000, mode === 'TRIM') };
        if (
          command === 'ffmpeg-bin' &&
          args.includes('-filter_complex_script')
        ) {
          graph = readFileSync(
            args[args.indexOf('-filter_complex_script') + 1],
            'utf8',
          );
          writeFileSync(args.at(-1), Buffer.from(`mixed-${mode}`));
        }
        if (command === 'ffprobe-bin') return { stdout: probeJson(1000) };
        return { stdout: '', stderr: '' };
      };
      const output = await makeComposer(roots, fixture.catalog, runner).compose(
        mixedInput(fixture, mode),
      );
      assert.equal(output.durationMilliseconds, 1000);
      const encode = calls.find(({ args }: any) =>
        args.includes('-filter_complex_script'),
      );
      assert.ok(encode.args.includes('-ss'));
      assert.ok(encode.args.includes('0.200'));
      assert.equal(encode.args.includes('-stream_loop'), mode === 'LOOP');
      assert.deepEqual(
        encode.args.flatMap((value: any, index: any) =>
          value === '-map' ? [encode.args[index + 1]] : [],
        ),
        ['[vout]', '[aout]'],
      );
      assert.match(graph, /concat=n=2:v=1:a=0/);
      assert.match(graph, /force_original_aspect_ratio=increase/);
      assert.match(graph, /crop=1080:1920/);
    }
  }));

test('V2 rejeita vídeo curto sem loop antes do FFmpeg', async () =>
  withRoots(async (roots: any) => {
    const fixture = mixedPhysicalFixture(roots, 'TRIM', 700);
    let calls = 0;
    await assert.rejects(
      makeComposer(roots, fixture.catalog, async () => {
        calls += 1;
      }).compose(mixedInput(fixture, 'TRIM')),
      adapterError('COMPOSER_VIDEO_TOO_SHORT'),
    );
    assert.equal(calls, 0);
  }));

test('falha antes do processo para cadeia divergente, direitos, formato, limites e cancelamento', async () =>
  withRoots(async (roots: any) => {
    const fixture = physicalFixture(roots);
    let calls = 0;
    const runner = async () => {
      calls += 1;
      return {};
    };
    const cases = [
      {
        catalog: {
          ...fixture.catalog,
          getVoiceTrack: () => ({
            ...fixture.voice,
            contentHash: 'a'.repeat(64),
          }),
        },
        code: 'COMPOSER_VOICE_HASH_MISMATCH',
      },
      {
        catalog: {
          ...fixture.catalog,
          getMediaAsset: () => ({
            ...fixture.image,
            rights: { usageBasis: 'OWNED', commercialUseAllowed: false },
          }),
        },
        code: 'COMPOSER_INPUT_INVALID',
      },
      {
        catalog: {
          ...fixture.catalog,
          getMediaAsset: () => ({
            ...fixture.image,
            assetType: 'VIDEO',
            technicalProperties: {
              ...fixture.image.technicalProperties,
              format: 'mp4',
              durationMilliseconds: 1000,
            },
          }),
        },
        code: 'COMPOSER_MEDIA_UNSUPPORTED',
      },
    ];
    for (const item of cases)
      await assert.rejects(
        makeComposer(roots, item.catalog, runner).compose(input(fixture)),
        adapterError(item.code),
      );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      makeComposer(roots, fixture.catalog, runner).compose(input(fixture), {
        signal: controller.signal,
      }),
      adapterError('COMPOSER_CANCELLED'),
    );
    assert.equal(calls, 0);
  }));

test('falha sanitizada para saída ausente, probe malformado, timeout e limpa staging', async () =>
  withRoots(async (roots: any) => {
    const fixture = physicalFixture(roots);
    await assert.rejects(
      makeComposer(roots, fixture.catalog, async () => ({
        stdout: '',
      })).compose(input(fixture)),
      adapterError('COMPOSER_OUTPUT_INVALID'),
    );
    const invalidProbe = async (command: any, args: any) => {
      if (command === 'ffmpeg-bin' && args.includes('-filter_complex_script'))
        writeFileSync(args.at(-1), Buffer.from('mp4'));
      return { stdout: command === 'ffprobe-bin' ? '{' : '' };
    };
    await assert.rejects(
      makeComposer(roots, fixture.catalog, invalidProbe).compose(
        input(fixture),
      ),
      adapterError('COMPOSER_PROBE_INVALID'),
    );
    const timeout = Object.assign(new Error('PRIVATE path'), {
      code: 'COMPOSER_TIMEOUT',
    });
    await assert.rejects(
      makeComposer(roots, fixture.catalog, async () => {
        throw timeout;
      }).compose(input(fixture)),
      adapterError('COMPOSER_TIMEOUT'),
    );
    assert.deepEqual(readdirSync(join(roots.renderRoot, '.staging')), []);
  }));

test('rejeita hash físico divergente da voz copiada antes de executar processo', async () =>
  withRoots(async (roots: any) => {
    const fixture = physicalFixture(roots);
    const path = join(
      roots.voiceRoot,
      'sha256',
      fixture.voiceHash.slice(0, 2),
      `${fixture.voiceHash}.wav`,
    );
    writeFileSync(path, wav({ durationMilliseconds: 1100 }));
    let calls = 0;
    await assert.rejects(
      makeComposer(roots, fixture.catalog, async () => {
        calls += 1;
      }).compose(input(fixture)),
      adapterError('COMPOSER_PHYSICAL_HASH_MISMATCH'),
    );
    assert.equal(calls, 0);
  }));

test('rejeita streams e propriedades medidas divergentes sem promover render', async () =>
  withRoots(async (roots: any) => {
    const fixture = physicalFixture(roots);
    for (const mutate of [
      (value: any) => {
        value.streams[0].codec_name = 'hevc';
      },
      (value: any) => {
        value.streams[0].width = 720;
      },
      (value: any) => {
        value.streams[0].pix_fmt = 'yuv444p';
      },
      (value: any) => {
        value.streams[0].r_frame_rate = '25/1';
      },
      (value: any) => {
        value.streams[1].codec_name = 'mp3';
      },
      (value: any) => {
        value.format.duration = '0.900000';
      },
      (value: any) => {
        value.streams.pop();
      },
    ]) {
      const runner = async (command: any, args: any) => {
        if (command === 'ffmpeg-bin' && args.includes('-filter_complex_script'))
          writeFileSync(args.at(-1), Buffer.from('mp4'));
        if (command === 'ffprobe-bin') {
          const value = JSON.parse(probeJson(1000));
          mutate(value);
          return { stdout: JSON.stringify(value) };
        }
        return { stdout: '' };
      };
      await assert.rejects(
        makeComposer(roots, fixture.catalog, runner).compose(input(fixture)),
        adapterError('COMPOSER_OUTPUT_POLICY_MISMATCH'),
      );
    }
  }));

test('classifica binário ausente e falha de decode sem expor detalhes', async () =>
  withRoots(async (roots: any) => {
    const fixture = physicalFixture(roots);
    const missing = Object.assign(new Error('C:/PRIVATE/ffmpeg'), {
      code: 'ENOENT',
    });
    await assert.rejects(
      makeComposer(roots, fixture.catalog, async () => {
        throw missing;
      }).compose(input(fixture)),
      adapterError('COMPOSER_UNAVAILABLE'),
    );
    let call = 0;
    const decodeFailure = async (_command: any, args: any) => {
      call += 1;
      if (args.includes('-filter_complex_script')) {
        writeFileSync(args.at(-1), Buffer.from('truncated'));
        return { stdout: '' };
      }
      throw new Error('PRIVATE stderr');
    };
    await assert.rejects(
      makeComposer(roots, fixture.catalog, decodeFailure).compose(
        input(fixture),
      ),
      adapterError('COMPOSER_PROCESS_FAILED'),
    );
    assert.equal(call, 2);
  }));

test('executor limita logs e encerra por timeout ou cancelamento', async () => {
  const logged = await runProcess(
    process.execPath,
    ['-e', "process.stdout.write('x'.repeat(200))"],
    { timeoutMs: 1000, maxLogBytes: 32, shell: false, windowsHide: true },
  );
  assert.ok(Buffer.byteLength(logged.stdout) <= 32);
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      timeoutMs: 10,
      maxLogBytes: 32,
      shell: false,
      windowsHide: true,
    }),
    adapterError('COMPOSER_TIMEOUT'),
  );
  const controller = new AbortController();
  const pending = runProcess(
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    {
      timeoutMs: 1000,
      maxLogBytes: 32,
      shell: false,
      windowsHide: true,
      signal: controller.signal,
    },
  );
  controller.abort();
  await assert.rejects(pending, adapterError('COMPOSER_CANCELLED'));
});

function makeComposer(roots: any, catalog: any, processRunner: any): any {
  return new FfmpegVideoComposer(config(roots), {
    artifactCatalog: catalog,
    processRunner,
  });
}
function config({ voiceRoot, mediaRoot, renderRoot }: any): any {
  return {
    policyVersion: 'ffmpeg-video-policy/1.0.0',
    ffmpegPath: 'ffmpeg-bin',
    ffprobePath: 'ffprobe-bin',
    voiceRoot,
    mediaRoot,
    renderRoot,
    stagingRoot: join(renderRoot, '.staging'),
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
    maxVoiceBytes: 20971520,
    maxImageBytes: 20971520,
    maxTotalInputBytes: 536870912,
    maxOutputBytes: 524288000,
    timeoutMs: 300000,
    maxLogBytes: 65536,
    publicConfiguration: {},
  };
}
function physicalFixture(roots: any): any {
  const voiceBytes = wav({ durationMilliseconds: 1000 });
  const imageBytes = png({ color: 32 });
  const image2Bytes = png({ color: 96 });
  const voiceHash = store(roots.voiceRoot, voiceBytes, 'wav');
  const imageHash = store(roots.mediaRoot, imageBytes, 'png');
  const image2Hash = store(roots.mediaRoot, image2Bytes, 'png');
  const voice = {
    schemaVersion: 'voice-track/1.0.0',
    voiceTrackId: 'voice_track_001',
    pipelineRunId: 'run_e07_001',
    projectId: 'project_e07',
    projectVersion: 1,
    scriptId: 'script_001',
    scriptContentHash: 'b'.repeat(64),
    language: 'pt-BR',
    voiceStyle: 'informative',
    durationMilliseconds: 1000,
    audioFormat: 'wav',
    contentHash: voiceHash,
    storageReference: `object:voice/sha256/${voiceHash}`,
    origin: 'SYNTHETIC_TTS',
    provider: 'openai',
    rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
    createdAt: '2026-09-29T00:00:00.000Z',
    revision: 1,
    supersedesVoiceTrackId: null,
  };
  const media = (id: any, hash: any, position: any) => ({
    schemaVersion: 'media-asset/1.0.0',
    mediaAssetId: id,
    pipelineRunId: 'run_e07_001',
    projectId: 'project_e07',
    projectVersion: 1,
    scriptId: 'script_001',
    scriptContentHash: 'b'.repeat(64),
    visualDirectionPosition: position,
    assetType: 'IMAGE',
    technicalProperties: {
      format: 'png',
      widthPixels: 90,
      heightPixels: 160,
      durationMilliseconds: null,
    },
    contentHash: hash,
    mediaReference: `media:sha256_${hash}`,
    origin: 'PROVIDER_GENERATED',
    provider: 'openai',
    rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
    createdAt: '2026-09-29T00:00:00.000Z',
    revision: 1,
    supersedesMediaAssetId: null,
  });
  const image = media('media_asset_001', imageHash, 1);
  const image2 = media('media_asset_002', image2Hash, 2);
  const catalog = {
    getVoiceTrack: (id: any) => (id === voice.voiceTrackId ? voice : null),
    getMediaAsset: (id: any) =>
      id === image.mediaAssetId
        ? image
        : id === image2.mediaAssetId
          ? image2
          : null,
  };
  return { voice, image, image2, voiceHash, imageHash, image2Hash, catalog };
}
function mixedPhysicalFixture(
  roots: any,
  mode: any,
  videoDuration: any = 1000,
): any {
  const base = physicalFixture(roots);
  const videoBytes = Buffer.from(`physical-video-${videoDuration}`);
  const videoHash = store(roots.mediaRoot, videoBytes, 'mp4');
  const video = {
    schemaVersion: 'media-asset/2.0.0',
    mediaAssetId: 'media_asset_video',
    pipelineRunId: 'run_e07_001',
    projectId: 'project_e07',
    projectVersion: 1,
    scriptId: 'script_001',
    scriptContentHash: 'b'.repeat(64),
    visualDirectionPosition: 1,
    assetType: 'VIDEO',
    technicalProperties: {
      format: 'mp4',
      mimeType: 'video/mp4',
      widthPixels: 720,
      heightPixels: 1280,
      durationMilliseconds: videoDuration,
      hasAudio: mode === 'TRIM',
    },
    contentHash: videoHash,
    mediaReference: `media:sha256_${videoHash}`,
    origin: 'PROVIDER_LICENSED',
    provider: 'pexels',
    rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
    source: {
      externalAssetId: '123',
      licenseName: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
      photographerName: 'Creator',
      photographerUrl: 'https://www.pexels.com/@creator',
      sourceUrl: 'https://www.pexels.com/video/123',
    },
    createdAt: '2026-09-29T00:00:00.000Z',
    revision: 1,
    supersedesMediaAssetId: null,
  };
  const image = { ...base.image2, visualDirectionPosition: 2 };
  return {
    ...base,
    video,
    image,
    videoHash,
    catalog: {
      getVoiceTrack: () => base.voice,
      getMediaAsset: (id: any) =>
        id === video.mediaAssetId
          ? video
          : id === image.mediaAssetId
            ? image
            : null,
    },
  };
}
function mixedInput(fixture: any, playbackMode: any): any {
  const plan = {
    schemaVersion: 'composition-plan/2.0.0',
    compositionPlanId: 'composition_plan_mixed',
    pipelineRunId: 'run_e07_001',
    projectId: 'project_e07',
    projectVersion: 1,
    scriptId: 'script_001',
    scriptContentHash: 'b'.repeat(64),
    voiceTrackId: fixture.voice.voiceTrackId,
    voiceTrackContentHash: fixture.voiceHash,
    outputAspectRatio: '9:16',
    timelineUnit: 'MILLISECOND',
    continuityMode: 'CONTIGUOUS',
    durationMilliseconds: 1000,
    productionProfile: 'MIXED_MEDIA_V2',
    compositionPolicyVersion: 'mixed-media-composition-policy/2.0.0',
    segments: [
      mixedSegment(1, 1, fixture.video, 0, 600, 200, playbackMode),
      mixedSegment(2, 2, fixture.image, 600, 1000, 0, 'TRIM'),
    ],
    createdAt: '2026-09-29T00:00:00.000Z',
    revision: 1,
    supersedesCompositionPlanId: null,
    contentHash: '0'.repeat(64),
  };
  plan.contentHash = compositionPlanContentHash(plan);
  return {
    logicalCallId: 'video_composition_mixed',
    compositionPlan: plan,
    output: { containerFormat: 'mp4', widthPixels: 1080, heightPixels: 1920 },
  };
}
function mixedSegment(
  position: any,
  direction: any,
  asset: any,
  start: any,
  end: any,
  sourceStart: any,
  playbackMode: any,
): any {
  return {
    position,
    visualDirectionPosition: direction,
    mediaAssetId: asset.mediaAssetId,
    mediaAssetContentHash: asset.contentHash,
    startMilliseconds: start,
    endMilliseconds: end,
    mediaType: asset.assetType,
    sourceStartMilliseconds: sourceStart,
    playbackMode,
    originalAudioMuted: true,
    framingStrategy: 'COVER_CROP_9_16',
    transition: {
      policyVersion: 'composition-transition/1.0.0',
      type: 'CUT',
      durationMilliseconds: 0,
    },
  };
}
function inputVideoProbeJson(duration: any, hasAudio: any = false): any {
  return JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        width: 720,
        height: 1280,
        duration: (duration / 1000).toFixed(6),
      },
      ...(hasAudio
        ? [{ codec_type: 'audio', duration: (duration / 1000).toFixed(6) }]
        : []),
    ],
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: (duration / 1000).toFixed(6),
    },
  });
}
function input(fixture: any): any {
  const plan = {
    schemaVersion: 'composition-plan/1.0.0',
    compositionPlanId: 'composition_plan_001',
    pipelineRunId: 'run_e07_001',
    projectId: 'project_e07',
    projectVersion: 1,
    scriptId: 'script_001',
    scriptContentHash: 'b'.repeat(64),
    voiceTrackId: fixture.voice.voiceTrackId,
    voiceTrackContentHash: fixture.voiceHash,
    outputAspectRatio: '9:16',
    timelineUnit: 'MILLISECOND',
    continuityMode: 'CONTIGUOUS',
    durationMilliseconds: 1000,
    segments: [
      {
        position: 1,
        visualDirectionPosition: 1,
        mediaAssetId: fixture.image.mediaAssetId,
        mediaAssetContentHash: fixture.imageHash,
        startMilliseconds: 0,
        endMilliseconds: 517,
      },
      {
        position: 2,
        visualDirectionPosition: 2,
        mediaAssetId: fixture.image2.mediaAssetId,
        mediaAssetContentHash: fixture.image2Hash,
        startMilliseconds: 517,
        endMilliseconds: 1000,
      },
    ],
    createdAt: '2026-09-29T00:00:00.000Z',
    revision: 1,
    supersedesCompositionPlanId: null,
    contentHash: '0'.repeat(64),
  };
  plan.contentHash = compositionPlanContentHash(plan);
  return {
    logicalCallId: 'video_composition_001',
    compositionPlan: plan,
    output: { containerFormat: 'mp4', widthPixels: 1080, heightPixels: 1920 },
  };
}
function probeJson(duration: any): any {
  return JSON.stringify({
    streams: [
      {
        index: 0,
        codec_name: 'h264',
        profile: 'High',
        codec_type: 'video',
        width: 1080,
        height: 1920,
        pix_fmt: 'yuv420p',
        level: 40,
        r_frame_rate: '30/1',
        avg_frame_rate: '30/1',
        duration: ((duration - 1) / 1000).toFixed(6),
      },
      {
        index: 1,
        codec_name: 'aac',
        profile: 'LC',
        codec_type: 'audio',
        sample_rate: '48000',
        channels: 1,
        duration: (duration / 1000).toFixed(6),
      },
    ],
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: (duration / 1000).toFixed(6),
      size: '12',
    },
  });
}
function store(root: any, bytes: any, extension: any): any {
  const hash = sha256(bytes);
  const directory = join(root, 'sha256', hash.slice(0, 2));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${hash}.${extension}`), bytes);
  return hash;
}
async function withRoots(run: any): Promise<any> {
  const root = mkdtempSync(join(tmpdir(), 'mktauto-ffmpeg-test-'));
  const roots = {
    voiceRoot: join(root, 'voice'),
    mediaRoot: join(root, 'media'),
    renderRoot: join(root, 'render'),
    outside: join(root, 'outside'),
  };
  Object.values(roots).forEach((path: any) =>
    mkdirSync(path, { recursive: true }),
  );
  try {
    await run(roots);
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  }
}
function adapterError(code: any): any {
  return (caught: any) =>
    caught?.code === code && !caught.message.includes('PRIVATE');
}
