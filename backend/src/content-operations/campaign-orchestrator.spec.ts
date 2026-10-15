import { DatabaseSync } from 'node:sqlite';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { CampaignRepository } from './infrastructure/campaign.repository.js';
import {
  CampaignOrchestrator,
  type CampaignWorkflow,
} from './application/campaign-orchestrator.js';
const at = '2026-10-15T12:00:00.000Z';
describe('campaign orchestration', () => {
  let db: DatabaseSync, r: CampaignRepository, service: CampaignOrchestrator;
  let workflow: CampaignWorkflow;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    provisionSchema(db);
    db.exec('PRAGMA foreign_keys=OFF');
    r = new CampaignRepository(db);
    workflow = {
      steps: ['EDITORIAL', 'MEDIA', 'HANDOFF'],
      execute: vi.fn(async (step) => ({ step })),
      reconcile: vi.fn(async () => null),
    };
    service = new CampaignOrchestrator(r, workflow, () => at);
  });
  afterEach(() => db.close());
  const schedule = () =>
    r.schedule(
      {
        campaignId: 'campaign_001',
        campaignRevision: 1,
        scheduledAt: at,
        runId: 'run_001',
      },
      {},
      at,
    );
  it('executes concurrent ticks once and replays persisted checkpoints', async () => {
    const e = schedule();
    await Promise.all([service.tick(), service.tick()]);
    expect(r.get(e.execution_id).status).toBe('SUCCEEDED');
    expect(workflow.execute).toHaveBeenCalledTimes(3);
    await new CampaignOrchestrator(r, workflow, () => at).tick();
    expect(workflow.execute).toHaveBeenCalledTimes(3);
  });
  it.each([
    'EDITORIAL_PROVIDER_UNAVAILABLE',
    'AUDIO_REQUIRED',
    'ALIGNMENT_CONFIGURATION_REQUIRED',
    'GLOBAL_DAILY_BUDGET_EXCEEDED',
    'GLOBAL_MONTHLY_BUDGET_EXCEEDED',
    'GLOBAL_PRICE_UNPROVEN',
  ])('waits for %s', async (code) => {
    const e = schedule();
    vi.mocked(workflow.execute).mockRejectedValue(
      Object.assign(new Error(code), { code }),
    );
    await service.tick();
    expect(r.get(e.execution_id).status).toBe('WAITING_INPUT');
  });
  it.each(['FINANCE_UNKNOWN', 'EXTERNAL_EFFECT_UNCERTAIN'])(
    'never retries %s',
    async (code) => {
      const e = schedule();
      vi.mocked(workflow.execute).mockRejectedValue(
        Object.assign(new Error(code), { code, transient: true }),
      );
      await service.tick();
      expect(r.get(e.execution_id).status).toBe('WAITING_RECONCILIATION');
      expect(workflow.execute).toHaveBeenCalledTimes(1);
      await expect(service.resume(e.execution_id)).rejects.toThrow(
        'RECONCILIATION_REQUIRED',
      );
    },
  );
  it('retries known safe transient failure at most 3 times, including resumes', async () => {
    const e = schedule();
    vi.mocked(workflow.execute).mockRejectedValue(
      Object.assign(new Error('UNAVAILABLE'), {
        code: 'LOCAL_TEMPORARY',
        retrySafe: true,
        transient: true,
      }),
    );
    await service.tick();
    expect(workflow.execute).toHaveBeenCalledTimes(3);
    expect(r.get(e.execution_id).status).toBe('FAILED');
    await service.resume(e.execution_id);
    await service.tick();
    expect(workflow.execute).toHaveBeenCalledTimes(3);
  });
  it('preserves completed stages through waiting and restart', async () => {
    const e = schedule();
    vi.mocked(workflow.execute).mockImplementation(async (step) => {
      if (step === 'MEDIA')
        throw Object.assign(new Error('AUDIO_REQUIRED'), {
          code: 'AUDIO_REQUIRED',
        });
      return { step };
    });
    await service.tick();
    expect(r.get(e.execution_id).status).toBe('WAITING_INPUT');
    vi.mocked(workflow.execute).mockImplementation(async (step) => ({ step }));
    await service.resume(e.execution_id);
    await new CampaignOrchestrator(r, workflow, () => at).tick();
    expect(r.get(e.execution_id).status).toBe('SUCCEEDED');
    expect(
      vi
        .mocked(workflow.execute)
        .mock.calls.filter((c) => c[0] === 'EDITORIAL'),
    ).toHaveLength(1);
  });
  it('does not dispatch further stages after cancellation during an effect', async () => {
    const e = schedule();
    vi.mocked(workflow.execute).mockImplementation(async () => {
      r.cancel(e.execution_id, at);
      return {};
    });
    await service.tick();
    expect(r.get(e.execution_id).status).toBe('CANCELLED');
    expect(workflow.execute).toHaveBeenCalledTimes(1);
  });
  it('QC failure is terminal and never produces handoff', async () => {
    const e = schedule();
    vi.mocked(workflow.execute).mockRejectedValue(
      Object.assign(new Error('QC_FAILED'), { code: 'QC_FAILED' }),
    );
    await service.tick();
    expect(r.get(e.execution_id).status).toBe('FAILED');
  });
  it('requires adapter verification before resuming an expired claim', async () => {
    const e = schedule();
    r.claim(e.execution_id, at, 1000);
    r.recover('2026-10-15T12:00:02.000Z');
    await expect(service.resume(e.execution_id)).rejects.toThrow(
      'RECONCILIATION_REQUIRED',
    );
    vi.mocked(workflow.reconcile).mockResolvedValue({ verified: true });
    await service.resume(e.execution_id);
    expect(r.get(e.execution_id).status).toBe('SCHEDULED');
  });
});
