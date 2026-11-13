import { facebookPublicationFixture } from '../../../test/support/facebook-publication.fixture.js';
import { PublishingService } from './application/publishing.service.js';
import { HumanApprovalService } from './application/human-approval.service.js';

// FICTITIOUS_TEST_ONLY. Media uses a trusted repository port double; package
// persistence uses native disposable SQLite. Social adapters are isolated.
// These decisions are never operational human approvals or publication receipts.
test('FICTITIOUS_TEST_ONLY media rejection remains exact across service instances/replay and cannot silently become approval', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('EXTERNAL_HTTP_FORBIDDEN'));
  const f = await facebookPublicationFixture();
  try {
    const posts = structuredClone(f.posts);
    const input = {
      ...f.facebookPackage.identity,
      decision: 'REJECTED',
      actor: 'FICTITIOUS_TEST_ONLY_reviewer',
      justification:
        'FICTITIOUS_TEST_ONLY: exact video declined by fixture reviewer',
    };
    // This shared fixture supplies Media through ports rather than persisted V1
    // video/QC rows. Keep SQL binding triggers intact and test the service port.
    const decisions = new Map<string, any>();
    const repository = {
      getVideoRender: (id: string) => f.media.getVideoRender(id),
      getQualityControlReport: (id: string) => f.media.report(id),
      getHumanApprovalDecision: (id: string) => decisions.get(id) ?? null,
      findApprovedHumanApprovalDecision: () => null,
      registerHumanApprovalDecision: (decision: any) => {
        decisions.set(decision.humanApprovalDecisionId, decision);
        return decision;
      },
    };
    const rejected = new HumanApprovalService({ repository }).decide(input);
    expect(rejected.decision).toBe('REJECTED');
    expect(rejected.videoRenderContentHash).toBe(f.hash);
    expect(rejected.qualityControlReportContentHash).toBe(
      input.qualityControlReportContentHash,
    );
    const restarted = new HumanApprovalService({ repository });
    expect(restarted.decide(input)).toEqual(rejected);
    expect(() =>
      restarted.decide({ ...input, decision: 'APPROVED', justification: null }),
    ).toThrow(/HUMAN_APPROVAL_DECISION_CONFLICT/);
    expect(
      f.publishing.manualReadiness(f.facebookPackage.contentHash).ready,
    ).toBe(false);
    expect(f.publishing.publications(f.facebookPackage.contentHash)).toEqual(
      [],
    );
    expect(f.posts).toEqual(posts);
    expect(network).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
    network.mockRestore();
  }
});

test('FICTITIOUS_TEST_ONLY exact package rejection requires a reason, preserves history and blocks publication after restart', async () => {
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('EXTERNAL_HTTP_FORBIDDEN'));
  const f = await facebookPublicationFixture();
  try {
    const pkg = f.facebookPackage,
      posts = structuredClone(f.posts);
    const input = {
      packageHash: pkg.contentHash,
      decision: 'REJECTED',
      actor: 'FICTITIOUS_TEST_ONLY_reviewer',
      justification:
        'FICTITIOUS_TEST_ONLY: approved media does not approve this commercial package',
    };
    expect(() =>
      f.publishing.review(
        { ...input, justification: null },
        'commercial_rejection_missing_reason',
      ),
    ).toThrow(/JUSTIFICATION_REQUIRED/);
    expect(f.publishing.packageReview(pkg.contentHash)).toBeNull();
    const rejected = f.publishing.review(input, 'commercial_package_rejection');
    expect(rejected.packageHash).toBe(pkg.contentHash);
    expect(rejected.mediaDecision.decision).toBe('REJECTED');
    const restarted = new PublishingService(f.store, f.media);
    expect(restarted.packageReview(pkg.contentHash)).toEqual(rejected);
    expect(restarted.review(input, 'commercial_package_rejection')).toEqual(
      rejected,
    );
    expect(restarted.manualReadiness(pkg.contentHash).ready).toBe(false);
    expect(() => restarted.manualHandoff(pkg.contentHash)).toThrow(
      /DISTRIBUTION_APPROVAL_REQUIRED/,
    );
    expect(() =>
      restarted.review(
        { ...input, decision: 'APPROVED', justification: null },
        'commercial_conflicting_approval',
      ),
    ).toThrow(/HUMAN_APPROVAL_DECISION_CONFLICT/);
    expect(() =>
      restarted.recordPublication(
        {
          packageHash: pkg.contentHash,
          actor: 'FICTITIOUS_TEST_ONLY',
          publishedAt: f.at,
          externalId: null,
          externalUrl: null,
          evidenceReference: 'fixture:FICTITIOUS_TEST_ONLY:blocked-attempt',
          state: 'UNCONFIRMED',
        },
        'commercial_rejected_publication',
      ),
    ).toThrow(/DISTRIBUTION_APPROVAL_REQUIRED/);
    expect(restarted.publications(pkg.contentHash)).toEqual([]);
    expect(restarted.packageReview(pkg.contentHash)).toEqual(rejected);
    expect(restarted.package(pkg.contentHash)).toEqual(pkg);
    expect(f.posts).toEqual(posts);
    expect(network).not.toHaveBeenCalled();
  } finally {
    f.cleanup();
    network.mockRestore();
  }
});
