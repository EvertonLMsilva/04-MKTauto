import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from './infrastructure/local-evidence-storage.js';
import {
  LocalPiperTts,
  adaptLocalNarration,
} from './infrastructure/local-piper-tts.js';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import { LocalFlowRepository } from './infrastructure/local-flow.repository.js';
import { alignmentHash } from './domain/alignment-contracts.js';
import { DatabaseSync } from 'node:sqlite';
import { Test } from '@nestjs/testing';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { OperationsModule } from '../operations/operations.module.js';
import { CAMPAIGN_DATABASE } from '../content-operations/application/campaign-administration.js';
import { CONTENT_DATABASE } from '../content/infrastructure/content.persistence.js';
import { AFFILIATE_DATABASE } from '../affiliate/infrastructure/affiliate-database.config.js';
import { PROJECT_DATABASE } from '../project/infrastructure/project-database.config.js';
import { RESEARCH_DATABASE } from '../research/infrastructure/research-database.config.js';
import {
  CONTENT_OPERATIONS,
  CONTENT_OPERATIONS_DATABASE,
} from '../content-operations/application/ports/operations.port.js';
import { FINANCE_DATABASE } from '../finance/finance.module.js';
import { MEDIA_DATABASE } from './infrastructure/media.persistence.js';
import {
  PUBLISHING_DATABASE,
  SOCIAL_HISTORY_DATABASE,
} from '../publishing/infrastructure/publishing.persistence.js';
import { EDITORIAL_PROVIDER } from '../content/application/editorial-provider.port.js';
import { FakeEditorialProvider } from '../content/infrastructure/fake-editorial.provider.js';
import { AFFILIATE_RUN_CONTEXT } from '../affiliate/application/ports/affiliate-run-context.port.js';
import { EditorialFlowService } from '../content/application/editorial-flow.service.js';
import { ContentService } from '../content/application/content.service.js';
import { MediaService } from './application/media.service.js';
import { runProcess } from './infrastructure/ffmpeg-process.js';
const { wav } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mkt-tts-test-'));
  const files = ['model', 'config', 'executable', 'license'];
  const paths = Object.fromEntries(
    files.map((name) => {
      const path = join(root, name);
      writeFileSync(path, `TEST_ONLY_${name}`);
      return [name, path];
    }),
  );
  writeFileSync(
    paths.config,
    JSON.stringify({
      language: { code: 'pt_BR' },
      espeak: { voice: 'pt-br' },
      dataset: 'TEST_CC0_FIXTURE',
    }),
  );
  const manifest = {
    schemaVersion: 'local-tts-license/1',
    engine: 'piper',
    modelId: 'TEST_CC0_PT_BR',
    modelVersion: 'fixture/1',
    language: 'pt-BR',
    modelPath: paths.model,
    configPath: paths.config,
    executablePath: paths.executable,
    licenseEvidencePath: paths.license,
    modelSha256: digest(readFileSync(paths.model)),
    configSha256: digest(readFileSync(paths.config)),
    executableSha256: digest(readFileSync(paths.executable)),
    licenseEvidenceSha256: digest(readFileSync(paths.license)),
    license: 'CC0-1.0',
    licenseSource: 'https://example.invalid/TEST-license',
    attribution: 'TEST synthetic fixture only',
    commercialUseAllowed: true,
    localProcessingAllowed: true,
    approvedBy: 'operator_test',
    approvedAt: '2026-10-18T00:00:00Z',
  };
  const env: NodeJS.ProcessEnv = {
    LOCAL_TTS_MANIFEST: join(root, 'manifest.json'),
    FFMPEG_PATH: paths.executable,
    LOCAL_ALIGNMENT_PYTHON: paths.executable,
    LOCAL_ALIGNMENT_MODEL_ROOT: root,
    LOCAL_ALIGNMENT_MODEL_SHA256: 'a'.repeat(64),
    LOCAL_ALIGNMENT_EVIDENCE_KEY: 'k'.repeat(32),
  };
  const save = () => {
    writeFileSync(env.LOCAL_TTS_MANIFEST!, JSON.stringify(manifest));
    env.LOCAL_TTS_MANIFEST_SHA256 = digest(
      readFileSync(env.LOCAL_TTS_MANIFEST!),
    );
  };
  save();
  const runner = vi.fn(async (_cmd: string, args: string[], options: any) => {
    const pad = args.find((a) => a.startsWith('apad='));
    writeFileSync(
      options.outputPath!,
      wav({
        durationMilliseconds: pad
          ? Number(pad.match(/whole_len=(\d+)/)![1]) / 24
          : 1000,
      }),
    );
    return { stdout: '' };
  });
  return {
    root,
    manifest,
    env,
    save,
    runner,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
test('conservative adaptation removes literal repetition without adding or dropping unique claims', () => {
  const text =
    'Produto X com ajuste manual. Produto X com ajuste manual. Confira as condições antes da compra.';
  expect(adaptLocalNarration(text, 10000)).toBe(
    'Produto X com ajuste manual. Confira as condições antes da compra.',
  );
  expect(() => adaptLocalNarration(text, 1000)).toThrow(
    'NARRATION_DURATION_REQUIRED',
  );
  expect(
    adaptLocalNarration(
      'Dose autorizada: 0.5 ml. Não exceda essa dose.',
      10000,
    ),
  ).toBe('Dose autorizada: 0.5 ml. Não exceda essa dose.');
});
test('missing local authorization blocks before any process; manual audio is unaffected', async () => {
  const run = vi.fn();
  await expect(
    new LocalPiperTts({}, run).synthesize('Olá.', 4000),
  ).rejects.toThrow('LOCAL_TTS_CONFIGURATION_REQUIRED');
  expect(run).not.toHaveBeenCalled();
});
test('local runner delivers bounded UTF-8 stdin without shell interpolation', async () => {
  const result = await runProcess(
    process.execPath,
    [
      '-e',
      'process.stdin.setEncoding("utf8");let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(s));',
    ],
    { stdin: 'Olá. $(TEST_ONLY)', timeoutMs: 10000, maxLogBytes: 1024 },
  );
  expect(result.stdout).toBe('Olá. $(TEST_ONLY)');
  await expect(
    runProcess('must-not-execute', [], {
      stdin: 'x'.repeat(65537),
      timeoutMs: 1000,
      maxLogBytes: 1024,
    }),
  ).rejects.toMatchObject({ code: 'FFMPEG_CONFIGURATION_INVALID' });
});
test.each([
  'rights',
  'model-hash',
  'manifest-hash',
  'alignment',
  'edresson',
  'noncommercial',
])('rejects unsafe local configuration: %s', async (kind) => {
  const f = fixture();
  try {
    if (kind === 'rights') f.manifest.commercialUseAllowed = false;
    if (kind === 'model-hash') f.manifest.modelSha256 = 'a'.repeat(64);
    if (kind === 'alignment') delete f.env.LOCAL_ALIGNMENT_PYTHON;
    if (kind === 'edresson') f.manifest.modelId = 'pt_BR-edresson-low';
    if (kind === 'noncommercial') f.manifest.license = 'CC-BY-NC-4.0';
    f.save();
    if (kind === 'manifest-hash')
      f.env.LOCAL_TTS_MANIFEST_SHA256 = 'a'.repeat(64);
    await expect(
      new LocalPiperTts(f.env, f.runner).synthesize('Olá.', 4000),
    ).rejects.toThrow();
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});
test('uses bounded local processes, canonical speech, normal pace and PCM 24k mono; preserves full video duration', async () => {
  const f = fixture();
  try {
    const result = await new LocalPiperTts(f.env, f.runner).synthesize(
      'Olá.',
      4000,
    );
    expect(result.evidence).toMatchObject({
      modelId: 'TEST_CC0_PT_BR',
      modelVersion: 'fixture/1',
      license: 'CC0-1.0',
      narration: 'Olá.',
      targetDurationMs: 4000,
    });
    expect(result.bytes.length).toBeGreaterThan(100);
    expect(f.runner).toHaveBeenCalledTimes(3);
    expect(f.runner.mock.calls[0][2].stdin).toBe('Olá.\n');
    expect(f.runner.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le']),
    );
    expect(JSON.stringify(f.runner.mock.calls)).not.toMatch(
      /atempo|length.scale/,
    );
  } finally {
    f.cleanup();
  }
});
test('actual speech that exceeds available duration is never cropped or accepted', async () => {
  const f = fixture();
  try {
    f.runner.mockImplementation(async (_cmd, args, options) => {
      writeFileSync(options.outputPath!, wav({ durationMilliseconds: 5000 }));
      return { stdout: '' };
    });
    await expect(
      new LocalPiperTts(f.env, f.runner).synthesize('Olá.', 4000),
    ).rejects.toThrow('NARRATION_DURATION_REQUIRED');
    expect(f.runner).toHaveBeenCalledTimes(2);
  } finally {
    f.cleanup();
  }
});

test('native SQLite preserves synthetic provenance, concurrent replay, restart and adapted alignment without accepting synthetic uploads', async () => {
  const f = fixture(),
    native = p2EditorialFixture();
  const db = new DatabaseSync(native.database);
  provisionSchema(db);
  db.close();
  vi.stubEnv('INSTAGRAM_SCHEDULER_ENABLED', 'false');
  vi.stubEnv('CAMPAIGN_SCHEDULER_ENABLED', 'false');
  let builder = Test.createTestingModule({ imports: [OperationsModule] });
  for (const token of [
    CAMPAIGN_DATABASE,
    CONTENT_DATABASE,
    AFFILIATE_DATABASE,
    PROJECT_DATABASE,
    RESEARCH_DATABASE,
    CONTENT_OPERATIONS_DATABASE,
    FINANCE_DATABASE,
    MEDIA_DATABASE,
    PUBLISHING_DATABASE,
    SOCIAL_HISTORY_DATABASE,
  ])
    builder = builder.overrideProvider(token).useValue(native.database);
  const module = await builder
    .overrideProvider(EDITORIAL_PROVIDER)
    .useValue(new FakeEditorialProvider())
    .compile();
  try {
    module
      .get(AFFILIATE_RUN_CONTEXT)
      .bindRun(
        { pipelineRunId: 'run_001', briefingId: 'brief_001' },
        'bind_auto_audio',
      );
    const editorial = await module.get(EditorialFlowService).generate({
      generationRequestId: 'tts_editorial_test',
      pipelineRunId: 'run_001',
      briefingId: 'brief_001',
      researchShortlistId: native.shortlist.artifactId,
      referenceInsightId: null,
      requestedAt: '2026-10-18T00:00:00Z',
      supersedesScriptId: null,
    });
    const script = editorial.script;
    const env = {
      ...f.env,
      LOCAL_MEDIA_EVIDENCE_ROOT: join(f.root, 'evidence'),
      FFMPEG_VOICE_ROOT: join(f.root, 'voice'),
    };
    const open = () =>
      new LocalFlowRepository(
        native.database,
        module.get(CONTENT_OPERATIONS),
        module.get(ContentService),
      );
    const aligner = {
      identity: 'TEST_FIXTURE_ALIGNER',
      align: vi.fn(async (input: any) => {
        const evidence: any = {
          input,
          parameters: { fixture: true },
          provenance: 'FORCED_ALIGNMENT',
          output: {
            alignmentId:
              'align_' +
              alignmentHash({ input, configuration: 'TEST_FIXTURE_ALIGNER' }),
            provider: 'offline-fixture',
            modelVersion: 'TEST/1',
            audioSha256: input.audioSha256,
            scriptTextSha256: input.scriptTextSha256,
            status: 'VERIFIED',
            evidenceHash: '',
            segments: [
              {
                startMs: 100,
                endMs: input.durationMs - 100,
                text: input.canonicalText,
                textStartOffset: 0,
                textEndOffset: input.canonicalText.length,
              },
            ],
          },
        };
        evidence.output.evidenceHash = alignmentHash(evidence);
        return evidence;
      }),
    };
    const make = () =>
      new LocalFlowRuntime(
        open,
        module.get(MediaService),
        env,
        { verify: async () => true },
        f.runner,
        aligner,
      );
    const scope = {
      pipelineRunId: 'run_001',
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      createdAt: '2026-10-18T00:00:00Z',
    };
    const flow = make();
    const [a, b] = await Promise.all([
      flow.automaticAudio(scope, 60000),
      flow.automaticAudio(scope, 60000),
    ]);
    expect(a).toEqual(b);
    expect(f.runner).toHaveBeenCalledTimes(3);
    expect(await make().automaticAudio(scope, 60000)).toEqual(a);
    expect(f.runner).toHaveBeenCalledTimes(3);
    const repository = open();
    const voice = repository.getVoiceTrack(a.voiceTrackId);
    const ids = repository.localVoiceIds(
      'run_001',
      script.scriptId,
      script.contentHash,
    );
    repository.close();
    expect(ids).toEqual([a.voiceTrackId]);
    expect(voice).toMatchObject({
      origin: 'SYNTHETIC_TTS',
      provider: 'local_piper',
      rights: { usageBasis: 'LICENSED', commercialUseAllowed: true },
    });
    expect(
      make().authorizedAudio(
        'run_001',
        script.scriptId,
        script.contentHash,
        undefined,
        'RECORDING',
      ),
    ).toBeNull();
    await expect(
      flow.ingest({
        voiceTrack: voice,
        authorization: { actorId: 'operator_test', statement: 'TEST' },
      }),
    ).rejects.toThrow('LOCAL_AUTHORIZED_AUDIO_REQUIRED');
    const alignment = await flow.alignAudio(a.voiceTrackId);
    expect(alignment.input.canonicalText).toBe(
      adaptLocalNarration(script.fullNarration, 60000),
    );
    expect(flow.subtitles(alignment.output.alignmentId)).toHaveProperty(
      'subtitleId',
    );
    expect(await make().alignAudio(a.voiceTrackId)).toEqual(alignment);
    expect(aligner.align).toHaveBeenCalledTimes(1);
    writeFileSync(f.manifest.licenseEvidencePath, 'changed TEST license');
    expect(() =>
      make().authorizedAudio('run_001', script.scriptId, script.contentHash),
    ).toThrow('LOCAL_TTS_LICENSE_REQUIRED');
  } finally {
    await module.close();
    vi.unstubAllEnvs();
    native.cleanup();
    f.cleanup();
  }
});
