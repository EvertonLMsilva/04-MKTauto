import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { createSubtitlePhysicalFixture } from '../../../test/support/subtitle-track-physical-binding.fixture.js';
import { SubtitleTrackCanonicalService } from './application/subtitle-track-canonical.service.js';
import { SubtitleTrackRepository } from './infrastructure/subtitle-track.repository.js';
import { LocalVideoPilot } from './application/local-video-pilot.js';
import {
  LocalEvidenceStorage,
  digest,
} from './infrastructure/local-evidence-storage.js';
import { runProcess } from './infrastructure/ffmpeg-process.js';
import { PinnedAlignmentVerifier } from './application/alignment.port.js';
import {
  alignmentHash,
  serializeSubtitles,
  type AlignmentEvidence,
} from './domain/alignment-contracts.js';
import {
  deriveCanonicalSubtitle,
  verifyCanonicalLocalBinding,
} from './domain/subtitle-track-binding.js';
import { subtitleTrackContentHash } from './domain/subtitle-track-contracts.js';
import { adaptationHash } from './domain/media-hash.js';

const ffmpeg = process.env.MKTAUTO_TEST_FFMPEG;
const ffprobe = process.env.MKTAUTO_TEST_FFPROBE;
// Explicit opt-in. No production artifact, inference or public network access is needed.
describe.skipIf(!ffmpeg || !ffprobe)(
  'canonical subtitle physical fixture (not acoustic homologation)',
  () => {
    let f: Awaited<ReturnType<typeof createSubtitlePhysicalFixture>>;
    let repository: SubtitleTrackRepository;
    let files: LocalEvidenceStorage, renders: LocalEvidenceStorage;
    let service: SubtitleTrackCanonicalService;
    let pilotResult: any,
      track: any,
      local: any,
      sourceRender: any,
      binding: any,
      source: any;
    let probe: any, decode: any;
    const burnExecutions: {
      sourceHash: string;
      assHash: string;
      outputHash: string;
      command: string;
      args: string[];
    }[] = [];
    let restartProof: unknown;
    let replayProof: unknown;
    const runner = vi.fn(async (...args: Parameters<typeof runProcess>) => {
      const [command, argv, options] = args;
      const burning =
        argv.includes('-vf') && argv.some((v) => v.includes('subtitles.ass'));
      const staged = burning
        ? {
            sourceHash: digest(readFileSync(join(options.cwd!, 'source.mp4'))),
            assHash: digest(readFileSync(join(options.cwd!, 'subtitles.ass'))),
          }
        : null;
      const result = await runProcess(...args);
      if (staged)
        burnExecutions.push({
          ...staged,
          outputHash: digest(readFileSync(join(options.cwd!, 'final.mp4'))),
          command,
          args: argv,
        });
      return result;
    });
    const request = {
      subtitleTrackId: 'canonical_physical_009',
      createdAt: '2026-11-12T00:00:00Z',
      revision: 1,
      supersedesSubtitleTrackId: null,
    };
    const bindRequest = () => ({
      subtitleTrackId: track.subtitleTrackId,
      localSubtitleId: local.subtitleId,
      renderId: pilotResult.render.videoRenderId,
      readRender: (hash: string) => renders.read(hash, 'mp4'),
    });
    const physicalInput = () => ({
      track,
      evidence: f.alignment,
      local,
      localArtifact: repository.getArtifact(local.subtitleId),
      srt: files.read(local.srtHash, 'srt'),
      ass: files.read(local.assHash, 'ass'),
      render: pilotResult.render,
      sourceRender,
      renderPlan: f.plan,
      renderArtifact: repository.getArtifact(pilotResult.render.videoRenderId),
      renderBytes: renders.read(pilotResult.render.contentHash, 'mp4'),
    });
    // Separate adversarial vectors are re-signed after construction; the source is never mutated.
    const variant = (change: (v: AlignmentEvidence) => void) => {
      const v = structuredClone(f.alignment);
      change(v);
      v.output.evidenceHash = alignmentHash(v);
      return v;
    };
    const derive = (evidence: AlignmentEvidence) =>
      deriveCanonicalSubtitle(request, evidence, f.script, f.voice);
    beforeAll(async () => {
      vi.stubEnv('INSTAGRAM_SCHEDULER_ENABLED', 'false');
      vi.stubEnv('CAMPAIGN_SCHEDULER_ENABLED', 'false');
      f = await createSubtitlePhysicalFixture(ffmpeg!, ffprobe!, runner);
      repository = f.open();
      files = new LocalEvidenceStorage(f.env.LOCAL_MEDIA_EVIDENCE_ROOT);
      renders = new LocalEvidenceStorage(f.env.FFMPEG_RENDER_ROOT);
      pilotResult = await new LocalVideoPilot(f.flow, f.media).run(f.input);
      local = f.flow.subtitles(pilotResult.alignmentId);
      sourceRender = repository.getVideoRender(
        pilotResult.render.supersedesVideoRenderId,
      );
      service = new SubtitleTrackCanonicalService(repository, files, {
        readAuthorizedAudio: (...args) => f.runtime.audioBytes(...args),
        provenance: f.verifier,
      });
      track = await service.materialize({
        ...request,
        alignmentId: pilotResult.alignmentId,
      });
      source = repository.getSubtitleSource(track.subtitleTrackId, files);
      binding = await service.bindLocal(bindRequest());
      const probeIndex = runner.mock.calls.findIndex(
        (c) =>
          c[0] === ffprobe &&
          c[1].includes(renders.path(pilotResult.render.contentHash, 'mp4')),
      );
      const decodeIndex = runner.mock.calls.findIndex(
        (c) => c[0] === ffmpeg && c[1].includes('null'),
      );
      expect(probeIndex).toBeGreaterThanOrEqual(0);
      expect(decodeIndex).toBeGreaterThanOrEqual(0);
      probe = JSON.parse((await runner.mock.results[probeIndex].value).stdout);
      const response = await runner.mock.results[decodeIndex].value;
      decode = {
        status: 'PASS',
        command: runner.mock.calls[decodeIndex][0],
        args: runner.mock.calls[decodeIndex][1],
        stderr: response.stderr ?? '',
        source: 'Native LocalFlowRuntime QC full decode, real FFmpeg exit 0',
      };
    }, 120000);
    afterEach(() => {
      vi.restoreAllMocks();
      if (f)
        expect(alignmentHash(f.alignment)).toBe(
          f.alignment.output.evidenceHash,
        );
    });
    afterAll(async () => {
      try {
        const output = process.env.MKTAUTO_SUBTITLE_PHYSICAL_EVIDENCE;
        if (output && binding) {
          mkdirSync(output, { recursive: true });
          const qc = f.flow.qcHandoffEvidence(pilotResult.render.videoRenderId);
          const report = {
            schemaVersion: 'subtitle-track-physical-binding-fixture/1.0.0',
            fixture: {
              audioOrigin: 'OWNED_SYNTHETIC_PCM_TEST_FIXTURE',
              voiceContractOrigin: f.voice.origin,
              alignmentVerifier: 'PinnedAlignmentVerifier',
              physicalCtcInference: false,
              humanApproval: 'NOT_GRANTED',
              publicationAuthorized: false,
              limitations: [
                'No speech recognition or acoustic synchronization proof',
                'No visual readability or human AV acceptance',
                'No global style policy equivalence',
                'Does not complete CORE PostgreSQL QC v13',
              ],
            },
            script: f.script,
            voiceTrack: f.voice,
            audioSha256: digest(f.bytes),
            alignment: f.alignment,
            track,
            sourceReceipt: source,
            canonicalLineage: repository.getArtifact(track.subtitleTrackId),
            sourceLineage: repository.getArtifact(
              `subtitle_source:${digest(Buffer.from(track.subtitleTrackId))}`,
            ),
            localSubtitles: local,
            localSubtitleLineage: repository.getArtifact(local.subtitleId),
            compositionPlan: f.plan,
            sourceRender,
            finalRender: pilotResult.render,
            burnInLineage: repository.getArtifact(
              pilotResult.render.videoRenderId,
            ),
            probe,
            decode,
            burnExecutions,
            restartProof,
            replayProof,
            artifactPaths: {
              mp4: join(output, 'final.mp4'),
              srt: join(output, 'subtitles.srt'),
              ass: join(output, 'subtitles.ass'),
            },
            renderReceipt: repository.document(
              pilotResult.render.videoRenderId,
              'video_render',
              files,
            ),
            binding,
            nativeQc: qc,
            pilot: pilotResult,
            physicalMp4Sha256: digest(
              renders.read(pilotResult.render.contentHash, 'mp4'),
            ),
            database: {
              foreignKeys: repository.db.prepare('PRAGMA foreign_keys').get(),
              violations: repository.db
                .prepare('PRAGMA foreign_key_check')
                .all(),
              triggers: repository.db
                .prepare(
                  "SELECT name FROM sqlite_master WHERE type='trigger' AND (tbl_name='subtitle_tracks' OR tbl_name='subtitle_cues') ORDER BY name",
                )
                .all(),
            },
          };
          writeFileSync(
            join(output, 'physical-binding-report.json'),
            JSON.stringify(report, null, 2),
            { flag: 'wx' },
          );
          writeFileSync(
            join(output, 'final.mp4'),
            renders.read(pilotResult.render.contentHash, 'mp4'),
            { flag: 'wx' },
          );
          writeFileSync(
            join(output, 'subtitles.srt'),
            files.read(local.srtHash, 'srt'),
            { flag: 'wx' },
          );
          writeFileSync(
            join(output, 'subtitles.ass'),
            files.read(local.assHash, 'ass'),
            { flag: 'wx' },
          );
          writeFileSync(
            join(output, 'replay-input.json'),
            JSON.stringify(
              {
                input: f.input,
                script: f.script,
                run: f.module
                  .get(
                    (
                      await import('../content-operations/application/ports/operations.port.js')
                    ).CONTENT_OPERATIONS,
                  )
                  .get(f.script.pipelineRunId),
                materialize: {
                  ...request,
                  alignmentId: pilotResult.alignmentId,
                },
              },
              null,
              2,
            ),
            { flag: 'wx' },
          );
          cpSync(f.root, join(output, 'storage'), {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
          const db = new DatabaseSync(f.database, { readOnly: true });
          try {
            await backup(db, join(output, 'catalog.sqlite'));
          } finally {
            db.close();
          }
        }
      } finally {
        repository?.close();
        await f?.cleanup();
        vi.unstubAllEnvs();
      }
    });
    it('binds exact V1 cues/source/SRT/ASS to an actual native burn-in MP4 with live FK/triggers', () => {
      expect(track).toMatchObject({
        schemaVersion: 'subtitle-track/1.0.0',
        stylePolicyVersion: 'subtitle-style-policy/1.0.0',
        revision: 1,
        scriptId: f.script.scriptId,
        scriptContentHash: f.script.contentHash,
        voiceTrackId: f.voice.voiceTrackId,
        voiceTrackContentHash: digest(f.bytes),
      });
      expect(track.cues[0].startMilliseconds).toBe(0);
      expect(track.cues).toEqual(
        f.alignment.output.segments.map((v, i) => ({
          position: i + 1,
          text: v.text,
          startMilliseconds: v.startMs,
          endMilliseconds: v.endMs,
        })),
      );
      expect(burnExecutions).toHaveLength(1);
      expect(burnExecutions[0]).toMatchObject({
        sourceHash: sourceRender.contentHash,
        assHash: local.assHash,
        outputHash: pilotResult.render.contentHash,
      });
      expect(sourceRender.contentHash).not.toBe(pilotResult.render.contentHash);
      expect(
        repository.document(
          pilotResult.render.videoRenderId,
          'video_render',
          files,
        ),
      ).toEqual(pilotResult.render);
      expect(repository.getVideoRender(binding.renderId)!.contentHash).toBe(
        digest(renders.read(pilotResult.render.contentHash, 'mp4')),
      );
      expect(source).toMatchObject({
        schemaVersion: 'subtitle-track-source/1.0.0',
        alignmentId: f.alignment.output.alignmentId,
        alignmentEvidenceHash: f.alignment.output.evidenceHash,
      });
      expect(binding).toMatchObject({
        renderBinding: 'VERIFIED_PRODUCER_RECEIPT_AND_HASH',
        renderId: pilotResult.render.videoRenderId,
        scope: 'EXACT_ARTIFACT_BYTES',
        policyEquivalence: 'NOT_ASSUMED',
      });
      expect(sourceRender.revision).toBe(1);
      expect(pilotResult.render.revision).toBe(2);
      expect(pilotResult.render.supersedesVideoRenderId).toBe(
        sourceRender.videoRenderId,
      );
      const lineage = repository.getArtifact(pilotResult.render.videoRenderId)!;
      expect(lineage.inputs).toHaveLength(3);
      expect(lineage.inputs[2]).toMatchObject({
        inputId: local.subtitleId,
        contentHash: adaptationHash(local),
      });
      expect(lineage.generationMetadata).toMatchObject({
        provider: 'local',
        model: 'local-flow/1',
        taskType: 'subtitle-burn-in',
        configurationHash: adaptationHash(pilotResult.render),
      });
      expect(digest(renders.read(pilotResult.render.contentHash, 'mp4'))).toBe(
        lineage.contentHash,
      );
      expect(
        repository.db.prepare('PRAGMA foreign_keys').get().foreign_keys,
      ).toBe(1);
      expect(repository.db.prepare('PRAGMA foreign_key_check').all()).toEqual(
        [],
      );
      expect(
        repository.db
          .prepare(
            "SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND tbl_name='subtitle_tracks'",
          )
          .get().n,
      ).toBeGreaterThan(0);
      expect(
        repository.db
          .prepare('SELECT COUNT(*) n FROM human_approval_decisions')
          .get().n,
      ).toBe(0);
    });
    it('probes and fully decodes real H264/AAC MP4, without treating metadata as acoustic approval', () => {
      expect(probe.format.format_name.split(',')).toContain('mp4');
      expect(Number(probe.format.duration)).toBeCloseTo(10, 1);
      const video = probe.streams.filter((s: any) => s.codec_type === 'video'),
        audio = probe.streams.filter((s: any) => s.codec_type === 'audio');
      expect(video).toHaveLength(1);
      expect(audio).toHaveLength(1);
      expect(video[0]).toMatchObject({
        codec_name: 'h264',
        width: 1080,
        height: 1920,
      });
      expect(audio[0].codec_name).toBe('aac');
      expect(Number(audio[0].sample_rate)).toBeGreaterThan(0);
      expect(decode.args).toEqual(
        expect.arrayContaining(['-xerror', '0:v:0', '0:a:0', 'null']),
      );
      expect(decode.status).toBe('PASS');
      expect(
        f.flow.qcHandoffEvidence(pilotResult.render.videoRenderId)?.report
          .result,
      ).toBe('PASS');
      expect(pilotResult.handoff.status).toBe('READY_TECHNICAL');
    });
    it.each(['onset100', 'exceeds_duration', 'overlap', 'wrong_text'])(
      'rejects independently signed invalid cue vector: %s',
      (kind) => {
        const e = variant((v) => {
          if (kind === 'onset100') v.output.segments[0].startMs = 100;
          if (kind === 'exceeds_duration')
            v.output.segments.at(-1)!.endMs = 10001;
          if (kind === 'overlap')
            v.output.segments[1].startMs = v.output.segments[0].endMs - 1;
          if (kind === 'wrong_text') v.output.segments[0].text = 'Not original';
        });
        expect(() => derive(e)).toThrow(
          kind === 'onset100'
            ? 'FIRST_CUE_MUST_START_AT_ZERO'
            : kind === 'wrong_text'
              ? 'ALIGNMENT_TEXT_MISMATCH'
              : 'ALIGNMENT_RANGE_INVALID',
        );
      },
    );
    it('rejects an alignment artifact in another project', async () => {
      const get = repository.getArtifact.bind(repository);
      vi.spyOn(repository, 'getArtifact').mockImplementation((id) => {
        const a = get(id);
        return a && id === f.alignment.output.alignmentId
          ? { ...a, projectId: 'project_unrelated' }
          : a;
      });
      await expect(
        service.materialize({
          ...request,
          alignmentId: f.alignment.output.alignmentId,
        }),
      ).rejects.toThrow('SUBTITLE_SOURCE_SCOPE_MISMATCH');
    });
    it('rejects a voice belonging to another script', async () => {
      const get = repository.getVoiceTrack.bind(repository);
      vi.spyOn(repository, 'getVoiceTrack').mockImplementation((id) => ({
        ...get(id),
        scriptId: 'script_unrelated',
      }));
      await expect(
        service.materialize({
          ...request,
          alignmentId: f.alignment.output.alignmentId,
        }),
      ).rejects.toThrow('SUBTITLE_SOURCE_BINDING_MISMATCH');
    });
    it.each(['srt', 'ass'])(
      'rejects adulterated physical %s bytes and restores only this disposable fixture',
      async (ext) => {
        const path = files.path(
            ext === 'srt' ? local.srtHash : local.assHash,
            ext,
          ),
          bytes = readFileSync(path);
        try {
          writeFileSync(path, 'tampered fixture');
          await expect(service.bindLocal(bindRequest())).rejects.toThrow(
            'LOCAL_FILE_HASH_MISMATCH',
          );
        } finally {
          writeFileSync(path, bytes);
        }
      },
    );
    it('rejects a canonical record without a verified source receipt', async () => {
      const unsigned = {
        ...track,
        subtitleTrackId: 'canonical_without_source',
        revision: 2,
        supersedesSubtitleTrackId: track.subtitleTrackId,
      };
      unsigned.contentHash = subtitleTrackContentHash(unsigned);
      // Keep deliberately source-less supersession out of the positive evidence DB.
      const isolatedPath = join(f.root, 'negative-missing-source.sqlite');
      const snapshot = new DatabaseSync(f.database, { readOnly: true });
      try {
        await backup(snapshot, isolatedPath);
      } finally {
        snapshot.close();
      }
      const isolated = new SubtitleTrackRepository(
        isolatedPath,
        f.operations,
        f.content,
      );
      try {
        isolated.registerSubtitleTrack(unsigned);
        const reader = new SubtitleTrackCanonicalService(isolated, files, {
          readAuthorizedAudio: (...args) => f.runtime.audioBytes(...args),
          provenance: f.verifier,
        });
        await expect(
          reader.bindLocal({
            ...bindRequest(),
            subtitleTrackId: unsigned.subtitleTrackId,
          }),
        ).rejects.toThrow('SUBTITLE_SOURCE_MISSING');
      } finally {
        isolated.close();
      }
      expect(repository.getSubtitleTrack(unsigned.subtitleTrackId)).toBeNull();
    });
    it('rejects self-declared VERIFIED alignment without trusted provenance', async () => {
      const untrusted = new SubtitleTrackCanonicalService(repository, files, {
        readAuthorizedAudio: (...args) => f.runtime.audioBytes(...args),
        provenance: new PinnedAlignmentVerifier(new Set()),
      });
      await expect(untrusted.bindLocal(bindRequest())).rejects.toThrow(
        'ALIGNMENT_PROVENANCE_UNVERIFIED',
      );
    });
    it.each([
      'revision1',
      'unrelated_render',
      'input3',
      'metadata',
      'physical_sha',
    ])('rejects improper render proof: %s', (kind) => {
      const input: any = physicalInput();
      if (kind === 'revision1') {
        input.render = sourceRender;
        input.sourceRender = null;
      }
      if (kind === 'unrelated_render')
        input.render = { ...input.render, pipelineRunId: 'run_unrelated' };
      if (kind === 'input3')
        input.renderArtifact = {
          ...input.renderArtifact,
          inputs: input.renderArtifact!.inputs.map((x: any, i: number) =>
            i === 2 ? { ...x, inputId: 'subtitle_unrelated' } : x,
          ),
        };
      if (kind === 'metadata')
        input.renderArtifact = {
          ...input.renderArtifact,
          generationMetadata: {
            ...input.renderArtifact!.generationMetadata,
            taskType: 'local-evidence',
          },
        };
      if (kind === 'physical_sha')
        input.renderBytes = Buffer.from('not an MP4');
      expect(() => verifyCanonicalLocalBinding(input)).toThrow();
    });
    it('fails closed when the selected physical MP4 is absent', async () => {
      await expect(
        service.bindLocal({
          ...bindRequest(),
          readRender: () => readFileSync(join(f.root, 'missing.mp4')),
        }),
      ).rejects.toThrow('ENOENT');
    });
    it('rejects a truncated MP4 both by binding hash and real full decode', async () => {
      const corrupt = renders
        .read(pilotResult.render.contentHash, 'mp4')
        .subarray(0, 128);
      const path = join(f.root, 'corrupt.mp4');
      writeFileSync(path, corrupt, { flag: 'wx' });
      await expect(
        service.bindLocal({
          ...bindRequest(),
          readRender: () => readFileSync(path),
        }),
      ).rejects.toThrow('SUBTITLE_RENDER_BINDING_MISMATCH');
      await expect(
        runProcess(
          ffmpeg!,
          [
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
          ],
          { timeoutMs: 30000, maxLogBytes: 65536 },
        ),
      ).rejects.toMatchObject({ code: 'COMPOSER_PROCESS_FAILED' });
    });
    it('blocks grouping differences instead of equating the two presentation policies', () => {
      const e = variant((v) => {
        v.output.segments[0].endMs = 5;
      });
      const changed = derive(e),
        text = serializeSubtitles(e.output.segments, {
          frameRate: 30,
          durationMs: 10000,
        });
      const doc = {
        ...local,
        evidenceHash: e.output.evidenceHash,
        srtHash: digest(Buffer.from(text.srt)),
        assHash: digest(Buffer.from(text.ass)),
      };
      const artifact = {
        ...repository.getArtifact(local.subtitleId),
        contentHash: adaptationHash(doc),
        inputs: [
          {
            position: 1,
            kind: 'INTERNAL_ARTIFACT',
            inputId: doc.alignmentId,
            contentHash: adaptationHash(e),
          },
          ...repository.getArtifact(local.subtitleId)!.inputs.slice(1),
        ],
      };
      expect(() =>
        verifyCanonicalLocalBinding({
          track: changed,
          evidence: e,
          local: doc,
          localArtifact: artifact,
          srt: Buffer.from(text.srt),
          ass: Buffer.from(text.ass),
        }),
      ).toThrow('BLOCKED_POLICY_EQUIVALENCE');
    });
    it('replays and restarts using persisted physical artifacts without rendering/alignment again', async () => {
      const calls = runner.mock.calls.length,
        dbHash = digest(readFileSync(f.database));
      const restartFlow = f.make();
      expect(
        await new LocalVideoPilot(restartFlow, f.media).run(f.input),
      ).toEqual(pilotResult);
      const fresh = f.open();
      try {
        const restarted = new SubtitleTrackCanonicalService(fresh, files, {
          readAuthorizedAudio: (...args) => f.runtime.audioBytes(...args),
          provenance: f.verifier,
        });
        expect(
          await restarted.materialize({
            ...request,
            alignmentId: f.alignment.output.alignmentId,
          }),
        ).toEqual(track);
        expect(await restarted.bindLocal(bindRequest())).toEqual(binding);
      } finally {
        fresh.close();
      }
      expect(runner.mock.calls.length).toBe(calls);
      expect(f.alignmentCalls()).toBe(1);
      expect(digest(readFileSync(f.database))).toBe(dbHash);
      replayProof = {
        status: 'PASS',
        databaseSha256Before: dbHash,
        databaseSha256After: digest(readFileSync(f.database)),
        additionalRunnerCalls: runner.mock.calls.length - calls,
        alignmentCalls: f.alignmentCalls(),
      };
      const child = await runProcess(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import {DatabaseSync} from 'node:sqlite';
        const db=new DatabaseSync(process.argv[1],{readOnly:true});
        try {
          const row=db.prepare('SELECT payload_json,content_hash FROM subtitle_tracks WHERE subtitle_track_id=?').get(process.argv[2]);
          const render=db.prepare('SELECT payload_json FROM video_renders WHERE video_render_id=?').get(process.argv[3]);
          console.log(JSON.stringify({pid:process.pid,track:JSON.parse(row.payload_json),hash:row.content_hash,render:JSON.parse(render.payload_json),foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all()}));
        }finally{db.close()}
      `,
          f.database,
          track.subtitleTrackId,
          pilotResult.render.videoRenderId,
        ],
        { timeoutMs: 30000, maxLogBytes: 1048576 },
      );
      const persisted = JSON.parse(child.stdout);
      expect(persisted.pid).not.toBe(process.pid);
      expect(persisted.track).toEqual(track);
      expect(persisted.render).toEqual(pilotResult.render);
      expect(persisted.foreignKeyViolations).toEqual([]);
      expect(digest(readFileSync(f.database))).toBe(dbHash);
      restartProof = {
        status: 'PASS',
        processId: persisted.pid,
        trackContentHash: persisted.hash,
        renderContentHash: persisted.render.contentHash,
        databaseSha256Unchanged: true,
        source:
          'Separate Node process reads persisted disposable SQLite; fresh service instances also reverify source/binding',
      };
    });
  },
);
