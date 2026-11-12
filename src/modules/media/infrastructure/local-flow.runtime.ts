import { assertMediaProcessingRights } from '../domain/media-processing-rights.js';
import { visualScriptMatches } from '../../content/domain/script-visual-lineage.js';
import {
  publicationScope,
  validPublicationGrant,
} from '../../publishing/domain/instagram-editorial.js';
import {
  PRODUCT_FRAMING_STRATEGY,
  PRODUCT_CAPTION_STYLE,
} from '../domain/product-framing.js';
import {
  writeFileSync,
  readFileSync,
  statSync,
  accessSync,
  constants,
} from 'node:fs';
import { mkdir, rmdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { FinanceService } from '../../finance/application/finance.service.js';
import { isAbsolute, join, resolve } from 'node:path';
import type { MediaService } from '../application/media.service.js';
import type {
  AudioAligner,
  AlignmentProvenanceVerifier,
} from '../application/alignment.port.js';
import { LocalPythonAligner } from './local-python-aligner.js';
import { PinnedAlignmentVerifier } from '../application/alignment.port.js';
import {
  localFail,
  alignmentHash,
  serializeSubtitles,
  SUBTITLE_PRESENTATION_POLICY,
  validateAlignment,
  type AlignmentEvidence,
} from '../domain/alignment-contracts.js';
import { validateVoiceTrack } from '../domain/voice-track-contracts.js';
import { adaptationHash } from '../domain/media-hash.js';
import { LocalFlowRepository } from './local-flow.repository.js';
import {
  digest,
  documentBytes,
  LocalEvidenceStorage,
} from './local-evidence-storage.js';
import { inspectMvpWav, inspectMvpPng } from './physical-media-inspection.js';
import { LocalVideoStorage, hashFile } from './local-video-storage.js';
import { runProcess, type ProcessRunner } from './ffmpeg-process.js';
import type {
  LocalAudiovisualPort,
  LocalMediaScope,
  LocalImageSource,
} from '../application/local-flow.port.js';
import {
  localMediaReadiness,
  readinessCheck,
} from '../application/local-media-readiness.js';
import {
  LocalPiperTts,
  adaptLocalNarration,
  adaptKokoroNarration,
  type LocalSpeechEvidence,
} from './local-piper-tts.js';
type SubtitleDocument = {
  subtitleId: string;
  alignmentId: string;
  evidenceHash: string;
  voiceTrackId: string;
  scriptId: string;
  scriptContentHash: string;
  srtHash: string;
  assHash: string;
};
export function publicationSourceReview(
  asset: NonNullable<ReturnType<MediaService['get']>>,
  media: Pick<MediaService, 'temporalReview'>,
  root: string,
): { reviewHash: string; sourceKind: 'STATIC_IMAGE' | 'TEMPORAL_VIDEO' } {
  if (!asset.rights.commercialUseAllowed)
    localFail('PUBLICATION_RIGHTS_REQUIRED');
  if (asset.assetType === 'VIDEO') {
    const review = media.temporalReview(asset.mediaAssetId) as {
      result: string;
      contentHash: string;
    } | null;
    if (review?.result !== 'PASS') localFail('PUBLICATION_SOURCE_QC_REQUIRED');
    new LocalEvidenceStorage(resolve(root)).read(
      asset.contentHash,
      asset.technicalProperties.format,
      33554432,
    );
    return { reviewHash: review.contentHash, sourceKind: 'TEMPORAL_VIDEO' };
  }
  if (asset.assetType !== 'IMAGE') localFail('PUBLICATION_SOURCE_QC_REQUIRED');
  const properties = asset.technicalProperties;
  if (
    asset.mediaReference !== `media:sha256_${asset.contentHash}` ||
    properties.format !== 'png' ||
    properties.mimeType !== 'image/png' ||
    !Number.isSafeInteger(properties.widthPixels) ||
    !Number.isSafeInteger(properties.heightPixels) ||
    properties.durationMilliseconds !== null ||
    properties.hasAudio !== null
  )
    localFail('PUBLICATION_SOURCE_QC_REQUIRED');
  const bytes = new LocalEvidenceStorage(resolve(root)).read(
    asset.contentHash,
    'png',
    33554432,
  );
  let inspected: ReturnType<typeof inspectMvpPng>;
  try {
    inspected = inspectMvpPng(bytes, {
      widthPixels: properties.widthPixels,
      heightPixels: properties.heightPixels,
    });
  } catch {
    localFail('PUBLICATION_SOURCE_QC_REQUIRED');
  }
  return {
    reviewHash: adaptationHash({
      schemaVersion: 'static-image-publication-inspection/1.0.0',
      mediaAssetId: asset.mediaAssetId,
      mediaReference: asset.mediaReference,
      contentHash: asset.contentHash,
      technicalProperties: inspected,
    }),
    sourceKind: 'STATIC_IMAGE',
  };
}
export class LocalFlowRuntime {
  prepareImage(scope: LocalMediaScope, source: LocalImageSource) {
    const script = this.session((r) => r.getScript(scope.scriptId));
    if (
      !script ||
      script.pipelineRunId !== scope.pipelineRunId ||
      script.contentHash !== scope.scriptContentHash ||
      script.visualDirections.length !== 1
    )
      localFail('LOCAL_SCRIPT_BINDING_INVALID');
    assertMediaProcessingRights(
      source.rights.evidence,
      {
        mediaRef: source.mediaReference,
        contentHash: source.contentHash,
      },
      null,
    );
    if (!this.env.FFMPEG_MEDIA_ROOT)
      localFail('LOCAL_MEDIA_CONFIGURATION_REQUIRED');
    const bytes = new LocalEvidenceStorage(
      resolve(this.env.FFMPEG_MEDIA_ROOT!),
    ).read(source.contentHash, 'png', 20971520);
    const technical = inspectMvpPng(bytes);
    // A physical alias preserves the authorized bytes. Original identity and
    // authorization remain in the immutable campaign request.
    const mediaReference = `media:sha256_${source.contentHash}`;
    const rights = {
      ...source.rights,
      evidence: source.rights.evidence?.map((e) => ({
        ...e,
        ...(e.mediaAuthorization
          ? {
              mediaAuthorization: {
                ...e.mediaAuthorization,
                mediaRef: mediaReference,
              },
            }
          : {}),
      })),
    };
    return this.media.register({
      schemaVersion: 'media-asset/2.0.0',
      mediaAssetId: `image_auto:${adaptationHash({ scope, source })}`,
      pipelineRunId: scope.pipelineRunId,
      projectId: script.projectId,
      projectVersion: script.projectVersion,
      scriptId: scope.scriptId,
      scriptContentHash: scope.scriptContentHash,
      visualDirectionPosition: script.visualDirections[0].position,
      assetType: 'IMAGE',
      technicalProperties: {
        ...technical,
        mimeType: 'image/png',
        hasAudio: null,
      },
      contentHash: source.contentHash,
      mediaReference,
      origin: source.origin,
      provider: source.provider,
      rights,
      source: null,
      createdAt: scope.createdAt,
      revision: 1,
      supersedesMediaAssetId: null,
    });
  }
  audioBytes(
    runId: string,
    scriptId: string,
    scriptHash: string,
    voiceId: string,
  ) {
    const audio = this.authorizedAudio(runId, scriptId, scriptHash, voiceId);
    if (!audio) localFail('LOCAL_AUTHORIZED_AUDIO_REQUIRED');
    return this.voiceFiles().read(audio!.contentHash, 'wav', 20971520);
  }
  private paidOperation(id: string, script: any, target: number) {
    const op = this.finance?.getTts(id);
    if (
      !op?.audio ||
      !op.providerRequestId ||
      !(
        op.state === 'COMPLETED' ||
        (op.state === 'UNKNOWN' &&
          op.errorCode === 'TTS_BILLING_EVIDENCE_REQUIRED')
      ) ||
      op.audio.provider !== 'openai' ||
      op.audio.origin !== 'SYNTHETIC_TTS' ||
      op.audio.rights.usageBasis !== 'PROVIDER_TERMS' ||
      !op.audio.rights.commercialUseAllowed ||
      op.request.financialPolicy?.schemaVersion !==
        'tts-risk-reservation/2.0.0' ||
      op.request.financialPolicy.scriptId !== script.scriptId ||
      op.request.financialPolicy.scriptContentHash !== script.contentHash ||
      op.request.operation.pipelineRunId !== script.pipelineRunId ||
      op.request.operation.maxDurationMilliseconds !== target ||
      op.request.operation.narration !==
        adaptLocalNarration(script.fullNarration, target)
    )
      localFail('TTS_CONFIRMED_AUDIO_REQUIRED');
    return op!;
  }
  async ingestTts(
    scope: {
      pipelineRunId: string;
      scriptId: string;
      scriptContentHash: string;
      createdAt: string;
    },
    id: string,
    durationMs: number,
  ) {
    const binding = this.session((r) => {
      const script = r.getScript(scope.scriptId);
      if (
        !script ||
        script.pipelineRunId !== scope.pipelineRunId ||
        script.contentHash !== scope.scriptContentHash
      )
        localFail('LOCAL_SCRIPT_BINDING_INVALID');
      const op = this.paidOperation(id, script, durationMs),
        grant = r.paidTtsGrant(id);
      if (grant.requestHash !== op.requestHash)
        localFail('TTS_DISPATCH_EVIDENCE_REQUIRED');
      return { script, op, grant };
    });
    const voiceId = `voice_tts_openai:${adaptationHash({ id, scope, durationMs })}`;
    const previous = this.authorizedAudio(
      scope.pipelineRunId,
      scope.scriptId,
      scope.scriptContentHash,
      voiceId,
    );
    if (previous) return previous;
    const source = this.voiceFiles().read(
        binding.op.audio!.contentHash,
        'wav',
        20971520,
      ),
      facts = inspectMvpWav(source);
    if (facts.durationMilliseconds !== binding.op.audio!.durationMilliseconds)
      localFail('LOCAL_AUDIO_FORMAT_MISMATCH');
    if (facts.durationMilliseconds > durationMs)
      localFail('NARRATION_DURATION_REQUIRED');
    let bytes = source;
    if (facts.durationMilliseconds < durationMs) {
      const temp = await mkdtemp(join(tmpdir(), 'mkt-paid-audio-'));
      try {
        const input = join(temp, 'source.wav'),
          output = join(temp, 'padded.wav');
        writeFileSync(input, source, { flag: 'wx' });
        await this.run(
          this.env.FFMPEG_PATH,
          [
            '-v',
            'error',
            '-nostdin',
            '-i',
            input,
            '-af',
            `apad=whole_len=${durationMs * 24},atrim=end_sample=${durationMs * 24}`,
            '-ar',
            '24000',
            '-ac',
            '1',
            '-c:a',
            'pcm_s16le',
            output,
          ],
          { outputPath: output, maxOutputBytes: 20971520 },
        );
        bytes = readFileSync(output);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
    if (inspectMvpWav(bytes).durationMilliseconds !== durationMs)
      localFail('ALIGNMENT_DURATION_MISMATCH');
    const hash = this.voiceFiles().put(bytes, 'wav');
    const voice = validateVoiceTrack({
      schemaVersion: 'voice-track/1.0.0',
      voiceTrackId: voiceId,
      ...scope,
      projectId: binding.script.projectId,
      projectVersion: binding.script.projectVersion,
      language: 'pt-BR',
      voiceStyle: 'informative',
      durationMilliseconds: durationMs,
      audioFormat: 'wav',
      contentHash: hash,
      storageReference: `object:voice/sha256/${hash}`,
      origin: 'SYNTHETIC_TTS',
      provider: 'openai',
      rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
      revision: 1,
      supersedesVoiceTrackId: null,
    });
    const authorization = {
      actorId: binding.grant.actorId,
      statement: `Confirmed OpenAI TTS response ${binding.op.providerRequestId}; financial authorization ${binding.op.requestHash}; provider terms; billing may remain unknown.`,
    };
    const doc = {
      voice,
      authorization,
      audioSha256: hash,
      paidTts: {
        operationId: id,
        requestHash: binding.op.requestHash,
        sourceAudioHash: binding.op.audio!.contentHash,
      },
      cost: {
        status: binding.op.billing ? 'KNOWN' : 'UNKNOWN',
        amount: binding.op.billing?.actualCostUsd ?? null,
      },
    };
    const docHash = this.files().put(documentBytes(doc), 'json');
    this.session((r) =>
      r.transaction(() =>
        r.registerLocalVoice(
          voice,
          docHash,
          adaptationHash({ authorization, paidTts: doc.paidTts }),
        ),
      ),
    );
    return this.authorizedAudio(
      scope.pipelineRunId,
      scope.scriptId,
      scope.scriptContentHash,
      voiceId,
    )!;
  }
  automaticAudioReady() {
    return new LocalPiperTts(this.env, this.runner).ready();
  }
  readiness() {
    const executable = (path: string | undefined) => {
      if (!path || !isAbsolute(path))
        return readinessCheck(
          'NOT_READY',
          'LOCAL_MEDIA_CONFIGURATION_REQUIRED',
        );
      try {
        if (!statSync(path).isFile()) throw new Error();
        accessSync(path, constants.X_OK);
        return readinessCheck('READY');
      } catch {
        return readinessCheck('NOT_READY', 'LOCAL_DEPENDENCY_UNAVAILABLE');
      }
    };
    const roots = [
      this.env.FFMPEG_MEDIA_ROOT,
      this.env.FFMPEG_VOICE_ROOT,
      this.env.FFMPEG_RENDER_ROOT,
      this.env.LOCAL_MEDIA_EVIDENCE_ROOT,
    ];
    let storage = readinessCheck('READY');
    if (roots.some((root) => !root))
      storage = readinessCheck(
        'NOT_READY',
        'LOCAL_MEDIA_CONFIGURATION_REQUIRED',
      );
    else {
      try {
        for (const root of roots) {
          if (!statSync(resolve(root!)).isDirectory()) throw new Error();
          accessSync(resolve(root!), constants.R_OK);
        }
      } catch {
        storage = readinessCheck('NOT_READY', 'LOCAL_STORAGE_UNAVAILABLE');
      }
    }
    return localMediaReadiness({
      piper: new LocalPiperTts(this.env, this.runner).readiness(),
      ctc: new LocalPythonAligner(this.env).readiness(),
      ffmpeg: executable(this.env.FFMPEG_PATH),
      ffprobe: executable(this.env.FFPROBE_PATH),
      storage,
    });
  }
  async automaticAudio(
    scope: Parameters<NonNullable<LocalAudiovisualPort['automaticAudio']>>[0],
    durationMs: number,
  ) {
    const existing = () =>
      this.authorizedAudio(
        scope.pipelineRunId,
        scope.scriptId,
        scope.scriptContentHash,
      );
    const previous = existing();
    if (previous) return previous;
    const tts = new LocalPiperTts(this.env, this.runner),
      config = tts.configuration();
    const key = adaptationHash({
      scope,
      durationMs,
      configurationHash: config.configurationHash,
    });
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const operation = (async () => {
      const lock = join(this.files().root, `tts_${key}.lock`);
      try {
        await mkdir(lock);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          localFail('LOCAL_TTS_BUSY_REQUIRED');
        throw error;
      }
      try {
        const replay = existing();
        if (replay) return replay;
        const script = this.session((r) => r.getScript(scope.scriptId));
        if (
          !script ||
          script.contentHash !== scope.scriptContentHash ||
          script.pipelineRunId !== scope.pipelineRunId ||
          script.language !== 'pt-BR'
        )
          localFail('LOCAL_SCRIPT_BINDING_INVALID');
        const { bytes, evidence } = await tts.synthesize(
          script.fullNarration,
          durationMs,
        );
        const hash = digest(bytes);
        const voice = validateVoiceTrack({
          schemaVersion: 'voice-track/1.0.0',
          voiceTrackId: `voice_tts:${key}`,
          pipelineRunId: scope.pipelineRunId,
          projectId: script.projectId,
          projectVersion: script.projectVersion,
          scriptId: scope.scriptId,
          scriptContentHash: scope.scriptContentHash,
          language: script.language,
          voiceStyle: 'informative',
          durationMilliseconds: durationMs,
          audioFormat: 'wav',
          contentHash: hash,
          storageReference: `object:voice/sha256/${hash}`,
          origin: 'SYNTHETIC_TTS',
          provider:
            config.engine === 'kokoro'
              ? 'local_kokoro'
              : config.engine === 'espeak-ng'
                ? 'local_espeak_ng'
                : 'local_piper',
          rights: { usageBasis: 'LICENSED', commercialUseAllowed: true },
          createdAt: scope.createdAt,
          revision: 1,
          supersedesVoiceTrackId: null,
        });
        const authorization = {
          actorId: evidence.approvedBy,
          statement: `Local synthetic speech authorized by pinned license evidence ${evidence.licenseEvidenceSha256}; ${evidence.license}; ${evidence.attribution}`,
        };
        const documentHash = this.files().put(
          documentBytes({
            voice,
            authorization,
            synthesis: evidence,
            audioSha256: hash,
            cost: { status: 'UNKNOWN', amount: null },
          }),
          'json',
        );
        this.voiceFiles().put(bytes, 'wav');
        this.session((r) =>
          r.transaction(() => {
            if (
              r.getScript(scope.scriptId)?.contentHash !==
              scope.scriptContentHash
            )
              localFail('LOCAL_SCRIPT_BINDING_INVALID');
            return r.registerLocalVoice(
              voice,
              documentHash,
              adaptationHash({ authorization, synthesis: evidence }),
            );
          }),
        );
        return existing()!;
      } finally {
        await rmdir(lock);
      }
    })();
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(key);
    }
  }
  private narration(r: LocalFlowRepository, voice: any, script: any): string {
    if (voice.origin === 'SYNTHETIC_TTS' && voice.provider === 'openai') {
      const doc = r.document<any>(
        voice.voiceTrackId,
        'voice_track',
        this.files(),
      );
      if (!doc.paidTts || voice.rights.usageBasis !== 'PROVIDER_TERMS')
        localFail('TTS_CONFIRMED_AUDIO_REQUIRED');
      const op = this.paidOperation(
          doc.paidTts.operationId,
          script,
          voice.durationMilliseconds,
        ),
        grant = r.paidTtsGrant(doc.paidTts.operationId);
      if (
        grant.requestHash !== op.requestHash ||
        doc.paidTts.requestHash !== op.requestHash ||
        doc.paidTts.sourceAudioHash !== op.audio!.contentHash
      )
        localFail('TTS_CONFIRMED_AUDIO_REQUIRED');
      this.voiceFiles().read(op.audio!.contentHash, 'wav', 20971520);
      return op.request.operation.narration;
    }
    if (
      voice.origin !== 'SYNTHETIC_TTS' ||
      !['local_piper', 'local_espeak_ng', 'local_kokoro'].includes(
        voice.provider,
      )
    )
      return script.fullNarration;
    if (voice.rights.usageBasis !== 'LICENSED')
      localFail('LOCAL_AUTHORIZED_AUDIO_REQUIRED');
    const doc = r.document<{ synthesis: LocalSpeechEvidence }>(
      voice.voiceTrackId,
      'voice_track',
      this.files(),
    );
    const evidence = doc.synthesis,
      config = new LocalPiperTts(this.env, this.runner).configuration(
        evidence?.configurationHash,
      );
    if (
      !evidence ||
      evidence.schemaVersion !== 'local-tts-evidence/1' ||
      evidence.configurationHash !== config.configurationHash ||
      voice.provider !==
        (config.engine === 'kokoro'
          ? 'local_kokoro'
          : config.engine === 'espeak-ng'
            ? 'local_espeak_ng'
            : 'local_piper') ||
      evidence.modelSha256 !== config.modelSha256 ||
      evidence.licenseEvidenceSha256 !== config.licenseEvidenceSha256 ||
      evidence.modelId !== config.modelId ||
      evidence.modelVersion !== config.modelVersion ||
      evidence.executableSha256 !== config.executableSha256 ||
      evidence.license !== config.license ||
      evidence.licenseSource !== config.licenseSource ||
      evidence.attribution !== config.attribution ||
      evidence.approvedBy !== config.approvedBy ||
      evidence.approvedAt !== config.approvedAt ||
      adaptationHash(evidence.presentation ?? null) !==
        adaptationHash(config.presentation ?? null) ||
      evidence.targetDurationMs !== voice.durationMilliseconds ||
      evidence.speechDurationMs > evidence.targetDurationMs ||
      ![
        'literal-deduplication/1',
        'paragraph-preserving-deduplication/2',
      ].includes(evidence.adaptation) ||
      evidence.narration !==
        (evidence.adaptation === 'paragraph-preserving-deduplication/2'
          ? adaptKokoroNarration(
              script.fullNarration,
              voice.durationMilliseconds,
            )
          : adaptLocalNarration(
              script.fullNarration,
              voice.durationMilliseconds,
            ))
    )
      localFail('LOCAL_TTS_LICENSE_REQUIRED');
    // CTC keeps its existing canonical text; Kokoro receives paragraph breaks.
    return evidence.adaptation === 'paragraph-preserving-deduplication/2'
      ? adaptLocalNarration(script.fullNarration, voice.durationMilliseconds)
      : evidence.narration;
  }
  async ingestRecording(
    scope: Parameters<NonNullable<LocalAudiovisualPort['ingestRecording']>>[0],
    input: Parameters<NonNullable<LocalAudiovisualPort['ingestRecording']>>[1],
    actorId: string,
  ) {
    if (
      !input ||
      Object.keys(input).sort().join(',') !==
        'audioBase64,commercialUseAllowed,statement,usageBasis' ||
      !['OWNED', 'LICENSED'].includes(input.usageBasis) ||
      input.commercialUseAllowed !== true
    )
      localFail('LOCAL_RIGHTS_EVIDENCE_REQUIRED');
    if (
      typeof input.audioBase64 !== 'string' ||
      input.audioBase64.length > 28000000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audioBase64)
    )
      localFail('LOCAL_AUDIO_INVALID');
    const bytes = Buffer.from(input.audioBase64, 'base64');
    if (
      bytes.length > 20971520 ||
      bytes.toString('base64') !== input.audioBase64
    )
      localFail('LOCAL_AUDIO_INVALID');
    const facts = inspectMvpWav(bytes),
      hash = digest(bytes);
    const script = this.session((r) => r.getScript(scope.scriptId));
    if (
      !script ||
      script.pipelineRunId !== scope.pipelineRunId ||
      script.contentHash !== scope.scriptContentHash
    )
      localFail('LOCAL_SCRIPT_BINDING_INVALID');
    const voice = {
      schemaVersion: 'voice-track/1.0.0',
      voiceTrackId: `voice_local:${adaptationHash({ scope, hash, actorId, usageBasis: input.usageBasis, statement: input.statement })}`,
      pipelineRunId: scope.pipelineRunId,
      projectId: script!.projectId,
      projectVersion: script!.projectVersion,
      scriptId: scope.scriptId,
      scriptContentHash: scope.scriptContentHash,
      language: script!.language,
      voiceStyle: 'informative',
      durationMilliseconds: facts.durationMilliseconds,
      audioFormat: 'wav',
      contentHash: hash,
      storageReference: `object:voice/sha256/${hash}`,
      origin:
        input.usageBasis === 'OWNED'
          ? 'OPERATOR_RECORDING'
          : 'AUTHORIZED_RECORDING',
      provider: null,
      rights: { usageBasis: input.usageBasis, commercialUseAllowed: true },
      createdAt: scope.createdAt,
      revision: 1,
      supersedesVoiceTrackId: null,
    };
    return this.ingest({
      voiceTrack: voice,
      audioBase64: input.audioBase64,
      authorization: { actorId, statement: input.statement },
    });
  }
  authorizedAudio(
    runId: string,
    scriptId: string,
    scriptHash: string,
    voiceTrackId?: string,
    source?: 'RECORDING',
  ) {
    return this.session((r) => {
      const ids = r
        .localVoiceIds(runId, scriptId, scriptHash)
        .filter((id) => !voiceTrackId || id === voiceTrackId)
        .filter(
          (id) =>
            source !== 'RECORDING' ||
            r.getVoiceTrack(id)?.origin !== 'SYNTHETIC_TTS',
        );
      if (!ids.length) return null;
      if (ids.length !== 1) localFail('LOCAL_AUDIO_SELECTION_REQUIRED');
      const voice = validateVoiceTrack(r.getVoiceTrack(ids[0]));
      const script = r.getScript(scriptId),
        run = r.getRun(runId);
      if (
        !script ||
        !run ||
        script.contentHash !== scriptHash ||
        (['pipelineRunId', 'projectId', 'projectVersion'] as const).some(
          (key) => script[key] !== voice[key] || run[key] !== voice[key],
        ) ||
        voice.pipelineRunId !== runId ||
        voice.scriptId !== scriptId ||
        voice.scriptContentHash !== scriptHash ||
        (voice.origin === 'SYNTHETIC_TTS'
          ? ![
              'local_piper',
              'local_espeak_ng',
              'local_kokoro',
              'openai',
            ].includes(voice.provider)
          : voice.provider !== null) ||
        !(voice.provider === 'openai'
          ? voice.rights.usageBasis === 'PROVIDER_TERMS'
          : ['OWNED', 'LICENSED'].includes(voice.rights.usageBasis)) ||
        ![
          'AUTHORIZED_RECORDING',
          'OPERATOR_RECORDING',
          'SYNTHETIC_TTS',
        ].includes(voice.origin)
      )
        localFail('LOCAL_AUTHORIZED_AUDIO_REQUIRED');
      const doc = r.document<{
        voice: unknown;
        authorization: { actorId: string; statement: string };
        audioSha256: string;
      }>(voice.voiceTrackId, 'voice_track', this.files());
      if (
        adaptationHash(doc.voice) !== adaptationHash(voice) ||
        doc.audioSha256 !== voice.contentHash ||
        !doc.authorization?.actorId ||
        !doc.authorization.statement?.trim()
      )
        localFail('LOCAL_RIGHTS_EVIDENCE_REQUIRED');
      const bytes = this.voiceFiles().read(voice.contentHash, 'wav', 20971520);
      this.narration(r, voice, script);
      if (
        voice.audioFormat !== 'wav' ||
        voice.storageReference !== `object:voice/sha256/${voice.contentHash}` ||
        inspectMvpWav(bytes).durationMilliseconds !== voice.durationMilliseconds
      )
        localFail('LOCAL_AUDIO_FORMAT_MISMATCH');
      return {
        voiceTrackId: voice.voiceTrackId as string,
        contentHash: voice.contentHash as string,
        durationMilliseconds: voice.durationMilliseconds as number,
      };
    });
  }
  private readonly inFlight = new Map<string, Promise<any>>();
  constructor(
    private readonly open: () => LocalFlowRepository,
    private readonly media: MediaService,
    private readonly env: NodeJS.ProcessEnv,
    private readonly provenance: AlignmentProvenanceVerifier = new PinnedAlignmentVerifier(
      new Set(
        (env.LOCAL_ALIGNMENT_EVIDENCE_HASHES ?? '').split(',').filter(Boolean),
      ),
    ),
    private readonly runner: ProcessRunner = runProcess,
    private readonly aligner: AudioAligner = new LocalPythonAligner(env),
    private readonly finance?: Pick<FinanceService, 'getTts'>,
  ) {}
  private files() {
    const root = this.env.LOCAL_MEDIA_EVIDENCE_ROOT;
    if (!root) localFail('LOCAL_MEDIA_CONFIGURATION_REQUIRED');
    return new LocalEvidenceStorage(resolve(root));
  }
  private voiceFiles() {
    if (!this.env.FFMPEG_VOICE_ROOT)
      localFail('LOCAL_MEDIA_CONFIGURATION_REQUIRED');
    return new LocalEvidenceStorage(resolve(this.env.FFMPEG_VOICE_ROOT));
  }
  private renderFiles() {
    if (!this.env.FFMPEG_RENDER_ROOT)
      localFail('LOCAL_MEDIA_CONFIGURATION_REQUIRED');
    return new LocalEvidenceStorage(resolve(this.env.FFMPEG_RENDER_ROOT));
  }
  private session<T>(action: (r: LocalFlowRepository) => T): T {
    const r = this.open();
    try {
      return action(r);
    } finally {
      r.close();
    }
  }
  async ingest(value: unknown) {
    const v = value as {
      voiceTrack: unknown;
      audioBase64?: string;
      authorization: { actorId: string; statement: string };
    };
    const voice = validateVoiceTrack(v?.voiceTrack);
    if (
      !['OPERATOR_RECORDING', 'AUTHORIZED_RECORDING'].includes(voice.origin) ||
      voice.provider !== null ||
      !['OWNED', 'LICENSED'].includes(voice.rights.usageBasis)
    )
      localFail('LOCAL_AUTHORIZED_AUDIO_REQUIRED');
    if (
      v.audioBase64 !== undefined &&
      (typeof v.audioBase64 !== 'string' ||
        v.audioBase64.length > 28000000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(v.audioBase64))
    )
      localFail('LOCAL_AUDIO_INVALID');
    if (
      !v.authorization ||
      !/^[a-z0-9][a-z0-9_:-]{2,199}$/.test(v.authorization.actorId) ||
      typeof v.authorization.statement !== 'string' ||
      !v.authorization.statement.trim() ||
      v.authorization.statement.length > 2000
    )
      localFail('LOCAL_RIGHTS_EVIDENCE_REQUIRED');
    // HTTP may reference an operator-staged CAS WAV without uploading large JSON.
    const audio =
      v.audioBase64 === undefined
        ? this.voiceFiles().read(voice.contentHash, 'wav', 20971520)
        : Buffer.from(v.audioBase64, 'base64');
    if (
      (v.audioBase64 !== undefined &&
        audio.toString('base64') !== v.audioBase64) ||
      audio.length > 20971520 ||
      digest(audio) !== voice.contentHash
    )
      localFail('LOCAL_AUDIO_HASH_MISMATCH');
    const facts = inspectMvpWav(audio);
    if (
      voice.audioFormat !== 'wav' ||
      facts.durationMilliseconds !== voice.durationMilliseconds ||
      voice.storageReference !== `object:voice/sha256/${voice.contentHash}`
    )
      localFail('LOCAL_AUDIO_FORMAT_MISMATCH');
    const files = this.files();
    const document = {
      voice,
      authorization: v.authorization,
      audioSha256: voice.contentHash,
      cost: { status: 'UNKNOWN', amount: null },
    };
    const documentHash = files.put(documentBytes(document), 'json');
    this.voiceFiles().put(audio, 'wav');
    return this.session((r) =>
      r.transaction(() => {
        const script = r.getScript(voice.scriptId),
          run = r.getRun(voice.pipelineRunId);
        if (
          !script ||
          !run ||
          script.contentHash !== voice.scriptContentHash ||
          script.language !== voice.language ||
          (['pipelineRunId', 'projectId', 'projectVersion'] as const).some(
            (k) => script[k] !== voice[k] || run[k] !== voice[k],
          )
        )
          localFail('LOCAL_SCRIPT_BINDING_INVALID');
        // Existing run→campaign binding is authoritative; no parallel campaign state.
        return r.registerLocalVoice(
          voice,
          documentHash,
          adaptationHash(v.authorization),
        );
      }),
    );
  }
  private bind(r: LocalFlowRepository, evidence: AlignmentEvidence) {
    const voice = r.getVoiceTrack(evidence.input.audioAssetId),
      script = r.getScript(evidence.input.scriptId);
    if (
      !voice ||
      !script ||
      voice.voiceTrackId !== evidence.input.audioAssetId ||
      script.scriptId !== evidence.input.scriptId ||
      voice.scriptId !== script.scriptId ||
      voice.scriptContentHash !== script.contentHash ||
      voice.contentHash !== evidence.input.audioSha256 ||
      voice.durationMilliseconds !== evidence.input.durationMs ||
      script.revision !== evidence.input.scriptVersion ||
      this.narration(r, voice, script) !== evidence.input.canonicalText
    )
      localFail('ALIGNMENT_CURRENT_BINDING_INVALID');
    const audio = this.voiceFiles().read(voice.contentHash, 'wav', 20971520);
    const facts = inspectMvpWav(audio);
    if (facts.durationMilliseconds !== evidence.input.durationMs)
      localFail('ALIGNMENT_DURATION_MISMATCH');
    return { voice, script, audio };
  }
  async acceptAlignment(raw: unknown) {
    const evidence = validateAlignment(raw);
    const chain = this.session((r) => this.bind(r, evidence));
    if (
      !(await this.provenance.verify(evidence, chain.audio)) &&
      !(await new LocalPythonAligner(this.env).verify(evidence, chain.audio))
    )
      localFail('ALIGNMENT_PROVENANCE_UNVERIFIED');
    return this.session((r) =>
      r.transaction(() => {
        const { voice, script } = this.bind(r, evidence);
        r.saveDocument(
          evidence.output.alignmentId,
          'local_alignment',
          evidence,
          voice,
          [
            { inputId: voice.voiceTrackId, contentHash: voice.contentHash },
            { inputId: script.scriptId, contentHash: script.contentHash },
          ],
          this.files(),
        );
        return evidence;
      }),
    );
  }
  async alignAudio(id: string): Promise<AlignmentEvidence> {
    if (!/^[a-z0-9][a-z0-9_:-]{2,199}$/.test(id))
      localFail('ALIGNMENT_ID_INVALID');
    const input = this.session((r) => {
      const voice = r.getVoiceTrack(id);
      if (!voice) localFail('LOCAL_AUDIO_NOT_FOUND');
      const script = r.getScript(voice.scriptId);
      if (!script) localFail('LOCAL_SCRIPT_NOT_FOUND');
      // Only explicitly authorized, ingested local audio may be aligned.
      if (
        ![
          'AUTHORIZED_RECORDING',
          'OPERATOR_RECORDING',
          'SYNTHETIC_TTS',
        ].includes(voice.origin) ||
        (voice.origin === 'SYNTHETIC_TTS' &&
          ![
            'local_piper',
            'local_espeak_ng',
            'local_kokoro',
            'openai',
          ].includes(voice.provider)) ||
        !r.getArtifact(id)?.generationMetadata
      )
        localFail('LOCAL_AUTHORIZED_AUDIO_REQUIRED');
      const authorization = r.document<{ authorization?: unknown }>(
        id,
        'voice_track',
        this.files(),
      );
      if (!authorization.authorization)
        localFail('LOCAL_AUTHORIZED_AUDIO_REQUIRED');
      return {
        audioAssetId: id,
        audioSha256: voice.contentHash,
        scriptId: script.scriptId,
        scriptVersion: script.revision,
        scriptTextSha256: alignmentHash(this.narration(r, voice, script)),
        durationMs: voice.durationMilliseconds,
        canonicalText: this.narration(r, voice, script),
      };
    });
    const alignmentId =
      'align_' + alignmentHash({ input, configuration: this.aligner.identity });
    const replay = () =>
      this.session((r) =>
        r.getArtifact(alignmentId) ? this.alignment(r, alignmentId) : null,
      );
    const previous = replay();
    if (previous) return previous;
    const running = this.inFlight.get(alignmentId);
    if (running) return running;
    const operation = (async () => {
      const root = this.env.LOCAL_MEDIA_EVIDENCE_ROOT;
      if (!root) localFail('LOCAL_MEDIA_CONFIGURATION_REQUIRED');
      await mkdir(root, { recursive: true });
      const lock = join(root, alignmentId + '.lock');
      // Atomic filesystem lock also serializes distinct Nest workers. A stale lock fails closed.
      const deadline = Date.now() + 185000;
      for (;;) {
        try {
          await mkdir(lock);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const saved = replay();
          if (saved) return saved;
          if (Date.now() > deadline) localFail('ALIGNMENT_BUSY_CONFLICT');
          await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        }
      }
      try {
        const saved = replay();
        if (saved) return saved;
        const chain = this.session((r) =>
          this.bind(r, { input } as AlignmentEvidence),
        );
        const evidence = validateAlignment(
          await this.aligner.align(input, chain.audio),
        );
        if (alignmentHash(evidence.input) !== alignmentHash(input))
          localFail('ALIGNMENT_BINDING_MISMATCH');
        if (evidence.output.alignmentId !== alignmentId)
          localFail('ALIGNMENT_BINDING_MISMATCH');
        return await this.acceptAlignment(evidence);
      } finally {
        await rmdir(lock);
      }
    })();
    this.inFlight.set(alignmentId, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(alignmentId);
    }
  }
  private alignment(r: LocalFlowRepository, id: string) {
    const evidence = validateAlignment(
      r.document(id, 'local_alignment', this.files()),
    );
    this.bind(r, evidence);
    return evidence;
  }
  subtitles(alignmentId: string): SubtitleDocument {
    return this.session((r) =>
      r.transaction(() => {
        const evidence = this.alignment(r, alignmentId),
          { voice, script } = this.bind(r, evidence),
          files = this.files();
        // The local composer outputs 30 fps. Presentation policy is separate
        // from signed acoustic evidence, and participates in artifact identity.
        const presentation = {
          frameRate: 30,
          durationMs: evidence.input.durationMs,
        };
        const text = serializeSubtitles(evidence.output.segments, presentation);
        const presentationHash = adaptationHash({
          policy: SUBTITLE_PRESENTATION_POLICY,
          presentation,
          srt: text.srt,
          ass: text.ass,
        });
        const doc = {
          subtitleId: `subtitle_local:${evidence.output.evidenceHash}:${presentationHash}`,
          alignmentId,
          evidenceHash: evidence.output.evidenceHash,
          voiceTrackId: voice.voiceTrackId,
          scriptId: script.scriptId,
          scriptContentHash: script.contentHash,
          srtHash: files.put(Buffer.from(text.srt), 'srt'),
          assHash: files.put(Buffer.from(text.ass), 'ass'),
        };
        r.saveDocument(
          doc.subtitleId,
          'local_subtitles',
          doc,
          voice,
          [
            {
              inputId: alignmentId,
              contentHash: r.getArtifact(alignmentId)!.contentHash,
            },
            { inputId: script.scriptId, contentHash: script.contentHash },
            { inputId: voice.voiceTrackId, contentHash: voice.contentHash },
          ],
          files,
        );
        return doc;
      }),
    );
  }
  async compose(value: unknown) {
    return this.media.compose(value);
  }
  private subtitle(r: LocalFlowRepository, id: string) {
    const doc = r.document<SubtitleDocument>(
      id,
      'local_subtitles',
      this.files(),
    );
    const evidence = this.alignment(r, doc.alignmentId);
    if (
      doc.evidenceHash !== evidence.output.evidenceHash ||
      doc.voiceTrackId !== evidence.input.audioAssetId ||
      doc.scriptId !== evidence.input.scriptId
    )
      localFail('LOCAL_SUBTITLE_BINDING_INVALID');
    this.files().read(doc.assHash, 'ass');
    this.files().read(doc.srtHash, 'srt');
    return doc;
  }
  async burn(videoId: string, subtitleId: string): Promise<any> {
    const key = `${videoId}/${subtitleId}`;
    const prior = this.inFlight.get(key);
    if (prior) return prior;
    const task = this.burnOnce(videoId, subtitleId);
    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(key);
    }
  }
  private async burnOnce(videoId: string, subtitleId: string) {
    const id = `video_render:local:${adaptationHash({ videoId, subtitleId })}`;
    const { source, previous, subtitle, contain } = this.session((r) => {
      const source = r.getVideoRender(videoId) as any,
        subtitle = this.subtitle(r, subtitleId);
      if (
        !source ||
        source.schemaVersion !== 'video-render/1.0.0' ||
        source.revision !== 1
      )
        localFail('LOCAL_SOURCE_RENDER_REQUIRED');
      const plan = r.getCompositionPlan(source.compositionPlanId);
      if (
        plan.voiceTrackId !== subtitle.voiceTrackId ||
        plan.scriptId !== subtitle.scriptId ||
        plan.scriptContentHash !== subtitle.scriptContentHash
      )
        localFail('LOCAL_SUBTITLE_BINDING_INVALID');
      return {
        source,
        subtitle,
        previous: r.getVideoRender(id),
        contain: plan.segments.every(
          (s: any) => s.framingStrategy === PRODUCT_FRAMING_STRATEGY,
        ),
      };
    });
    this.renderFiles().read(source.contentHash, 'mp4');
    if (previous) {
      this.renderFiles().read(previous.contentHash, 'mp4');
      return previous;
    }
    const root = this.env.FFMPEG_RENDER_ROOT!;
    const storage = new LocalVideoStorage({ root, maxBytes: 524288000 }),
      staging = await storage.createStaging();
    try {
      const sourcePath = join(staging, 'source.mp4'),
        output = join(staging, 'final.mp4');
      writeFileSync(
        sourcePath,
        this.renderFiles().read(source.contentHash, 'mp4'),
        { flag: 'wx' },
      );
      writeFileSync(
        join(staging, 'subtitles.ass'),
        this.files().read(subtitle.assHash, 'ass'),
        { flag: 'wx' },
      );
      await this.run(
        this.env.FFMPEG_PATH,
        [
          '-nostdin',
          '-v',
          'error',
          '-i',
          'source.mp4',
          '-vf',
          contain
            ? `subtitles=subtitles.ass:force_style='${PRODUCT_CAPTION_STYLE}'`
            : 'ass=subtitles.ass',
          '-map',
          '0:v:0',
          '-map',
          '0:a:0',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'copy',
          '-movflags',
          '+faststart',
          'final.mp4',
        ],
        { cwd: staging, outputPath: output, maxOutputBytes: 524288000 },
      );
      const facts = await this.probe(output);
      if (!this.validFacts(facts, source)) localFail('LOCAL_RENDER_QC_FAILED');
      const hash = await hashFile(output, 524288000),
        promoted = await storage.promote(output, hash);
      const render = {
        ...source,
        videoRenderId: id,
        contentHash: hash,
        logicalReference: promoted.logicalReference,
        revision: 2,
        supersedesVideoRenderId: source.videoRenderId,
      };
      return this.session((r) =>
        r.transaction(() => {
          this.subtitle(r, subtitleId);
          return r.registerBurned(render, subtitleId, this.files());
        }),
      );
    } finally {
      await storage.cleanup(staging);
    }
  }
  private async run(
    command: string | undefined,
    args: string[],
    extra: Record<string, unknown> = {},
  ) {
    if (!command) localFail('LOCAL_FFMPEG_UNAVAILABLE');
    return this.runner(command, args, {
      timeoutMs: 300000,
      maxLogBytes: 65536,
      ...extra,
    });
  }
  private async probe(path: string) {
    const result = await this.run(this.env.FFPROBE_PATH, [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      path,
    ]);
    const raw = JSON.parse(result.stdout) as { streams: any[]; format: any };
    return {
      streams: raw.streams.map(
        ({
          codec_type,
          codec_name,
          width,
          height,
          duration,
        }: Record<string, unknown>) => ({
          codec_type: codec_type ?? null,
          codec_name: codec_name ?? null,
          width: width ?? null,
          height: height ?? null,
          duration: duration ?? null,
        }),
      ),
      format: {
        format_name: (raw.format.format_name ?? null) as string | null,
        duration: (raw.format.duration ?? null) as string | null,
      },
    };
  }
  private validFacts(f: { streams: any[]; format: any }, render: any) {
    const videos = f.streams?.filter((s) => s.codec_type === 'video') ?? [],
      audios = f.streams?.filter((s) => s.codec_type === 'audio') ?? [];
    const within = (s: unknown) =>
      typeof s === 'string' &&
      Number.isFinite(Number(s)) &&
      Math.abs(Number(s) * 1000 - render.durationMilliseconds) <= 34;
    return (
      videos.length === 1 &&
      audios.length === 1 &&
      f.streams.length === 2 &&
      videos[0].width === render.widthPixels &&
      videos[0].height === render.heightPixels &&
      videos[0].codec_name === 'h264' &&
      audios[0].codec_name === 'aac' &&
      f.format?.format_name?.split(',').includes('mp4') &&
      within(f.format.duration) &&
      within(videos[0].duration) &&
      within(audios[0].duration)
    );
  }
  publicationEvidence(qcId: string, inspectOnly = false) {
    return this.session((r) => {
      const qc: any = r.document(qcId, 'local_qc', this.files());
      const render = r.getVideoRender(qc.videoRenderId) as any;
      if (
        !render ||
        render.revision !== 2 ||
        qc.result !== 'PASS' ||
        qc.approvalBlocked !== false ||
        qc.videoRenderContentHash !== render.contentHash ||
        !Array.isArray(qc.findings) ||
        qc.findings.some((f: any) => f.status !== 'PASS') ||
        [
          'PHYSICAL_HASH',
          'VERIFIED_SUBTITLES_LINEAGE',
          'STREAMS_FORMAT_DURATION',
          'FULL_DECODE',
        ].some((c) => !qc.findings.some((f: any) => f.code === c))
      )
        localFail('PUBLICATION_QC_REQUIRED');
      this.renderFiles().read(render.contentHash, 'mp4');
      const subtitleId = r.getArtifact(render.videoRenderId)?.inputs[2]
        ?.inputId;
      if (!subtitleId) localFail('LOCAL_SUBTITLES_REQUIRED');
      this.subtitle(r, subtitleId!);
      const plan = r.getCompositionPlan(render.compositionPlanId) as any;
      if (!plan || plan.schemaVersion !== 'composition-plan/2.0.0')
        localFail('PUBLICATION_LINEAGE_REQUIRED');
      const audio = this.authorizedAudio(
        render.pipelineRunId,
        plan.scriptId,
        plan.scriptContentHash,
        plan.voiceTrackId,
      );
      if (!audio || audio.contentHash !== plan.voiceTrackContentHash)
        localFail('LOCAL_AUTHORIZED_AUDIO_REQUIRED');
      const sourceAssets = plan.segments.map((s: any) =>
        this.media.get(s.mediaAssetId),
      );
      const currentScript = r.getScript(plan.scriptId);
      if (
        !currentScript ||
        currentScript.contentHash !== plan.scriptContentHash
      )
        localFail('PUBLICATION_LINEAGE_REQUIRED');
      if (sourceAssets.some((a: any) => !a))
        localFail('PUBLICATION_RIGHTS_REQUIRED');
      const scope = publicationScope(render, plan, audio, sourceAssets);
      const hasTable = r.db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='instagram_publication_rights'",
        )
        .get();
      const row = hasTable
        ? r.db
            .prepare(
              'SELECT payload_json FROM instagram_publication_rights WHERE scope_hash=?',
            )
            .get(scope.scopeHash)
        : null;
      const grant = row ? JSON.parse(String(row.payload_json)) : null;
      const scoped = sourceAssets.some((a: any) =>
        a.rights.evidence?.some(
          (e: any) =>
            e.mediaAuthorization?.campaignId !== undefined ||
            e.mediaAuthorization?.operationScope !== undefined,
        ),
      );
      const grantValid = validPublicationGrant(grant, scope);
      const assets = plan.segments.map((segment: any) => {
        const asset = this.media.get(segment.mediaAssetId);
        if (
          !asset ||
          asset.pipelineRunId !== render.pipelineRunId ||
          !visualScriptMatches(
            currentScript,
            asset.scriptId,
            asset.scriptContentHash,
            (id) => r.getScript(id),
          ) ||
          asset.contentHash !== segment.mediaAssetContentHash ||
          !asset.rights.commercialUseAllowed
        )
          localFail('PUBLICATION_RIGHTS_REQUIRED');
        // Preserve the original review scope; publishing requires its own exact grant.
        const scopedAsset = asset!.rights.evidence?.some(
          (e) =>
            e.mediaAuthorization?.campaignId !== undefined ||
            e.mediaAuthorization?.operationScope !== undefined,
        );
        if (scopedAsset && !inspectOnly && !grantValid)
          localFail('PUBLICATION_RIGHTS_REQUIRED');
        if (scopedAsset) {
          for (const e of asset!.rights.evidence!.filter(
            (e) => e.kind === 'MEDIA_USAGE_RIGHT',
          )) {
            const a = e.mediaAuthorization;
            assertMediaProcessingRights(
              [e],
              {
                mediaRef: asset!.mediaReference,
                contentHash: asset!.contentHash,
              },
              null,
              a?.operationScope,
              a?.campaignId
                ? { campaignId: a.campaignId, purpose: a.purpose! }
                : undefined,
            );
          }
        } else
          assertMediaProcessingRights(
            asset!.rights.evidence,
            {
              mediaRef: asset!.mediaReference,
              contentHash: asset!.contentHash,
            },
            null,
          );
        const source = publicationSourceReview(
          asset!,
          this.media,
          this.env.FFMPEG_MEDIA_ROOT!,
        );
        return {
          id: asset!.mediaAssetId,
          contentHash: asset!.contentHash,
          rightsHash: adaptationHash(asset!.rights),
          reviewHash: source.reviewHash,
          sourceKind: source.sourceKind,
        };
      });
      const voice = r.getVoiceTrack(audio.voiceTrackId) as any;
      const authorization = r.document<any>(
        audio.voiceTrackId,
        'voice_track',
        this.files(),
      ).authorization;
      return {
        qc,
        publicationScope: scope,
        publicationAuthorization: {
          required: scoped && !grantValid,
          grant: grantValid ? grant : null,
          missing:
            scoped && !grantValid
              ? 'COMMERCIAL_INSTAGRAM_FAKE_PUBLICATION'
              : null,
        },
        render,
        planHash: plan.contentHash,
        audio: {
          ...audio,
          rightsHash: adaptationHash(voice.rights),
          authorizationHash: adaptationHash(authorization),
        },
        assets,
      };
    });
  }
  async qc(videoId: string) {
    const render = this.session((r) => r.getVideoRender(videoId));
    if (!render) localFail('LOCAL_RENDER_NOT_FOUND');
    const findings: { code: string; status: 'PASS' | 'FAIL' | 'UNKNOWN' }[] =
      [];
    let facts: unknown = null;
    let bytes: Buffer | undefined;
    try {
      bytes = this.renderFiles().read(render.contentHash, 'mp4');
      findings.push({ code: 'PHYSICAL_HASH', status: 'PASS' });
    } catch {
      findings.push({ code: 'PHYSICAL_HASH', status: 'FAIL' });
    }
    try {
      this.session((r) => {
        const lineage = r.getArtifact(videoId),
          subtitleId = lineage?.inputs[2]?.inputId;
        if (render.revision !== 2 || !subtitleId)
          localFail('LOCAL_SUBTITLES_REQUIRED');
        this.subtitle(r, subtitleId);
      });
      findings.push({ code: 'VERIFIED_SUBTITLES_LINEAGE', status: 'PASS' });
    } catch {
      findings.push({ code: 'VERIFIED_SUBTITLES_LINEAGE', status: 'FAIL' });
    }
    if (bytes) {
      try {
        const path = this.renderFiles().path(render.contentHash, 'mp4');
        facts = await this.probe(path);
        findings.push({
          code: 'STREAMS_FORMAT_DURATION',
          status: this.validFacts(
            facts as { streams: any[]; format: any },
            render,
          )
            ? 'PASS'
            : 'FAIL',
        });
        await this.run(this.env.FFMPEG_PATH, [
          '-nostdin',
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
        ]);
        findings.push({ code: 'FULL_DECODE', status: 'PASS' });
        this.renderFiles().read(render.contentHash, 'mp4');
      } catch (e) {
        const code = e instanceof Error && 'code' in e ? e.code : null;
        findings.push({
          code: 'DECODE_OR_INSPECTION',
          status: code === 'COMPOSER_PROCESS_FAILED' ? 'FAIL' : 'UNKNOWN',
        });
      }
    }
    const result = findings.some((f) => f.status === 'FAIL')
      ? 'FAIL'
      : findings.some((f) => f.status === 'UNKNOWN')
        ? 'UNKNOWN'
        : 'PASS';
    const report = {
      policyVersion: 'local-qc/1',
      videoRenderId: videoId,
      videoRenderContentHash: render.contentHash,
      findings,
      facts,
      result,
      approvalBlocked: result !== 'PASS',
      cost: { status: 'UNKNOWN', amount: null },
    };
    const reportId = `local_qc:${adaptationHash(report)}`;
    this.session((r) =>
      r.transaction(() =>
        r.saveDocument(
          reportId,
          'local_qc',
          report,
          render,
          [{ inputId: videoId, contentHash: render.contentHash }],
          this.files(),
        ),
      ),
    );
    return { reportId, ...report };
  }
  async preview(videoId: string) {
    const report = await this.qc(videoId);
    const render = this.session((r) => r.getVideoRender(videoId));
    return {
      ready: report.result === 'PASS',
      videoRender: render,
      qc: report,
      url:
        report.result === 'PASS'
          ? `/media/local/previews/${encodeURIComponent(videoId)}/file`
          : null,
    };
  }
  async previewBytes(videoId: string) {
    const preview = await this.preview(videoId);
    if (!preview.ready) localFail('LOCAL_PREVIEW_BLOCKED');
    return this.renderFiles().read(preview.videoRender!.contentHash, 'mp4');
  }
}
