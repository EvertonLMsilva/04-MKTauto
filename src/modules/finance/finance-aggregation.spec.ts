import { historicalResidualContracts } from '../../../test/support/historical-residual-contracts.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import {
  campaignFinanceFixture,
  cost,
  proof,
  time,
  video,
  tts,
  telemetry,
} from '../../../test/support/finance-fixture.js';
import {
  SqliteVideoFinancialCommitmentsReader,
  SqliteTtsFinancialCommitmentsReader,
  SqliteCampaignReferenceReader,
  SqliteFinancialAttributionReader,
} from './infrastructure/financial-readers.sqlite.js';
import {
  validateCostEvent,
  createCostLedger,
} from './domain/cost-event-contracts.js';
const contracts = historicalResidualContracts('cost-event-contracts');
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
describe('Finance historical aggregation JS/TS', () => {
  it('preserves immutable campaign policies and exact financial approvals', () => {
    const f = campaignFinanceFixture(false),
      ts = new FinanceSession(f.path);
    try {
      expect(ts.configureCampaign('camp_001', 1)).toEqual(
        f.gate.configureCampaign('camp_002', 1),
      );
      expect(ts.configureCampaign('camp_001', 1)).toEqual(
        f.gate.configureCampaign('camp_001', 1),
      );
      const changed = {
        totalUsd: '2',
        perGenerationUsd: '0.33',
        maxPaidSubmissions: 3,
        plannedOriginals: 3,
      };
      expect(
        outcome(() => ts.configureCampaign('camp_001', 1, changed)),
      ).toEqual(
        outcome(() => f.gate.configureCampaign('camp_001', 1, changed)),
      );
      video(f, 1, 'RESERVED', null, 'OFFICIAL_ESTIMATE');
      const op = ts.getOperation('video_001'),
        approval = {
          approvedAt: time,
          approvedBy: 'human',
          approvalReference: 'fixture:approval',
          acceptsUnboundedCost: true,
        };
      expect(ts.approveEstimate(op.request, op.ceiling, approval)).toEqual(
        f.gate.approveEstimate(op.request, op.ceiling, approval),
      );
      expect(
        outcome(() =>
          ts.approveEstimate(op.request, op.ceiling, {
            ...approval,
            approvedBy: 'other',
          }),
        ),
      ).toEqual(
        outcome(() =>
          f.gate.approveEstimate(op.request, op.ceiling, {
            ...approval,
            approvedBy: 'other',
          }),
        ),
      );
    } finally {
      ts.close();
      f.close();
    }
  });
  it('combines two campaigns, telemetry, Video, TTS, matching identities and manual TTS overlap', () => {
    const f = campaignFinanceFixture(),
      ts = new FinanceSession(f.path);
    try {
      const g = f.gate,
        r = f.legacy;
      g.reserveGlobal(
        {
          ...proof('a', '0.2'),
          pipelineRunId: 'run_001',
          bodyHash: 'b'.repeat(64),
          telemetryOccurredAt: time,
        },
        time,
      );
      g.dispatchGlobal('a');
      g.settleGlobal('a', {
        actualCostUsd: '0.15',
        evidenceReference: 'fixture:bill',
      });
      g.reserveGlobal({ ...proof('b', '0.1'), pipelineRunId: 'run_002' }, time);
      g.dispatchGlobal('b');
      g.settleGlobal('b', {
        actualCostUsd: '0.05',
        evidenceReference: 'fixture:bill',
      });
      r.registerCostEvent(cost({ costEventId: 'cost_ai', amount: '0.15' }));
      telemetry(f, 'cost_ai', 'b'.repeat(64), '0.15');
      video(f, 1);
      r.registerCostEvent(
        cost({
          costEventId: 'video_cost:video_001',
          amount: '0.12',
          origin: 'fake_video',
        }),
      );
      video(f, 2, 'UNKNOWN', null);
      tts(f, 1, 'SUBMITTING');
      r.registerCostEvent(
        cost({
          costEventId: 'tts_cost:tts_001',
          amount: '0.00306',
          origin: 'openai',
        }),
      );
      g.reserveGlobal(
        {
          ...proof('c', '0.01'),
          kind: 'MANUAL_TTS_RESERVATION',
          sourceTtsId: 'tts_001',
        },
        time,
        { authorizationMode: 'MANUAL' },
      );
      tts(f, 2, 'UNKNOWN');
      r.registerCostEvent(
        cost({
          costEventId: 'tts_cost:tts_002',
          pipelineRunId: 'run_002',
          amount: '0.00306',
          origin: 'manual_invoice',
        }),
      );
      r.registerCostEvent(cost());
      expect(ts.getGlobalUsage(time)).toEqual(g.getGlobalUsage(time));
      expect(ts.getGlobalUsage(time).dailyUsd).toBe('0.72306');
      for (const id of ['camp_001', 'camp_002'])
        expect(ts.getUsage(id)).toEqual(g.getUsage(id));
      const later = '2026-11-01T12:00:00Z';
      expect(ts.getGlobalUsage(later)).toEqual(g.getGlobalUsage(later));
      expect(ts.getGlobalUsage(later).dailyUsd).toBe('0.23');
      expect(
        outcome(() =>
          ts.reserveGlobal(
            { ...proof('d', '0.1'), pipelineRunId: 'run_002' },
            time,
          ),
        ),
      ).toEqual(
        outcome(() =>
          g.reserveGlobal(
            { ...proof('d', '0.1'), pipelineRunId: 'run_002' },
            time,
          ),
        ),
      );
    } finally {
      ts.close();
      f.close();
    }
  });
  it.each(['OFFICIAL_ESTIMATE', 'ENFORCED_MAXIMUM'])(
    'preserves %s authorization, hashes and receipts',
    (kind) => {
      const f = campaignFinanceFixture(),
        ts = new FinanceSession(f.path);
      try {
        video(f, 1, 'COMPLETED', null, kind);
        f.gate.reconcileCost('video_001', {
          providerRequestId: 'provider_001',
          actualCostUsd: '0.13',
          evidenceReference: 'fixture:bill',
        });
        f.legacy.registerCostEvent(
          cost({
            costEventId: 'video_cost:video_001',
            origin: 'fake_video',
            amount: '0.13',
          }),
        );
        expect(ts.getGlobalUsage(time)).toEqual(f.gate.getGlobalUsage(time));
        expect(ts.getUsage('camp_001')).toEqual(f.gate.getUsage('camp_001'));
        expect(ts.getOperation('video_001')).toEqual(
          f.gate.getOperation('video_001'),
        );
        expect(ts.getLedgerByPipelineRun('run_001')).toEqual(
          f.legacy.getCostLedgerByPipelineRun('run_001'),
        );
      } finally {
        ts.close();
        f.close();
      }
    },
  );
  it.each(['RESERVED', 'SUBMITTED', 'FAILED', 'CANCELLED'])(
    'preserves %s video liability',
    (state) => {
      const f = campaignFinanceFixture(),
        ts = new FinanceSession(f.path);
      try {
        video(f, 1, state, state === 'FAILED' ? '0.1' : null);
        for (const date of [time, '2026-11-01T12:00:00Z'])
          expect(ts.getGlobalUsage(date)).toEqual(f.gate.getGlobalUsage(date));
        expect(ts.getUsage('camp_001')).toEqual(f.gate.getUsage('camp_001'));
      } finally {
        ts.close();
        f.close();
      }
    },
  );
  it.each(['COMPLETED', 'REVIEW_REQUIRED', 'UNKNOWN', 'SUBMITTING'])(
    'preserves %s TTS with evidenced costs',
    (state) => {
      const f = campaignFinanceFixture(),
        ts = new FinanceSession(f.path);
      try {
        tts(f, 1, state, '0.005');
        f.legacy.registerCostEvent(
          cost({
            costEventId: 'tts_cost:tts_001',
            amount: '0.005',
            origin: 'openai',
          }),
        );
        expect(ts.getGlobalUsage(time)).toEqual(f.gate.getGlobalUsage(time));
        expect(ts.getGlobalUsage(time).dailyUsd).toBe('0.01');
        expect(ts.getUsage('camp_001')).toEqual(f.gate.getUsage('camp_001'));
      } finally {
        ts.close();
        f.close();
      }
    },
  );
  it('fails identically on ceiling breaches, unsupported currency and future dates', () => {
    const f = campaignFinanceFixture(),
      ts = new FinanceSession(f.path);
    try {
      tts(f, 1, 'COMPLETED', '0.02');
      expect(outcome(() => ts.getGlobalUsage(time))).toEqual(
        outcome(() => f.gate.getGlobalUsage(time)),
      );
      expect(ts.getUsage('camp_001')).toEqual(f.gate.getUsage('camp_001'));
      expect(ts.getUsage('camp_001').hasCeilingBreach).toBe(true);
    } finally {
      ts.close();
      f.close();
    }
    for (const value of [
      { currency: 'BRL' },
      { occurredAt: '2027-01-01T00:00:00Z' },
    ]) {
      const f = campaignFinanceFixture(),
        ts = new FinanceSession(f.path);
      try {
        f.legacy.registerCostEvent(cost(value));
        expect(outcome(() => ts.getGlobalUsage(time))).toEqual(
          outcome(() => f.gate.getGlobalUsage(time)),
        );
      } finally {
        ts.close();
        f.close();
      }
    }
  });
  it('preserves cost validation, exact totals, history and replay', () => {
    const f = campaignFinanceFixture(),
      ts = new FinanceSession(f.path);
    try {
      for (const change of [
        {},
        { amount: '000.1234567890123456780' },
        { amount: '0' },
        { amount: 0.1 },
        { extra: true },
        { recordedAt: 'invalid' },
        { currency: 'usd' },
        { projectVersion: 0 },
      ])
        expect(outcome(() => validateCostEvent(cost(change)))).toEqual(
          outcome(() => contracts.validateCostEvent(cost(change))),
        );
      const v = cost({ amount: '0.123456789012345678' });
      expect(ts.register(v)).toEqual(f.legacy.registerCostEvent(v));
      expect(ts.register(v)).toEqual(f.legacy.registerCostEvent(v));
      expect(outcome(() => ts.register({ ...v, amount: '0.1' }))).toEqual(
        outcome(() => f.legacy.registerCostEvent({ ...v, amount: '0.1' })),
      );
      expect(ts.get('cost_001')).toEqual(f.legacy.getCostEvent('cost_001'));
      expect(ts.listByPipelineRun('run_001')).toEqual(
        f.legacy.listCostEventsByPipelineRun('run_001'),
      );
      expect(ts.getLedgerByPipelineRun('run_001')).toEqual(
        f.legacy.getCostLedgerByPipelineRun('run_001'),
      );
      const input = {
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        events: [v],
      };
      expect(createCostLedger(input)).toEqual(
        contracts.createCostLedger(input),
      );
    } finally {
      ts.close();
      f.close();
    }
  });
  it('uses the same active transaction for all historical readers', () => {
    const f = campaignFinanceFixture(),
      ts = new FinanceSession(f.path),
      spies: any[] = [];
    try {
      tts(f, 1);
      video(f, 1);
      let calls = 0;
      for (const [proto, method] of [
        [SqliteVideoFinancialCommitmentsReader.prototype, 'listActive'],
        [SqliteTtsFinancialCommitmentsReader.prototype, 'list'],
        [SqliteCampaignReferenceReader.prototype, 'listRuns'],
        [SqliteFinancialAttributionReader.prototype, 'costEvents'],
      ] as const) {
        const original = (proto as any)[method];
        spies.push(
          vi.spyOn(proto as any, method).mockImplementation(function (
            this: any,
            ...args: any[]
          ) {
            expect(this.db).toBe(ts.db);
            expect(this.db.isTransaction).toBe(true);
            calls++;
            return original.apply(this, args);
          }),
        );
      }
      ts.getGlobalUsage(time);
      ts.getUsage('camp_001');
      expect(calls).toBeGreaterThan(3);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
      ts.close();
      f.close();
    }
  });
});
