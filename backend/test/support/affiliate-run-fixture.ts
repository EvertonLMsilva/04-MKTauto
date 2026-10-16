import { affiliateFixture, product, campaign } from './affiliate-fixture.js';
export function affiliateRunFixture() {
  const fixture = affiliateFixture();
  fixture.catalog.registerProduct(product(), 'product_one');
  fixture.catalog.registerCampaign(campaign(), 'campaign_one');
  fixture.catalog.createBriefing(
    { briefingId: 'brief_001', campaignId: 'camp_001', campaignRevision: 1 },
    'brief_one',
  );
  const start = (
    id = 'run_001',
    projectId = 'project_001',
    projectVersion = 1,
  ) =>
    fixture.base.startRun({
      execution: {
        pipelineRunId: id,
        projectId,
        projectVersion,
        startedAt: '2026-10-14T12:00:00Z',
      },
      projectSnapshot: fixture.base.get(projectId, projectVersion),
    });
  start();
  return { ...fixture, start };
}
export function outcome(run: () => unknown) {
  try {
    return { result: run() };
  } catch (error) {
    const e = error as { code?: string; field?: string; path?: string };
    return { code: e.code, field: e.field ?? e.path };
  }
}
