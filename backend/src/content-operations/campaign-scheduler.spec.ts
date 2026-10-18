import { DatabaseSync } from 'node:sqlite';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignAdministration } from './application/campaign-administration.js';
import type { NativeCampaignWorkflow } from './application/native-campaign-workflow.js';

test('enabled scheduler dispatches due work automatically and stops on shutdown', async () => {
  const f = p2EditorialFixture(),
    db = new DatabaseSync(f.database);
  provisionSchema(db);
  db.close();
  const execute = vi.fn(async () => ({ artifactId: 'fixture_result' }));
  const workflow = {
    steps: ['LOCAL'],
    validate: async () => ({}),
    execute,
    reconcile: async () => null,
  } as unknown as NativeCampaignWorkflow;
  const service = new CampaignAdministration(f.database, workflow, true);
  try {
    service.onModuleInit();
    const e = await service.schedule({
      campaignId: 'camp_001',
      campaignRevision: 1,
      scheduledAt: '2026-10-14T12:00:00Z',
      runId: 'scheduled_worker_001',
      briefingId: 'brief_001',
      researchShortlistId: f.shortlist.artifactId,
      generationRequestId: 'scheduled_script_001',
      mode: 'LOCAL_VALIDATION',
    });
    await vi.waitFor(
      () => expect(service.get(e.execution_id).status).toBe('SUCCEEDED'),
      { timeout: 3000, interval: 50 },
    );
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await service.onModuleDestroy();
    f.cleanup();
  }
});

test.each(['GLOBAL_DAILY_BUDGET_EXCEEDED', 'GLOBAL_MONTHLY_BUDGET_EXCEEDED'])(
  'exposes the actual narration wait and action for %s without changing Finance',
  (code) => {
    const service = new CampaignAdministration(
      null,
      {} as NativeCampaignWorkflow,
    );
    const history = [
      { event_type: 'SCHEDULED', evidence: {} },
      { event_type: 'PAUSED', evidence: { step: 'AUDIO', code } },
    ];
    (service as any).store = {
      get: () => ({ execution_id: 'fixture_exec', status: 'WAITING_INPUT' }),
      history: () => history,
    };
    const result = service.get('fixture_exec');
    expect(result.finalization.pending).toMatchObject({ code });
    expect(result.finalization.pending?.message).toContain('Finance');
    expect(result.finalization.pending?.message).toContain('Retomar');
    expect(result.finalization.availableActions).toEqual([
      'WAIT_BUDGET_WINDOW',
      'RESUME',
      'CANCEL',
    ]);
  },
);
