import { historicalResidualPersistence } from '../../../test/support/historical-residual-persistence.js';
import { historicalResidualContracts } from '../../../test/support/historical-residual-contracts.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  setup,
  render,
  persistedScript,
} from '../../../test/support/publishing-render-fixture.js';
import { VideoRenderRepository } from './infrastructure/video-render.reader.js';
import { HumanApprovalRepository } from '../publishing/infrastructure/human-approval.repository.js';
import { HumanApprovalService } from '../publishing/application/human-approval.service.js';
import { p4Qc } from '../../../test/support/media-qc-fixture.js';
import { p4ReportHash } from './domain/p4-qc-contracts.js';
const p4 = historicalResidualPersistence('p4-video-repository');
const originContracts = historicalResidualContracts(
  'video-generation-contracts',
);
const hash = (v: unknown) =>
  import('./domain/media-hash.js').then((m) => m.adaptationHash(v));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'render-reader-'));
  const path = join(root, 'catalog.sqlite');
  const f = setup(path);
  const value = render(f.compositionPlan);
  f.repository.registerVideoRender(value);
  const reader = new VideoRenderRepository(
    path,
    { get: (id) => f.repository.getRun(id) },
    { getScript: () => persistedScript() },
    { readOnly: true },
  );
  return {
    ...f,
    path,
    value,
    reader,
    cleanup() {
      reader.close();
      f.repository.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
function outcome(action: () => unknown) {
  try {
    return action();
  } catch (error: any) {
    return { code: error.code, field: error.field };
  }
}
describe('Read-only render lineage parity', () => {
  it('validates persisted AI origin without invoking generation', async () => {
    const f = fixture();
    try {
      const request = {
        schemaVersion: 'video-generation-request/1.0.0',
        generationRequestId: 'generation_fixture',
        pipelineRunId: f.value.pipelineRunId,
        campaignId: 'campaign_fixture',
        originalSlot: 1,
        provider: 'fal_ai',
        purpose: 'ORIGINAL',
        outputAspectRatio: '9:16',
        prompt: 'Authorized historical fixture',
      };
      const requestHash = originContracts.videoRequestHash(request),
        sourceHash = 'a'.repeat(64);
      const result = {
        state: 'COMPLETED',
        providerRequestId: 'provider_fixture',
        videoReference: `object:ltx-video/sha256/${sourceHash}`,
      };
      f.repository.db.exec('PRAGMA foreign_keys=OFF');
      f.repository.db
        .prepare(
          'INSERT INTO video_generation_operations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          request.generationRequestId,
          request.campaignId,
          request.pipelineRunId,
          1,
          requestHash,
          JSON.stringify(request),
          '{}',
          'COMPLETED',
          'fixture_owner',
          f.value.createdAt,
          JSON.stringify(result),
          'fixture_cost',
        );
      f.repository.db.exec('PRAGMA foreign_keys=ON');
      const config = {
        schemaVersion: 'campaign-audio/1.0.0',
        campaignId: request.campaignId,
        revision: 1,
        language: 'pt-BR',
        provider: 'fake_voice',
        voice: 'fixture_ptbr',
        style: 'calm',
        mode: 'PRESERVE',
        originalGainDb: 0,
        narrationGainDb: 0,
      };
      p4.putP4(f.repository, 'audio_config', 'audio_fixture', config);
      const value = {
        schemaVersion: 'video-render/2.0.0',
        videoRenderId: 'render_ai_fixture',
        pipelineRunId: f.value.pipelineRunId,
        projectId: f.value.projectId,
        projectVersion: 1,
        origin: {
          schemaVersion: 'video-origin/1.0.0',
          kind: 'AI_GENERATED',
          generationRequestId: request.generationRequestId,
          providerRequestId: result.providerRequestId,
          requestHash,
          sourceReference: result.videoReference,
          sourceContentHash: sourceHash,
          rights: {
            evidenceReference: 'manual/rights',
            evidenceContentHash: 'c'.repeat(64),
            processingAuthorized: true,
            commercialUseAuthorized: true,
            audioAuthorized: true,
          },
        },
        audioConfigId: 'audio_fixture',
        audioConfigHash: await hash(config),
        narrationId: null,
        narrationHash: null,
        outputAspectRatio: '9:16',
        widthPixels: 180,
        heightPixels: 320,
        durationMilliseconds: 1000,
        frameCount: 24,
        frameRate: 24,
        videoCodec: 'h264',
        videoProfile: 'High',
        audioCodec: 'aac',
        audioProfile: 'LC',
        audioSampleRate: 48000,
        audioChannels: 2,
        contentHash: 'b'.repeat(64),
        logicalReference: `render:sha256_${'b'.repeat(64)}`,
        revision: 1,
        supersedesVideoRenderId: null,
        createdAt: '2026-10-12T18:00:00Z',
      };
      p4.registerP4Render(f.repository, value);
      expect(f.reader.getVideoRender(value.videoRenderId)).toEqual(
        f.repository.getVideoRender(value.videoRenderId),
      );
      const invalid = {
        ...value,
        videoRenderId: 'render_ai_invalid',
        origin: { ...value.origin, requestHash: 'd'.repeat(64) },
      };
      p4.putP4(
        f.repository,
        'video_render',
        invalid.videoRenderId,
        invalid,
        invalid.pipelineRunId,
      );
      expect(
        outcome(() => f.reader.getVideoRender(invalid.videoRenderId)),
      ).toEqual(
        outcome(() => f.repository.getVideoRender(invalid.videoRenderId)),
      );
      expect(() => f.reader.getVideoRender(invalid.videoRenderId)).toThrow(
        /P4_AI_LINEAGE_INVALID/,
      );
    } finally {
      f.cleanup();
    }
  });
  it('preserves V1 plan, voice, assets and missing-render behavior', () => {
    const f = fixture();
    try {
      expect(f.reader.getVideoRender(f.value.videoRenderId)).toEqual(
        f.repository.getVideoRender(f.value.videoRenderId),
      );
      expect(f.reader.getVideoRender('missing_render')).toBeNull();
      expect(outcome(() => f.reader.getVideoRender('invalid/id'))).toEqual(
        outcome(() => f.repository.getVideoRender('invalid/id')),
      );
      f.repository.db.exec('DROP TRIGGER composition_plans_no_update;');
      f.repository.db.exec(
        "UPDATE composition_plans SET content_hash='" + '0'.repeat(64) + "'",
      );
      expect(
        outcome(() => f.reader.getVideoRender(f.value.videoRenderId)),
      ).toEqual(
        outcome(() => f.repository.getVideoRender(f.value.videoRenderId)),
      );
      expect(() => f.reader.getVideoRender(f.value.videoRenderId)).toThrow(
        /INVALID_PERSISTED_VIDEO_RENDER/,
      );
    } finally {
      f.cleanup();
    }
  });
  it('preserves V2 legacy origin, audio, narration and stored lineage validation', async () => {
    const f = fixture();
    try {
      const config = {
        schemaVersion: 'campaign-audio/1.0.0',
        campaignId: 'campaign_fixture',
        revision: 1,
        language: 'pt-BR',
        provider: 'fake_voice',
        voice: 'fixture_ptbr',
        style: 'calm',
        mode: 'REPLACE',
        originalGainDb: 0,
        narrationGainDb: 0,
      };
      // Historical binding fixture; no binding command or pipeline execution.
      for (const trigger of f.repository.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='affiliate_run_bindings'",
        )
        .all())
        f.repository.db.exec(`DROP TRIGGER "${trigger.name}"`);
      f.repository.db.exec('PRAGMA foreign_keys=OFF');
      f.repository.db.exec(
        "INSERT INTO affiliate_run_bindings VALUES ('run_e07_001','fixture_brief','" +
          'a'.repeat(64) +
          "','campaign_fixture',1,'fixture_product',1)",
      );
      f.repository.db.exec('PRAGMA foreign_keys=ON');
      const configHash = await hash(config);
      p4.putP4(f.repository, 'audio_config', 'audio_fixture', config);
      const narration = {
        contentHash: 'c'.repeat(64),
        audioConfigId: 'audio_fixture',
        sourceId: f.value.videoRenderId,
        pipelineRunId: f.value.pipelineRunId,
      };
      p4.putP4(
        f.repository,
        'voice_track',
        'narration_fixture',
        narration,
        f.value.pipelineRunId,
      );
      const value = {
        schemaVersion: 'video-render/2.0.0',
        videoRenderId: 'render_v2_fixture',
        pipelineRunId: f.value.pipelineRunId,
        projectId: f.value.projectId,
        projectVersion: 1,
        origin: {
          schemaVersion: 'video-origin/1.0.0',
          kind: 'LEGACY_COMPOSITION',
          videoRenderId: f.value.videoRenderId,
          videoRenderContentHash: f.value.contentHash,
        },
        audioConfigId: 'audio_fixture',
        audioConfigHash: configHash,
        narrationId: 'narration_fixture',
        narrationHash: narration.contentHash,
        outputAspectRatio: '9:16',
        widthPixels: 180,
        heightPixels: 320,
        durationMilliseconds: 1000,
        frameCount: 24,
        frameRate: 24,
        videoCodec: 'h264',
        videoProfile: 'High',
        audioCodec: 'aac',
        audioProfile: 'LC',
        audioSampleRate: 48000,
        audioChannels: 2,
        contentHash: 'b'.repeat(64),
        logicalReference: `render:sha256_${'b'.repeat(64)}`,
        revision: 1,
        supersedesVideoRenderId: null,
        createdAt: '2026-10-12T18:00:00Z',
      };
      p4.registerP4Render(f.repository, value);
      expect(f.reader.getVideoRender(value.videoRenderId)).toEqual(
        f.repository.getVideoRender(value.videoRenderId),
      );
      const q: any = {
        ...p4Qc(),
        pipelineRunId: value.pipelineRunId,
        videoRenderId: value.videoRenderId,
        videoRenderContentHash: value.contentHash,
        origin: value.origin,
      };
      q.contentHash = p4ReportHash(q);
      p4.putP4(
        f.repository,
        'qc_report',
        q.qualityControlReportId,
        q,
        value.pipelineRunId,
      );
      const evidence = {
        getVideoRender: (id: string) => f.reader.getVideoRender(id),
        getQualityControlReport: () => q,
      };
      const approvals = new HumanApprovalRepository(f.repository, evidence);
      const service = new HumanApprovalService({
        repository: approvals,
        now: () => value.createdAt,
      });
      const request = {
        projectId: value.projectId,
        projectVersion: 1,
        pipelineRunId: value.pipelineRunId,
        videoRenderId: value.videoRenderId,
        videoRenderRevision: 1,
        videoRenderContentHash: value.contentHash,
        qualityControlReportId: q.qualityControlReportId,
        qualityControlReportContentHash: q.contentHash,
        decision: 'APPROVED',
        actor: 'operator',
        justification: null,
      };
      const decision = service.decide(request);
      expect(service.decide(request)).toEqual(decision);
      expect(
        approvals.listHumanApprovalDecisionsByPipelineRun(value.pipelineRunId),
      ).toEqual([decision]);
      expect(
        p4.getP4(
          f.repository,
          'human_approval',
          decision.humanApprovalDecisionId,
        ),
      ).toEqual(decision);
      expect(() =>
        service.decide({
          ...request,
          decision: 'REJECTED',
          justification: 'Rejected',
        }),
      ).toThrow(/HUMAN_APPROVAL_DECISION_CONFLICT/);
      f.repository.db.exec(
        "DROP TRIGGER p4_artifact_no_delete; DELETE FROM p4_artifacts WHERE kind='voice_track';",
      );
      expect(
        outcome(() => f.reader.getVideoRender(value.videoRenderId)),
      ).toEqual(
        outcome(() => f.repository.getVideoRender(value.videoRenderId)),
      );
      expect(() => f.reader.getVideoRender(value.videoRenderId)).toThrow(
        /P4_NARRATION_BINDING_INVALID/,
      );
    } finally {
      f.cleanup();
    }
  });
});
