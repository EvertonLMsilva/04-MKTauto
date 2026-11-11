import { historicalResidualContracts } from '../../../test/support/historical-residual-contracts.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import { FinanceService } from './application/finance.service.js';
import { ttsFinanceFixture } from '../../../test/support/tts-finance-fixture.js';
import { time, proof, cost } from '../../../test/support/finance-fixture.js';
import { financeFixture } from '../../../test/support/finance-fixture.js';
import { raceFinance } from '../../../test/support/finance-concurrency.js';
import {
  ttsRequest,
  ttsApproval,
  ttsHash,
  ttsAudio,
} from './domain/tts-financial-contracts.js';
const legacy = historicalResidualContracts('tts-finance-contracts');
const voiceLegacy = historicalResidualContracts('voice-generation-contracts');

describe('safe TTS financial cycle', () => {
  it('preserves successful and invalid wire contracts against JS', () => {
    const f = ttsFinanceFixture();
    const capture = (fn: () => unknown) => {
      try {
        return { value: fn() };
      } catch (e: any) {
        return { code: e.code, field: e.field ?? e.path };
      }
    };
    try {
      expect(ttsRequest(f.plan)).toEqual(legacy.ttsRequest(f.plan));
      expect(ttsApproval(f.request, f.approval)).toEqual(
        legacy.ttsApproval(f.request, f.approval),
      );
      expect(ttsAudio(f.audio)).toEqual(
        voiceLegacy.validateVoiceProviderOutput(f.audio),
      );
      for (const audio of [
        { ...f.audio, durationMilliseconds: 0 },
        { ...f.audio, storageReference: 'https://private.invalid/audio' },
        {
          ...f.audio,
          rights: { ...f.audio.rights, commercialUseAllowed: false },
        },
      ])
        expect(capture(() => ttsAudio(audio))).toEqual(
          capture(() => voiceLegacy.validateVoiceProviderOutput(audio)),
        );
      for (const mutation of [
        (p: any) => {
          p.estimatedCost.guaranteedMaximum = true;
        },
        (p: any) => {
          p.estimatedCost.amount = '0.1';
        },
        (p: any) => {
          p.operation.narration += ' changed';
        },
        (p: any) => {
          p.providerConfiguration.voice = 'alloy';
        },
        (p: any) => {
          p.audioConfiguration.config.originalGainDb = -61;
        },
      ]) {
        const plan = structuredClone(f.plan);
        mutation(plan);
        expect(capture(() => ttsRequest(plan))).toEqual(
          capture(() => legacy.ttsRequest(plan)),
        );
      }
    } finally {
      f.close();
    }
  });
  it.each(['daily', 'monthly'])(
    'rolls back a new TTS claim when the %s global balance is insufficient',
    (period) => {
      const f = ttsFinanceFixture(),
        service = new FinanceService({
          open: () => new FinanceSession(f.path),
        });
      try {
        service.register(
          cost({
            pipelineRunId: 'run_002',
            amount: period === 'daily' ? '0.99' : '20',
            occurredAt: period === 'daily' ? time : '2026-10-01T12:00:00Z',
          }),
        );
        service.approveTts(f.plan, f.approval);
        expect(() => service.beginTts(f.plan, time)).toThrow(
          expect.objectContaining({
            code:
              period === 'daily'
                ? 'GLOBAL_DAILY_BUDGET_EXCEEDED'
                : 'GLOBAL_MONTHLY_BUDGET_EXCEEDED',
          }),
        );
        expect(service.getTts('tts_001')).toBeNull();
        expect(service.getGlobalUsage(time).policy).toMatchObject({
          daily_usd: '1',
          monthly_usd: '20',
        });
      } finally {
        f.close();
      }
    },
  );
  it('requires pre-existing TTS tables without initializing or altering schema', () => {
    const f = financeFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      const schema = f.legacy.db
        .prepare('SELECT sql FROM sqlite_master ORDER BY name')
        .all();
      expect(() => service.getTts('tts_001')).toThrow(
        expect.objectContaining({ code: 'FINANCE_SCHEMA_REQUIRED' }),
      );
      expect(
        f.legacy.db
          .prepare('SELECT sql FROM sqlite_master ORDER BY name')
          .all(),
      ).toEqual(schema);
      expect(
        f.legacy.db.prepare('PRAGMA user_version').get().user_version,
      ).toBe(39);
    } finally {
      f.close();
    }
  });
  it('serializes identical claims between independent NestJS workers and replayed cost reconciliation', async () => {
    const f = ttsFinanceFixture(),
      service = new FinanceService({
        open: () => new FinanceSession(f.path),
      });
    try {
      service.approveTts(f.plan, f.approval);
      const claims = await raceFinance(f.path, [
        { method: 'beginTts', args: [f.plan, time] },
        { method: 'beginTts', args: [f.plan, time] },
      ]);
      expect(new Set(claims.map((r) => r.workerThreadId)).size).toBe(2);
      expect(claims.every((r) => r.workerThreadId > 0)).toBe(true);
      expect(claims.filter((r) => r.ok)).toHaveLength(1);
      expect(claims.find((r) => !r.ok)?.code).toBe(
        'TTS_RECONCILIATION_REQUIRED',
      );
      service.markTtsUnknown('tts_001');
      service.recordTtsResult('tts_001', {
        audio: f.audio,
        billing: {
          actualCostUsd: '0.004',
          evidenceReference: 'fixture/invoice',
        },
      });
      const reconciliations = await raceFinance(f.path, [
        {
          method: 'reconcileTts',
          args: ['tts_001', 'fixture/reconciliation'],
        },
        {
          method: 'reconcileTts',
          args: ['tts_001', 'fixture/reconciliation'],
        },
      ]);
      expect(new Set(reconciliations.map((r) => r.workerThreadId)).size).toBe(
        2,
      );
      expect(reconciliations.every((r) => r.ok)).toBe(true);
      expect(service.getLedgerByPipelineRun('run_001').events).toHaveLength(1);
      expect(service.getTts('tts_001')!.state).toBe('COMPLETED');
    } finally {
      f.close();
    }
  });
  it('blocks an unpaid transport and rolls back missing approval, scope and terminal transitions', async () => {
    const f = ttsFinanceFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      const altered = structuredClone(f.plan);
      altered.operation.pipelineRunId = 'run_002';
      altered.operationHash = ttsHash(altered.operation);
      expect(() =>
        service.approveTts(altered, {
          ...f.approval,
          requestHash: ttsHash(ttsRequest(altered)),
        }),
      ).toThrow(expect.objectContaining({ code: 'TTS_SCOPE_INVALID' }));
      expect(() =>
        service.approveTts(f.plan, {
          ...f.approval,
          acceptsUnboundedCost: false,
        }),
      ).toThrow(expect.objectContaining({ code: 'TTS_APPROVAL_INVALID' }));
      service.approveTts(f.plan, f.approval);
      expect(() => service.beginTts(f.plan, '2026-10-01T00:00:00Z')).toThrow(
        expect.objectContaining({ code: 'TTS_APPROVAL_INVALID' }),
      );
      expect(service.getTts('tts_001')).toBeNull();
      service.beginTts(f.plan, time);
      const transport = vi.fn(async () => ({ fixture: true }));
      await expect(
        service.executePaid(
          {
            ...proof('dispatch', '0.01'),
            kind: 'MANUAL_TTS_RESERVATION',
            sourceTtsId: 'tts_001',
            requestHash: f.approval.requestHash,
          },
          transport,
          time,
          { authorizationMode: 'MANUAL' },
        ),
      ).rejects.toMatchObject({ code: 'TTS_FINANCIAL_GUARANTEE_REQUIRED' });
      expect(transport).not.toHaveBeenCalled();
      expect(service.getGlobalOperation('dispatch')!.state).toBe('RESERVED');
      expect(() => service.accountTts('tts_001')).toThrow(
        expect.objectContaining({ code: 'TTS_STATE_INVALID' }),
      );
      service.markTtsUnknown('tts_001');
      service.recordTtsResult('tts_001', {
        audio: f.audio,
        billing: {
          actualCostUsd: '0.004',
          evidenceReference: 'fixture/invoice',
        },
      });
      service.reconcileTts('tts_001', 'fixture/reconciliation');
      expect(() => service.markTtsUnknown('tts_001')).toThrow(
        expect.objectContaining({ code: 'TTS_STATE_INVALID' }),
      );
      expect(() => service.dispatchTts('tts_001', time)).toThrow(
        expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }),
      );
    } finally {
      f.close();
    }
  });
  it('blocks a second operationId for the same intent and conflicting result evidence', () => {
    const f = ttsFinanceFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      service.approveTts(f.plan, f.approval);
      service.beginTts(f.plan, time);
      service.markTtsUnknown('tts_001');
      const other = { ...f.plan, operationId: 'tts_002' };
      service.approveTts(other, {
        ...f.approval,
        requestHash: ttsHash(ttsRequest(other)),
      });
      expect(() => service.beginTts(other, time)).toThrow(
        expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }),
      );
      const result = {
        audio: f.audio,
        billing: {
          actualCostUsd: '0.004',
          evidenceReference: 'fixture/invoice',
        },
      };
      expect(service.recordTtsResult('tts_001', result)).toEqual(
        service.recordTtsResult('tts_001', result),
      );
      expect(() =>
        service.recordTtsResult('tts_001', {
          ...result,
          billing: { ...result.billing, actualCostUsd: '0.005' },
        }),
      ).toThrow(expect.objectContaining({ code: 'TTS_IDENTITY_CONFLICT' }));
    } finally {
      f.close();
    }
  });
  it.each(['0', '0.02'])(
    'reconciles conclusive costs %s without duplicate entries and retains historical liability',
    (amount) => {
      const f = ttsFinanceFixture(),
        service = new FinanceService({
          open: () => new FinanceSession(f.path),
        });
      try {
        service.approveTts(f.plan, f.approval);
        service.beginTts(f.plan, time);
        service.markTtsUnknown('tts_001');
        service.recordTtsResult('tts_001', {
          audio: { ...f.audio, durationMilliseconds: 11000 },
          billing: {
            actualCostUsd: amount,
            evidenceReference: 'fixture/invoice',
          },
        });
        expect(
          service.reconcileTts('tts_001', 'fixture/reconciliation').state,
        ).toBe('REVIEW_REQUIRED');
        expect(service.accountTts('tts_001')).toEqual(
          amount === '0' ? null : service.get('tts_cost:tts_001'),
        );
        expect(service.getLedgerByPipelineRun('run_001').events).toHaveLength(
          amount === '0' ? 0 : 1,
        );
        if (amount === '0')
          expect(service.getGlobalUsage(time).dailyUsd).toBe('0.011');
        else
          expect(() => service.getGlobalUsage(time)).toThrow(
            expect.objectContaining({ code: 'GLOBAL_PRICE_CEILING_BREACHED' }),
          );
      } finally {
        f.close();
      }
    },
  );
  it('rolls back both state and reconciliation evidence after a failed ledger insert', () => {
    const f = ttsFinanceFixture(),
      session = new FinanceSession(f.path);
    try {
      session.approveTts(f.plan, f.approval);
      session.beginTts(f.plan, time);
      session.markTtsUnknown('tts_001');
      session.recordTtsResult('tts_001', {
        audio: f.audio,
        billing: {
          actualCostUsd: '0.004',
          evidenceReference: 'fixture/invoice',
        },
      });
      const prepare = session.db.prepare.bind(session.db);
      const failure = vi
        .spyOn(session.db, 'prepare')
        .mockImplementation((sql: any) => {
          if (sql.includes('INSERT INTO cost_events'))
            throw new Error('fixture ledger failure');
          return prepare(sql);
        });
      expect(() =>
        session.reconcileTts('tts_001', 'fixture/reconciliation'),
      ).toThrow('fixture ledger failure');
      failure.mockRestore();
      expect(session.getTts('tts_001')!.state).toBe('UNKNOWN');
      expect(session.getTts('tts_001')!.reconciliationReference).toBeNull();
      expect(session.get('tts_cost:tts_001')).toBeNull();
      expect(session.db.isTransaction).toBe(false);
      expect(
        session.reconcileTts('tts_001', 'fixture/reconciliation').state,
      ).toBe('COMPLETED');
    } finally {
      session.close();
      f.close();
    }
  });
  it('requires exact authorization and preserves historical approval/request hashes', () => {
    const f = ttsFinanceFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      expect(() => service.beginTts(f.plan, time)).toThrow(
        expect.objectContaining({ code: 'TTS_APPROVAL_REQUIRED' }),
      );
      expect(service.approveTts(f.plan, f.approval)).toEqual(
        f.gate.approveTts(f.plan, f.approval),
      );
      expect(service.approveTts(f.plan, f.approval)).toEqual(f.approval);
      expect(() =>
        service.approveTts(f.plan, { ...f.approval, approvedBy: 'other' }),
      ).toThrow(expect.objectContaining({ code: 'TTS_IDENTITY_CONFLICT' }));
      expect(service.beginTts(f.plan, time)).toEqual({
        created: true,
        operation: f.gate.getTts('tts_001'),
      });
      expect(service.getTts('tts_001')!.request).toEqual(
        legacy.ttsRequest(f.plan),
      );
      expect(() => service.beginTts(f.plan, time)).toThrow(
        expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }),
      );
      expect(service.getTts('absent')).toBeNull();
    } finally {
      f.close();
    }
  });
  it('reserves liability once and denies TTS and global manual dispatch without a real ceiling', () => {
    const f = ttsFinanceFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      service.approveTts(f.plan, f.approval);
      service.beginTts(f.plan, time);
      service.reserveGlobal(
        {
          ...proof('dispatch', '0.01'),
          kind: 'MANUAL_TTS_RESERVATION',
          sourceTtsId: 'tts_001',
          requestHash: f.approval.requestHash,
        },
        time,
        { authorizationMode: 'MANUAL' },
      );
      expect(service.getGlobalUsage(time).dailyUsd).toBe('0.011');
      expect(() => service.dispatchTts('tts_001', time)).toThrow(
        expect.objectContaining({ code: 'TTS_FINANCIAL_GUARANTEE_REQUIRED' }),
      );
      expect(() => service.dispatchGlobal('dispatch', time)).toThrow(
        expect.objectContaining({ code: 'TTS_FINANCIAL_GUARANTEE_REQUIRED' }),
      );
      expect(service.getGlobalOperation('dispatch')!.state).toBe('RESERVED');
      expect(service.getTts('tts_001')!.state).toBe('SUBMITTING');
    } finally {
      f.close();
    }
  });
  it('keeps unknown charges across calendar periods, blocks retry and accounts estimates once', () => {
    const f = ttsFinanceFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      service.approveTts(f.plan, f.approval);
      service.beginTts(f.plan, time);
      service.markTtsUnknown('tts_001', 'TTS_TIMEOUT');
      expect(service.markTtsUnknown('tts_001', 'TTS_TIMEOUT').state).toBe(
        'UNKNOWN',
      );
      expect(() => service.beginTts(f.plan, time)).toThrow(
        expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }),
      );
      expect(() => service.dispatchTts('tts_001', time)).toThrow(
        expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }),
      );
      const event = service.accountTts('tts_001');
      expect(service.accountTts('tts_001')).toEqual(event);
      expect(event!.amount).toBe('0.00306');
      expect(service.getGlobalUsage('2026-11-01T12:00:00Z').dailyUsd).toBe(
        '0.01',
      );
      expect(service.getLedgerByPipelineRun('run_001').events).toHaveLength(1);
      expect(() =>
        service.reconcileTts('tts_001', 'fixture/reconciliation'),
      ).toThrow(
        expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }),
      );
    } finally {
      f.close();
    }
  });
  it('records existing results, requires conclusive billing and reconciles exactly once', () => {
    const f = ttsFinanceFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      f.gate.approveTts(f.plan, f.approval);
      f.gate.beginTts(f.plan, time);
      f.gate.finishTts('tts_001', 'UNKNOWN');
      service.recordTtsResult('tts_001', {
        audio: f.audio,
        providerRequestId: 'provider_001',
      });
      expect(() =>
        service.reconcileTts('tts_001', 'fixture/reconciliation'),
      ).toThrow(
        expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }),
      );
      service.recordTtsResult('tts_001', {
        audio: f.audio,
        billing: {
          actualCostUsd: '0.004',
          evidenceReference: 'fixture/invoice',
        },
        providerRequestId: 'provider_001',
      });
      const final = service.reconcileTts('tts_001', 'fixture/reconciliation');
      expect(final.state).toBe('COMPLETED');
      expect(service.reconcileTts('tts_001', 'fixture/reconciliation')).toEqual(
        final,
      );
      expect(service.accountTts('tts_001')!.amount).toBe('0.004');
      expect(service.getLedgerByPipelineRun('run_001').events).toHaveLength(1);
      expect(service.beginTts(f.plan, time).created).toBe(false);
      expect(() =>
        service.reconcileTts('tts_001', 'different/evidence'),
      ).toThrow(expect.objectContaining({ code: 'TTS_IDENTITY_CONFLICT' }));
    } finally {
      f.close();
    }
  });
  it('reconciles an already dispatched historical operation, with no new provider calls or duplicate liability', () => {
    const f = ttsFinanceFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      // Imported historical dispatch state; this task never authorizes a paid transport.
      f.gate.approveTts(f.plan, f.approval);
      f.gate.beginTts(f.plan, time);
      f.gate.reserveGlobal(
        {
          ...proof('historic_dispatch', '0.01'),
          kind: 'MANUAL_TTS_RESERVATION',
          sourceTtsId: 'tts_001',
          requestHash: f.approval.requestHash,
        },
        time,
        { authorizationMode: 'MANUAL' },
      );
      f.legacy.db
        .prepare(
          "UPDATE global_paid_operations SET state='SUBMITTING' WHERE operation_id=?",
        )
        .run('historic_dispatch');
      service.markTtsUnknown('tts_001', 'TTS_TIMEOUT');
      expect(service.getGlobalOperation('historic_dispatch')!.state).toBe(
        'UNKNOWN',
      );
      service.recordTtsResult('tts_001', {
        audio: f.audio,
        billing: {
          actualCostUsd: '0.004',
          evidenceReference: 'fixture/invoice',
        },
      });
      // Historical recovery may finalize TTS before settling its global receipt.
      f.gate.finishTts('tts_001', 'COMPLETED', 'fixture/reconciliation');
      service.reconcileTts('tts_001', 'fixture/reconciliation');
      expect(service.getGlobalOperation('historic_dispatch')).toMatchObject({
        state: 'COMPLETED',
        actual_usd: '0.004',
        billing_reference: 'fixture/invoice',
      });
      expect(service.getGlobalUsage(time).dailyUsd).toBe('0.011');
      expect(service.getLedgerByPipelineRun('run_001').events).toHaveLength(1);
      expect(
        service.reconcileTts('tts_001', 'fixture/reconciliation').state,
      ).toBe('COMPLETED');
      expect(service.getGlobalOperation('historic_dispatch')!.state).toBe(
        'COMPLETED',
      );
      expect(() => service.dispatchGlobal('historic_dispatch', time)).toThrow(
        expect.objectContaining({
          code: 'GLOBAL_OPERATION_RECONCILIATION_REQUIRED',
        }),
      );
    } finally {
      f.close();
    }
  });
  it('rolls back reconciliation when immutable historical estimate conflicts with actual billing', () => {
    const f = ttsFinanceFixture(),
      service = new FinanceService({ open: () => new FinanceSession(f.path) });
    try {
      f.gate.approveTts(f.plan, f.approval);
      f.gate.beginTts(f.plan, time);
      f.gate.finishTts('tts_001', 'UNKNOWN');
      f.gate.accountTts('tts_001');
      service.recordTtsResult('tts_001', {
        audio: f.audio,
        billing: {
          actualCostUsd: '0.004',
          evidenceReference: 'fixture/invoice',
        },
      });
      expect(() =>
        service.reconcileTts('tts_001', 'fixture/reconciliation'),
      ).toThrow(expect.objectContaining({ code: 'COST_EVENT_ID_REUSED' }));
      expect(service.getTts('tts_001')!.state).toBe('UNKNOWN');
      expect(service.getTts('tts_001')!.reconciliationReference).toBeNull();
      expect(service.get('tts_cost:tts_001')!.amount).toBe('0.00306');
    } finally {
      f.close();
    }
  });
});
