import { lstatSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { localFail } from '../domain/alignment-contracts.js';
import { digest } from './local-evidence-storage.js';
import { inspectMvpWav } from './physical-media-inspection.js';
import { runProcess, type ProcessRunner } from './ffmpeg-process.js';

export function adaptLocalNarration(
  original: string,
  durationMs: number,
): string {
  if (
    typeof original !== 'string' ||
    !original.trim() ||
    original.length > 6000 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1000 ||
    durationMs > 60000
  )
    localFail('NARRATION_DURATION_REQUIRED');
  const text = original.trim().replace(/\s+/g, ' ');
  const sentences = text.split(/(?<=[.!?])\s+/u);
  const seen = new Set<string>();
  const narration = sentences
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 15) return true;
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    })
    .join(' ');
  // Never infer a product claim, delete a qualifier or rewrite an approved claim.
  // If literal deduplication is insufficient, human editorial review is necessary.
  if (
    !narration ||
    narration.split(/\s+/u).length > Math.floor((durationMs / 1000) * 2.5)
  )
    localFail('NARRATION_DURATION_REQUIRED');
  return narration;
}
const blockedModel =
  'de4cecee38b30bb1a6378a337af605d59f0c377df702c6a6752870db8991cd84';
export type LocalSpeechEvidence = {
  schemaVersion: 'local-tts-evidence/1';
  configurationHash: string;
  modelId: string;
  modelVersion: string;
  modelSha256: string;
  executableSha256: string;
  license: string;
  licenseSource: string;
  licenseEvidenceSha256: string;
  attribution: string;
  approvedBy: string;
  approvedAt: string;
  narration: string;
  targetDurationMs: number;
  speechDurationMs: number;
  adaptation: 'literal-deduplication/1';
};
export class LocalPiperTts {
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly runner: ProcessRunner = runProcess,
  ) {}
  private file(path: unknown, expected: unknown, max: number) {
    if (
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      !/^[a-f0-9]{64}$/.test(String(expected))
    )
      localFail('LOCAL_TTS_LICENSE_REQUIRED');
    const stat = lstatSync(path as string);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > max ||
      realpathSync(path as string) !== resolve(path as string)
    )
      localFail('LOCAL_TTS_LICENSE_REQUIRED');
    const bytes = readFileSync(path as string);
    if (digest(bytes) !== expected) localFail('LOCAL_TTS_LICENSE_REQUIRED');
    return bytes;
  }
  configuration() {
    if (!this.env.LOCAL_TTS_MANIFEST || !this.env.LOCAL_TTS_MANIFEST_SHA256)
      localFail('LOCAL_TTS_CONFIGURATION_REQUIRED');
    try {
      const bytes = this.file(
        this.env.LOCAL_TTS_MANIFEST,
        this.env.LOCAL_TTS_MANIFEST_SHA256,
        65536,
      );
      const m = JSON.parse(bytes.toString());
      if (
        m.schemaVersion !== 'local-tts-license/1' ||
        !['piper', 'espeak-ng'].includes(m.engine) ||
        m.language !== 'pt-BR' ||
        typeof m.modelId !== 'string' ||
        !/^[a-zA-Z0-9_.:/-]{3,150}$/.test(m.modelId) ||
        /edresson|ryan/i.test(m.modelId) ||
        m.modelSha256 === blockedModel ||
        typeof m.modelVersion !== 'string' ||
        !/^[a-zA-Z0-9_.:/-]{1,100}$/.test(m.modelVersion) ||
        !(m.engine === 'espeak-ng'
          ? m.license === 'GPL-3.0-or-later'
          : ['CC0-1.0', 'CC-BY-4.0', 'MIT', 'Apache-2.0'].includes(
              m.license,
            )) ||
        m.commercialUseAllowed !== true ||
        m.localProcessingAllowed !== true ||
        !/^[a-z][a-z0-9_:-]{2,99}$/.test(m.approvedBy ?? '') ||
        !Number.isFinite(Date.parse(m.approvedAt)) ||
        Date.parse(m.approvedAt) > Date.now() ||
        typeof m.attribution !== 'string' ||
        !m.attribution.trim() ||
        m.attribution.length > 1000 ||
        typeof m.licenseSource !== 'string' ||
        !/^https:\/\/[^\s@]+$/.test(m.licenseSource)
      )
        localFail('LOCAL_TTS_LICENSE_REQUIRED');
      this.file(m.modelPath, m.modelSha256, 536870912);
      if (m.engine === 'espeak-ng') {
        const inventory = JSON.parse(
          this.file(m.modelPath, m.modelSha256, 1048576).toString(),
        );
        if (
          m.modelId !== 'espeak-ng/pt-br' ||
          !isAbsolute(m.dataRoot ?? '') ||
          inventory.schemaVersion !== 'espeak-native/1' ||
          inventory.voice !== 'pt-br' ||
          inventory.type !== 'FORMANT_RULES' ||
          !inventory.files ||
          typeof inventory.files !== 'object' ||
          Array.isArray(inventory.files) ||
          Object.keys(inventory.files).length > 2000 ||
          [
            'espeak-ng.dll',
            'espeak-ng-data/lang/roa/pt-BR',
            ...[
              'phondata',
              'phonindex',
              'phontab',
              'intonations',
              'pt_dict',
            ].map((name) => `espeak-ng-data/${name}`),
          ].some((name) => !inventory.files[name])
        )
          localFail('LOCAL_TTS_LICENSE_REQUIRED');
        for (const [name, hash] of Object.entries(inventory.files)) {
          if (
            !name ||
            name.includes('..') ||
            isAbsolute(name) ||
            /[:\\]/.test(name)
          )
            localFail('LOCAL_TTS_LICENSE_REQUIRED');
          this.file(join(m.dataRoot, name), hash, 16777216);
        }
        this.file(
          fileURLToPath(
            new URL('../../../python/tts/espeak.py', import.meta.url),
          ),
          m.adapterSha256,
          65536,
        );
      }
      const metadata = JSON.parse(
        this.file(m.configPath, m.configSha256, 1048576).toString(),
      );
      if (
        metadata.language?.code !== 'pt_BR' ||
        !(m.engine === 'espeak-ng'
          ? ['pt-br', 'pt-br+m1', 'pt-br+m3', 'pt-br+f2', 'pt-br+f3'].includes(
              metadata.espeak?.voice,
            )
          : metadata.espeak?.voice === 'pt-br') ||
        /edresson|ryan/i.test(metadata.dataset ?? '')
      )
        localFail('LOCAL_TTS_LICENSE_REQUIRED');
      const licenseURL = new URL(m.licenseSource);
      if (m.engine === 'espeak-ng' && metadata.espeak.voice.includes('+')) {
        const variant = `espeak-ng-data/voices/!v/${metadata.espeak.voice.split('+')[1]}`;
        const inventory = JSON.parse(
          this.file(m.modelPath, m.modelSha256, 1048576).toString(),
        );
        if (!inventory.files[variant]) localFail('LOCAL_TTS_LICENSE_REQUIRED');
      }
      if (
        m.engine === 'espeak-ng' &&
        ![140, 150, 160].includes(metadata.espeak.rate ?? 150)
      )
        localFail('LOCAL_TTS_LICENSE_REQUIRED');
      if (
        licenseURL.username ||
        licenseURL.password ||
        licenseURL.search ||
        licenseURL.hash
      )
        localFail('LOCAL_TTS_LICENSE_REQUIRED');
      this.file(m.executablePath, m.executableSha256, 536870912);
      this.file(m.licenseEvidencePath, m.licenseEvidenceSha256, 1048576);
      return {
        ...m,
        nativeVoice: metadata.espeak.voice,
        nativeRate: metadata.espeak.rate ?? 150,
        configurationHash: digest(bytes),
      };
    } catch (error) {
      if ((error as { code?: string }).code === 'LOCAL_TTS_LICENSE_REQUIRED')
        throw error;
      return localFail('LOCAL_TTS_LICENSE_REQUIRED');
    }
  }
  ready() {
    try {
      this.preflight();
      return true;
    } catch {
      return false;
    }
  }
  private preflight() {
    const config = this.configuration(),
      e = this.env;
    if (
      !e.FFMPEG_PATH ||
      !isAbsolute(e.FFMPEG_PATH) ||
      !existsSync(e.FFMPEG_PATH)
    )
      localFail('LOCAL_MEDIA_CONFIGURATION_REQUIRED');
    if (
      !e.LOCAL_ALIGNMENT_PYTHON ||
      !isAbsolute(e.LOCAL_ALIGNMENT_PYTHON) ||
      !existsSync(e.LOCAL_ALIGNMENT_PYTHON) ||
      !e.LOCAL_ALIGNMENT_MODEL_ROOT ||
      !isAbsolute(e.LOCAL_ALIGNMENT_MODEL_ROOT) ||
      !existsSync(e.LOCAL_ALIGNMENT_MODEL_ROOT) ||
      !/^[a-f0-9]{64}$/.test(e.LOCAL_ALIGNMENT_MODEL_SHA256 ?? '') ||
      (e.LOCAL_ALIGNMENT_EVIDENCE_KEY?.length ?? 0) < 32
    )
      localFail('ALIGNMENT_CONFIGURATION_REQUIRED');
    return config;
  }
  async synthesize(
    original: string,
    durationMs: number,
  ): Promise<{ bytes: Buffer; evidence: LocalSpeechEvidence }> {
    const m = this.preflight();
    const narration = adaptLocalNarration(original, durationMs);
    const root = await mkdtemp(join(tmpdir(), 'mktauto-local-tts-'));
    const raw = join(root, 'raw.wav'),
      speech = join(root, 'speech.wav'),
      final = join(root, 'final.wav');
    const options = {
      timeoutMs: 120000,
      maxLogBytes: 8192,
      maxOutputBytes: 20971520,
    };
    try {
      await this.runner(
        m.executablePath,
        m.engine === 'espeak-ng'
          ? [
              '-B',
              fileURLToPath(
                new URL('../../../python/tts/espeak.py', import.meta.url),
              ),
              m.dataRoot,
              raw,
              m.nativeVoice,
              String(m.nativeRate),
            ]
          : [
              '--model',
              m.modelPath,
              '--config',
              m.configPath,
              '--output_file',
              raw,
            ],
        { ...options, outputPath: raw, stdin: narration + '\n' },
      );
      await this.runner(
        this.env.FFMPEG_PATH!,
        [
          '-v',
          'error',
          '-nostdin',
          '-i',
          raw,
          '-vn',
          '-ar',
          '24000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          speech,
        ],
        { ...options, outputPath: speech },
      );
      const speechDurationMs = inspectMvpWav(
        readFileSync(speech),
      ).durationMilliseconds;
      if (speechDurationMs > durationMs)
        localFail('NARRATION_DURATION_REQUIRED');
      // Padding adds silence only. No speed change, word truncation or video repetition.
      await this.runner(
        this.env.FFMPEG_PATH!,
        [
          '-v',
          'error',
          '-nostdin',
          '-i',
          speech,
          '-af',
          `apad=whole_len=${durationMs * 24},atrim=end_sample=${durationMs * 24}`,
          '-ar',
          '24000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          final,
        ],
        { ...options, outputPath: final },
      );
      const bytes = readFileSync(final);
      if (inspectMvpWav(bytes).durationMilliseconds !== durationMs)
        localFail('LOCAL_AUDIO_FORMAT_MISMATCH');
      const evidence: LocalSpeechEvidence = {
        schemaVersion: 'local-tts-evidence/1',
        configurationHash: m.configurationHash,
        modelId: m.modelId,
        modelVersion: m.modelVersion,
        modelSha256: m.modelSha256,
        executableSha256: m.executableSha256,
        license: m.license,
        licenseSource: m.licenseSource,
        licenseEvidenceSha256: m.licenseEvidenceSha256,
        attribution: m.attribution,
        approvedBy: m.approvedBy,
        approvedAt: m.approvedAt,
        narration,
        targetDurationMs: durationMs,
        speechDurationMs,
        adaptation: 'literal-deduplication/1',
      };
      return { bytes, evidence };
    } catch (error) {
      if (
        ['NARRATION_DURATION_REQUIRED', 'LOCAL_AUDIO_FORMAT_MISMATCH'].includes(
          (error as { code?: string }).code ?? '',
        )
      )
        throw error;
      return localFail('LOCAL_TTS_EXECUTION_REQUIRED');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
