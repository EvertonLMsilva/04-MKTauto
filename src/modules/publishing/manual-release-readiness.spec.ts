import { manualReleaseReadiness } from './application/manual-release-readiness.js';
import { PublishingService } from './application/publishing.service.js';
const hash = 'a'.repeat(64);
const pkg = {
  contentHash: hash,
  platform: 'instagram',
  account: '123456789',
  campaignId: 'camp_001',
  campaignRevision: 2,
  identity: {
    projectId: 'project_001',
    projectVersion: 1,
    pipelineRunId: 'run_001',
    videoRenderId: 'render_001',
    videoRenderRevision: 2,
    videoRenderContentHash: 'b'.repeat(64),
    qualityControlReportId: 'qc_001',
  },
  caption: 'PRIVATE_SECRET',
  link: 'https://private.invalid',
  rightsEvidence: 'PRIVATE_SECRET',
};
test.each([
  ['DISTRIBUTION_PACKAGE_NOT_FOUND', 'PACKAGE_NOT_FOUND'],
  ['DISTRIBUTION_APPROVAL_REQUIRED', 'APPROVAL_REQUIRED'],
  ['DISTRIBUTION_APPROVAL_REVOKED', 'APPROVAL_REVOKED'],
  ['DISTRIBUTION_QC_FAILED', 'QC_BLOCKED'],
  ['DISTRIBUTION_QC_BINDING_MISMATCH', 'QC_BLOCKED'],
  ['DISTRIBUTION_MEDIA_CHANGED', 'MEDIA_MISMATCH'],
  ['DISTRIBUTION_RIGHTS_REQUIRED', 'RIGHTS_REQUIRED'],
  ['DISTRIBUTION_FAKE_ONLY', 'FAKE_ONLY'],
  ['DISTRIBUTION_APPROVAL_BINDING_MISMATCH', 'UNKNOWN'],
])(
  'existing gate %s yields %s without leaking distribution content',
  (code, status) => {
    const load = () => {
      if (status === 'PACKAGE_NOT_FOUND')
        throw Object.assign(Error('PRIVATE_SECRET'), { code });
      return pkg;
    };
    const result = manualReleaseReadiness(hash, load, () => {
      throw Object.assign(Error('PRIVATE_SECRET'), { code });
    });
    expect(result.status).toBe(status);
    expect(result.ready).toBe(false);
    expect(result.blockerCodes).toEqual([code]);
    expect(result.nextAction).not.toBe('OPEN_MANUAL_HANDOFF');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
    expect(result).not.toHaveProperty('handoff');
    expect(result.checks.physicalEvidence).toBe('UNKNOWN');
  },
);
test('unverifiable or unexpected errors never become readiness or expose raw error details', () => {
  const result = manualReleaseReadiness(
    hash,
    () => pkg,
    () => {
      throw Object.assign(Error('token PRIVATE_SECRET C:/private/file'), {
        code: 'PRIVATE_SECRET',
      });
    },
  );
  expect(result.status).toBe('UNKNOWN');
  expect(result.ready).toBe(false);
  expect(result.blockerCodes).toEqual(['DISTRIBUTION_READINESS_UNAVAILABLE']);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
});
test('only the existing handoff success proves readiness, without returning its payload', () => {
  const handoff = vi.fn(() => ({
    caption: 'PRIVATE_SECRET',
    affiliateUrl: 'PRIVATE_SECRET',
  }));
  const result = manualReleaseReadiness(hash, () => pkg, handoff);
  expect(handoff).toHaveBeenCalledOnce();
  expect(result.status).toBe('READY_FOR_OPERATOR_HANDOFF');
  expect(result.ready).toBe(true);
  expect(Object.values(result.checks).every((v) => v === 'PASS')).toBe(true);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
});
test('failure to open a read-only session yields UNKNOWN with no private path or error detail', () => {
  const open = vi.fn(() => {
    throw Error('PRIVATE_SECRET C:/private/database.sqlite');
  });
  const service = new PublishingService(
    { open, social: vi.fn() } as any,
    {} as any,
  );
  const result = service.manualReadiness(hash);
  expect(open).toHaveBeenCalledExactlyOnceWith(true);
  expect(result.status).toBe('UNKNOWN');
  expect(result.ready).toBe(false);
  expect(result.identity).toBeNull();
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SECRET');
});
