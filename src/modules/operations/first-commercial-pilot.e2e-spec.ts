import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { Test } from '@nestjs/testing';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { OperationsModule } from '../../modules/operations/operations.module.js';
import { CAMPAIGN_DATABASE } from '../../modules/content-operations/application/campaign-administration.js';
import { CONTENT_DATABASE } from '../../modules/content/infrastructure/content.persistence.js';
import { AFFILIATE_DATABASE } from '../../modules/affiliate/infrastructure/affiliate-database.config.js';
import { PROJECT_DATABASE } from '../../modules/project/infrastructure/project-database.config.js';
import { RESEARCH_DATABASE } from '../../modules/research/infrastructure/research-database.config.js';
import {
  CONTENT_OPERATIONS,
  CONTENT_OPERATIONS_DATABASE,
} from '../../modules/content-operations/application/ports/operations.port.js';
import { FINANCE_DATABASE } from '../../modules/finance/finance.module.js';
import { MEDIA_DATABASE } from '../../modules/media/infrastructure/media.persistence.js';
import {
  PUBLISHING_DATABASE,
  SOCIAL_HISTORY_DATABASE,
} from '../../modules/publishing/infrastructure/publishing.persistence.js';
import { EDITORIAL_PROVIDER } from '../../modules/content/application/editorial-provider.port.js';
import { FakeEditorialProvider } from '../../modules/content/infrastructure/fake-editorial.provider.js';
import { AFFILIATE_RUN_CONTEXT } from '../../modules/affiliate/application/ports/affiliate-run-context.port.js';
import { EditorialFlowService } from '../../modules/content/application/editorial-flow.service.js';
import { ContentService } from '../../modules/content/application/content.service.js';
import { MediaService } from '../../modules/media/application/media.service.js';
import { runProcess } from '../../modules/media/infrastructure/ffmpeg-process.js';
import { LocalFlowRuntime } from '../../modules/media/infrastructure/local-flow.runtime.js';
import { SubtitleTrackRepository } from '../../modules/media/infrastructure/subtitle-track.repository.js';
import { PinnedAlignmentVerifier } from '../../modules/media/application/alignment.port.js';
import type { ProcessRunner } from '../../modules/media/infrastructure/ffmpeg-process.js';
import type {
  AlignmentInput,
  AlignmentEvidence,
} from '../../modules/media/domain/alignment-contracts.js';
import { LocalFlowService } from '../../modules/media/application/local-flow.service.js';
import {
  LocalEvidenceStorage,
  digest,
} from '../../modules/media/infrastructure/local-evidence-storage.js';
import { createVideoComposer } from '../../modules/media/infrastructure/ffmpeg-composer.provider.js';
import { alignmentHash } from '../../modules/media/domain/alignment-contracts.js';
import { compositionPlanContentHash } from '../../modules/media/domain/composition-plan-contracts.js';
import { videoCompositionRequestHash } from '../../modules/media/domain/video-composition-contracts.js';
const { wav, png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);

const SUBTITLE_FIXTURE_IDENTITY = 'B009_ZERO_ONSET_FIXTURE/1';
/** Independent test vector, not a CTC inference. Times are defined before signing. */
function buildSubtitleFixtureAlignment(
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
async function createPilotFixture(
  ffmpeg: string,
  ffprobe: string,
  runner: ProcessRunner = runProcess,
) {
  const native = p2EditorialFixture({ productionProfile: 'MIXED_MEDIA_V2' });
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
      requestedAt: '2026-11-12T00:00:00.000Z',
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
      await import('../../modules/media/infrastructure/media.persistence.js')
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
      createdAt: '2026-11-12T00:00:00.000Z',
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
          'FICTITIOUS_TEST_ONLY: own synthetic PCM fixture, not speech recognition or human approval.',
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
      schemaVersion: 'composition-plan/2.0.0',
      productionProfile: 'MIXED_MEDIA_V2',
      compositionPolicyVersion: 'mixed-media-composition-policy/2.0.0',
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
          mediaType: 'IMAGE',
          sourceStartMilliseconds: 0,
          playbackMode: 'TRIM',
          originalAudioMuted: true,
          framingStrategy: 'COVER_CROP_9_16',
          transition: {
            policyVersion: 'composition-transition/1.0.0',
            type: 'CUT',
            durationMilliseconds: 0,
          },
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
      shortlistId: native.shortlist.artifactId,
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

import { LocalVideoPilot } from '../media/application/local-video-pilot.js';
import { PublishingPersistence } from '../publishing/infrastructure/publishing.persistence.js';
import { PublishingService } from '../publishing/application/publishing.service.js';
import { publishingEvidence } from '../publishing/application/publication-eligibility.js';
import { AFFILIATE_REPOSITORY } from '../affiliate/application/ports/affiliate-repository.port.js';
import { FinanceService } from '../finance/application/finance.service.js';
import { AffiliateService } from '../affiliate/application/affiliate.service.js';
import { RESEARCH_READER } from '../research/application/research-repository.port.js';
import { NativeCampaignWorkflow } from '../content-operations/application/native-campaign-workflow.js';
import { CampaignAdministration } from '../content-operations/application/campaign-administration.js';
import { completedContext } from '../content-operations/application/campaign-orchestrator.js';
import { OperationsPreflightService } from './operations-preflight.service.js';
import { FirstCommercialPilotService } from './first-commercial-pilot.service.js';

const ffmpeg = process.env.MKTAUTO_TEST_FFMPEG;
const ffprobe = process.env.MKTAUTO_TEST_FFPROBE;
describe.skipIf(!ffmpeg || !ffprobe)(
  'FICTITIOUS_TEST_ONLY first commercial pilot physical integration',
  () => {
    it('renders and verifies native SQLite media and prepares the exact manual package', async () => {
      vi.stubEnv('INSTAGRAM_SCHEDULER_ENABLED', 'false');
      vi.stubEnv('CAMPAIGN_SCHEDULER_ENABLED', 'false');
      const network = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('NETWORK_FORBIDDEN'));
      const f = await createPilotFixture(ffmpeg!, ffprobe!);
      let admin: CampaignAdministration | undefined;
      let recovered: CampaignAdministration | undefined;
      try {
        const result = await new LocalVideoPilot(f.flow, f.media).run(f.input);
        expect(result.handoff.status).toBe('READY_TECHNICAL');
        const qc = f.flow.qcHandoffEvidence(result.render.videoRenderId)!;
        expect(qc.reportId).toMatch(/^local_qc:/);
        const evidence = publishingEvidence(f.media, f.flow);
        const publishing = new PublishingService(
          new PublishingPersistence(
            f.database,
            f.module.get(AFFILIATE_REPOSITORY),
            f.module.get(AFFILIATE_RUN_CONTEXT),
            evidence,
          ),
          evidence,
          f.module.get(FinanceService),
        );
        const workflow = new NativeCampaignWorkflow(
          f.module.get(AffiliateService),
          f.module.get(AFFILIATE_RUN_CONTEXT),
          f.module.get(RESEARCH_READER),
          f.module.get(EditorialFlowService),
          new FakeEditorialProvider(),
          f.content,
          f.flow,
          f.media,
          f.module.get(FinanceService),
          f.operations,
          publishing,
        );
        admin = new CampaignAdministration(f.database, workflow, false);
        const input = {
          campaignId: 'camp_001',
          campaignRevision: 1,
          runId: f.script.pipelineRunId,
          scheduledAt: f.voice.createdAt,
          briefingId: 'brief_001',
          researchShortlistId: f.shortlistId,
          generationRequestId: 'subtitle_physical_editorial',
          scriptId: f.script.scriptId,
          voiceTrackId: f.voice.voiceTrackId,
          composition: f.input.compositionRequest,
          mode: 'LOCAL_VALIDATION',
        };
        const execution = await admin.schedule(input);
        expect((await admin.schedule(input)).execution_id).toBe(
          execution.execution_id,
        );
        await admin.tick();
        expect(
          admin.get(execution.execution_id).status,
          JSON.stringify(admin.history(execution.execution_id)),
        ).toBe('WAITING_INPUT');
        expect(
          admin.history(execution.execution_id).at(-1)?.evidence.code,
        ).toBe('EXACT_HUMAN_APPROVAL_REQUIRED');
        const pkg = publishing.prepare(
          {
            campaignId: 'camp_001',
            campaignRevision: 1,
            videoRenderId: result.render.videoRenderId,
            qualityControlReportId: qc.reportId,
            platform: 'instagram',
            account: 'FICTITIOUS_TEST_ONLY',
            caption: 'FICTITIOUS_TEST_ONLY. Fixture técnica; não publicar.',
          },
          'fixture_manual_package',
        );
        expect(pkg.identity.pipelineRunId).toBe(f.script.pipelineRunId);
        expect(publishing.packageReview(pkg.contentHash)).toBeNull();
        const activeAdmin = admin;
        const inspect = () =>
          new FirstCommercialPilotService(
            activeAdmin,
            f.module.get(AffiliateService),
            f.media,
            f.flow,
            publishing,
            f.module.get(FinanceService),
            new OperationsPreflightService(
              activeAdmin,
              f.module.get(FinanceService),
              f.flow,
            ),
          );
        const pending = await inspect().inspect({
          executionId: execution.execution_id,
          packageHash: pkg.contentHash,
        });
        expect(pending.physicalMedia).toBe('VERIFIED');
        expect(pending.qc).toBe('PASS');
        expect(pending.package?.approval).toBe('PENDING');
        expect(pending.commercialAcceptance).toBe('NOT_ASSESSED');
        expect(pending.publication).toEqual([]);
        expect(() => publishing.manualHandoff(pkg.contentHash)).toThrow(
          'DISTRIBUTION_APPROVAL_REQUIRED',
        );
        // Simulated inputs exercise the contract only in this disposable fixture.
        // They are never human approval or publication evidence for a real pilot.
        const proof = await workflow.approvalEvidence(
          admin.get(execution.execution_id),
          completedContext(admin.history(execution.execution_id)),
        );
        const approval = {
          projectId: proof.render.projectId,
          projectVersion: proof.render.projectVersion,
          pipelineRunId: proof.render.pipelineRunId,
          videoRenderId: proof.render.videoRenderId,
          videoRenderRevision: proof.render.revision,
          videoRenderContentHash: proof.render.contentHash,
          qualityControlReportId: proof.qc.qualityControlReportId,
          qualityControlReportContentHash: proof.qc.contentHash,
          decision: 'APPROVED',
          actor: 'FICTITIOUS_TEST_ONLY',
          justification:
            'FICTITIOUS_TEST_ONLY contract input, no real approval.',
        };
        await expect(
          admin.approve(execution.execution_id, {
            ...approval,
            videoRenderContentHash: '0'.repeat(64),
          }),
        ).rejects.toThrow();
        await admin.approve(execution.execution_id, approval);
        await admin.resume(execution.execution_id);
        await admin.tick();
        expect(admin.get(execution.execution_id).status).toBe('SUCCEEDED');
        publishing.review(
          {
            packageHash: pkg.contentHash,
            decision: 'APPROVED',
            actor: 'FICTITIOUS_TEST_ONLY',
            justification:
              'FICTITIOUS_TEST_ONLY simulated review, never real approval.',
          },
          'fixture_review',
        );
        expect(publishing.manualHandoff(pkg.contentHash).video.sha256).toBe(
          result.render.contentHash,
        );
        const receiptInput = {
          packageHash: pkg.contentHash,
          actor: 'FICTITIOUS_TEST_ONLY',
          publishedAt: f.voice.createdAt,
          externalId: null,
          externalUrl: null,
          evidenceReference:
            'fixture:FICTITIOUS_TEST_ONLY:no-publication-occurred',
          state: 'UNCONFIRMED',
        };
        const receipt = publishing.recordPublication(
          receiptInput,
          'fixture_receipt',
        );
        expect(
          publishing.recordPublication(receiptInput, 'fixture_receipt'),
        ).toEqual(receipt);
        expect(publishing.publications(pkg.contentHash)).toHaveLength(1);
        expect(receipt.state).toBe('UNCONFIRMED');
        await admin.onModuleDestroy();
        admin = undefined;
        recovered = new CampaignAdministration(f.database, workflow, false);
        expect(recovered.get(execution.execution_id).status).toBe('SUCCEEDED');
        const recoveredReport = await new FirstCommercialPilotService(
          recovered,
          f.module.get(AffiliateService),
          f.media,
          f.make(),
          publishing,
          f.module.get(FinanceService),
          new OperationsPreflightService(
            recovered,
            f.module.get(FinanceService),
            f.make(),
          ),
        ).inspect({
          executionId: execution.execution_id,
          packageHash: pkg.contentHash,
        });
        expect(recoveredReport.publication).toEqual([
          { id: receipt.publicationId, state: 'UNCONFIRMED' },
        ]);
        expect(
          (await new LocalVideoPilot(f.make(), f.media).run(f.input)).render,
        ).toEqual(result.render);
        await recovered.onModuleDestroy();
        recovered = undefined;
        const parent = process.env.MKTAUTO_FIRST_PILOT_EVIDENCE;
        if (parent) {
          const { externalPath } = await import(
            new URL('../../../scripts/ops-local/lib.mjs', import.meta.url).href
          );
          externalPath(parent);
          const output = mkdtempSync(join(parent, 'FICTITIOUS_TEST_ONLY-'));
          for (const name of ['media', 'voice', 'render', 'evidence'])
            cpSync(join(f.root, name), join(output, name), {
              recursive: true,
              errorOnExist: true,
              force: false,
            });
          for (const name of ['data', 'tmp']) mkdirSync(join(output, name));
          const db = new DatabaseSync(f.database, { readOnly: true });
          try {
            await backup(db, join(output, 'data', 'pilot.sqlite'));
          } finally {
            db.close();
          }
          const physical = new LocalEvidenceStorage(
            f.env.FFMPEG_RENDER_ROOT,
          ).read(result.render.contentHash, 'mp4');
          expect(digest(physical)).toBe(result.render.contentHash);
          writeFileSync(
            join(output, 'final-FICTITIOUS_TEST_ONLY.mp4'),
            physical,
            { flag: 'wx' },
          );
          writeFileSync(
            join(output, 'audio-FICTITIOUS_TEST_ONLY.wav'),
            f.bytes,
            { flag: 'wx' },
          );
          const probe = JSON.parse(
            (
              await runProcess(
                ffprobe!,
                [
                  '-v',
                  'error',
                  '-show_streams',
                  '-show_format',
                  '-of',
                  'json',
                  join(output, 'final-FICTITIOUS_TEST_ONLY.mp4'),
                ],
                { timeoutMs: 10000, maxLogBytes: 65536 },
              )
            ).stdout,
          );
          expect(
            probe.streams.find((s: any) => s.codec_type === 'video'),
          ).toMatchObject({ width: 1080, height: 1920 });
          expect(Number(probe.format.duration)).toBeCloseTo(10, 1);
          const report = recoveredReport;
          const save = (name: string, value: unknown) =>
            writeFileSync(
              join(output, name),
              JSON.stringify(value, null, 2) + '\n',
              { flag: 'wx' },
            );
          save('FICTITIOUS_TEST_ONLY.json', {
            purpose: 'MKTAUTO-RELEASE-FIRST-COMMERCIAL-PILOT-001',
            classification: 'FICTITIOUS_TEST_ONLY',
            databaseSha256: digest(
              readFileSync(join(output, 'data', 'pilot.sqlite')),
            ),
          });
          save('config.json', {
            schemaVersion: 'first-commercial-pilot-local/1.0.0',
            classification: 'FICTITIOUS_TEST_ONLY',
            provider: 'fake',
            root: output,
            executionId: execution.execution_id,
            packageHash: pkg.contentHash,
            ffmpeg,
            ffprobe,
          });
          save('physical-evidence.json', {
            classification: 'FICTITIOUS_TEST_ONLY',
            technicalVerticalStatus: 'TECHNICAL_VERTICAL_PASS',
            operationalPilotStatus: 'NOT_READY',
            commercialPilotStatus: 'WAITING_REAL_PRODUCT_EVIDENCE',
            actualHumanApproval: 'NOT_GRANTED',
            actualManualPublication: 'NOT_PERFORMED',
            narration: 'SYNTHETIC_PCM_FIXTURE_NOT_SPOKEN_NARRATION',
            ctc: 'PINNED_FIXTURE_NOT_INFERENCE',
            contractReview: 'SIMULATED_FIXTURE_ONLY',
            contractReceipt: 'UNCONFIRMED_FIXTURE_NO_PUBLICATION_OCCURRED',
            knownPaidProviderCalls: 0,
            totalExecutionCost: null,
            costReason: 'LOCAL_COMPUTE_AND_ENERGY_NOT_MEASURED',
            script: f.script,
            voice: f.voice,
            plan: f.plan,
            finalRender: result.render,
            qc,
            probe,
            report,
            replay: 'SAME_RENDER_AND_RECEIPT_IDENTITIES_NO_DUPLICATION',
            recovery: 'REOPENED_SQLITE_CAMPAIGN_AND_LOCAL_FLOW',
          });
          console.info('FICTITIOUS_TEST_ONLY physical evidence:', output);
        }
        expect(network).not.toHaveBeenCalled();
      } finally {
        await admin?.onModuleDestroy();
        await recovered?.onModuleDestroy();
        await f.cleanup();
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
      }
    }, 180000);
  },
);
