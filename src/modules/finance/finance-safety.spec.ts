import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { FinanceSession } from './infrastructure/finance.session.js';
import { FinanceService } from './application/finance.service.js';
import {
  financeFixture,
  campaignFinanceFixture,
  cost,
  proof,
  time,
} from '../../../test/support/finance-fixture.js';
describe('Finance replay, evidence and storage safety', () => {
  it('replays a historical JS response after restart without invoking transport', async () => {
    const f = financeFixture();
    try {
      await f.gate.executePaid(
        proof(),
        async () => ({ body: 'fixture', status: 200 }),
        time,
      );
      const service = new FinanceService({
          open: () => new FinanceSession(f.path),
        }),
        transport = vi.fn();
      expect(await service.executePaid(proof(), transport, time)).toEqual({
        body: 'fixture',
        status: 200,
      });
      expect(transport).not.toHaveBeenCalled();
      expect(service.getGlobalOperation('a')?.actual_usd).toBeNull();
    } finally {
      f.close();
    }
  });
  it('retains UNKNOWN after lost transport and denies every retry', async () => {
    const f = financeFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      const transport = vi.fn(async () => {
        throw new Error('lost response');
      });
      await expect(
        service.executePaid(proof(), transport, time),
      ).rejects.toThrow('lost response');
      await expect(
        service.executePaid(proof(), transport, time),
      ).rejects.toMatchObject({
        code: 'GLOBAL_OPERATION_RECONCILIATION_REQUIRED',
      });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(service.getGlobalUsage('2026-11-01T12:00:00Z').dailyUsd).toBe(
        '0.6',
      );
    } finally {
      f.close();
    }
  });
  it('does not dispatch after failed persistence; a failed result write retains uncertainty', async () => {
    const f = financeFixture(),
      ts = new FinanceSession(f.path);
    try {
      const transport = vi.fn(async () => ({ mock: true }));
      ts.db.exec(
        "CREATE TRIGGER fail_insert BEFORE INSERT ON global_paid_operations BEGIN SELECT RAISE(ABORT,'fixture insert'); END",
      );
      await expect(ts.executePaid(proof(), transport, time)).rejects.toThrow(
        'fixture insert',
      );
      expect(transport).not.toHaveBeenCalled();
      ts.db.exec('DROP TRIGGER fail_insert');
      ts.db.exec(
        "CREATE TRIGGER fail_result BEFORE UPDATE ON global_paid_operations WHEN NEW.state='COMPLETED' BEGIN SELECT RAISE(ABORT,'fixture result'); END",
      );
      await expect(ts.executePaid(proof(), transport, time)).rejects.toThrow(
        'fixture result',
      );
      expect(ts.getGlobalOperation('a')?.state).toBe('UNKNOWN');
      await expect(
        ts.executePaid(proof(), transport, time),
      ).rejects.toMatchObject({
        code: 'GLOBAL_OPERATION_RECONCILIATION_REQUIRED',
      });
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      ts.close();
      f.close();
    }
  });
  it('keeps USD 1/day and USD 20/month, across settled days', async () => {
    const f = financeFixture(),
      ts = new FinanceSession(f.path);
    try {
      for (let day = 1; day <= 20; day++) {
        const date = `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`;
        await ts.executePaid(
          {
            ...proof('a', '1'),
            operationId: `op_${day}`,
            requestHash: day.toString(16).padStart(64, '0'),
          },
          async () => ({ mock: true }),
          date,
        );
        ts.settleGlobal(`op_${day}`, {
          actualCostUsd: '1',
          evidenceReference: `fixture:receipt_${day}`,
        });
      }
      expect(() =>
        ts.reserveGlobal(
          { ...proof('b', '1'), requestHash: 'f'.repeat(64) },
          '2026-10-21T12:00:00Z',
        ),
      ).toThrow('GLOBAL_MONTHLY_BUDGET_EXCEEDED');
    } finally {
      ts.close();
      f.close();
    }
  });
  it('preserves timezone rollover and rejects unproven ceilings and reused identities', () => {
    const f = financeFixture(),
      ts = new FinanceSession(f.path);
    try {
      for (const change of [
        { kind: 'OFFICIAL_ESTIMATE' },
        { includesAllCharges: false },
        { expiresAt: time },
        { maximumAmount: 'UNKNOWN' },
        { maximumAmount: '0' },
        { currency: 'BRL' },
      ])
        expect(() => ts.reserveGlobal({ ...proof(), ...change }, time)).toThrow(
          'GLOBAL_PRICE_UNPROVEN',
        );
      ts.reserveGlobal(proof('a', '1'), '2026-10-14T02:59:00Z');
      ts.dispatchGlobal('a', '2026-10-14T02:59:00Z');
      ts.settleGlobal('a', {
        actualCostUsd: '0',
        evidenceReference: 'mock:zero-receipt',
      });
      expect(() =>
        ts.reserveGlobal({ ...proof('a', '1'), operationId: 'other' }, time),
      ).toThrow('GLOBAL_IDENTITY_CONFLICT');
      expect(
        ts.reserveGlobal(proof('b', '1'), '2026-10-14T03:01:00Z').created,
      ).toBe(true);
    } finally {
      ts.close();
      f.close();
    }
  });
  it('opens only existing schema 39 storage and never provisions finance tables', () => {
    const f = financeFixture();
    try {
      const absent = join(dirname(f.path), 'absent.sqlite');
      expect(() => new FinanceSession(absent)).toThrow();
      expect(existsSync(absent)).toBe(false);
      const before = f.legacy.db
        .prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')
        .all();
      const ts = new FinanceSession(f.path);
      try {
        ts.getGlobalUsage(time);
      } finally {
        ts.close();
      }
      expect(
        f.legacy.db
          .prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name')
          .all(),
      ).toEqual(before);
      // Only the disposable fixture loses its auxiliary schema.
      f.legacy.db.exec(
        'DROP TABLE global_paid_operations; DROP TABLE global_finance_policy;',
      );
      const bytes = readFileSync(f.path);
      const closed = new FinanceSession(f.path);
      try {
        expect(() => closed.reserveGlobal(proof(), time)).toThrow(
          'FINANCE_SCHEMA_REQUIRED',
        );
      } finally {
        closed.close();
      }
      expect(
        f.legacy.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='global_finance_policy'",
          )
          .get(),
      ).toBeUndefined();
      expect(readFileSync(f.path)).toEqual(bytes);
      f.legacy.db.exec('PRAGMA user_version=38');
      expect(() => new FinanceSession(f.path)).toThrow(
        'FINANCE_SCHEMA_VERSION_UNSUPPORTED',
      );
    } finally {
      f.close();
    }
  });
  it('rolls back cost writes and preserves validation of run and artifact scope', () => {
    const f = campaignFinanceFixture(),
      ts = new FinanceSession(f.path);
    try {
      expect(() => ts.register(cost({ pipelineRunId: 'run_missing' }))).toThrow(
        'PIPELINE_RUN_NOT_FOUND',
      );
      expect(() => ts.register(cost({ projectVersion: 2 }))).toThrow(
        'COST_EVENT_RUN_SCOPE_MISMATCH',
      );
      expect(() =>
        ts.register(cost({ artifactId: 'artifact_missing' })),
      ).toThrow('COST_EVENT_ARTIFACT_NOT_FOUND');
      ts.db.exec(
        "CREATE TRIGGER fail_cost BEFORE INSERT ON cost_events BEGIN SELECT RAISE(ABORT,'fixture cost'); END",
      );
      expect(() => ts.register(cost())).toThrow(
        'COST_EVENT_PERSISTENCE_FAILED',
      );
      expect(ts.listByPipelineRun('run_001')).toEqual([]);
      ts.db.exec('DROP TRIGGER fail_cost');
      expect(ts.register(cost()).amount).toBe('0.04');
    } finally {
      ts.close();
      f.close();
    }
  });
});
