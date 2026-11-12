import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { Test } from '@nestjs/testing';
import { p2EditorialFixture } from '../../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
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
import { LocalFlowRuntime } from './infrastructure/local-flow.runtime.js';
import { LocalFlowRepository } from './infrastructure/local-flow.repository.js';
import { LocalFlowService } from './application/local-flow.service.js';
import { LocalVideoPilot } from './application/local-video-pilot.js';
import {
  LocalEvidenceStorage,
  digest,
} from './infrastructure/local-evidence-storage.js';
import { createVideoComposer } from './infrastructure/ffmpeg-composer.provider.js';
import { alignmentHash } from './domain/alignment-contracts.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import { videoCompositionRequestHash } from './domain/video-composition-contracts.js';
const { wav, png } = await import(
  new URL('../../../test-support/physical-fixtures.js', import.meta.url).href
);

const ffmpeg = process.env.MKTAUTO_TEST_FFMPEG,
  ffprobe = process.env.MKTAUTO_TEST_FFPROBE;
it.skipIf(!ffmpeg || !ffprobe)(
  'native SQLite pipeline, real FFmpeg, bridge, failures, replay and restart',
  async () => {
    const native = p2EditorialFixture();
    const root = mkdtempSync(join(tmpdir(), 'pilot-native-'));
    const schema = new DatabaseSync(native.database);
    provisionSchema(schema);
    schema.close();
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
          'bind_pilot',
        );
      const editorial = await module.get(EditorialFlowService).generate({
        generationRequestId: 'pilot_editorial',
        pipelineRunId: 'run_001',
        briefingId: 'brief_001',
        researchShortlistId: native.shortlist.artifactId,
        referenceInsightId: null,
        requestedAt: '2026-11-12T00:00:00Z',
        supersedesScriptId: null,
      });
      const script = editorial.script;
      const env = {
        FFMPEG_PATH: ffmpeg!,
        FFPROBE_PATH: ffprobe!,
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
        await import('./infrastructure/media.persistence.js')
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
        new LocalFlowRepository(native.database, operations, content);
      const aligner = {
        identity: 'EXPLICIT_FIXTURE_ALIGNMENT_ONLY',
        align: vi.fn(async (input: any) => {
          const words = Array.from(
            input.canonicalText.matchAll(/\S+/gu),
          ) as RegExpMatchArray[];
          const output = {
            alignmentId:
              'align_' +
              alignmentHash({
                input,
                configuration: 'EXPLICIT_FIXTURE_ALIGNMENT_ONLY',
              }),
            provider: 'fixture',
            modelVersion: 'fixture/1',
            audioSha256: input.audioSha256,
            scriptTextSha256: input.scriptTextSha256,
            segments: words.map((m, i) => ({
              text: m[0],
              textStartOffset: m.index!,
              textEndOffset: m.index! + m[0].length,
              startMs: Math.floor(100 + (i * 9800) / words.length),
              endMs: Math.floor(100 + ((i + 1) * 9800) / words.length),
            })),
            evidenceHash: '',
            status: 'VERIFIED',
          };
          const evidence = {
            input,
            parameters: { fixture: true },
            provenance: 'FORCED_ALIGNMENT',
            output,
          };
          output.evidenceHash = alignmentHash(evidence);
          return evidence as any;
        }),
      };
      const runner = vi.fn(runProcess);
      const make = () =>
        new LocalFlowService(
          new LocalFlowRuntime(
            open,
            media,
            env,
            { verify: async () => true },
            runner,
            aligner,
          ),
        );
      const flow = make();
      const bytes = wav({ durationMilliseconds: 10000 });
      const hash = digest(bytes);
      const voice = {
        schemaVersion: 'voice-track/1.0.0',
        voiceTrackId: 'voice_pilot',
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
      await flow.ingest({
        voiceTrack: voice,
        audioBase64: bytes.toString('base64'),
        authorization: {
          actorId: 'operator_test',
          statement: 'TEST ONLY own PCM fixture, no human approval.',
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
        compositionPlanId: 'plan_pilot',
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
        videoCompositionRequestId: 'composition_pilot',
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
      const pilot = new LocalVideoPilot(flow, media);
      const burnFailure = vi
        .spyOn(flow, 'burn')
        .mockRejectedValueOnce(Error('AFTER_COMPOSITION'));
      await expect(pilot.run(input)).rejects.toThrow('AFTER_COMPOSITION');
      burnFailure.mockRestore();
      const qcFailure = vi
        .spyOn(flow, 'ensureQcHandoffEvidence')
        .mockRejectedValueOnce(Error('BEFORE_QC'));
      await expect(pilot.run(input)).rejects.toThrow('BEFORE_QC');
      qcFailure.mockRestore();
      const [a, b, c] = await Promise.all([
        pilot.run(input),
        pilot.run(input),
        new LocalVideoPilot(make(), media).run(input),
      ]);
      expect(a).toEqual(b);
      expect(a).toEqual(c);
      expect(a.handoff.status).toBe('READY_TECHNICAL');
      expect(
        runner.mock.calls.filter((call) => call[1].includes('null')),
      ).toHaveLength(1);
      const before = runner.mock.calls.length;
      const evidence = flow.qcHandoffEvidence(a.render.videoRenderId)!;
      expect(evidence.report.result).toBe('PASS');
      expect(evidence.checkedAt).toBeTruthy();
      expect(await new LocalVideoPilot(make(), media).run(input)).toEqual(a);
      expect(runner.mock.calls.length).toBe(before);
      const legacyOpen = () => {
        const r = open();
        vi.spyOn(r, 'localQcHandoffIds').mockReturnValue([]);
        return r;
      };
      const legacy = new LocalFlowRuntime(
        legacyOpen,
        media,
        env,
        { verify: async () => true },
        runner,
        aligner,
      );
      await expect(
        legacy.ensureQcHandoffEvidence(a.render.videoRenderId),
      ).rejects.toThrow('QC_TIMESTAMP_REQUIRED');
      expect(runner.mock.calls.length).toBe(before);
      expect(aligner.align).toHaveBeenCalledTimes(1);
      const db = new DatabaseSync(native.database, { readOnly: true });
      try {
        expect(
          db.prepare('SELECT COUNT(*) n FROM human_approval_decisions').get()
            ?.n,
        ).toBe(0);
      } finally {
        db.close();
      }
      // Persist private physical evidence only when an explicit test output is supplied.
      if (process.env.MKTAUTO_PILOT_EVIDENCE) {
        const out = process.env.MKTAUTO_PILOT_EVIDENCE;
        mkdirSync(out, { recursive: true });
        writeFileSync(
          join(out, 'pilot-result.json'),
          JSON.stringify(a, null, 2),
        );
        writeFileSync(
          join(out, 'native-qc.json'),
          JSON.stringify(evidence, null, 2),
        );
        cpSync(root, join(out, 'storage'), {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
        const src = new DatabaseSync(native.database, { readOnly: true });
        try {
          await backup(src, join(out, 'catalog.sqlite'));
        } finally {
          src.close();
        }
        writeFileSync(
          join(out, 'replay-input.json'),
          JSON.stringify(
            { input, script, run: operations.get(script.pipelineRunId) },
            null,
            2,
          ),
        );
        writeFileSync(
          join(out, 'pilot.mp4'),
          readFileSync(
            new LocalEvidenceStorage(env.FFMPEG_RENDER_ROOT).path(
              a.render.contentHash,
              'mp4',
            ),
          ),
        );
      }
      const beforeDb = digest(readFileSync(native.database));
      expect(
        media.handoff(
          {
            videoRenderId: a.render.videoRenderId,
            pipelineRunId: input.pipelineRunId,
            scriptId: input.scriptId,
            scriptContentHash: input.scriptHash,
            renderRevision: a.render.revision,
            renderContentHash: a.render.contentHash,
            qualityControlReportId: evidence.reportId,
          },
          flow,
        ).status,
      ).toBe('READY_TECHNICAL');
      expect(digest(readFileSync(native.database))).toBe(beforeDb);
      for (const [dir, hash, ext] of [
        [env.FFMPEG_VOICE_ROOT, evidence.context.voiceHash, 'wav'],
        [
          env.LOCAL_MEDIA_EVIDENCE_ROOT,
          evidence.context.subtitle.assHash,
          'ass',
        ],
        [
          env.LOCAL_MEDIA_EVIDENCE_ROOT,
          evidence.context.subtitle.srtHash,
          'srt',
        ],
      ] as const) {
        const p = new LocalEvidenceStorage(dir).path(hash, ext),
          original = readFileSync(p);
        writeFileSync(p, 'tampered');
        expect(() => flow.qcHandoffEvidence(a.render.videoRenderId)).toThrow();
        writeFileSync(p, original);
      }
      const originalGet = content.getScript.bind(content);
      const changed = vi
        .spyOn(content, 'getScript')
        .mockImplementation((id) => {
          const v = originalGet(id);
          return v ? { ...v, contentHash: 'f'.repeat(64) } : v;
        });
      expect(() => flow.qcHandoffEvidence(a.render.videoRenderId)).toThrow();
      changed.mockRestore();
      const path = new LocalEvidenceStorage(env.FFMPEG_RENDER_ROOT).path(
        a.render.contentHash,
        'mp4',
      );
      const original = readFileSync(path);
      writeFileSync(path, 'tampered');
      expect(() => flow.qcHandoffEvidence(a.render.videoRenderId)).toThrow();
      writeFileSync(path, original);
      const countProofs = () => {
        const r = open();
        try {
          return r.db
            .prepare(
              "SELECT COUNT(*) AS n FROM artifact_lineage WHERE artifact_type='local_qc_handoff'",
            )
            .get().n;
        } finally {
          r.close();
        }
      };
      const countBefore = countProofs();
      const failingOpen = () => {
        const r = open(),
          save = r.saveDocument.bind(r);
        vi.spyOn(r, 'saveDocument').mockImplementation((...args) => {
          if (args[1] === 'local_qc_handoff')
            throw Error('TEST_PROOF_COMMIT_FAILURE');
          return save(...args);
        });
        return r;
      };
      const failing = new LocalFlowRuntime(
        failingOpen,
        media,
        env,
        { verify: async () => true },
        runner,
        aligner,
      );
      await expect(failing.qc(a.render.videoRenderId, true)).rejects.toThrow(
        'TEST_PROOF_COMMIT_FAILURE',
      );
      expect(countProofs()).toBe(countBefore);
      expect(
        flow.qcHandoffEvidence(a.render.videoRenderId)?.report.result,
      ).toBe('PASS');
      const unavailable = new LocalFlowRuntime(
        open,
        media,
        env,
        { verify: async () => true },
        async () => {
          throw Error('TEST_INSPECTION_UNAVAILABLE');
        },
        aligner,
      );
      const unknown = await unavailable.qc(a.render.videoRenderId, true);
      expect(unknown.result).toBe('UNKNOWN');
      const uncertain = media.handoff(
        {
          videoRenderId: a.render.videoRenderId,
          pipelineRunId: input.pipelineRunId,
          scriptId: input.scriptId,
          scriptContentHash: input.scriptHash,
          renderRevision: a.render.revision,
          renderContentHash: a.render.contentHash,
          qualityControlReportId: unknown.reportId,
        },
        flow,
      );
      expect(uncertain).toMatchObject({
        status: 'UNKNOWN',
        qc: 'UNKNOWN',
        blockers: ['QC_INSUFFICIENT'],
      });
    } finally {
      await module.close();
      vi.unstubAllEnvs();
      native.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  },
  120000,
);
