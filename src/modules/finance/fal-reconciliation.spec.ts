import { DatabaseSync } from 'node:sqlite';
import { falFixture } from '../../../test/support/fal-fixture.js';
import { provisionSchema } from '../../infrastructure/administration/schema-provisioner.js';
import { CostLedgerRepository } from './infrastructure/cost-ledger.repository.js';

describe('NestJS fal financial reconciliation', () => {
  const observation = (amount: string, final = false) => ({
    amount,
    final,
    currency: 'USD',
    source: 'invoice/1.0.0',
    occurredAt: '2026-10-11T12:00:00Z',
  });
  async function setup() {
    const { FalGenerationRepository } =
      await import('./infrastructure/fal-generation.repository.js');
    const f = falFixture();
    f.base.startRun({
      execution: {
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        startedAt: '2026-10-11T12:00:00Z',
      },
      projectSnapshot: f.base.get('project_001')!,
    });
    const db = new DatabaseSync(f.database);
    try {
      provisionSchema(db);
    } finally {
      db.close();
    }
    const ledger = new CostLedgerRepository(f.database);
    const jobs = new FalGenerationRepository(ledger);
    const reserve = (id = 'acq_001', amount = '1') =>
      jobs.reserve({
        basis: { pipelineRunId: 'run_001', imageHash: id },
        request: { mediaAcquisitionRequestId: id, contentHash: 'a'.repeat(64) },
        budget: { amount: '1', currency: 'USD' },
        estimate: { amount, currency: 'USD', source: 'fixture/1.0.0' },
      });
    return {
      ...f,
      jobs,
      ledger,
      reserve,
      cleanup: () => {
        ledger.close();
        f.cleanup();
      },
    };
  }
  it('keeps partial costs and reservations conservative until final settlement', async () => {
    const f = await setup();
    try {
      const job = f.reserve();
      f.jobs.submitted(job.key, 'request_001');
      f.jobs.recordObservedCost(job.key, observation('0.10'));
      expect(() => f.reserve('acq_002', '0.90')).toThrow(
        'PROVIDER_BUDGET_EXCEEDED',
      );
      f.jobs.state(job.key, 'COMPLETED');
      f.jobs.recordObservedCost(job.key, observation('0.10', true));
      expect(f.reserve('acq_002', '0.90').owner).toBe(true);
      expect(f.ledger.listCostEventsByPipelineRun('run_001')).toHaveLength(1);
      expect(f.jobs.get(job.key)!.observedCostAmount).toBe('0.1');
    } finally {
      f.cleanup();
    }
  });
  it('reserves exactly once across independent NestJS connections and keeps unknown submissions', async () => {
    const f = await setup();
    const { FalGenerationRepository } =
      await import('./infrastructure/fal-generation.repository.js');
    const otherLedger = new CostLedgerRepository(f.database);
    try {
      const first = f.reserve();
      f.jobs.uncertain(first.key);
      const other = new FalGenerationRepository(otherLedger);
      expect(other.getByAcquisitionRequest('acq_001')).toMatchObject({
        state: 'RECONCILIATION_PENDING',
        requestId: null,
      });
      expect(f.reserve().owner).toBe(false);
      expect(() => f.reserve('acq_002')).toThrow('PROVIDER_BUDGET_EXCEEDED');
    } finally {
      otherLedger.close();
      f.cleanup();
    }
  });
  it('rolls back cost and final settlement together after a write failure', async () => {
    const f = await setup();
    try {
      const job = f.reserve();
      f.jobs.submitted(job.key, 'request_001');
      f.jobs.state(job.key, 'COMPLETED');
      f.ledger.db.exec(
        "CREATE TRIGGER reject_settlement BEFORE INSERT ON fal_financial_settlements BEGIN SELECT RAISE(ABORT,'injected failure'); END;",
      );
      expect(() =>
        f.jobs.recordObservedCost(job.key, observation('0.2', true)),
      ).toThrow();
      expect(f.ledger.listCostEventsByPipelineRun('run_001')).toEqual([]);
      expect(f.jobs.get(job.key)!.financiallySettled).toBe(false);
      expect(f.ledger.db.isTransaction).toBe(false);
    } finally {
      f.cleanup();
    }
  });
  it('accounts cumulative observations once and rejects regressions and conflicting final evidence', async () => {
    const f = await setup();
    try {
      const job = f.reserve();
      f.jobs.submitted(job.key, 'request_001');
      f.jobs.recordObservedCost(job.key, observation('0.1'));
      f.jobs.recordObservedCost(job.key, observation('0.1'));
      f.jobs.recordObservedCost(job.key, observation('0.4'));
      expect(f.jobs.get(job.key)?.observedCostAmount).toBe('0.4');
      expect(f.ledger.listCostEventsByPipelineRun('run_001')).toHaveLength(2);
      expect(() =>
        f.jobs.recordObservedCost(job.key, observation('0.2')),
      ).toThrow('PROVIDER_COST_REGRESSION');
      f.jobs.state(job.key, 'COMPLETED');
      f.jobs.recordObservedCost(job.key, observation('0.4', true));
      f.jobs.recordObservedCost(job.key, observation('0.4', true));
      expect(() =>
        f.jobs.recordObservedCost(job.key, observation('0.5', true)),
      ).toThrow('PROVIDER_COST_ALREADY_SETTLED');
      expect(f.ledger.listCostEventsByPipelineRun('run_001')).toHaveLength(2);
    } finally {
      f.cleanup();
    }
  });
  it('retains unknown costs until evidence exists and blocks tampered persisted basis', async () => {
    const f = await setup();
    try {
      const job = f.reserve();
      expect(f.jobs.get(job.key)?.observedCostAmount).toBeNull();
      expect(() => f.reserve('other', '2')).toThrow('PROVIDER_BUDGET_EXCEEDED');
      // Scratch database damage must never manufacture a fresh dispatch owner.
      f.ledger.db.exec('DROP TRIGGER fal_generation_identity_immutable');
      f.ledger.db
        .prepare(
          'UPDATE fal_generations SET basis_json=? WHERE generation_key=?',
        )
        .run('{"changed":true}', job.key);
      expect(() => f.reserve()).toThrow('PROVIDER_PERSISTED_JOB_INVALID');
    } finally {
      f.cleanup();
    }
  });
});
