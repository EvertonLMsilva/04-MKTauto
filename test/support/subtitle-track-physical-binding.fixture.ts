import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Test } from '@nestjs/testing';
import { p2EditorialFixture } from './p2-editorial-fixture.js';
import { provisionSchema } from '../../src/infrastructure/administration/schema-provisioner.js';
import { OperationsModule } from '../../src/modules/operations/operations.module.js';
import { CAMPAIGN_DATABASE } from '../../src/modules/content-operations/application/campaign-administration.js';
import { CONTENT_DATABASE } from '../../src/modules/content/infrastructure/content.persistence.js';
import { AFFILIATE_DATABASE } from '../../src/modules/affiliate/infrastructure/affiliate-database.config.js';
import { PROJECT_DATABASE } from '../../src/modules/project/infrastructure/project-database.config.js';
import { RESEARCH_DATABASE } from '../../src/modules/research/infrastructure/research-database.config.js';
import {
  CONTENT_OPERATIONS,
  CONTENT_OPERATIONS_DATABASE,
} from '../../src/modules/content-operations/application/ports/operations.port.js';
import { FINANCE_DATABASE } from '../../src/modules/finance/finance.module.js';
import { MEDIA_DATABASE } from '../../src/modules/media/infrastructure/media.persistence.js';
import {
  PUBLISHING_DATABASE,
  SOCIAL_HISTORY_DATABASE,
} from '../../src/modules/publishing/infrastructure/publishing.persistence.js';
import { EDITORIAL_PROVIDER } from '../../src/modules/content/application/editorial-provider.port.js';
import { FakeEditorialProvider } from '../../src/modules/content/infrastructure/fake-editorial.provider.js';
import { AFFILIATE_RUN_CONTEXT } from '../../src/modules/affiliate/application/ports/affiliate-run-context.port.js';
import { EditorialFlowService } from '../../src/modules/content/application/editorial-flow.service.js';
import { ContentService } from '../../src/modules/content/application/content.service.js';
import { MediaService } from '../../src/modules/media/application/media.service.js';
import { runProcess } from '../../src/modules/media/infrastructure/ffmpeg-process.js';
import { LocalFlowRuntime } from '../../src/modules/media/infrastructure/local-flow.runtime.js';
import { SubtitleTrackRepository } from '../../src/modules/media/infrastructure/subtitle-track.repository.js';
import { PinnedAlignmentVerifier } from '../../src/modules/media/application/alignment.port.js';
import type { ProcessRunner } from '../../src/modules/media/infrastructure/ffmpeg-process.js';
import type {
  AlignmentInput,
  AlignmentEvidence,
} from '../../src/modules/media/domain/alignment-contracts.js';
import { LocalFlowService } from '../../src/modules/media/application/local-flow.service.js';
import {
  LocalEvidenceStorage,
  digest,
} from '../../src/modules/media/infrastructure/local-evidence-storage.js';
import { createVideoComposer } from '../../src/modules/media/infrastructure/ffmpeg-composer.provider.js';
import { alignmentHash } from '../../src/modules/media/domain/alignment-contracts.js';
import { compositionPlanContentHash } from '../../src/modules/media/domain/composition-plan-contracts.js';
import { videoCompositionRequestHash } from '../../src/modules/media/domain/video-composition-contracts.js';
const { wav, png } = await import(
  new URL('../../test-support/physical-fixtures.js', import.meta.url).href
);

export const SUBTITLE_FIXTURE_IDENTITY = 'B009_ZERO_ONSET_FIXTURE/1';
/** Independent test vector, not a CTC inference. Times are defined before signing. */
export function buildSubtitleFixtureAlignment(
  input: AlignmentInput,
): AlignmentEvidence {
  const words = Array.from(input.canonicalText.matchAll(/\S+/gu));
  const step = Math.floor(input.durationMs / words.length / 10) * 10;
  if (step < 40) throw Error('FIXTURE_CUE_PRECISION_UNSUPPORTED');
  const evidence: AlignmentEvidence = {
    input: structuredClone(input),
    parameters: { fixture: true, zeroOnset: true },
    provenance: 'FORCED_ALIGNMENT',
    output: {
      alignmentId:
        'align_' +
        alignmentHash({ input, configuration: SUBTITLE_FIXTURE_IDENTITY }),
      provider: 'pinned-fixture',
      modelVersion: 'fixture/1',
      audioSha256: input.audioSha256,
      scriptTextSha256: input.scriptTextSha256,
      status: 'VERIFIED',
      evidenceHash: '',
      segments: words.map((m, i) => ({
        text: m[0],
        textStartOffset: m.index!,
        textEndOffset: m.index! + m[0].length,
        startMs: i * step,
        endMs: i === words.length - 1 ? input.durationMs : (i + 1) * step,
      })),
    },
  };
  evidence.output.evidenceHash = alignmentHash(evidence);
  return evidence;
}
/** Arranges disposable native records. Rendering stays entirely in LocalVideoPilot. */
export async function createSubtitlePhysicalFixture(
  ffmpeg: string,
  ffprobe: string,
  runner: ProcessRunner = runProcess,
) {
  const native = p2EditorialFixture();
  const root = mkdtempSync(join(tmpdir(), 'subtitle-physical-'));
  const cleanupFiles = () => {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith('subtitle-physical-')
    )
      throw Error('FIXTURE_CLEANUP_SCOPE_INVALID');
    rmSync(root, { recursive: true, force: true });
  };
  const schema = new DatabaseSync(native.database);
  provisionSchema(schema);
  schema.close();
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
        'bind_pilot',
      );
    const editorial = await module.get(EditorialFlowService).generate({
      generationRequestId: 'subtitle_physical_editorial',
      pipelineRunId: 'run_001',
      briefingId: 'brief_001',
      researchShortlistId: native.shortlist.artifactId,
      referenceInsightId: null,
      requestedAt: '2026-11-12T00:00:00Z',
      supersedesScriptId: null,
    });
    const script = editorial.script;
    const env = {
      FFMPEG_PATH: ffmpeg,
      FFPROBE_PATH: ffprobe,
      FFMPEG_MEDIA_ROOT: join(root, 'media'),
      FFMPEG_VOICE_ROOT: join(root, 'voice'),
      FFMPEG_RENDER_ROOT: join(root, 'render'),
      LOCAL_MEDIA_EVIDENCE_ROOT: join(root, 'evidence'),
    };
    Object.values(env)
      .filter((p) => p.startsWith(root))
      .forEach((p) => mkdirSync(p, { recursive: true }));
    const operations = module.get(CONTENT_OPERATIONS),
      content = module.get<ContentService<false>>(ContentService);
    const store = new (
      await import('../../src/modules/media/infrastructure/media.persistence.js')
    ).MediaPersistence(
      native.database,
      operations,
      content,
      env.FFMPEG_RENDER_ROOT,
    );
    const media = new MediaService(
      store,
      await createVideoComposer(store, env),
    );
    const open = () =>
      new SubtitleTrackRepository(native.database, operations, content);
    const bytes = wav({ durationMilliseconds: 10000 });
    const hash = digest(bytes);
    const voice = {
      schemaVersion: 'voice-track/1.0.0',
      voiceTrackId: 'voice_subtitle_physical',
      pipelineRunId: script.pipelineRunId,
      projectId: script.projectId,
      projectVersion: script.projectVersion,
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      language: 'pt-BR',
      voiceStyle: 'informative',
      durationMilliseconds: 10000,
      audioFormat: 'wav',
      contentHash: hash,
      storageReference: `object:voice/sha256/${hash}`,
      origin: 'AUTHORIZED_RECORDING',
      provider: null,
      rights: { usageBasis: 'OWNED', commercialUseAllowed: true },
      createdAt: '2026-11-12T00:00:00Z',
      revision: 1,
      supersedesVoiceTrackId: null,
    };

    const alignmentInput: AlignmentInput = {
      audioAssetId: voice.voiceTrackId,
      audioSha256: hash,
      scriptId: script.scriptId,
      scriptVersion: script.revision,
      scriptTextSha256: alignmentHash(script.fullNarration),
      durationMs: 10000,
      canonicalText: script.fullNarration,
    };
    const alignment = buildSubtitleFixtureAlignment(alignmentInput);
    const verifier = new PinnedAlignmentVerifier(
      new Set([alignment.output.evidenceHash]),
    );
    let alignmentCalls = 0;
    const aligner = {
      identity: SUBTITLE_FIXTURE_IDENTITY,
      async align(input: AlignmentInput, actualAudio: Buffer) {
        if (
          alignmentHash(input) !== alignmentHash(alignmentInput) ||
          digest(actualAudio) !== hash
        )
          throw Error('FIXTURE_ALIGNMENT_INPUT_MISMATCH');
        alignmentCalls++;
        return structuredClone(alignment);
      },
    };
    const makeRuntime = () =>
      new LocalFlowRuntime(open, media, env, verifier, runner, aligner);
    const runtime = makeRuntime();
    const make = () => new LocalFlowService(makeRuntime());
    const flow = new LocalFlowService(runtime);
    await flow.ingest({
      voiceTrack: voice,
      audioBase64: bytes.toString('base64'),
      authorization: {
        actorId: 'operator_test',
        statement:
          'B009 TEST ONLY: own synthetic PCM fixture, not speech recognition or human approval.',
      },
    });
    const imageHash = new LocalEvidenceStorage(env.FFMPEG_MEDIA_ROOT).put(
      png(),
      'png',
    );
    const ref = `media:sha256_${imageHash}`;
    const image = flow.prepareImage(
      {
        pipelineRunId: script.pipelineRunId,
        scriptId: script.scriptId,
        scriptContentHash: script.contentHash,
        createdAt: voice.createdAt,
      },
      {
        contentHash: imageHash,
        mediaReference: ref,
        origin: 'OPERATOR_OWNED',
        provider: null,
        rights: {
          usageBasis: 'OWNED',
          commercialUseAllowed: true,
          evidence: [
            {
              id: 'ev_pilot_right',
              kind: 'MEDIA_USAGE_RIGHT',
              sourceRef: 'fixture:own-png',
              recordedAt: voice.createdAt,
              mediaAuthorization: {
                mediaRef: ref,
                contentHash: imageHash,
                commercialUse: 'GRANTED',
                processing: 'GRANTED',
                localProcessing: true,
                externalProviders: [],
              },
            },
          ],
        },
      },
    );
    const plan: any = {
      schemaVersion: 'composition-plan/1.0.0',
      compositionPlanId: 'plan_subtitle_physical',
      pipelineRunId: script.pipelineRunId,
      projectId: script.projectId,
      projectVersion: script.projectVersion,
      scriptId: script.scriptId,
      scriptContentHash: script.contentHash,
      voiceTrackId: voice.voiceTrackId,
      voiceTrackContentHash: hash,
      outputAspectRatio: '9:16',
      timelineUnit: 'MILLISECOND',
      continuityMode: 'CONTIGUOUS',
      durationMilliseconds: 10000,
      segments: [
        {
          position: 1,
          visualDirectionPosition: 1,
          mediaAssetId: image.mediaAssetId,
          mediaAssetContentHash: image.contentHash,
          startMilliseconds: 0,
          endMilliseconds: 10000,
        },
      ],
      createdAt: voice.createdAt,
      revision: 1,
      supersedesCompositionPlanId: null,
      contentHash: '',
    };
    plan.contentHash = compositionPlanContentHash(plan);
    media.registerCompositionPlan(plan);
    const request: any = {
      schemaVersion: 'video-composition-request/1.0.0',
      videoCompositionRequestId: 'composition_subtitle_physical',
      compositionPlanId: plan.compositionPlanId,
      compositionPlanContentHash: plan.contentHash,
      containerFormat: 'mp4',
      widthPixels: 1080,
      heightPixels: 1920,
      requestedAt: voice.createdAt,
    };
    request.contentHash = videoCompositionRequestHash(request);
    const input: any = {
      schemaVersion: 'local-video-pilot/1',
      pipelineRunId: script.pipelineRunId,
      scriptId: script.scriptId,
      scriptHash: script.contentHash,
      scriptRevision: script.revision,
      audio: {
        voiceTrackId: voice.voiceTrackId,
        contentHash: hash,
        durationMilliseconds: 10000,
      },
      plan,
      compositionRequest: request,
    };

    return {
      root,
      database: native.database,
      module,
      operations,
      content,
      script,
      voice,
      bytes,
      alignment,
      verifier,
      env,
      media,
      open,
      flow,
      runtime,
      make,
      input,
      plan,
      alignmentCalls: () => alignmentCalls,
      async cleanup() {
        await module.close();
        native.cleanup();
        cleanupFiles();
      },
    };
  } catch (error) {
    await module.close();
    native.cleanup();
    cleanupFiles();
    throw error;
  }
}
