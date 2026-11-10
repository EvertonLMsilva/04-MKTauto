import { DashboardSummaryService } from './dashboard-summary.service.js';
import type { DashboardReadSnapshot } from './dashboard-summary.contract.js';

function snapshot(): DashboardReadSnapshot {
  return {
    generatedAt: '2026-11-09T12:00:00.000Z',
    publicationMode: null,
    runningExecutions: { value: 4, reason: null },
    generatedMedia: { value: null, reason: 'MEDIA_MATERIALIZATION_NOT_PROVEN' },
    socialPublicationsFake: {
      value: null,
      reason: 'PUBLICATION_SCOPE_UNAVAILABLE',
    },
    socialPublicationsLive: {
      value: null,
      reason: 'PUBLICATION_SCOPE_UNAVAILABLE',
    },
    qcApproved: { value: 1, reason: null },
    qcEvaluated: { value: 2, reason: null },
  };
}

test('versioned summary preserves units and unavailable semantic totals', () => {
  const value = new DashboardSummaryService({ read: snapshot }).summary();
  expect(value).toMatchObject({
    schemaVersion: 'operations-dashboard-summary/1.0.0',
    activeCampaigns: null,
    completedPublications: null,
    runningExecutions: 4,
    qcApprovalRate: 50,
    scope: {
      period: 'all_time',
      source: 'PROJECT_API_DATABASE',
      qcFamily: 'quality-control-report/1.0.0',
    },
  });
  expect(value.availability.qcApprovalRate).toEqual({
    status: 'AVAILABLE',
    reason: null,
  });
});

test.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'invalid aggregate %s is not exposed as a number',
  (invalid) => {
    const input = snapshot();
    input.runningExecutions.value = invalid;
    expect(
      new DashboardSummaryService({ read: () => input }).summary(),
    ).toMatchObject({
      runningExecutions: null,
      availability: { runningExecutions: { reason: 'INVALID_AGGREGATE' } },
    });
  },
);

test('QC numerator above denominator invalidates the complete QC group', () => {
  const input = snapshot();
  input.qcApproved.value = 3;
  expect(
    new DashboardSummaryService({ read: () => input }).summary(),
  ).toMatchObject({
    qcApproved: null,
    qcEvaluated: null,
    qcApprovalRate: null,
  });
});
