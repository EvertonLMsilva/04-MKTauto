import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { MediaStore } from './application/media.port.js';
import { LocalRenderIntegrity } from './infrastructure/local-render-integrity.js';
import { qcReport } from '../../../test/support/media-qc-fixture.js';

import { MediaService } from './application/media.service.js';
import {
  validateQualityControlReport,
  qualityControlReportContentHash,
} from './domain/quality-control-contracts.js';
import { compositionPlanContentHash } from './domain/composition-plan-contracts.js';
import type { MediaHandoffRequest } from './application/media-handoff.js';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'media-handoff-'));
  const path = join(root, 'fixture.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE evidence(kind TEXT PRIMARY KEY, payload TEXT)');
  const script = { scriptId: 'script_fixture', contentHash: 'a'.repeat(64) };
  const plan = {
    schemaVersion: 'composition-plan/1.0.0',
    compositionPlanId: 'plan_fixture',
    pipelineRunId: 'run_fixture',
    projectId: 'project_fixture',
    projectVersion: 1,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    voiceTrackId: 'voice_fixture',
    voiceTrackContentHash: 'b'.repeat(64),
    outputAspectRatio: '9:16',
    timelineUnit: 'MILLISECOND',
    continuityMode: 'CONTIGUOUS',
    durationMilliseconds: 10000,
    segments: [
      {
        position: 1,
        visualDirectionPosition: 1,
        mediaAssetId: 'media_fixture',
        mediaAssetContentHash: 'c'.repeat(64),
        startMilliseconds: 0,
        endMilliseconds: 10000,
      },
    ],
    createdAt: '2026-09-28T12:00:00.000Z',
    revision: 1,
    supersedesCompositionPlanId: null,
    contentHash: '',
  };
  plan.contentHash = compositionPlanContentHash(plan);
  const hash = sha(Buffer.from('TEST_ONLY_BYTES_NOT_REAL_VIDEO'));
  const value = {
    schemaVersion: 'video-render/1.0.0' as const,
    videoRenderId: 'render_fixture',
    pipelineRunId: plan.pipelineRunId,
    projectId: plan.projectId,
    projectVersion: 1,
    compositionPlanId: plan.compositionPlanId,
    compositionPlanContentHash: plan.contentHash,
    outputAspectRatio: '9:16',
    durationMilliseconds: 10000,
    containerFormat: 'mp4',
    widthPixels: 1080,
    heightPixels: 1920,
    contentHash: hash,
    logicalReference: `render:sha256_${hash}`,
    createdAt: plan.createdAt,
    revision: 1,
    supersedesVideoRenderId: null,
  };
  const directory = join(root, 'sha256', hash.slice(0, 2));
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${hash}.mp4`);
  writeFileSync(file, 'TEST_ONLY_BYTES_NOT_REAL_VIDEO');
  const qc = qcReport(value.pipelineRunId);
  qc.projectId = plan.projectId;
  qc.videoRenderId = value.videoRenderId;
  qc.videoRenderContentHash = hash;
  qc.checkedAt = '2026-09-29T00:00:00.000Z';
  qc.artifacts.videoRender = { id: value.videoRenderId, contentHash: hash };
  qc.artifacts.script = {
    id: script.scriptId,
    contentHash: script.contentHash,
  };
  qc.artifacts.compositionPlan = {
    id: plan.compositionPlanId,
    contentHash: plan.contentHash,
  };
  qc.artifacts.voiceTrack = {
    id: plan.voiceTrackId,
    contentHash: plan.voiceTrackContentHash,
  };
  qc.artifacts.mediaAssets = [
    { position: 1, id: 'media_fixture', contentHash: 'c'.repeat(64) },
  ];
  qc.contentHash = qualityControlReportContentHash(qc);
  for (const [kind, payload] of Object.entries({ render: value, plan, qc }))
    db.prepare('INSERT INTO evidence VALUES (?,?)').run(
      kind,
      JSON.stringify(payload),
    );
  const read = (kind: string) => {
    const r = new DatabaseSync(path, { readOnly: true });
    try {
      return JSON.parse(
        String(
          r.prepare('SELECT payload FROM evidence WHERE kind=?').get(kind)!
            .payload,
        ),
      );
    } finally {
      r.close();
    }
  };
  let changed = false;
  const getRender = (id: string) => {
    if (changed) throw new Error('STALE_SCRIPT');
    const v = read('render');
    return v.videoRenderId === id ? v : null;
  };
  const store: MediaStore = {
    openRender: () => ({ getVideoRender: getRender, close() {} }),
    openInitialRender: () => ({
      getVideoRender: getRender,
      getCompositionPlan: () => read('plan'),
      getVideoComposition: () => null,
      listVideoRendersByCompositionPlan: () => [read('render')],
      registerVideoComposition: () => {
        throw Error('WRITE_FORBIDDEN');
      },
      close() {},
    }),
    openComposition: () => ({
      getCompositionPlan: () => read('plan'),
      listCompositionPlansByScript: () => [read('plan')],
      listCompositionPlansByPipelineRun: () => [read('plan')],
      registerCompositionPlan: () => {
        throw Error('WRITE_FORBIDDEN');
      },
      close() {},
    }),
    openQuality: () => ({
      getQualityControlReport: (id) => {
        const q = read('qc');
        return q.qualityControlReportId === id ? q : null;
      },
      findQualityControlReport: () => null,
      close() {},
    }),
    open: () => {
      throw Error('ASSET_WRITE_FORBIDDEN');
    },
    verifyMedia: (ref) => new LocalRenderIntegrity(root).verifyMedia(ref),
  };
  const service = () => new MediaService(store);

  const request: MediaHandoffRequest = {
    videoRenderId: value.videoRenderId,
    pipelineRunId: value.pipelineRunId,
    scriptId: script.scriptId,
    scriptContentHash: script.contentHash,
    renderRevision: value.revision,
    renderContentHash: hash,
    qualityControlReportId: qc.qualityControlReportId,
  };
  return {
    root,
    path,
    value,
    file,
    qc,
    store,
    service,
    request,
    compositionPlan: plan,
    tamperQc() {
      db.prepare('UPDATE evidence SET payload=? WHERE kind=?').run(
        JSON.stringify({ ...qc, contentHash: 'd'.repeat(64) }),
        'qc',
      );
    },
    changeScript() {
      changed = true;
    },
    cleanup() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
  f = fixture();
});
afterEach(() => {
  f?.cleanup();
  vi.restoreAllMocks();
});

it('projects validated persisted evidence without writing or granting authorization; survives reopening', () => {
  const before = sha(readFileSync(f.path));
  const quality = vi.spyOn(f.store, 'openQuality');
  const composition = vi.spyOn(f.store, 'openInitialRender');
  const first = f.service().handoff(f.request);
  expect(first).toMatchObject({
    schemaVersion: 'media-handoff/1.0.0',
    status: 'READY_TECHNICAL',
    composition: 'CONSISTENT',
    qc: 'PASS',
    authorizationsGranted: false,
  });
  expect(first.render?.contentHash).toBe(f.value.contentHash);
  expect(first.present).toContain('PHYSICAL_HASH');
  expect(first.absent).toContain('OPTIONAL_COMPOSITION_RECEIPT');
  expect(quality).toHaveBeenCalledWith(true);
  expect(composition).toHaveBeenCalledWith(true);
  expect(f.service().handoff(f.request)).toEqual(first);
  expect(sha(readFileSync(f.path))).toBe(before);
});
it('reports missing render and QC', () => {
  expect(
    f.service().handoff({ ...f.request, videoRenderId: 'absent' }).blockers,
  ).toContain('RENDER_NOT_FOUND');
  expect(
    f.service().handoff({ ...f.request, qualityControlReportId: 'absent' })
      .blockers,
  ).toContain('QC_MISSING');
});
it.each(['FAIL', 'WARN'] as const)('never accepts QC %s', (status) => {
  const qc = structuredClone(f.qc);
  qc.result = status as typeof qc.result;
  qc.approvalBlocked = status === 'FAIL';
  qc.findings[0].status = status;
  qc.contentHash = qualityControlReportContentHash(qc);
  vi.spyOn(f.store, 'openQuality').mockReturnValue({
    close() {},
    getQualityControlReport: () => validateQualityControlReport(qc),
    findQualityControlReport: () => null,
  });
  expect(f.service().handoff(f.request)).toMatchObject({
    status: 'NOT_READY',
    qc: status,
    blockers: ['QC_NOT_PASS'],
  });
});
it.each(['pipelineRunId', 'renderContentHash', 'renderRevision'] as const)(
  'rejects wrong expected %s',
  (key) => {
    const request = {
      ...f.request,
      [key]:
        key === 'renderRevision'
          ? 2
          : key === 'renderContentHash'
            ? 'a'.repeat(64)
            : 'wrong_run',
    };
    expect(f.service().handoff(request).blockers).toContain(
      'RENDER_IDENTITY_MISMATCH',
    );
  },
);
it('rejects an obsolete script identity and a changed persisted script', () => {
  expect(
    f.service().handoff({ ...f.request, scriptContentHash: 'e'.repeat(64) })
      .blockers,
  ).toContain('SCRIPT_REVISION_MISMATCH');
  f.changeScript();
  expect(f.service().handoff(f.request).status).toBe('NOT_READY');
});
it.each(['missing', 'tampered'] as const)(
  'rejects %s physical bytes without exposing filesystem errors',
  (kind) => {
    if (kind === 'missing') unlinkSync(f.file);
    else writeFileSync(f.file, 'TAMPERED');
    const result = f.service().handoff(f.request);
    expect(result.status).toBe('NOT_READY');
    expect(JSON.stringify(result)).not.toContain(f.root);
  },
);
it('rejects a different QC render binding and tampered persisted QC', () => {
  const service = f.service();
  const qc = structuredClone(f.qc);
  qc.videoRenderContentHash = 'c'.repeat(64);
  qc.artifacts.videoRender.contentHash = qc.videoRenderContentHash;
  qc.contentHash = qualityControlReportContentHash(qc);
  const spy = vi
    .spyOn(service, 'report')
    .mockReturnValue(validateQualityControlReport(qc));
  expect(service.handoff(f.request).blockers).toContain('QC_BINDING_MISMATCH');
  spy.mockRestore();
  f.tamperQc();
  expect(service.handoff(f.request).status).toBe('NOT_READY');
});
it('rejects incompatible composition and superseded renders', () => {
  const service = f.service();
  const plan = { ...f.compositionPlan, durationMilliseconds: 20000 };
  // A changed descriptor must not be accepted even before persisted lineage checks.
  plan.contentHash = compositionPlanContentHash(plan);
  const spy = vi.spyOn(service, 'getCompositionPlan').mockReturnValue(plan);
  expect(service.handoff(f.request).status).toBe('NOT_READY');
  spy.mockRestore();
  const open = f.store.openInitialRender!.bind(f.store);
  vi.spyOn(f.store, 'openInitialRender').mockImplementation((readOnly) => {
    const reader = open(readOnly);
    vi.spyOn(reader, 'listVideoRendersByCompositionPlan').mockReturnValue([
      {
        ...f.value,
        videoRenderId: 'new_render',
        revision: 2,
        supersedesVideoRenderId: f.value.videoRenderId,
      },
    ]);
    return reader;
  });
  expect(service.handoff(f.request).blockers).toContain('RENDER_SUPERSEDED');
});
it('treats unavailable freshness capability as UNKNOWN and closes readers on failure', () => {
  f.store.openInitialRender =
    undefined as unknown as typeof f.store.openInitialRender;
  expect(f.service().handoff(f.request).status).toBe('UNKNOWN');
});
it('checks an explicitly supplied composition receipt and rejects absent or incompatible evidence', () => {
  const service = f.service();
  const request = { ...f.request, compositionRequestId: 'compose_test' };
  expect(service.handoff(request).blockers).toContain(
    'COMPOSITION_RECEIPT_MISSING',
  );
  const spy = vi
    .spyOn(service, 'compositionReceipt')
    .mockReturnValue({ requestHash: 'b'.repeat(64), videoRender: f.value });
  expect(service.handoff(request).status).toBe('READY_TECHNICAL');
  spy.mockReturnValue({
    requestHash: 'b'.repeat(64),
    videoRender: { ...f.value, contentHash: 'e'.repeat(64) },
  });
  expect(service.handoff(request).status).toBe('NOT_READY');
});

it('rejects newer composition revisions, absent plans and QC from a different script', () => {
  const service = f.service();
  const newer = {
    ...f.compositionPlan,
    compositionPlanId: 'plan_new',
    revision: 2,
    supersedesCompositionPlanId: f.compositionPlan.compositionPlanId,
  };
  newer.contentHash = compositionPlanContentHash(newer);
  const plans = vi
    .spyOn(service, 'listCompositionPlansByScript')
    .mockReturnValue([f.compositionPlan, newer]);
  expect(service.handoff(f.request).blockers).toContain(
    'COMPOSITION_SUPERSEDED',
  );
  plans.mockRestore();
  const plan = vi.spyOn(service, 'getCompositionPlan').mockReturnValue(null);
  expect(service.handoff(f.request).blockers).toContain(
    'COMPOSITION_PLAN_MISSING',
  );
  plan.mockRestore();
  const qc = structuredClone(f.qc);
  qc.artifacts.script.contentHash = 'f'.repeat(64);
  qc.contentHash = qualityControlReportContentHash(qc);
  vi.spyOn(service, 'report').mockReturnValue(validateQualityControlReport(qc));
  expect(service.handoff(f.request).blockers).toContain('QC_LINEAGE_MISMATCH');
});

it('closes read-only repositories after errors and sanitizes invalid input', () => {
  const close = vi.fn();
  vi.spyOn(f.store, 'openQuality').mockReturnValue({
    close,
    getQualityControlReport: () => {
      throw Error('PRIVATE_ERROR');
    },
    findQualityControlReport: () => null,
  });
  const result = f.service().handoff(f.request);
  expect(result.status).toBe('NOT_READY');
  expect(close).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain('PRIVATE_ERROR');
  expect(
    f.service().handoff({ ...f.request, videoRenderId: '../private' }).blockers,
  ).toContain('HANDOFF_CONTEXT_REQUIRED');
});
