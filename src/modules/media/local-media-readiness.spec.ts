import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawn,
  spawnSync,
  exec,
  execFile,
  execSync,
  execFileSync,
} from 'node:child_process';
import * as asyncFs from 'node:fs/promises';
import { vi } from 'vitest';
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import { LocalFlowService } from './application/local-flow.service.js';
import type { LocalAudiovisualPort } from './application/local-flow.port.js';
import type { MediaService } from './application/media.service.js';
import { LocalPiperTts } from './infrastructure/local-piper-tts.js';
import { LocalPythonAligner } from './infrastructure/local-python-aligner.js';
import { digest } from './infrastructure/local-evidence-storage.js';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(() => {
    throw new Error('READINESS_MUST_NOT_SPAWN');
  }),
  spawnSync: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    mkdirSync: vi.fn(actual.mkdirSync),
  };
});
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    mkdir: vi.fn(actual.mkdir),
    mkdtemp: vi.fn(actual.mkdtemp),
  };
});

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'mkt-readiness-'));
  const ttsModel = join(root, 'tts.onnx');
  const ttsConfig = join(root, 'tts.json');
  const executable = join(root, 'test-executable');
  const license = join(root, 'license.txt');
  const modelRoot = join(root, 'ctc');
  fs.mkdirSync(modelRoot);
  fs.writeFileSync(ttsModel, 'TEST_ONLY_MODEL');
  fs.writeFileSync(
    ttsConfig,
    JSON.stringify({ language: { code: 'pt_BR' }, espeak: { voice: 'pt-br' } }),
  );
  fs.writeFileSync(executable, 'TEST_ONLY_EXECUTABLE');
  fs.chmodSync(executable, 0o700);
  fs.writeFileSync(license, 'TEST_ONLY_CC0');
  const tts = {
    schemaVersion: 'local-tts-license/1',
    engine: 'piper',
    language: 'pt-BR',
    modelId: 'TEST_ONLY/cadu',
    modelVersion: 'fixture/1',
    modelPath: ttsModel,
    modelSha256: digest(fs.readFileSync(ttsModel)),
    configPath: ttsConfig,
    configSha256: digest(fs.readFileSync(ttsConfig)),
    executablePath: executable,
    executableSha256: digest(fs.readFileSync(executable)),
    licenseEvidencePath: license,
    licenseEvidenceSha256: digest(fs.readFileSync(license)),
    license: 'CC0-1.0',
    licenseSource: 'https://example.invalid/license',
    commercialUseAllowed: true,
    localProcessingAllowed: true,
    attribution: 'TEST_ONLY',
    approvedBy: 'operator_test',
    approvedAt: '2026-01-01T00:00:00Z',
  };
  const files: Record<string, string> = {};
  for (const name of [
    'config.json',
    'preprocessor_config.json',
    'vocab.json',
    'special_tokens_map.json',
    'pytorch_model.bin',
  ]) {
    const data =
      name === 'pytorch_model.bin'
        ? 'TEST_ONLY_WEIGHTS'
        : JSON.stringify(
            name === 'config.json' ? { model_type: 'wav2vec2' } : {},
          );
    fs.writeFileSync(join(modelRoot, name), data);
    files[name] = digest(Buffer.from(data));
  }
  const environment = JSON.stringify({
    python: 'TEST_ONLY',
    packages: [{ name: 'torch', version: '2.8.0+cpu' }],
  });
  fs.writeFileSync(join(modelRoot, 'environment.json'), environment);
  const ctc = {
    model: 'jonatasgrosman/wav2vec2-large-xlsr-53-portuguese',
    revision: '634ac655299bcdc46c83bc01da9bab52d2987e4f',
    files,
    environmentSha256: digest(Buffer.from(environment)),
  };
  const env: NodeJS.ProcessEnv = {
    LOCAL_TTS_MANIFEST: join(root, 'tts-manifest.json'),
    LOCAL_ALIGNMENT_PYTHON: executable,
    LOCAL_ALIGNMENT_MODEL_ROOT: modelRoot,
    LOCAL_ALIGNMENT_EVIDENCE_KEY: 'TEST_ONLY_SECRET_'.repeat(3),
    FFMPEG_PATH: executable,
    FFPROBE_PATH: executable,
    FFMPEG_MEDIA_ROOT: root,
    FFMPEG_VOICE_ROOT: root,
    FFMPEG_RENDER_ROOT: root,
    LOCAL_MEDIA_EVIDENCE_ROOT: root,
  };
  const save = () => {
    fs.writeFileSync(env.LOCAL_TTS_MANIFEST!, JSON.stringify(tts));
    fs.writeFileSync(join(modelRoot, 'manifest.json'), JSON.stringify(ctc));
    env.LOCAL_TTS_MANIFEST_SHA256 = digest(
      fs.readFileSync(env.LOCAL_TTS_MANIFEST!),
    );
    env.LOCAL_ALIGNMENT_MODEL_SHA256 = digest(
      fs.readFileSync(join(modelRoot, 'manifest.json')),
    );
  };
  save();
  const open = vi.fn(() => {
    throw new Error('READINESS_MUST_NOT_OPEN_DATABASE');
  });
  const runner = vi.fn(async () => {
    throw new Error('READINESS_MUST_NOT_RUN');
  });
  const runtime = () =>
    new LocalFlowRuntime(open, {} as MediaService, env, undefined, runner);
  return { root, modelRoot, tts, ctc, env, save, open, runner, runtime };
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
  vi.clearAllMocks();
  f = fixture();
});
afterEach(() => {
  fs.rmSync(f.root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it('projects static readiness through the service without model reads, inference, database or files', () => {
  const before = fs.readdirSync(f.root, { recursive: true });
  vi.mocked(fs.readFileSync).mockClear();
  vi.mocked(fs.writeFileSync).mockClear();
  vi.mocked(fs.mkdirSync).mockClear();
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('NO_NETWORK'));
  const result = new LocalFlowService(f.runtime()).readiness();
  expect(result).toMatchObject({
    schemaVersion: 'local-media-readiness/1.0.0',
    scope: 'STATIC_ONLY',
    status: 'READY',
    automaticGeneration: 'UNKNOWN',
    physicalValidation: 'NOT_PERFORMED',
  });
  expect(
    Object.values(result.components).every((c) => c.status === 'READY'),
  ).toBe(true);
  expect(result.unverified).toContain('CTC_RUNTIME_UNVERIFIED');
  expect(result.unverified).toContain('PIPER_MODEL_INTEGRITY_UNVERIFIED');
  const reads = vi
    .mocked(fs.readFileSync)
    .mock.calls.map(([path]) => String(path));
  expect(reads).not.toContain(f.tts.modelPath);
  expect(reads).not.toContain(join(f.modelRoot, 'pytorch_model.bin'));
  expect(reads).not.toContain(f.tts.executablePath);
  expect(f.open).not.toHaveBeenCalled();
  expect(f.runner).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
  for (const effect of [
    spawnSync,
    exec,
    execFile,
    execSync,
    execFileSync,
    fs.writeFileSync,
    fs.mkdirSync,
    asyncFs.writeFile,
    asyncFs.mkdir,
    asyncFs.mkdtemp,
    fetch,
  ])
    expect(effect).not.toHaveBeenCalled();
  expect(fs.readdirSync(f.root, { recursive: true })).toEqual(before);
  const publicJson = JSON.stringify(result);
  for (const privateValue of [
    f.root,
    f.env.LOCAL_ALIGNMENT_EVIDENCE_KEY!,
    f.env.LOCAL_TTS_MANIFEST_SHA256!,
  ])
    expect(publicJson).not.toContain(privateValue);
});

it('reports absent configuration and supports legacy ports without probing the old boolean', () => {
  Object.keys(f.env).forEach((name) => delete f.env[name]);
  const result = f.runtime().readiness();
  expect(result.status).toBe('NOT_READY');
  expect(result.automaticGeneration).toBe('NOT_READY');
  expect(result.components.piper.codes).toContain(
    'LOCAL_TTS_CONFIGURATION_REQUIRED',
  );
  expect(result.components.ctc.codes).toContain(
    'ALIGNMENT_CONFIGURATION_REQUIRED',
  );
  const automaticAudioReady = vi.fn(() => true);
  const legacy = new LocalFlowService({
    automaticAudioReady,
  } as unknown as LocalAudiovisualPort);
  expect(legacy.readiness().status).toBe('UNKNOWN');
  expect(automaticAudioReady).not.toHaveBeenCalled();
  expect(legacy.automaticAudioReady()).toBe(true);
});

it.each(['tts', 'ctc'] as const)(
  'detects a missing %s model and recovers after restoration',
  (component) => {
    const path =
      component === 'tts'
        ? f.tts.modelPath
        : join(f.modelRoot, 'pytorch_model.bin');
    const bytes = fs.readFileSync(path);
    fs.unlinkSync(path);
    expect(
      f.runtime().readiness().components[component === 'tts' ? 'piper' : 'ctc']
        .status,
    ).toBe('NOT_READY');
    fs.writeFileSync(path, bytes);
    expect(f.runtime().readiness().status).toBe('READY');
  },
);

it.each(['tts', 'ctc'] as const)(
  'rejects invalid %s manifests without leaking parser errors',
  (component) => {
    const path =
      component === 'tts'
        ? f.env.LOCAL_TTS_MANIFEST!
        : join(f.modelRoot, 'manifest.json');
    fs.writeFileSync(path, '{PRIVATE_INVALID_JSON');
    f.env[
      component === 'tts'
        ? 'LOCAL_TTS_MANIFEST_SHA256'
        : 'LOCAL_ALIGNMENT_MODEL_SHA256'
    ] = digest(fs.readFileSync(path));
    const result = f.runtime().readiness();
    expect(result.status).toBe('NOT_READY');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_INVALID_JSON');
  },
);

it('revalidates configuration in the same instance and after restart without cached success', () => {
  const runtime = f.runtime();
  expect(runtime.readiness().status).toBe('READY');
  expect(runtime.automaticAudioReady()).toBe(true);
  f.ctc.revision = 'wrong-revision';
  f.save();
  expect(runtime.readiness().components.ctc.codes).toContain(
    'ALIGNMENT_MODEL_INCOMPATIBLE',
  );
  // The legacy boolean remains the original TTS preflight, not the new diagnostic.
  expect(runtime.automaticAudioReady()).toBe(true);
  expect(f.runtime().readiness()).toEqual(runtime.readiness());
  f.ctc.revision = '634ac655299bcdc46c83bc01da9bab52d2987e4f';
  f.save();
  expect(runtime.readiness().status).toBe('READY');
  f.env.LOCAL_ALIGNMENT_TEXT_POLICY = 'invalid';
  expect(runtime.readiness().components.ctc.codes).toContain(
    'ALIGNMENT_CONFIGURATION_REQUIRED',
  );
});

it('detects incompatible Piper metadata while preserving existing readiness and errors', () => {
  const tts = new LocalPiperTts(f.env, f.runner);
  expect(tts.ready()).toBe(true);
  fs.writeFileSync(
    f.tts.configPath,
    JSON.stringify({ language: { code: 'en_US' } }),
  );
  f.tts.configSha256 = digest(fs.readFileSync(f.tts.configPath));
  f.save();
  expect(tts.readiness()).toEqual({
    status: 'NOT_READY',
    codes: ['LOCAL_TTS_LICENSE_REQUIRED'],
  });
  expect(tts.ready()).toBe(false);
  expect(() => tts.configuration()).toThrow('LOCAL_TTS_LICENSE_REQUIRED');
});

it('detects unavailable local executables, model metadata tampering and missing storage configuration', () => {
  f.env.FFPROBE_PATH = join(f.root, 'missing-private-path');
  expect(f.runtime().readiness().components.ffprobe.codes).toContain(
    'LOCAL_DEPENDENCY_UNAVAILABLE',
  );
  f.env.LOCAL_ALIGNMENT_PYTHON = f.modelRoot;
  expect(new LocalPythonAligner(f.env).readiness().codes).toContain(
    'ALIGNMENT_PYTHON_UNAVAILABLE',
  );
  delete f.env.LOCAL_MEDIA_EVIDENCE_ROOT;
  expect(f.runtime().readiness().components.storage.status).toBe('NOT_READY');
  f.env.LOCAL_ALIGNMENT_PYTHON = f.env.FFMPEG_PATH;
  fs.writeFileSync(join(f.modelRoot, 'config.json'), '{}');
  expect(new LocalPythonAligner(f.env).readiness().codes).toContain(
    'ALIGNMENT_MODEL_TAMPERED',
  );
});

it('does not mistake present model weights or interpreter for verified runtime compatibility', () => {
  fs.writeFileSync(f.tts.modelPath, 'PRESENT_BUT_UNVERIFIED');
  fs.writeFileSync(
    join(f.modelRoot, 'pytorch_model.bin'),
    'PRESENT_BUT_UNVERIFIED',
  );
  const result = f.runtime().readiness();
  expect(result.status).toBe('READY');
  expect(result.automaticGeneration).toBe('UNKNOWN');
  expect(result.unverified).toContain('CTC_MODEL_INTEGRITY_UNVERIFIED');
  expect(new LocalPiperTts(f.env, f.runner).ready()).toBe(false);
});

it('preserves UNKNOWN when bounded static inspection cannot finish', () => {
  fs.writeFileSync(join(f.modelRoot, 'manifest.json'), ' '.repeat(1048577));
  const result = f.runtime().readiness();
  expect(result.status).toBe('UNKNOWN');
  expect(result.automaticGeneration).toBe('UNKNOWN');
  expect(result.components.ctc).toEqual({
    status: 'UNKNOWN',
    codes: ['LOCAL_READINESS_INSPECTION_LIMIT'],
  });
});

it('rejects incompatible CTC model configuration even when its metadata hash is current', () => {
  const path = join(f.modelRoot, 'config.json');
  fs.writeFileSync(path, JSON.stringify({ model_type: 'other' }));
  f.ctc.files['config.json'] = digest(fs.readFileSync(path));
  f.save();
  expect(f.runtime().readiness().components.ctc.codes).toContain(
    'ALIGNMENT_MODEL_INCOMPATIBLE',
  );
});

it('checks the evidence environment descriptor without claiming installed Python packages are verified', () => {
  const path = join(f.modelRoot, 'environment.json');
  fs.unlinkSync(path);
  expect(f.runtime().readiness().components.ctc.codes).toContain(
    'ALIGNMENT_ENVIRONMENT_UNAVAILABLE',
  );
  fs.writeFileSync(path, JSON.stringify({ packages: 'invalid' }));
  f.ctc.environmentSha256 = digest(fs.readFileSync(path));
  f.save();
  expect(f.runtime().readiness().components.ctc.codes).toContain(
    'ALIGNMENT_ENVIRONMENT_INCOMPATIBLE',
  );
});

it('reports an alternate speech engine without selecting or altering its configuration', () => {
  f.tts.engine = 'kokoro';
  f.save();
  expect(f.runtime().readiness().components.piper.codes).toContain(
    'LOCAL_TTS_PIPER_REQUIRED',
  );
  expect(f.tts.engine).toBe('kokoro');
});
