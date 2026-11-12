import { adaptationHash } from './domain/media-hash.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import { validateQualityControlReport } from './domain/quality-control-contracts.js';
import { validateLocalQcHandoff } from './application/local-qc-handoff.js';
import { projectMediaHandoff } from './application/media-handoff.js';

function fixture() {
  const hash = 'a'.repeat(64),
    voice = 'b'.repeat(64),
    image = 'c'.repeat(64),
    script = 'd'.repeat(64);
  const plan: any = {
    schemaVersion: 'composition-plan/1.0.0',
    compositionPlanId: 'plan_test',
    pipelineRunId: 'run_test',
    projectId: 'project_test',
    projectVersion: 1,
    scriptId: 'script_test',
    scriptContentHash: script,
    voiceTrackId: 'voice_test',
    voiceTrackContentHash: voice,
    outputAspectRatio: '9:16',
    timelineUnit: 'MILLISECOND',
    continuityMode: 'CONTIGUOUS',
    durationMilliseconds: 1000,
    segments: [
      {
        position: 1,
        visualDirectionPosition: 1,
        mediaAssetId: 'image_test',
        mediaAssetContentHash: image,
        startMilliseconds: 0,
        endMilliseconds: 1000,
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    revision: 1,
    supersedesCompositionPlanId: null,
    contentHash: '',
  };
  plan.contentHash = compositionPlanContentHash(plan);
  const render = {
    schemaVersion: 'video-render/1.0.0',
    videoRenderId: 'render_test',
    pipelineRunId: plan.pipelineRunId,
    projectId: plan.projectId,
    projectVersion: 1,
    compositionPlanId: plan.compositionPlanId,
    compositionPlanContentHash: plan.contentHash,
    outputAspectRatio: '9:16',
    durationMilliseconds: 1000,
    containerFormat: 'mp4',
    widthPixels: 90,
    heightPixels: 160,
    contentHash: hash,
    logicalReference: `render:sha256_${hash}`,
    createdAt: plan.createdAt,
    revision: 2,
    supersedesVideoRenderId: 'render_source',
  };
  const report: any = {
    policyVersion: 'local-qc/1',
    videoRenderId: render.videoRenderId,
    videoRenderContentHash: hash,
    result: 'PASS',
    approvalBlocked: false,
    findings: [
      'PHYSICAL_HASH',
      'VERIFIED_SUBTITLES_LINEAGE',
      'STREAMS_FORMAT_DURATION',
      'FULL_DECODE',
    ].map((code) => ({ code, status: 'PASS' })),
    facts: { fixture: true },
    cost: { status: 'UNKNOWN', amount: null },
  };
  const e: any = {
    schemaVersion: 'local-qc-handoff/1',
    reportId: 'local_qc:' + adaptationHash(report),
    report,
    checkedAt: '2026-01-01T01:00:00Z',
    context: {
      renderId: render.videoRenderId,
      renderHash: hash,
      renderRevision: 2,
      pipelineRunId: plan.pipelineRunId,
      projectId: plan.projectId,
      projectVersion: 1,
      scriptId: plan.scriptId,
      scriptHash: script,
      scriptRevision: 1,
      planId: plan.compositionPlanId,
      planHash: plan.contentHash,
      voiceId: plan.voiceTrackId,
      voiceHash: voice,
      assets: [{ position: 1, id: 'image_test', contentHash: image }],
      subtitle: {
        id: 'subtitle_test',
        contentHash: hash,
        srtHash: hash,
        assHash: hash,
      },
    },
  };
  const req = {
    videoRenderId: render.videoRenderId,
    pipelineRunId: plan.pipelineRunId,
    scriptId: plan.scriptId,
    scriptContentHash: script,
    renderRevision: 2,
    renderContentHash: hash,
    qualityControlReportId: e.reportId,
  };
  const media: any = {
    getVideoRender: () => render,
    getCompositionPlan: () => plan,
    listCompositionPlansByScript: () => [plan],
    report: () => null,
    verifyMedia: () => hash,
    compositionReceipt: () => null,
  };
  const handoff = () =>
    projectMediaHandoff(
      media,
      req,
      () => [render],
      () => e,
    );
  return {
    e,
    req,
    media,
    render,
    plan,
    handoff,
    rehash() {
      e.reportId = 'local_qc:' + adaptationHash(report);
      req.qualityControlReportId = e.reportId;
    },
  };
}
it('accepts validated local policy without pretending to be a canonical QC or human approval', () => {
  const f = fixture();
  expect(validateLocalQcHandoff(f.e).report.result).toBe('PASS');
  expect(() => validateQualityControlReport(f.e.report)).toThrow();
  expect(f.handoff()).toMatchObject({
    status: 'READY_TECHNICAL',
    qc: 'PASS',
    authorizationsGranted: false,
  });
  expect(f.handoff().references.qc?.policyVersion).toBe('local-qc/1');
});
it.each(['FAIL', 'UNKNOWN'])('preserves %s without promotion', (status) => {
  const f = fixture();
  f.e.report.result = status;
  f.e.report.approvalBlocked = true;
  f.e.report.findings[0].status = status;
  f.rehash();
  expect(f.handoff()).toMatchObject({
    status: status === 'FAIL' ? 'NOT_READY' : 'UNKNOWN',
    qc: status,
  });
});
it.each(['scriptHash', 'voiceHash', 'planHash'])(
  'blocks divergent %s',
  (key) => {
    const f = fixture();
    f.e.context[key] = 'e'.repeat(64);
    expect(f.handoff().blockers).toContain('QC_LINEAGE_MISMATCH');
  },
);
it('blocks changed asset positions/hashes and incomplete subtitle references', () => {
  const f = fixture();
  f.e.context.assets[0].contentHash = 'f'.repeat(64);
  expect(f.handoff().blockers).toContain('QC_LINEAGE_MISMATCH');
  delete f.e.context.subtitle.assHash;
  expect(() => validateLocalQcHandoff(f.e)).toThrow('QC_LINEAGE_MISMATCH');
});
it.each(['', 'not-a-time', '2999-01-01T00:00:00Z'])(
  'requires a verifiable timestamp: %s',
  (time) => {
    const f = fixture();
    f.e.checkedAt = time;
    expect(f.handoff()).toMatchObject({
      status: 'UNKNOWN',
      blockers: ['QC_TIMESTAMP_REQUIRED'],
    });
  },
);
it('rejects altered report, wrong render and absent QC; keeps supersession/file gates', () => {
  const f = fixture();
  f.e.report.result = 'FAIL';
  expect(f.handoff().blockers).toContain('QC_BINDING_MISMATCH');
  f.e.report.result = 'PASS';
  f.e.context.renderRevision = 1;
  expect(f.handoff().blockers).toContain('QC_BINDING_MISMATCH');
  f.e.context.renderRevision = 2;
  f.media.verifyMedia = () => 'f'.repeat(64);
  expect(f.handoff().blockers).toContain('RENDER_FILE_MISMATCH');
  f.media.verifyMedia = () => f.render.contentHash;
  expect(
    projectMediaHandoff(
      f.media,
      f.req,
      () => [f.render],
      () => null,
    ).blockers,
  ).toContain('QC_MISSING');
  expect(
    projectMediaHandoff(
      f.media,
      f.req,
      () => [
        f.render,
        {
          ...f.render,
          videoRenderId: 'new_render',
          revision: 3,
          supersedesVideoRenderId: f.render.videoRenderId,
        },
      ],
      () => f.e,
    ).blockers,
  ).toContain('RENDER_SUPERSEDED');
});
it('requires every actually executed mandatory finding', () => {
  const f = fixture();
  f.e.report.findings.pop();
  f.rehash();
  expect(f.handoff().status).toBe('NOT_READY');
});
