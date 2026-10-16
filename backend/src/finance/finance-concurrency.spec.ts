import { FinanceSession } from './infrastructure/finance.session.js';
import {
  campaignFinanceFixture,
  financeFixture,
  proof,
  time,
} from '../../test/support/finance-fixture.js';
import { raceFinance } from '../../test/support/finance-concurrency.js';
describe('Finance real simultaneous SQLite transactions', () => {
  it('shares the final global balance across campaigns between two independent NestJS workers', async () => {
    const f = campaignFinanceFixture();
    try {
      const results = await raceFinance(f.path, [
        {
          method: 'reserveGlobal',
          args: [{ ...proof('a'), pipelineRunId: 'run_001' }, time],
        },
        {
          method: 'reserveGlobal',
          args: [{ ...proof('b'), pipelineRunId: 'run_002' }, time],
        },
      ]);
      expect(new Set(results.map((r) => r.workerThreadId)).size).toBe(2);
      expect(results.every((r) => r.workerThreadId > 0)).toBe(true);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)?.code).toBe(
        'GLOBAL_DAILY_BUDGET_EXCEEDED',
      );
      const ts = new FinanceSession(f.path);
      try {
        expect(ts.getGlobalUsage(time).dailyUsd).toBe('0.6');
        expect(
          ts.db.prepare('SELECT count(*) n FROM global_paid_operations').get()
            .n,
        ).toBe(1);
      } finally {
        ts.close();
      }
    } finally {
      f.close();
    }
  });
  it('claims the same intent once and only one dispatcher can proceed', async () => {
    const f = financeFixture();
    try {
      const reservations = await raceFinance(f.path, [
        { method: 'reserveGlobal', args: [proof(), time] },
        { method: 'reserveGlobal', args: [proof(), time] },
      ]);
      expect(reservations.every((r) => r.ok)).toBe(true);
      expect(reservations.filter((r) => r.value.created)).toHaveLength(1);
      const dispatches = await raceFinance(f.path, [
        { method: 'dispatchGlobal', args: ['a', time] },
        { method: 'dispatchGlobal', args: ['a', time] },
      ]);
      expect(dispatches.filter((r) => r.ok)).toHaveLength(1);
      expect(dispatches.find((r) => !r.ok)?.code).toBe(
        'GLOBAL_OPERATION_RECONCILIATION_REQUIRED',
      );
    } finally {
      f.close();
    }
  });
  it('serializes conflicting receipts and persists the winning receipt across restart', async () => {
    const f = financeFixture();
    try {
      f.gate.reserveGlobal(proof(), time);
      f.gate.dispatchGlobal('a');
      const results = await raceFinance(f.path, [
        {
          method: 'settleGlobal',
          args: ['a', { actualCostUsd: '0.2', evidenceReference: 'bill:a' }],
        },
        {
          method: 'settleGlobal',
          args: ['a', { actualCostUsd: '0.3', evidenceReference: 'bill:b' }],
        },
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)?.code).toBe('GLOBAL_BILLING_CONFLICT');
      const ts = new FinanceSession(f.path);
      try {
        const saved = ts.getGlobalOperation('a');
        expect(saved.state).toBe('COMPLETED');
        expect(['0.2', '0.3']).toContain(saved.actual_usd);
        expect(() =>
          ts.settleGlobal('a', {
            actualCostUsd: saved.actual_usd,
            evidenceReference: saved.billing_reference,
          }),
        ).not.toThrow();
      } finally {
        ts.close();
      }
    } finally {
      f.close();
    }
  });
});
