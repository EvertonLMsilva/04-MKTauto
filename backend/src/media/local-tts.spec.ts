import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digest } from './infrastructure/local-evidence-storage.js';
import {
  LocalPiperTts,
  adaptLocalNarration,
  adaptKokoroNarration,
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

function espeakFixture(
  f: ReturnType<typeof fixture>,
  windows = process.platform === 'win32',
) {
  Object.assign(f.manifest, {
    engine: 'espeak-ng',
    modelId: 'espeak-ng/pt-br',
    license: 'GPL-3.0-or-later',
    dataRoot: f.root,
  });
  mkdirSync(join(f.root, 'espeak-ng-data/lang/roa'), { recursive: true });
  writeFileSync(join(f.root, 'espeak-ng.dll'), 'TEST_DLL');
  writeFileSync(join(f.root, 'espeak-ng-data/lang/roa/pt-BR'), 'TEST_VOICE');
  Object.assign(f.manifest, {
    adapterSha256: digest(
      readFileSync(
        fileURLToPath(new URL('../../python/tts/espeak.py', import.meta.url)),
      ),
    ),
  });
  writeFileSync(
    f.manifest.modelPath,
    JSON.stringify({
      schemaVersion: 'espeak-native/1',
      voice: 'pt-br',
      type: 'FORMANT_RULES',
      files: {
        'espeak-ng.dll': digest(readFileSync(join(f.root, 'espeak-ng.dll'))),
        'espeak-ng-data/lang/roa/pt-BR': digest(
          readFileSync(join(f.root, 'espeak-ng-data/lang/roa/pt-BR')),
        ),
        ...Object.fromEntries(
          ['phondata', 'phonindex', 'phontab', 'intonations', 'pt_dict'].map(
            (name) => {
              const key = 'espeak-ng-data/' + name;
              writeFileSync(join(f.root, key), 'TEST_DATA');
              return [key, digest(readFileSync(join(f.root, key)))];
            },
          ),
        ),
      },
    }),
  );
  f.manifest.modelSha256 = digest(readFileSync(f.manifest.modelPath));
  f.save();
  if (!windows) linuxEspeakFixture(f);
}
function linuxEspeakFixture(f: ReturnType<typeof fixture>) {
  espeakFixture(f, true);
  const libraryPath = join(f.root, 'libespeak-ng.so.1.1.51');
  const executablePath = join(f.root, 'espeak-ng');
  writeFileSync(libraryPath, 'TEST_LINUX_LIBRARY_NOT_EXECUTABLE');
  writeFileSync(executablePath, 'TEST_LINUX_EXECUTABLE_NOT_EXECUTABLE');
  const native = {
    platform: 'linux',
    architecture: process.arch,
    version: '1.51',
    libraryPath,
    librarySha256: digest(readFileSync(libraryPath)),
    executablePath,
    executableSha256: digest(readFileSync(executablePath)),
  };
  const inventory = JSON.parse(readFileSync(f.manifest.modelPath, 'utf8'));
  delete inventory.files['espeak-ng.dll'];
  inventory.files['libespeak-ng.so.1.1.51'] = native.librarySha256;
  inventory.files['espeak-ng'] = native.executableSha256;
  Object.assign(inventory, {
    schemaVersion: 'espeak-native/2',
    platform: native.platform,
    architecture: native.architecture,
    version: native.version,
    library: { path: libraryPath, sha256: native.librarySha256 },
    executable: { path: executablePath, sha256: native.executableSha256 },
  });
  const saveInventory = () => {
    writeFileSync(f.manifest.modelPath, JSON.stringify(inventory));
    f.manifest.modelSha256 = digest(readFileSync(f.manifest.modelPath));
    f.save();
  };
  Object.assign(f.manifest, { modelVersion: '1.51', native });
  saveInventory();
  return { native, inventory, saveInventory };
}

test('Linux espeak requires its explicit platform, version, library, executable and pt-br inventory without selecting Kokoro', async () => {
  const f = fixture();
  try {
    const { native } = linuxEspeakFixture(f);
    const tts = new LocalPiperTts(f.env, f.runner, 'linux');
    await tts.synthesize('Olá. Veja os detalhes do produto.', 5184);
    const args = f.runner.mock.calls[0][1];
    expect(args[1]).toContain('espeak.py');
    expect(args.slice(4, 6)).toEqual(['pt-br', '150']);
    expect(JSON.parse(args[6])).toEqual(native);
    expect(JSON.stringify(f.runner.mock.calls)).not.toContain('kokoro.py');
  } finally {
    f.cleanup();
  }
});

test.each([
  'libraryHash',
  'executableHash',
  'version',
  'platform',
  'architecture',
  'hostArchitecture',
  'missingNative',
  'missingExecutable',
  'unlistedLibrary',
  'missingVoice',
  'kokoroFallback',
])('Linux espeak rejects %s before starting any process', async (kind) => {
  const f = fixture();
  try {
    const { native, inventory, saveInventory } = linuxEspeakFixture(f);
    if (kind === 'libraryHash') writeFileSync(native.libraryPath, 'TAMPERED');
    if (kind === 'executableHash')
      writeFileSync(native.executablePath, 'TAMPERED');
    if (kind === 'version') inventory.version = '1.52';
    if (kind === 'platform') inventory.platform = 'win32';
    if (kind === 'architecture')
      inventory.architecture = process.arch === 'x64' ? 'arm64' : 'x64';
    if (kind === 'hostArchitecture') {
      native.architecture = process.arch === 'x64' ? 'arm64' : 'x64';
      inventory.architecture = native.architecture;
    }
    if (kind === 'missingNative')
      Object.assign(f.manifest, { native: undefined });
    if (kind === 'missingExecutable') inventory.executable = undefined;
    if (kind === 'unlistedLibrary')
      inventory.library.path = join(f.root, 'unapproved.so');
    if (kind === 'missingVoice')
      delete inventory.files['espeak-ng-data/lang/roa/pt-BR'];
    if (kind === 'kokoroFallback')
      Object.assign(f.manifest, { engine: 'kokoro' });
    saveInventory();
    await expect(
      new LocalPiperTts(f.env, f.runner, 'linux').synthesize('Olá.', 4000),
    ).rejects.toThrow('LOCAL_TTS_LICENSE_REQUIRED');
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});

test('a Linux manifest cannot authorize synthesis on Windows', async () => {
  const f = fixture();
  try {
    linuxEspeakFixture(f);
    await expect(
      new LocalPiperTts(f.env, f.runner, 'win32').synthesize('Olá.', 4000),
    ).rejects.toThrow('LOCAL_TTS_LICENSE_REQUIRED');
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});

test('a Windows manifest cannot authorize synthesis on Linux', async () => {
  const f = fixture();
  try {
    espeakFixture(f, true);
    await expect(
      new LocalPiperTts(f.env, f.runner, 'linux').synthesize('Olá.', 4000),
    ).rejects.toThrow('LOCAL_TTS_LICENSE_REQUIRED');
    expect(f.runner).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
  }
});

function kokoroFixture(f: ReturnType<typeof fixture>) {
  Object.assign(f.manifest, {
    engine: 'kokoro',
    modelId: 'kokoro/pf_dora',
    license: 'Apache-2.0',
    voicesPath: f.manifest.modelPath,
    voicesSha256: f.manifest.modelSha256,
    adapterSha256: digest(
      readFileSync(
        fileURLToPath(new URL('../../python/tts/kokoro.py', import.meta.url)),
      ),
    ),
  });
  writeFileSync(
    f.manifest.configPath,
    JSON.stringify({
      language: { code: 'pt_BR' },
      voice: 'pf_dora',
      speed: 1,
      sentencePause: 0.25,
    }),
  );
  f.manifest.configSha256 = digest(readFileSync(f.manifest.configPath));
  f.save();
}

test('Kokoro pins Dora natural, voices and adapter; never falls back or changes speed', async () => {
  const f = fixture();
  try {
    Object.assign(f.manifest, {
      engine: 'kokoro',
      modelId: 'kokoro/pf_dora',
      license: 'Apache-2.0',
      voicesPath: f.manifest.modelPath,
      voicesSha256: f.manifest.modelSha256,
      adapterSha256: digest(
        readFileSync(
          fileURLToPath(new URL('../../python/tts/kokoro.py', import.meta.url)),
        ),
      ),
    });
    writeFileSync(
      f.manifest.configPath,
      JSON.stringify({
        language: { code: 'pt_BR' },
        voice: 'pf_dora',
        speed: 1,
        sentencePause: 0.25,
      }),
    );
    f.manifest.configSha256 = digest(readFileSync(f.manifest.configPath));
    f.save();
    const result = await new LocalPiperTts(f.env, f.runner).synthesize(
      'Publicidade. Cena ilustrativa.',
      20000,
    );
    expect(result.evidence.modelId).toBe('kokoro/pf_dora');
    expect(result.evidence.adaptation).toBe(
      'paragraph-preserving-deduplication/2',
    );
    expect(f.runner.mock.calls[0][1]).toEqual([
      '-B',
      expect.stringContaining('kokoro.py'),
      f.manifest.modelPath,
      f.manifest.modelPath,
      expect.any(String),
    ]);
    expect(f.runner.mock.calls[0][2].stdin).toContain('Cena ilustrativa.');
    expect(f.runner.mock.calls.flat().join(' ')).not.toContain('atempo');
    writeFileSync(f.manifest.modelPath, 'changed voice');
    expect(() => new LocalPiperTts(f.env).configuration()).toThrow(
      'LOCAL_TTS_LICENSE_REQUIRED',
    );
  } finally {
    f.cleanup();
  }
});

test('native pt-BR formant speech requires GPL evidence and a complete pinned local inventory, without a sampled voice', async () => {
  const f = fixture();
  try {
    espeakFixture(f, true);
    await new LocalPiperTts(f.env, f.runner, 'win32').synthesize(
      'Conheça este travesseiro anatômico. Veja os detalhes do produto.',
      5184,
    );
    expect(f.runner.mock.calls[0][1]).toEqual([
      '-B',
      expect.stringContaining('espeak.py'),
      f.root,
      expect.any(String),
      'pt-br',
      '150',
    ]);
    expect(f.runner.mock.calls[0][2].stdin).toContain(
      'Veja os detalhes do produto.',
    );
    writeFileSync(f.manifest.configPath, 'TAMPERED');
    expect(() => new LocalPiperTts(f.env).configuration()).toThrow(
      'LOCAL_TTS_LICENSE_REQUIRED',
    );
  } finally {
    f.cleanup();
  }
});
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
test('Dora input retains Portuguese accents, sentence marks and paragraph pauses', () => {
  const text =
    'Você conhece a organização em plástico?\n\nA avó e o avô aprovam.';
  expect(adaptKokoroNarration(text, 20000)).toBe(text);
  expect(adaptLocalNarration(text, 20000)).toBe(text.replace('\n\n', ' '));
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

test.each(['piper', 'piper-prosody', 'espeak-ng', 'kokoro'])(
  'native SQLite preserves synthetic provenance, replay and adapted alignment for %s',
  async (engine) => {
    const f = fixture(),
      native = p2EditorialFixture();
    if (engine === 'espeak-ng') espeakFixture(f);
    if (engine === 'kokoro') kokoroFixture(f);
    if (engine === 'piper-prosody') {
      Object.assign(f.manifest, {
        presentation: {
          schemaVersion: 'piper-presentation/1',
          sentencePauseSeconds: 0.45,
        },
      });
      f.save();
    }
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
      if (engine === 'kokoro')
        expect(f.runner.mock.calls[0][2].stdin).toBe(
          adaptKokoroNarration(script.fullNarration, 60000) + '\n',
        );
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
        provider:
          engine === 'kokoro'
            ? 'local_kokoro'
            : engine === 'espeak-ng'
              ? 'local_espeak_ng'
              : 'local_piper',
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
      const historicalHash = f.env.LOCAL_TTS_MANIFEST_SHA256!;
      const historicalPath = join(f.root, 'original-manifest.json');
      writeFileSync(historicalPath, readFileSync(f.env.LOCAL_TTS_MANIFEST!));
      const upgradedExecutable = join(f.root, 'upgraded-executable');
      writeFileSync(upgradedExecutable, 'TEST_UPDATED_RUNTIME');
      f.manifest.executablePath = upgradedExecutable;
      f.manifest.executableSha256 = digest(readFileSync(upgradedExecutable));
      f.save();
      Object.assign(env, {
        LOCAL_TTS_MANIFEST_SHA256: f.env.LOCAL_TTS_MANIFEST_SHA256,
        LOCAL_TTS_HISTORICAL_MANIFESTS: JSON.stringify({
          [historicalHash]: historicalPath,
        }),
      });
      expect(
        make().authorizedAudio('run_001', script.scriptId, script.contentHash),
      ).toEqual(a);
      expect(await make().automaticAudio(scope, 60000)).toEqual(a);
      expect(f.runner).toHaveBeenCalledTimes(3);
      expect(
        make().authorizedAudio(
          'run_other',
          script.scriptId,
          script.contentHash,
        ),
      ).toBeNull();
      const audioPath = join(
        env.FFMPEG_VOICE_ROOT,
        'sha256',
        a.contentHash.slice(0, 2),
        `${a.contentHash}.wav`,
      );
      const originalAudio = readFileSync(audioPath);
      writeFileSync(audioPath, 'TEST_TAMPERED_AUDIO');
      expect(() =>
        make().authorizedAudio('run_001', script.scriptId, script.contentHash),
      ).toThrow('LOCAL_FILE_HASH_MISMATCH');
      writeFileSync(audioPath, originalAudio);
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
  },
  15000,
);

test.each([
  'valid',
  'tampered-manifest',
  'model',
  'license',
  'voice',
  'unregistered',
  'new-generation',
])(
  'historical TTS manifest remains pinned after runtime upgrade: %s',
  async (kind) => {
    const f = fixture();
    try {
      if (kind === 'voice') kokoroFixture(f);
      const originalHash = f.env.LOCAL_TTS_MANIFEST_SHA256!;
      const originalPath = join(f.root, 'original-manifest.json');
      writeFileSync(originalPath, readFileSync(f.env.LOCAL_TTS_MANIFEST!));
      const upgraded = join(f.root, 'new-executable');
      writeFileSync(upgraded, 'TEST_NEW_RUNTIME');
      f.manifest.executablePath = upgraded;
      f.manifest.executableSha256 = digest(readFileSync(upgraded));
      f.save();
      f.env.LOCAL_TTS_HISTORICAL_MANIFESTS = JSON.stringify({
        [originalHash]: originalPath,
      });
      if (kind === 'tampered-manifest') writeFileSync(originalPath, '{}');
      if (kind === 'model')
        writeFileSync(f.manifest.modelPath, 'TEST_CHANGED_MODEL');
      if (kind === 'license')
        writeFileSync(f.manifest.licenseEvidencePath, 'TEST_CHANGED_LICENSE');
      if (kind === 'voice')
        writeFileSync((f.manifest as any).voicesPath, 'TEST_CHANGED_VOICE');
      if (kind === 'unregistered') delete f.env.LOCAL_TTS_HISTORICAL_MANIFESTS;
      const tts = new LocalPiperTts(f.env, f.runner);
      if (kind === 'valid') {
        expect(tts.configuration(originalHash).configurationHash).toBe(
          originalHash,
        );
        expect(tts.configuration().executableSha256).toBe(
          f.manifest.executableSha256,
        );
      } else if (kind === 'new-generation') {
        writeFileSync(upgraded, 'TEST_TAMPERED_CURRENT_EXECUTABLE');
        expect(tts.configuration(originalHash).configurationHash).toBe(
          originalHash,
        );
        await expect(tts.synthesize('Olá.', 4000)).rejects.toThrow(
          'LOCAL_TTS_LICENSE_REQUIRED',
        );
        expect(f.runner).not.toHaveBeenCalled();
      } else {
        expect(() => tts.configuration(originalHash)).toThrow(
          'LOCAL_TTS_LICENSE_REQUIRED',
        );
      }
    } finally {
      f.cleanup();
    }
  },
);

test.each([false, true])(
  'historical Windows paths use explicitly pinned Docker files; tampered=%s',
  (tampered) => {
    const f = fixture();
    try {
      const files: Record<string, string> = {};
      for (const name of [
        'model',
        'config',
        'executable',
        'licenseEvidence',
      ] as const) {
        const hash = f.manifest[`${name}Sha256`];
        files[hash] = f.manifest[`${name}Path`];
        f.manifest[`${name}Path`] = `C:\\historical\\${name}`;
      }
      f.save();
      const historicalHash = f.env.LOCAL_TTS_MANIFEST_SHA256!;
      const original = join(f.root, 'original.json');
      writeFileSync(original, readFileSync(f.env.LOCAL_TTS_MANIFEST!));
      // The active runtime remains independent; historical bytes are not rewritten.
      f.env.LOCAL_TTS_MANIFEST_SHA256 = 'f'.repeat(64);
      f.env.LOCAL_TTS_HISTORICAL_MANIFESTS = JSON.stringify({
        [historicalHash]: original,
      });
      f.env.LOCAL_TTS_HISTORICAL_FILES = JSON.stringify(files);
      if (tampered)
        writeFileSync(
          files[f.manifest.executableSha256],
          'TEST_TAMPERED_EXECUTABLE',
        );
      const read = () => new LocalPiperTts(f.env).configuration(historicalHash);
      if (tampered) expect(read).toThrow('LOCAL_TTS_LICENSE_REQUIRED');
      else expect(read().configurationHash).toBe(historicalHash);
    } finally {
      f.cleanup();
    }
  },
);
const piperPresentation = {
  schemaVersion: 'piper-presentation/1',
  sentencePauseSeconds: 0.45,
};

test.each([0, 0.45])(
  'pinned Piper presentation preserves text and records sentence pause %s',
  async (sentencePauseSeconds) => {
    const f = fixture();
    const presentation = { ...piperPresentation, sentencePauseSeconds };
    try {
      Object.assign(f.manifest, { presentation });
      f.save();
      const result = await new LocalPiperTts(f.env, f.runner).synthesize(
        'São 3 passos, em 20 segundos.\n\nConfira os detalhes.',
        20000,
      );
      expect(f.runner.mock.calls[0][1]).toEqual(
        expect.arrayContaining([
          '--sentence-silence',
          String(sentencePauseSeconds),
        ]),
      );
      expect(f.runner.mock.calls[0][2].stdin).toBe(
        'São 3 passos, em 20 segundos. Confira os detalhes.\n',
      );
      expect(result.evidence).toMatchObject({
        configurationHash: f.env.LOCAL_TTS_MANIFEST_SHA256,
        presentation,
        adaptation: 'literal-deduplication/1',
      });
      expect(JSON.stringify(f.runner.mock.calls)).not.toMatch(
        /atempo|length.scale/,
      );
    } finally {
      f.cleanup();
    }
  },
);

test.each([
  { schemaVersion: 'unknown/1', sentencePauseSeconds: 0.45 },
  { schemaVersion: 'piper-presentation/1', sentencePauseSeconds: -0.1 },
  { schemaVersion: 'piper-presentation/1', sentencePauseSeconds: 2.01 },
  { schemaVersion: 'piper-presentation/1', sentencePauseSeconds: '0.45' },
  { schemaVersion: 'piper-presentation/1', sentencePauseSeconds: null },
  { ...piperPresentation, speed: 1.5 },
])(
  'invalid Piper presentation blocks before execution: %j',
  async (presentation) => {
    const f = fixture();
    try {
      Object.assign(f.manifest, { presentation });
      f.save();
      await expect(
        new LocalPiperTts(f.env, f.runner).synthesize('Olá.', 4000),
      ).rejects.toThrow('LOCAL_TTS_LICENSE_REQUIRED');
      expect(f.runner).not.toHaveBeenCalled();
    } finally {
      f.cleanup();
    }
  },
);

test('Piper presentation cannot silently change an eSpeak configuration', () => {
  const f = fixture();
  try {
    espeakFixture(f);
    Object.assign(f.manifest, { presentation: piperPresentation });
    f.save();
    expect(() => new LocalPiperTts(f.env).configuration()).toThrow(
      'LOCAL_TTS_LICENSE_REQUIRED',
    );
  } finally {
    f.cleanup();
  }
});
