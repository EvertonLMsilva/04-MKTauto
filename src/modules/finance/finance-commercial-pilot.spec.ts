import { falFixture } from '../../../test/support/fal-fixture.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import { FinanceService } from './application/finance.service.js';
import { SqliteAffiliateRepository } from '../affiliate/infrastructure/sqlite-affiliate.repository.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';

const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
const time = '2026-10-13T12:00:00Z';
const later = '2026-11-01T12:00:00Z';
const inputHash = 'f'.repeat(64);
function proof(id = 'a', amount = '0.6', run = 'run_001') {
  return {
    operationId: id,
    requestHash: id.repeat(64),
    provider: 'openai',
    kind: 'ENFORCED_MAXIMUM',
    includesAllCharges: true,
    currency: 'USD',
    maximumAmount: amount,
    evidenceReference: 'fixture:enforced-maximum',
    expiresAt: '2026-10-14T12:00:00Z',
    pipelineRunId: run,
    bodyHash: inputHash,
    telemetryOccurredAt: time,
  };
}
function fixture() {
  const f = falFixture();
  const catalog = new SqliteAffiliateRepository(f.database);
  try {
    catalog.registerProduct(fixtures.product(), 'fixture_product');
    const bindings = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.database),
    );
    for (let i = 1; i <= 2; i++) {
      const campaignId = `camp_00${i}`;
      catalog.registerCampaign(
        fixtures.campaign({ campaignId }),
        `fixture_campaign_${i}`,
        true,
      );
      catalog.createBriefing(
        { briefingId: `brief_00${i}`, campaignId, campaignRevision: 1 },
        `fixture_brief_${i}`,
        true,
      );
      fixtures.startRun(f.base, `run_00${i}`);
      bindings.bindRun(
        { pipelineRunId: `run_00${i}`, briefingId: `brief_00${i}` },
        `fixture_bind_${i}`,
      );
    }
  } finally {
    catalog.close();
  }
  const finance = new FinanceService({
    open: () => new FinanceSession(f.database),
  });
  finance.configureGlobal({});
  finance.configureCampaign('camp_001', 1);
  finance.configureCampaign('camp_002', 1);
  return { ...f, finance };
}
function observe(f: ReturnType<typeof fixture>, id: string, amount: string) {
  f.finance.register({
    schemaVersion: 'cost-event/1.0.0',
    costEventId: id,
    category: 'ai_cost',
    pipelineRunId: 'run_001',
    projectId: 'project_001',
    projectVersion: 1,
    contentIdentity: null,
    artifactId: null,
    amount,
    currency: 'USD',
    occurredAt: time,
    origin: 'openai',
    attributionRuleVersion: 'fixture/1.0.0',
    recordedAt: time,
  });
  // Synthetic provider observations only, confined to the disposable fixture.
  f.base.db
    .prepare(
      "INSERT INTO ai_call_telemetry (ai_call_id,logical_call_id,schema_version,identity_hash,request_hash,pipeline_run_id,project_id,project_version,cost_event_id,provider,model,task_type,prompt_version,cost_amount,currency,cost_origin,occurred_at,input_hash,outcome,failure_code,recorded_at) VALUES(?,?,'ai-call-telemetry/1.0.0',?,?,'run_001','project_001',1,?,'openai','fake','script_generation','fixture/1.0.0',?,'USD','PROVIDER',?,?,'FAILURE','FIXTURE',?)",
    )
    .run(
      `call_${id}`,
      `logical_${id}`,
      'a'.repeat(64),
      'a'.repeat(64),
      id,
      amount,
      time,
      inputHash,
      time,
    );
}

describe('Commercial pilot Finance acceptance, isolated SQLite and fake transport', () => {
  it('checks expiry against the current clock when dispatch time is omitted', () => {
    const f = fixture();
    try {
      f.finance.reserveGlobal(proof(), time);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
      expect(() => f.finance.dispatchGlobal('a')).toThrow(
        'GLOBAL_PRICE_UNPROVEN',
      );
      expect(f.finance.getGlobalOperation('a')?.state).toBe('RESERVED');
    } finally {
      vi.useRealTimers();
      f.cleanup();
    }
  });

  it('aggregates distinct observed events exactly once in global and campaign budgets', () => {
    const f = fixture();
    try {
      f.finance.reserveGlobal(proof(), time);
      f.finance.dispatchGlobal('a', time);
      observe(f, 'cost_a', '0.2');
      observe(f, 'cost_b', '0.300000000000000001');
      expect(f.finance.getGlobalReadiness(time).daily).toMatchObject({
        committedUsd: '0.6',
        recordedCostUsd: '0.500000000000000001',
        reservedLiabilityUsd: '0.099999999999999999',
      });
      expect(f.finance.getUsage('camp_001').committedUsd).toBe('0.6');
      expect(
        f.finance.getLedgerV2ByPipelineRun('run_001').totalsByCurrency,
      ).toEqual([{ currency: 'USD', amount: '0.500000000000000001' }]);
      expect(
        f.finance.getGlobalReadiness(time).operations[0].reconciliationRequired,
      ).toBe(true);
      f.finance.settleGlobal('a', {
        actualCostUsd: '0.500000000000000001',
        evidenceReference: 'fixture:bill',
      });
      expect(f.finance.getRunReadiness('run_001').status).toBe('RECONCILED');
      expect(f.finance.getGlobalReadiness(time).daily.recordedCostUsd).toBe(
        '0.500000000000000001',
      );
      expect(f.finance.getUsage('camp_001').committedUsd).toBe('0.6');
      expect(f.finance.getUsage('camp_002').committedUsd).toBe('0');
      const closure = f.finance.getRunCostCoverage('run_001', undefined, time);
      expect(closure.coverage.coverageStatus).toBe('COVERAGE_UNVERIFIED');
      expect(closure.financial.financiallyClosed).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  it('detects a ceiling breach hidden by multiple smaller observed events', () => {
    const f = fixture();
    try {
      f.finance.reserveGlobal(proof(), time);
      f.finance.dispatchGlobal('a', time);
      observe(f, 'cost_a', '0.400000000000000001');
      observe(f, 'cost_b', '0.4');
      const readiness = f.finance.getGlobalReadiness(time);
      expect(readiness.daily.committedUsd).toBe('0.800000000000000001');
      expect(readiness.daily.recordedCostUsd).toBe('0.800000000000000001');
      expect(readiness.reasons).toContain('PRICE_CEILING_BREACHED');
      expect(f.finance.getUsage('camp_001')).toMatchObject({
        committedUsd: '0.800000000000000001',
        hasCeilingBreach: true,
      });
      expect(() => f.finance.getGlobalUsage(time)).toThrow(
        'GLOBAL_PRICE_CEILING_BREACHED',
      );
      expect(() =>
        f.finance.reserveGlobal(proof('b', '0.1', 'run_002'), time),
      ).toThrow('GLOBAL_PRICE_CEILING_BREACHED');
      expect(f.finance.getGlobalOperation('b')).toBeNull();
    } finally {
      f.cleanup();
    }
  });

  it('retains unbilled successful consumption across restart and period rollover', async () => {
    const f = fixture();
    try {
      const transport = vi.fn(async () => ({ fixture: 'response' }));
      await f.finance.executePaid(proof(), transport, time);
      const restarted = new FinanceService({
        open: () => new FinanceSession(f.database),
      });
      await restarted.executePaid(proof(), transport, later);
      expect(transport).toHaveBeenCalledTimes(1);
      const closure = restarted.getPilotCostClosure('run_001', later);
      expect(closure.budget.daily.committedUsd).toBe('0.6');
      expect(closure.budget.monthly.committedUsd).toBe('0.6');
      expect(closure.budget.operations[0].reconciliationRequired).toBe(true);
      expect(closure.run.unknownCosts).toEqual(['GLOBAL:a']);
      expect(closure.financiallyClosed).toBe(false);
      expect(closure.totalRunCost).toBeNull();
      expect(restarted.getUsage('camp_001').hasUnknown).toBe(true);
      expect(() =>
        restarted.reserveGlobal(
          { ...proof('c', '0.1'), expiresAt: '2026-12-01T00:00:00Z' },
          later,
        ),
      ).toThrow('VIDEO_GENERATION_RECONCILIATION_REQUIRED');
      expect(() =>
        restarted.reserveGlobal(
          {
            ...proof('b', '0.5', 'run_002'),
            expiresAt: '2026-12-01T00:00:00Z',
          },
          later,
        ),
      ).toThrow('GLOBAL_DAILY_BUDGET_EXCEEDED');
      restarted.settleGlobal('a', {
        actualCostUsd: '0',
        evidenceReference: 'fixture:confirmed-no-charge',
      });
      expect(restarted.getGlobalReadiness(later).daily.committedUsd).toBe('0');
      expect(restarted.getUsage('camp_001').hasUnknown).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  it('keeps observed consumption pending until billing, even after successful transport', async () => {
    const f = fixture();
    try {
      await f.finance.executePaid(
        proof(),
        async () => ({ fixture: true }),
        time,
      );
      observe(f, 'cost_a', '0.2');
      observe(f, 'cost_b', '0.1');
      const r = f.finance.getGlobalReadiness(later);
      expect(r.daily).toMatchObject({
        committedUsd: '0.6',
        recordedCostUsd: '0.3',
        reservedLiabilityUsd: '0.3',
      });
      expect(r.reasons).toContain('RECONCILIATION_REQUIRED');
      expect(f.finance.getUsage('camp_001').hasUnknown).toBe(true);
      expect(f.finance.getRunReadiness('run_001').unknownCosts).toEqual([
        'GLOBAL:a',
      ]);
      f.finance.settleGlobal('a', {
        actualCostUsd: '0.3',
        evidenceReference: 'fixture:bill',
      });
      expect(f.finance.getGlobalReadiness(later).daily.committedUsd).toBe('0');
      expect(f.finance.getRunReadiness('run_001').status).toBe('RECONCILED');
    } finally {
      f.cleanup();
    }
  });

  it('does not release uncertain consumption when a billing write rolls back', async () => {
    const f = fixture();
    try {
      await f.finance.executePaid(
        proof(),
        async () => ({ fixture: true }),
        time,
      );
      f.base.db.exec(
        "CREATE TRIGGER reject_billing BEFORE UPDATE ON global_paid_operations WHEN NEW.actual_usd IS NOT NULL BEGIN SELECT RAISE(ABORT,'fixture billing failure'); END",
      );
      expect(() =>
        f.finance.settleGlobal('a', {
          actualCostUsd: '0.2',
          evidenceReference: 'fixture:bill',
        }),
      ).toThrow('fixture billing failure');
      expect(f.finance.getGlobalOperation('a')).toMatchObject({
        state: 'COMPLETED',
        actual_usd: null,
        billing_reference: null,
      });
      expect(f.finance.getGlobalReadiness(later).daily.committedUsd).toBe(
        '0.6',
      );
      expect(f.finance.getUsage('camp_001').hasUnknown).toBe(true);
    } finally {
      f.cleanup();
    }
  });

  it('keeps conflicting billing and observed totals pending without changing historical billing', () => {
    const f = fixture();
    try {
      f.finance.reserveGlobal(proof(), time);
      f.finance.dispatchGlobal('a', time);
      f.finance.settleGlobal('a', {
        actualCostUsd: '0.2',
        evidenceReference: 'fixture:partial-bill',
      });
      observe(f, 'cost_a', '0.2');
      observe(f, 'cost_b', '0.1');
      const r = f.finance.getGlobalReadiness(later);
      expect(r.reasons).toContain('RECONCILIATION_REQUIRED');
      expect(r.daily.committedUsd).toBe('0.6');
      expect(r.daily.recordedCostUsd).toBe('0.3');
      expect(f.finance.getUsage('camp_001').hasUnknown).toBe(true);
      expect(f.finance.getGlobalOperation('a')?.actual_usd).toBe('0.2');
      expect(f.finance.getRunReadiness('run_001').pendingClosure).toContain(
        'COST_EVENT_LINK_REQUIRED:GLOBAL:a',
      );
      expect(() =>
        f.finance.settleGlobal('a', {
          actualCostUsd: '0.3',
          evidenceReference: 'fixture:replacement-bill',
        }),
      ).toThrow('GLOBAL_BILLING_CONFLICT');
    } finally {
      f.cleanup();
    }
  });

  it('does not send paid transport without a proven financial authorization', async () => {
    const f = fixture();
    try {
      const transport = vi.fn();
      for (const change of [
        { kind: 'OFFICIAL_ESTIMATE' },
        { includesAllCharges: false },
        { evidenceReference: '' },
        { maximumAmount: '0' },
        { expiresAt: time },
      ]) {
        await expect(
          f.finance.executePaid({ ...proof(), ...change }, transport, time),
        ).rejects.toMatchObject({ code: 'GLOBAL_PRICE_UNPROVEN' });
      }
      expect(transport).not.toHaveBeenCalled();
      expect(f.finance.getGlobalOperation('a')).toBeNull();
      expect(f.finance.getPilotCostClosure('run_001', time)).toMatchObject({
        financiallyClosed: false,
        totalRunCost: null,
        spendingAuthorized: false,
      });
    } finally {
      f.cleanup();
    }
  });
});
