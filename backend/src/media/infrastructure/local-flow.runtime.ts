import { assertMediaProcessingRights } from '../domain/media-processing-rights.js';
import { writeFileSync } from 'node:fs';
import { mkdir, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
import { inspectMvpWav } from './physical-media-inspection.js';
import { LocalVideoStorage, hashFile } from './local-video-storage.js';
import { runProcess, type ProcessRunner } from './ffmpeg-process.js';
import type { LocalAudiovisualPort } from '../application/local-flow.port.js';
import {
  LocalPiperTts,
  adaptLocalNarration,
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
export class LocalFlowRuntime {
  automaticAudioReady() {
    return new LocalPiperTts(this.env, this.runner).ready();
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
            config.engine === 'espeak-ng' ? 'local_espeak_ng' : 'local_piper',
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
    if (
      voice.origin !== 'SYNTHETIC_TTS' ||
      !['local_piper', 'local_espeak_ng'].includes(voice.provider)
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
      config = new LocalPiperTts(this.env, this.runner).configuration();
    if (
      !evidence ||
      evidence.schemaVersion !== 'local-tts-evidence/1' ||
      evidence.configurationHash !== config.configurationHash ||
      voice.provider !==
        (config.engine === 'espeak-ng' ? 'local_espeak_ng' : 'local_piper') ||
      evidence.modelSha256 !== config.modelSha256 ||
      evidence.licenseEvidenceSha256 !== config.licenseEvidenceSha256 ||
      evidence.modelId !== config.modelId ||
      evidence.modelVersion !== config.modelVersion ||
      evidence.license !== config.license ||
      evidence.targetDurationMs !== voice.durationMilliseconds ||
      evidence.speechDurationMs > evidence.targetDurationMs ||
      evidence.adaptation !== 'literal-deduplication/1' ||
      evidence.narration !==
        adaptLocalNarration(script.fullNarration, voice.durationMilliseconds)
    )
      localFail('LOCAL_TTS_LICENSE_REQUIRED');
    return evidence.narration;
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
          ? !['local_piper', 'local_espeak_ng'].includes(voice.provider)
          : voice.provider !== null) ||
        !['OWNED', 'LICENSED'].includes(voice.rights.usageBasis) ||
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
          !['local_piper', 'local_espeak_ng'].includes(voice.provider)) ||
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
        const text = serializeSubtitles(evidence.output.segments);
        const doc = {
          subtitleId: `subtitle_local:${evidence.output.evidenceHash}`,
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
    const { source, previous, subtitle } = this.session((r) => {
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
      return { source, subtitle, previous: r.getVideoRender(id) };
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
          'ass=subtitles.ass',
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
  publicationEvidence(qcId: string) {
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
      const assets = plan.segments.map((segment: any) => {
        const asset = this.media.get(segment.mediaAssetId);
        if (
          !asset ||
          asset.pipelineRunId !== render.pipelineRunId ||
          asset.scriptId !== plan.scriptId ||
          asset.contentHash !== segment.mediaAssetContentHash ||
          !asset.rights.commercialUseAllowed
        )
          localFail('PUBLICATION_RIGHTS_REQUIRED');
        // Existing composition-only/review-only scopes are never widened for publishing.
        if (
          asset!.rights.evidence?.some(
            (e) =>
              e.mediaAuthorization?.campaignId !== undefined ||
              e.mediaAuthorization?.operationScope !== undefined,
          )
        )
          localFail('PUBLICATION_RIGHTS_REQUIRED');
        assertMediaProcessingRights(
          asset!.rights.evidence,
          { mediaRef: asset!.mediaReference, contentHash: asset!.contentHash },
          null,
        );
        const review: any = this.media.temporalReview(asset!.mediaAssetId);
        if (review?.result !== 'PASS')
          localFail('PUBLICATION_SOURCE_QC_REQUIRED');
        new LocalEvidenceStorage(resolve(this.env.FFMPEG_MEDIA_ROOT!)).read(
          asset!.contentHash,
          asset!.technicalProperties.format,
          33554432,
        );
        return {
          id: asset!.mediaAssetId,
          contentHash: asset!.contentHash,
          rightsHash: adaptationHash(asset!.rights),
          reviewHash: review.contentHash,
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
