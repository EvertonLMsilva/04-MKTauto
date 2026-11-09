import { InstagramPublicationService } from './application/instagram-publication.service.js';
import { publishingEvidence } from './application/publication-eligibility.js';
it('keeps local technical QC distinct and rejects missing rights/lineage evidence', () => {
  const media: any = {
    getVideoRender: vi.fn(),
    verifyMedia: vi.fn(),
    report: vi.fn(() => ({ result: 'PASS' })),
  };
  const adapter = publishingEvidence(media, {
    publicationEvidence: () => ({ qc: { result: 'PASS' } }),
  } as any);
  expect(() => adapter.report('local_qc:fixture')).toThrow(
    'SOCIAL_ELIGIBILITY_REQUIRED',
  );
  expect(adapter.report('qc_existing')).toEqual({ result: 'PASS' });
});
it('rejects a local render with failed QC even when source evidence is present', () => {
  const hash = 'a'.repeat(64);
  const proof: any = {
    qc: { result: 'FAIL', approvalBlocked: true, videoRenderContentHash: hash },
    render: { contentHash: hash },
    assets: [{ id: 'image_001', reviewHash: hash, sourceKind: 'STATIC_IMAGE' }],
    audio: { contentHash: hash },
    planHash: hash,
  };
  const adapter = publishingEvidence({} as any,
    { publicationEvidence: () => proof } as any);
  expect(() => adapter.report('local_qc:fixture')).toThrow('SOCIAL_ELIGIBILITY_REQUIRED');
  proof.qc = { result: 'PASS', approvalBlocked: false,
    videoRenderContentHash: 'b'.repeat(64) };
  expect(() => adapter.report('local_qc:fixture')).toThrow('SOCIAL_ELIGIBILITY_REQUIRED');
});
it('seals the verified local proof without modifying it or manufacturing human approval', () => {
  const hash = 'a'.repeat(64),
    proof = {
      qc: {
        result: 'PASS',
        approvalBlocked: false,
        videoRenderContentHash: hash,
      },
      render: {
        videoRenderId: 'render_001',
        contentHash: hash,
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
      },
      assets: [{ id: 'media_001', contentHash: hash, rightsHash: hash }],
      audio: { contentHash: hash },
      planHash: hash,
    };
  const adapter = publishingEvidence(
    {} as any,
    { publicationEvidence: () => proof } as any,
  );
  const report: any = adapter.report('local_qc:fixture');
  expect(report.schemaVersion).toBe('publication-eligibility/1.0.0');
  expect(report.evidence.localQcHash).toBeTruthy();
  expect(report).not.toHaveProperty('humanApproval');
  expect(proof.qc).not.toHaveProperty('schemaVersion');
});

it('blocks LIVE scheduling before opening storage or calling a transport', async () => {
  const openInstagram = vi.fn();
  const service = new InstagramPublicationService(
    { openInstagram } as any,
    { publisher: { mode: 'live' } } as any,
  );
  await expect(
    service.schedule(
      {
        execution_id: 'exec_001',
        run_id: 'run_001',
        campaign_id: 'campaign_001',
      },
      {},
      {},
      'operator_fixture',
    ),
  ).rejects.toThrow('SOCIAL_LIVE_POST_BLOCKED');
  expect(openInstagram).not.toHaveBeenCalled();
});
