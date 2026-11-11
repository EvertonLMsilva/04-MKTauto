import { FinanceSession } from './infrastructure/finance.session.js';
import {
  financeFixture as fixture,
  proof,
  time,
} from '../../../test/support/finance-fixture.js';
function outcome(fn: () => unknown) {
  try {
    return { result: fn() };
  } catch (e) {
    const error = e as any;
    return {
      name: error.name,
      code: error.code,
      field: error.field ?? error.path,
    };
  }
}
describe('Finance global parity', () => {
  it('matches defaults, exact units, replay, settlement and UNKNOWN across periods', () => {
    const a = fixture(),
      b = fixture();
    const ts = new FinanceSession(a.path);
    try {
      const pairs = [
        () => [ts.configureGlobal(), b.gate.configureGlobal()],
        () => [
          ts.reserveGlobal(proof(), time),
          b.gate.reserveGlobal(proof(), time),
        ],
        () => [
          ts.reserveGlobal(proof(), time),
          b.gate.reserveGlobal(proof(), time),
        ],
        () => [ts.getGlobalUsage(time), b.gate.getGlobalUsage(time)],
      ];
      for (const pair of pairs) {
        const [left, right] = pair();
        expect(left).toEqual(right);
      }
      for (const engine of [ts, b.gate]) {
        engine.dispatchGlobal('a');
        engine.unknownGlobal('a');
      }
      expect(ts.getGlobalUsage('2026-11-01T12:00:00Z')).toEqual(
        b.gate.getGlobalUsage('2026-11-01T12:00:00Z'),
      );
      expect(outcome(() => ts.reserveGlobal(proof('b'), time))).toEqual(
        outcome(() => b.gate.reserveGlobal(proof('b'), time)),
      );
      for (const engine of [ts, b.gate])
        engine.settleGlobal('a', {
          actualCostUsd: '0.123456789012345678',
          evidenceReference: 'mock:receipt',
        });
      expect(ts.getGlobalUsage(time)).toEqual(b.gate.getGlobalUsage(time));
      expect(
        outcome(() =>
          ts.settleGlobal('a', {
            actualCostUsd: '0.2',
            evidenceReference: 'other',
          }),
        ),
      ).toEqual(
        outcome(() =>
          b.gate.settleGlobal('a', {
            actualCostUsd: '0.2',
            evidenceReference: 'other',
          }),
        ),
      );
    } finally {
      ts.close();
      a.close();
      b.close();
    }
  });
  it('rolls back rejected reservations and injected persistence failures', () => {
    const f = fixture(),
      ts = new FinanceSession(f.path);
    try {
      ts.reserveGlobal(proof(), time);
      expect(() => ts.reserveGlobal(proof('b'), time)).toThrow(
        'GLOBAL_DAILY_BUDGET_EXCEEDED',
      );
      expect(
        ts.db.prepare('SELECT count(*) n FROM global_paid_operations').get()?.n,
      ).toBe(1);
      ts.db.exec(
        "CREATE TRIGGER fail_settle BEFORE UPDATE ON global_paid_operations WHEN NEW.state='COMPLETED' BEGIN SELECT RAISE(ABORT,'fixture'); END",
      );
      ts.dispatchGlobal('a');
      expect(() =>
        ts.settleGlobal('a', {
          actualCostUsd: '0.1',
          evidenceReference: 'mock:bill',
        }),
      ).toThrow('fixture');
      expect(
        ts.db
          .prepare('SELECT state,actual_usd FROM global_paid_operations')
          .get(),
      ).toEqual({ state: 'SUBMITTING', actual_usd: null });
    } finally {
      ts.close();
      f.close();
    }
  });
  it('preserves the monthly limit, timezone restriction and historical records', () => {
    const f = fixture(),
      ts = new FinanceSession(f.path);
    try {
      ts.configureGlobal({ dailyUsd: '1', monthlyUsd: '1', timeZone: 'UTC' });
      ts.reserveGlobal(proof('a', '0.7'), time);
      ts.dispatchGlobal('a');
      ts.settleGlobal('a', {
        actualCostUsd: '0.4',
        evidenceReference: 'mock:bill',
      });
      expect(() =>
        ts.reserveGlobal(proof('b', '0.4'), '2026-10-14T12:00:00Z'),
      ).toThrow('GLOBAL_MONTHLY_BUDGET_EXCEEDED');
      expect(() =>
        ts.configureGlobal({ timeZone: 'America/Sao_Paulo' }),
      ).toThrow('GLOBAL_POLICY_PERIOD_CONFLICT');
      expect(
        ts.reserveGlobal(proof('c', '0.4'), '2026-11-01T12:00:00Z').created,
      ).toBe(true);
      expect(ts.db.prepare('PRAGMA user_version').get()?.user_version).toBe(39);
    } finally {
      ts.close();
      f.close();
    }
  });
});
