import {
  readFileSync,
  writeFileSync,
  existsSync,
  cpSync,
  mkdirSync,
} from 'node:fs';
import { join, isAbsolute, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LocalPythonAligner } from './infrastructure/local-python-aligner.js';
import {
  alignmentHash,
  serializeSubtitles,
  validateAlignment,
} from './domain/alignment-contracts.js';
import {
  contentFixture,
  script as scriptFixture,
} from '../../test/support/content-fixture.js';
import {
  voiceTrack,
  mediaAsset,
  plan as planFixture,
} from '../../test/support/publishing-render-fixture.js';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import { LocalFlowRepository } from './infrastructure/local-flow.repository.js';
import {
  LocalEvidenceStorage,
  documentBytes,
  digest,
} from './infrastructure/local-evidence-storage.js';
import {
  scriptContentHash,
  validateScript,
} from '../content/domain/script-contracts.js';
import { MediaPersistence } from './infrastructure/media.persistence.js';
import { MediaService } from './application/media.service.js';
import { createVideoComposer } from './infrastructure/ffmpeg-composer.provider.js';
import { runProcess } from './infrastructure/ffmpeg-process.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import { videoCompositionRequestHash } from './domain/video-composition-contracts.js';
import { execFileSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LocalFlowController } from './local-flow.controller.js';
import { LocalFlowService } from './application/local-flow.service.js';

// Explicitly authorized local operational smoke only; ordinary tests remain offline mocks.
it.skipIf(!process.env.MKTAUTO_CTC_VALIDATION_ROOT)(
  'aligns authorized synthetic pt-BR speech with the actual local CTC model',
  async () => {
    const root = process.env.MKTAUTO_CTC_VALIDATION_ROOT!;
    expect(isAbsolute(root)).toBe(true);
    const modelRoot = process.env.LOCAL_ALIGNMENT_MODEL_ROOT!;
    const secretPath = join(root, '.evidence-key');
    if (!existsSync(secretPath))
      writeFileSync(secretPath, randomBytes(32).toString('hex'), {
        flag: 'wx',
        mode: 0o600,
      });
    const env = {
      ...process.env,
      LOCAL_ALIGNMENT_EVIDENCE_KEY: readFileSync(secretPath, 'utf8'),
      LOCAL_ALIGNMENT_MODEL_SHA256: alignmentHash(
        readFileSync(join(modelRoot, 'manifest.json'), 'utf8'),
      ),
    };
    const audio = readFileSync(join(root, 'speech-ptbr.wav'));
    const text = readFileSync(join(root, 'script-ptbr.txt'), 'utf8');
    const { createHash } = await import('node:crypto');
    const input = {
      audioAssetId: 'synthetic_validation001',
      audioSha256: createHash('sha256').update(audio).digest('hex'),
      scriptId: 'validation_script_exact001',
      scriptVersion: 1,
      scriptTextSha256: alignmentHash(text),
      canonicalText: text,
      durationMs: JSON.parse(
        readFileSync(join(root, 'tts-manifest.json'), 'utf8'),
      ).audio.durationMs as number,
    };
    const report: Record<string, unknown> = {
      synthetic: true,
      audioDurationMs: input.durationMs,
      independentTimingReference: null,
      timingP95: null,
      computeCost: 'UNAVAILABLE',
      paidCalls: 0,
    };
    const started = performance.now();
    try {
      const aligner = new LocalPythonAligner(env);
      const evidence = validateAlignment(await aligner.align(input, audio));
      expect(await aligner.verify(evidence, audio)).toBe(true);
      writeFileSync(
        join(root, 'alignment-exact.json'),
        JSON.stringify(evidence, null, 2),
      );
      const subtitles = serializeSubtitles(evidence.output.segments);
      writeFileSync(join(root, 'subtitles.srt'), subtitles.srt);
      writeFileSync(join(root, 'subtitles.ass'), subtitles.ass);
      expect(evidence.output.segments.map((s) => s.text).join(' ')).toBe(text);
      const tampered = structuredClone(evidence);
      tampered.output.segments[0]!.endMs++;
      tampered.output.evidenceHash = alignmentHash(tampered);
      expect(await aligner.verify(tampered, audio)).toBe(false);
      Object.assign(report, {
        status: 'ALIGNMENT_PASS',
        textCoverage: 1,
        segments: evidence.output.segments.length,
        processingMs: Math.round(performance.now() - started),
        parameters: evidence.parameters,
        tamperedEvidenceRejected: true,
      });
      await validateMedia(root, env, text, input.durationMs, report);
      report.status = 'PASS';
      report.totalProcessingMs = Math.round(performance.now() - started);
      report.alignmentFailures = 0;
    } catch (error) {
      Object.assign(report, {
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
        processingMs: Math.round(performance.now() - started),
      });
      throw error;
    } finally {
      writeFileSync(
        join(root, 'validation-report.json'),
        JSON.stringify(report, null, 2),
      );
    }
  },
  360000,
);

async function validateMedia(
  root: string,
  configuration: NodeJS.ProcessEnv,
  exactText: string,
  durationMs: number,
  report: Record<string, unknown>,
) {
  const base = contentFixture(); // Fully seeded disposable editorial DB, never the main DB.
  const { ScriptRepository } = await import(
    new URL('../../../src/script-repository.js', import.meta.url).href
  );
  const { png } = await import(
    new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
  );
  const repository = new ScriptRepository(base.database);
  const fixtureRoot = dirname(base.database);
  const fixtureScript = scriptFixture(base.selected);
  const fixtureVoice = voiceTrack(fixtureScript);
  const f = {
    root: fixtureRoot,
    path: base.database,
    repository,
    script: fixtureScript,
    voice: fixtureVoice,
    voiceRoot: join(fixtureRoot, 'voice'),
    mediaRoot: join(fixtureRoot, 'media'),
    env: {
      FFMPEG_VOICE_ROOT: join(fixtureRoot, 'voice'),
      FFMPEG_MEDIA_ROOT: join(fixtureRoot, 'media'),
      FFMPEG_RENDER_ROOT: join(fixtureRoot, 'render'),
    },
    plan: planFixture(fixtureScript, fixtureVoice, [
      mediaAsset(fixtureScript),
      mediaAsset(fixtureScript),
    ]),
    request: (id: string) => ({
      schemaVersion: 'video-composition-request/1.0.0',
      videoCompositionRequestId: id,
      compositionPlanId: 'plan_placeholder',
      compositionPlanContentHash: '0'.repeat(64),
      containerFormat: 'mp4',
      widthPixels: 1080,
      heightPixels: 1920,
      requestedAt: '2026-09-28T23:00:00.000Z',
      contentHash: '',
    }),
    close: () => {
      repository.close();
      base.close();
    },
  };
  Object.values(f.env).forEach((path) => mkdirSync(path, { recursive: true }));
  const image = png(),
    imageHash = digest(image);
  const imageDirectory = join(f.mediaRoot, 'sha256', imageHash.slice(0, 2));
  mkdirSync(imageDirectory, { recursive: true });
  writeFileSync(join(imageDirectory, `${imageHash}.png`), image);
  const binary = (name: string) =>
    execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true })
      .trim()
      .split(/\r?\n/)[0]!;
  const env = {
    ...configuration,
    ...f.env,
    FFMPEG_PATH: binary('ffmpeg'),
    FFPROBE_PATH: binary('ffprobe'),
    LOCAL_MEDIA_EVIDENCE_ROOT: join(f.root, 'operational-evidence'),
  };
  try {
    const sentences = exactText.match(/[^.!?]+[.!?]/g)!.map((s) => s.trim());
    expect(sentences.length).toBe(3);
    const rawScript = {
      ...structuredClone(f.script),
      scriptId: 'script_ctc_validation',
      revision: 1,
      supersedesScriptId: null,
      hook: sentences[0],
      narrativeBlocks: [
        { position: 1, purpose: 'EXPLANATION', narration: sentences[1] },
      ],
      cta: sentences[2],
      fullNarration: sentences.join('\n\n'),
      estimatedDurationSeconds: Math.ceil(durationMs / 1000),
      visualDirections: [
        f.script.visualDirections[0],
        { ...f.script.visualDirections[0], position: 2 },
      ],
    };
    rawScript.contentHash = scriptContentHash(rawScript);
    const script = validateScript(rawScript);
    expect(script.fullNarration.replaceAll('\n\n', ' ')).toBe(exactText);
    writeFileSync(join(root, 'media-script-ptbr.txt'), script.fullNarration);
    const operations = { get: (id: string) => f.repository.getRun(id) };
    const content = {
      getScript: (id: string) => f.repository.getScript(id),
    };
    const open = () => new LocalFlowRepository(f.path, operations, content);
    const store = new MediaPersistence(f.path, operations, content);
    const media = new MediaService(
      store,
      await createVideoComposer(store, env),
    );
    const flow = new LocalFlowRuntime(open, media, env); // Actual HMAC verifier, actual FFmpeg.
    f.repository.registerScript(script);
    await runProcess(
      env.FFMPEG_PATH,
      [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-i',
        join(root, 'speech-ptbr.wav'),
        '-ac',
        '1',
        '-ar',
        '24000',
        '-c:a',
        'pcm_s16le',
        join(root, 'speech-media-24k.wav'),
      ],
      { timeoutMs: 60000, maxLogBytes: 65536 },
    );
    const mediaAudio = readFileSync(join(root, 'speech-media-24k.wav'));
    const voice = {
      ...f.voice,
      voiceTrackId: 'voice_ctc_synthetic',
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      audioFormat: 'wav',
      contentHash: digest(mediaAudio),
      storageReference: `object:voice/sha256/${digest(mediaAudio)}`,
      durationMilliseconds: durationMs,
      origin: 'SYNTHETIC_TTS',
      provider: 'local-piper',
      revision: 1,
      supersedesVoiceTrackId: null,
      rights: { usageBasis: 'LICENSED', commercialUseAllowed: true },
    };
    new LocalEvidenceStorage(f.voiceRoot).put(mediaAudio, 'wav');
    const tts = {
      voice,
      synthetic: true,
      authorization:
        'User-authorized local synthetic validation only; no publication.',
      sourceTextSha256: alignmentHash(exactText),
      sourceAudioSha256: digest(readFileSync(join(root, 'speech-ptbr.wav'))),
      attribution:
        'Edresson / TTS-Portuguese-Corpus, CC BY 4.0 dataset; local Piper edresson low voice.',
    };
    const r = open();
    try {
      r.transaction(() =>
        r.registerLocalVoice(
          voice,
          new LocalEvidenceStorage(env.LOCAL_MEDIA_EVIDENCE_ROOT).put(
            documentBytes(tts),
            'json',
          ),
          alignmentHash(tts.authorization),
        ),
      );
    } finally {
      r.close();
    }
    const mediaInput = {
      audioAssetId: voice.voiceTrackId,
      audioSha256: voice.contentHash,
      scriptId: script.scriptId,
      scriptVersion: script.revision,
      scriptTextSha256: alignmentHash(script.fullNarration),
      canonicalText: script.fullNarration,
      durationMs,
    };
    const aligned = await new LocalPythonAligner(env).align(
      mediaInput,
      mediaAudio,
    );
    await flow.acceptAlignment(aligned);
    const tampered = structuredClone(aligned);
    tampered.output.segments[0]!.endMs++;
    tampered.output.evidenceHash = alignmentHash(tampered);
    await expect(flow.acceptAlignment(tampered)).rejects.toThrow(
      'ALIGNMENT_PROVENANCE_UNVERIFIED',
    );
    expect(await flow.acceptAlignment(aligned)).toEqual(aligned);
    writeFileSync(
      join(root, 'alignment-media.json'),
      JSON.stringify(aligned, null, 2),
    );
    const subtitles = flow.subtitles(aligned.output.alignmentId);
    const files = new LocalEvidenceStorage(env.LOCAL_MEDIA_EVIDENCE_ROOT);
    writeFileSync(
      join(root, 'media-subtitles.srt'),
      files.read(subtitles.srtHash, 'srt'),
    );
    writeFileSync(
      join(root, 'media-subtitles.ass'),
      files.read(subtitles.assHash, 'ass'),
    );
    const assetRepository = store.open();
    const assets: any[] = [];
    try {
      const previous = mediaAsset(script, {
        contentHash: imageHash,
        mediaReference: `media:sha256_${imageHash}`,
        technicalProperties: {
          format: 'png',
          widthPixels: 90,
          heightPixels: 160,
          durationMilliseconds: null,
        },
      });
      for (let i = 0; i < 2; i++)
        assets.push(
          assetRepository.registerMediaAsset({
            ...previous,
            mediaAssetId: `media_ctc_image_${i + 1}`,
            scriptId: script.scriptId,
            scriptContentHash: script.contentHash,
            visualDirectionPosition: i + 1,
            revision: 1,
            supersedesMediaAssetId: null,
          }),
        );
    } finally {
      assetRepository.close();
    }
    const middle = Math.floor(durationMs / 2);
    const plan = {
      ...f.plan,
      compositionPlanId: 'plan_ctc_validation',
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      voiceTrackId: voice.voiceTrackId,
      voiceTrackContentHash: voice.contentHash,
      durationMilliseconds: durationMs,
      revision: 1,
      supersedesCompositionPlanId: null,
      segments: assets.map((asset, i) => ({
        ...f.plan.segments[0],
        position: i + 1,
        visualDirectionPosition: i + 1,
        mediaAssetId: asset.mediaAssetId,
        mediaAssetContentHash: asset.contentHash,
        startMilliseconds: i ? middle : 0,
        endMilliseconds: i ? durationMs : middle,
      })),
    };
    plan.contentHash = compositionPlanContentHash(plan);
    media.registerCompositionPlan(plan);
    const compose = {
      ...f.request('compose_ctc_validation'),
      compositionPlanId: plan.compositionPlanId,
      compositionPlanContentHash: plan.contentHash,
    };
    compose.contentHash = videoCompositionRequestHash(compose);
    const source = await flow.compose(compose);
    expect((await flow.preview(source.videoRenderId)).ready).toBe(false);
    const burned = await flow.burn(source.videoRenderId, subtitles.subtitleId);
    const qc = await flow.qc(burned.videoRenderId);
    expect(qc.result).toBe('PASS');
    const module = await Test.createTestingModule({
      controllers: [LocalFlowController],
      providers: [
        { provide: LocalFlowService, useValue: new LocalFlowService(flow) },
      ],
    }).compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const preview = await request(app.getHttpServer())
        .get(
          `/media/local/previews/${encodeURIComponent(burned.videoRenderId)}`,
        )
        .expect(200);
      expect(preview.body.ready).toBe(true);
      await request(app.getHttpServer())
        .get(preview.body.url)
        .expect(200)
        .expect('Content-Type', 'video/mp4');
      writeFileSync(
        join(root, 'preview-response.json'),
        JSON.stringify(preview.body, null, 2),
      );
    } finally {
      await app.close();
    }
    writeFileSync(
      join(root, 'preview.mp4'),
      await flow.previewBytes(burned.videoRenderId),
    );
    writeFileSync(join(root, 'qc-report.json'), JSON.stringify(qc, null, 2));
    f.repository.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    cpSync(f.root, join(root, 'media-runtime'), { recursive: true });
    Object.assign(report, {
      media: {
        qc: qc.result,
        previewReady: true,
        httpPreview: 200,
        httpFile: 200,
        synthetic: true,
        fixtureDatabase: true,
        canonicalChanges: 'Paragraph separators only; identical words.',
        wavConversion:
          '16 kHz original preserved; separate 24 kHz copy for P3-B; CTC resamples to 16 kHz.',
        audioSha256: voice.contentHash,
        scriptSha256: mediaInput.scriptTextSha256,
        evidenceHash: aligned.output.evidenceHash,
        parameters: aligned.parameters,
        tamperedEvidenceRejected: true,
      },
    });
  } finally {
    f.close();
  }
}
