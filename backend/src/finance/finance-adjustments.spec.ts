import { readFileSync } from 'node:fs';
import { FinanceSession } from './infrastructure/finance.session.js';
import { migrateFinance40 } from './infrastructure/finance-schema-migration.js';
import { ttsFinanceFixture } from '../../test/support/tts-finance-fixture.js';
import { time } from '../../test/support/finance-fixture.js';
import { raceFinance } from '../../test/support/finance-concurrency.js';
import {
  adjustmentHash,
  validateAdjustment,
} from './domain/cost-adjustment-contracts.js';
import { ttsHash } from './domain/tts-financial-contracts.js';
import { cost, proof } from '../../test/support/finance-fixture.js';
const sql = readFileSync(
  new URL(
    '../../../src/db/migrations/040_financial_adjustments.sql',
    import.meta.url,
  ),
  'utf8',
);
const { CostLedgerRepository: LegacyLedger } = await import(
  new URL('../../../src/cost-ledger-repository.js', import.meta.url).href
);
const { MediaDatabase } =
  await import('./../media/infrastructure/media-database.js');

describe('schema 40 TTS ledger adjustments', () => {
  it('rejects absent originals, invalid evidence, zero deltas, tampering and negative balances', () => {
    const f = ttsFinanceFixture();
    try {
      f.gate.approveTts(f.plan, f.approval);
      f.gate.beginTts(f.plan, time);
      f.gate.finishTts('tts_001', 'UNKNOWN');
      f.gate.accountTts('tts_001');
      migrateFinance40(f.legacy.db, sql, time);
      const session = new FinanceSession(f.path);
      try {
        session.recordTtsResult('tts_001', {
          audio: f.audio,
          billing: {
            actualCostUsd: '0.001',
            evidenceReference: 'fixture/invoice',
          },
        });
        const content = {
          schemaVersion: 'cost-adjustment/2.0.0' as const,
          adjustmentId: 'adjustment_001',
          originalCostEventId: 'tts_cost:tts_001',
          ttsOperationId: 'tts_001',
          deltaUnits: '-2060000000000000',
          currency: 'USD' as const,
          evidenceReference: 'fixture/invoice',
          evidenceHash: ttsHash({
            actualCostUsd: '0.001',
            evidenceReference: 'fixture/invoice',
          }),
          idempotencyKey: 'adjustment_key_001',
          createdAt: time,
        };
        const signed = (overrides: object = {}) => {
          const v = { ...content, ...overrides };
          return { ...v, contentHash: adjustmentHash(v) };
        };
        expect(() => session.registerTtsAdjustment(signed())).toThrow(
          expect.objectContaining({
            code: 'COST_ADJUSTMENT_RECONCILIATION_REQUIRED',
          }),
        );
        f.gate.finishTts('tts_001', 'COMPLETED', 'fixture/reconciliation');
        expect(() =>
          session.registerTtsAdjustment(signed({ deltaUnits: '0' })),
        ).toThrow(
          expect.objectContaining({ code: 'COST_ADJUSTMENT_INVALID_DELTA' }),
        );
        expect(() =>
          session.registerTtsAdjustment(
            signed({ deltaUnits: '-3060000000000001' }),
          ),
        ).toThrow(
          expect.objectContaining({ code: 'COST_ADJUSTMENT_NEGATIVE_BALANCE' }),
        );
        const raw = signed({ deltaUnits: '-3060000000000001' });
        expect(() =>
          session.db
            .prepare('INSERT INTO cost_adjustments VALUES(?,?,?,?,?,?,?,?,?,?)')
            .run(
              raw.adjustmentId,
              raw.originalCostEventId,
              raw.ttsOperationId,
              raw.deltaUnits,
              raw.currency,
              raw.evidenceReference,
              raw.evidenceHash,
              raw.idempotencyKey,
              raw.createdAt,
              raw.contentHash,
            ),
        ).toThrow('COST_ADJUSTMENT_NEGATIVE_BALANCE');
        expect(() =>
          session.registerTtsAdjustment(
            signed({ evidenceHash: 'f'.repeat(64) }),
          ),
        ).toThrow(
          expect.objectContaining({
            code: 'COST_ADJUSTMENT_EVIDENCE_MISMATCH',
          }),
        );
        expect(() =>
          session.registerTtsAdjustment(
            signed({ originalCostEventId: 'absent' }),
          ),
        ).toThrow(
          expect.objectContaining({ code: 'COST_ADJUSTMENT_SCOPE_INVALID' }),
        );
        expect(() =>
          validateAdjustment({ ...signed(), contentHash: '0'.repeat(64) }),
        ).toThrow(
          expect.objectContaining({ code: 'COST_ADJUSTMENT_HASH_MISMATCH' }),
        );
        const adjustment = session.registerTtsAdjustment(signed());
        expect(session.registerTtsAdjustment(signed())).toEqual(adjustment);
        expect(() =>
          session.registerTtsAdjustment(
            signed({ adjustmentId: 'other', idempotencyKey: 'other_key' }),
          ),
        ).toThrow(
          expect.objectContaining({
            code: 'COST_ADJUSTMENT_IDENTITY_CONFLICT',
          }),
        );
        expect(session.getTtsStatementV2('tts_001').adjustments).toHaveLength(
          1,
        );
      } finally {
        session.close();
      }
    } finally {
      f.close();
    }
  });
  it('keeps eighteen-place monetary precision and the original accounting period', () => {
    const f = ttsFinanceFixture();
    try {
      f.gate.approveTts(f.plan, f.approval);
      f.gate.beginTts(f.plan, time);
      f.gate.finishTts('tts_001', 'UNKNOWN');
      f.gate.accountTts('tts_001');
      migrateFinance40(f.legacy.db, sql, time);
      const session = new FinanceSession(f.path);
      try {
        session.recordTtsResult('tts_001', {
          audio: f.audio,
          billing: {
            actualCostUsd: '0.003060000000000001',
            evidenceReference: 'fixture/invoice',
          },
        });
        session.reconcileTts('tts_001', 'fixture/reconciliation');
        expect(
          session.getTtsStatementV2('tts_001').adjustments[0].deltaUnits,
        ).toBe('1');
        expect(session.getGlobalUsage(time).dailyUsd).toBe(
          '0.004060000000000001',
        );
        expect(session.getGlobalUsage('2026-11-01T12:00:00Z').monthlyUsd).toBe(
          '0',
        );
      } finally {
        session.close();
      }
    } finally {
      f.close();
    }
  });
  it.each(['daily', 'monthly'])(
    'uses net settled TTS and retains %s global limits',
    (period) => {
      const f = ttsFinanceFixture();
      try {
        f.gate.approveTts(f.plan, f.approval);
        f.gate.beginTts(f.plan, time);
        f.gate.finishTts('tts_001', 'UNKNOWN');
        f.gate.accountTts('tts_001');
        migrateFinance40(f.legacy.db, sql, time);
        const session = new FinanceSession(f.path);
        try {
          session.recordTtsResult('tts_001', {
            audio: f.audio,
            billing: {
              actualCostUsd: '0.001',
              evidenceReference: 'fixture/invoice',
            },
          });
          session.reconcileTts('tts_001', 'fixture/reconciliation');
          session.register(
            cost({
              costEventId: 'other_cost',
              pipelineRunId: 'run_002',
              amount: period === 'daily' ? '0.997' : '19.997',
              occurredAt: period === 'daily' ? time : '2026-10-01T12:00:00Z',
            }),
          );
          expect(() =>
            session.reserveGlobal(proof('f', '0.002'), time),
          ).toThrow(
            expect.objectContaining({
              code:
                period === 'daily'
                  ? 'GLOBAL_DAILY_BUDGET_EXCEEDED'
                  : 'GLOBAL_MONTHLY_BUDGET_EXCEEDED',
            }),
          );
          expect(session.getGlobalOperation('f')).toBeNull();
          expect(session.getGlobalUsage(time).policy).toMatchObject({
            daily_usd: '1',
            monthly_usd: '20',
          });
          expect(() => session.dispatchTts('tts_001', time)).toThrow();
        } finally {
          session.close();
        }
      } finally {
        f.close();
      }
    },
  );
  it('rolls back the entire reconciliation after a failed adjustment insert', () => {
    const f = ttsFinanceFixture();
    try {
      f.gate.approveTts(f.plan, f.approval);
      f.gate.beginTts(f.plan, time);
      f.gate.finishTts('tts_001', 'UNKNOWN');
      f.gate.accountTts('tts_001');
      migrateFinance40(f.legacy.db, sql, time);
      const session = new FinanceSession(f.path);
      try {
        session.recordTtsResult('tts_001', {
          audio: f.audio,
          billing: {
            actualCostUsd: '0.001',
            evidenceReference: 'fixture/invoice',
          },
        });
        const prepare = session.db.prepare.bind(session.db);
        const failure = vi
          .spyOn(session.db, 'prepare')
          .mockImplementation((q: any) => {
            if (q.includes('INSERT INTO cost_adjustments'))
              throw new Error('fixture adjustment failure');
            return prepare(q);
          });
        expect(() =>
          session.reconcileTts('tts_001', 'fixture/reconciliation'),
        ).toThrow('fixture adjustment failure');
        failure.mockRestore();
        expect(session.getTts('tts_001')!.state).toBe('UNKNOWN');
        expect(session.getTtsStatementV2('tts_001').adjustments).toHaveLength(
          0,
        );
        expect(session.db.isTransaction).toBe(false);
        expect(session.getGlobalUsage('2026-11-01T12:00:00Z').dailyUsd).toBe(
          '0.01',
        );
      } finally {
        session.close();
      }
    } finally {
      f.close();
    }
  });
  it.each(['0.006', '0.001', '0'])(
    'migrates immutable history, reconciles %s and reopens V1/V2 consumers',
    (actual) => {
      const f = ttsFinanceFixture();
      f.gate.approveTts(f.plan, f.approval);
      f.gate.beginTts(f.plan, time);
      f.gate.finishTts('tts_001', 'UNKNOWN');
      f.gate.accountTts('tts_001');
      const original = f.legacy.getCostEvent('tts_cost:tts_001');
      const history = f.legacy.db.prepare('SELECT * FROM cost_events').all();
      try {
        expect(migrateFinance40(f.legacy.db, sql, time)).toBe(40);
        expect(migrateFinance40(f.legacy.db, sql, time)).toBe(40);
        expect(f.legacy.db.prepare('SELECT * FROM cost_events').all()).toEqual(
          history,
        );
        const session = new FinanceSession(f.path);
        try {
          const unknown = session.getGlobalUsage('2026-11-01T12:00:00Z');
          expect(unknown.dailyUsd).toBe('0.01');
          session.recordTtsResult('tts_001', {
            audio: f.audio,
            billing: {
              actualCostUsd: actual,
              evidenceReference: 'fixture/invoice',
            },
          });
          session.reconcileTts('tts_001', 'fixture/reconciliation');
          const statement = session.getTtsStatementV2('tts_001');
          expect(statement.originalCost).toEqual(original);
          expect(statement.netCostUsd).toBe(actual);
          expect(statement.adjustments).toHaveLength(1);
          const count = session.db
            .prepare('SELECT count(*) n FROM cost_adjustments')
            .get().n;
          session.reconcileTts('tts_001', 'fixture/reconciliation');
          session.accountTts('tts_001');
          expect(
            session.db.prepare('SELECT count(*) n FROM cost_adjustments').get()
              .n,
          ).toBe(count);
          expect(session.getLedgerByPipelineRun('run_001').events).toEqual([
            original,
          ]);
          expect(
            session.getLedgerV2ByPipelineRun('run_001').totalsByCurrency,
          ).toEqual([{ currency: 'USD', amount: actual }]);
          expect(session.getGlobalUsage(time).dailyUsd).toBe(
            (
              { '0.006': '0.007', '0.001': '0.002', '0': '0.001' } as Record<
                string,
                string
              >
            )[actual],
          );
          expect(session.getUsage('camp_001').committedUsd).toBe(
            session.getGlobalUsage(time).dailyUsd,
          );
          expect(session.getGlobalUsage('2026-11-01T12:00:00Z').dailyUsd).toBe(
            '0',
          );
          expect(session.db.prepare('PRAGMA foreign_key_check').all()).toEqual(
            [],
          );
          expect(() =>
            session.db.prepare('UPDATE cost_events SET amount=?').run('1'),
          ).toThrow('IMMUTABLE_COST_EVENT');
          expect(() =>
            session.db.prepare('DELETE FROM cost_adjustments').run(),
          ).toThrow('IMMUTABLE_COST_ADJUSTMENT');
        } finally {
          session.close();
        }
        const reopened = new FinanceSession(f.path),
          legacy = new LegacyLedger(f.path, { readOnly: true }),
          media = new MediaDatabase(
            f.path,
            {
              get: () => {
                throw new Error('unused fixture run reader');
              },
            },
            { getScript: () => null },
            { readOnly: true },
          );
        try {
          expect(reopened.getTtsStatementV2('tts_001').netCostUsd).toBe(actual);
          expect(legacy.getCostEvent('tts_cost:tts_001')).toEqual(original);
        } finally {
          reopened.close();
          legacy.close();
          media.close();
        }
      } finally {
        f.close();
      }
    },
  );
  it('rolls back an interrupted migration without modifying history or accepting unknown versions', () => {
    const f = ttsFinanceFixture();
    try {
      expect(() =>
        migrateFinance40(f.legacy.db, sql + '\nTHIS IS NOT SQL;', time),
      ).toThrow();
      expect(
        f.legacy.db.prepare('PRAGMA user_version').get().user_version,
      ).toBe(39);
      expect(
        f.legacy.db
          .prepare("SELECT 1 FROM sqlite_master WHERE name='cost_adjustments'")
          .get(),
      ).toBeUndefined();
      f.legacy.db.exec('PRAGMA user_version=41');
      expect(() => new FinanceSession(f.path)).toThrow(
        'FINANCE_SCHEMA_VERSION_UNSUPPORTED',
      );
      expect(() => new LegacyLedger(f.path, { readOnly: true })).toThrow();
      expect(
        () =>
          new MediaDatabase(
            f.path,
            {
              get: () => {
                throw new Error('unused fixture run reader');
              },
            },
            { getScript: () => null },
          ),
      ).toThrow('MEDIA_SCHEMA_VERSION_UNSUPPORTED');
      expect(() => migrateFinance40(f.legacy.db, sql, time)).toThrow();
    } finally {
      f.close();
    }
  });
  it('serializes reconciliations and adjustment accounting across two SQLite sessions', async () => {
    const f = ttsFinanceFixture();
    try {
      f.gate.approveTts(f.plan, f.approval);
      f.gate.beginTts(f.plan, time);
      f.gate.finishTts('tts_001', 'UNKNOWN');
      f.gate.accountTts('tts_001');
      migrateFinance40(f.legacy.db, sql, time);
      const session = new FinanceSession(f.path);
      session.recordTtsResult('tts_001', {
        audio: f.audio,
        billing: {
          actualCostUsd: '0.001',
          evidenceReference: 'fixture/invoice',
        },
      });
      session.close();
      const results = await raceFinance(f.path, [
        { method: 'reconcileTts', args: ['tts_001', 'fixture/reconciliation'] },
        { method: 'reconcileTts', args: ['tts_001', 'fixture/reconciliation'] },
      ]);
      expect(results.every((r) => r.ok)).toBe(true);
      const reopened = new FinanceSession(f.path);
      try {
        expect(reopened.getTtsStatementV2('tts_001').adjustments).toHaveLength(
          1,
        );
      } finally {
        reopened.close();
      }
    } finally {
      f.close();
    }
  });
});
