import { projectProfitability } from './domain/commercial-measurement-profitability.js';
import { validateObservation } from './domain/commercial-measurement.js';
import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { FinanceSession } from '../finance/infrastructure/finance.session.js';
import { ttsHash } from '../finance/domain/tts-financial-contracts.js';
import { adjustmentHash } from '../finance/domain/cost-adjustment-contracts.js';

const observed = {
  actor: 'fixture_operator',
  sourceReference: 'fixture:fictitious-commission-report',
  periodStart: '2026-11-01T00:00:00Z',
  periodEnd: '2026-11-02T00:00:00Z',
  attribution: 'DIRECT_PUBLICATION',
  commissionStatus: 'CONFIRMED',
  commissions: { status: 'KNOWN', amount: '1', currency: 'USD' },
};
test('no imported report or measured cost stays unknown rather than zero', () => {
  const p = projectProfitability();
  expect(p.reportedCommissionStatus).toBe('UNKNOWN');
  expect(p.confirmedCommission.status).toBe('UNKNOWN');
  expect(p.reconciledCostsByCurrency).toEqual([]);
  expect(p.partialNetResult.status).toBe('UNKNOWN');
  expect(p.pendingEvidence).toContain('FINANCE_UNAVAILABLE');
});
test.each(['UNKNOWN', 'EXPECTED', 'CANCELLED', undefined])(
  'reported %s commission never becomes confirmed',
  (commissionStatus) => {
    const p = projectProfitability({ ...observed, commissionStatus } as any);
    expect(p.confirmedCommission.status).toBe('UNKNOWN');
    expect(p.netProfit.status).toBe('UNKNOWN');
    expect(p.roi.status).toBe('UNKNOWN');
  },
);
test.each(['CAMPAIGN_REPORTED', 'UNATTRIBUTED'])(
  'shared-link %s report does not confirm individual income',
  (attribution) => {
    const p = projectProfitability({ ...observed, attribution } as any);
    expect(p.confirmedCommission.status).toBe('UNKNOWN');
    expect(p.pendingEvidence).toContain(
      'DIRECT_COMMISSION_ATTRIBUTION_REQUIRED',
    );
  },
);
test('omitted status preserves the historical normalized input and hash contract', () => {
  const { commissionStatus: _status, ...legacy } = observed;
  expect(validateObservation(legacy, 'fixture_publication')).not.toHaveProperty(
    'commissionStatus',
  );
});
test.each(['INVALID', null, 1])(
  'rejects invalid commission state %s',
  (commissionStatus) => {
    expect(() =>
      validateObservation(
        { ...observed, commissionStatus },
        'fixture_publication',
      ),
    ).toThrow();
  },
);
test('confirmation requires a known amount; cancellation preserves the reported amount', () => {
  expect(() =>
    validateObservation(
      {
        ...observed,
        commissions: { status: 'UNKNOWN', reason: 'NOT_REPORTED' },
      },
      'fixture_publication',
    ),
  ).toThrow();
  expect(
    validateObservation(
      { ...observed, commissionStatus: 'CANCELLED' },
      'fixture_publication',
    ).commissions,
  ).toEqual(observed.commissions);
});

test.each(['0', '0.001000000000000001'])(
  'SQLite Finance evidence supports reconciled %s cost without Commercial ledger writes',
  (amount) => {
    const f = p2EditorialFixture();
    let finance: FinanceSession | undefined;
    try {
      finance = new FinanceSession(f.database);
      finance.configureCampaign('camp_001', 1);
      // Minimal persisted reader fixtures, not TTS dispatch or operator approvals.
      const request = {
        operationId: 'fixture_tts',
        campaignId: 'camp_001',
        operation: { pipelineRunId: 'run_001' },
      };
      const requestHash = ttsHash(request);
      const at = '2026-11-10T12:00:00Z';
      f.base.db
        .prepare('INSERT INTO tts_financial_approvals VALUES(?,?,?,?)')
        .run(
          'fixture_tts',
          requestHash,
          JSON.stringify(request),
          JSON.stringify({ source: 'FICTITIOUS_TEST_FIXTURE' }),
        );
      f.base.db
        .prepare('INSERT INTO tts_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          'fixture_tts',
          requestHash,
          requestHash,
          'camp_001',
          JSON.stringify(request),
          'UNKNOWN',
          at,
          null,
          null,
          null,
          null,
          null,
        );
      finance.register({
        schemaVersion: 'cost-event/1.0.0',
        costEventId: 'tts_cost:fixture_tts',
        category: 'voice_cost',
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        contentIdentity: null,
        artifactId: null,
        amount: '0.00306',
        currency: 'USD',
        occurredAt: at,
        recordedAt: at,
        origin: 'openai',
        attributionRuleVersion: 'fixture/1.0.0',
      });
      const provisional = projectProfitability(
        observed as any,
        finance.getLedgerV2ByPipelineRun('run_001'),
      );
      expect(provisional.reconciledCostsByCurrency).toEqual([]);
      expect(provisional.partialNetResult.status).toBe('UNKNOWN');
      expect(provisional.costEvidence[0].status).toBe('UNRECONCILED');
      const billing = {
        actualCostUsd: amount,
        evidenceReference: 'fixture:fictitious-invoice',
      };
      f.base.db
        .prepare(
          'UPDATE tts_operations SET state=?, billing_json=?, reconciliation_reference=? WHERE operation_id=?',
        )
        .run(
          'COMPLETED',
          JSON.stringify(billing),
          'fixture:fictitious-reconciliation',
          'fixture_tts',
        );
      const [whole, fraction = ''] = amount.split('.');
      const delta =
        BigInt(whole) * 10n ** 18n +
        BigInt(fraction.padEnd(18, '0')) -
        3060000000000000n;
      const adjustment = {
        schemaVersion: 'cost-adjustment/2.0.0' as const,
        adjustmentId: 'fixture_adjustment',
        originalCostEventId: 'tts_cost:fixture_tts',
        ttsOperationId: 'fixture_tts',
        deltaUnits: String(delta),
        currency: 'USD' as const,
        evidenceReference: billing.evidenceReference,
        evidenceHash: ttsHash(billing),
        idempotencyKey: 'fixture_adjustment',
        createdAt: at,
      };
      finance.registerTtsAdjustment({
        ...adjustment,
        contentHash: adjustmentHash(adjustment),
      });
      const ledger = finance.getLedgerV2ByPipelineRun('run_001');
      const before = finance.db.prepare('SELECT * FROM cost_adjustments').all();
      const p = projectProfitability(observed as any, ledger);
      expect(p.reconciledCostsByCurrency).toEqual([
        { currency: 'USD', amount },
      ]);
      expect(p.partialNetResult).toEqual({
        status: 'KNOWN',
        currency: 'USD',
        amount: amount === '0' ? '1' : '0.998999999999999999',
      });
      expect(p.status).toBe('PARTIAL');
      expect(p.netProfit.status).toBe('UNKNOWN');
      expect(p.margin.status).toBe('UNKNOWN');
      expect(p.roi.status).toBe('UNKNOWN');
      expect(p.costEvidence[0].evidenceReference).toBe(
        'fixture:fictitious-invoice',
      );
      expect(
        projectProfitability(
          {
            ...observed,
            commissions: { status: 'KNOWN', amount: '1', currency: 'BRL' },
          } as any,
          ledger,
        ).partialNetResult.status,
      ).toBe('UNKNOWN');
      finance.close();
      finance = new FinanceSession(f.database);
      expect(
        projectProfitability(
          observed as any,
          finance.getLedgerV2ByPipelineRun('run_001'),
        ),
      ).toEqual(p);
      expect(
        finance.db.prepare('SELECT * FROM cost_adjustments').all(),
      ).toEqual(before);
    } finally {
      finance?.close();
      f.cleanup();
    }
  },
);
