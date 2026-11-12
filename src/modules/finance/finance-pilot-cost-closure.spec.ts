import { Test } from '@nestjs/testing';
import request from 'supertest';
import { falFixture } from '../../../test/support/fal-fixture.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import { FinanceService } from './application/finance.service.js';
import { FinanceModule, FINANCE_DATABASE } from './finance.module.js';
import { SqliteAffiliateRepository } from '../affiliate/infrastructure/sqlite-affiliate.repository.js';
import { ttsHash } from './domain/tts-financial-contracts.js';
const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);
const time = '2026-10-13T12:00:00Z';
function fixture() {
  const f = falFixture();
  const catalog = new SqliteAffiliateRepository(f.database);
  try {
    catalog.registerProduct(fixtures.product(), 'fixture_product');
    catalog.registerCampaign(fixtures.campaign(), 'fixture_campaign', true);
  } finally {
    catalog.close();
  }
  fixtures.startRun(f.base, 'run_001');
  fixtures.startRun(f.base, 'run_002');
  const finance = new FinanceService({
    open: () => new FinanceSession(f.database),
  });
  finance.configureCampaign('camp_001', 1);
  finance.configureGlobal({});
  return { ...f, finance };
}
function cost(id = 'cost_001', amount = '0.1', currency = 'USD') {
  return {
    schemaVersion: 'cost-event/1.0.0',
    costEventId: id,
    category: 'voice_cost',
    pipelineRunId: 'run_001',
    projectId: 'project_001',
    projectVersion: 1,
    contentIdentity: null,
    artifactId: null,
    amount,
    currency,
    occurredAt: time,
    origin: 'openai',
    attributionRuleVersion: 'fixture/1.0.0',
    recordedAt: time,
  };
}
function tts(f: ReturnType<typeof fixture>, actual: string | null) {
  const req = {
    operationId: 'tts_001',
    campaignId: 'camp_001',
    operation: { pipelineRunId: 'run_001', maxDurationMilliseconds: 10000 },
    reservationUsd: '0.1',
    estimatedUsd: '0.1',
  };
  const hash = ttsHash(req);
  f.base.db
    .prepare('INSERT INTO tts_financial_approvals VALUES(?,?,?,?)')
    .run('tts_001', hash, JSON.stringify(req), '{}');
  f.base.db
    .prepare('INSERT INTO tts_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      'tts_001',
      hash,
      hash,
      'camp_001',
      JSON.stringify(req),
      'UNKNOWN',
      time,
      null,
      actual === null
        ? null
        : JSON.stringify({
            actualCostUsd: actual,
            evidenceReference: 'fixture:invoice',
          }),
      null,
      null,
      null,
    );
}
function audio() {
  return {
    durationMilliseconds: 9000,
    audioFormat: 'wav',
    contentHash: 'c'.repeat(64),
    storageReference: 'object:fixture/audio',
    provider: 'openai',
    origin: 'SYNTHETIC_TTS',
    rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
  };
}

describe('Pilot financial closure, offline fixtures', () => {
  it('keeps a run without costs unverified and never declares zero or authorizes spending', () => {
    const f = fixture();
    try {
      const r = f.finance.getPilotCostClosure('run_001', time);
      expect(r).toMatchObject({
        schemaVersion: 'pilot-cost-closure/1.0.0',
        pipelineRunId: 'run_001',
        evaluatedAt: time,
        recordedDataStatus: 'PARTIAL_EVIDENCE',
        coverageStatus: 'COVERAGE_UNVERIFIED',
        financiallyClosed: false,
        totalRunCost: null,
        spendingAuthorized: false,
      });
      expect(r.run.ledger.events).toEqual([]);
      expect(r.blockers).toContainEqual({
        source: 'RUN',
        code: 'NO_RECORDED_COSTS',
      });
      expect(r.blockers).toContainEqual({
        source: 'RUN',
        code: 'RUN_COST_COVERAGE_UNVERIFIED',
      });
      expect(r.budget.daily).toMatchObject({
        limitUsd: '1',
        period: '2026-10-13',
      });
      expect(r.budget.monthly.limitUsd).toBe('20');
    } finally {
      f.cleanup();
    }
  });
  it.each(['0.001', '0', '0.000000000000000001'])(
    'reuses reconciled TTS, adjustments and exact amounts (%s) once',
    (actual) => {
      const f = fixture();
      try {
        tts(f, actual);
        f.finance.register(cost('tts_cost:tts_001', '0.1'));
        f.finance.recordTtsResult('tts_001', { audio: audio() });
        f.finance.reconcileTts('tts_001', 'fixture:reconciled');
        const r = f.finance.getPilotCostClosure('run_001', time);
        expect(r.recordedDataStatus).toBe('RECORDED_DATA_RECONCILED');
        expect(r.closureStatus).toBe('COVERAGE_UNVERIFIED');
        expect(r.totalRunCost).toBeNull();
        expect(r.run.recordedTotalsByCurrency).toEqual([
          { currency: 'USD', amount: '0.1' },
        ]);
        expect(r.run.provenEventTotalsByCurrency).toEqual([
          { currency: 'USD', amount: actual },
        ]);
        expect(r.run.ledger.adjustments).toHaveLength(1);
        expect(r.run.ledger.totalsByCurrency).toEqual([
          { currency: 'USD', amount: actual },
        ]);
        expect(r.run.evidence).toContain('fixture:invoice');
        expect(r.run).toEqual(f.finance.getRunReadiness('run_001'));
        expect(r.budget).toEqual(f.finance.getGlobalReadiness(time));
        expect(f.finance.getPilotCostClosure('run_001', time)).toEqual(r);
        const reopened = new FinanceSession(f.database);
        try {
          reopened.db.exec('PRAGMA query_only=ON');
          expect(reopened.getPilotCostClosure('run_001', time)).toEqual(r);
          expect(reopened.db.isTransaction).toBe(false);
        } finally {
          reopened.close();
        }
      } finally {
        f.cleanup();
      }
    },
  );
  it('does not promote declared or estimated amounts to proven costs', () => {
    const f = fixture();
    try {
      tts(f, '0.001');
      f.finance.register(cost('tts_cost:tts_001', '0.1'));
      let r = f.finance.getPilotCostClosure('run_001', time);
      expect(r.recordedDataStatus).toBe('UNKNOWN');
      expect(r.run.provenEventTotalsByCurrency).toEqual([]);
      f.finance.recordTtsResult('tts_001', { audio: audio() });
      f.finance.reconcileTts('tts_001', 'fixture:reconciled');
      f.finance.register({
        ...cost('declared_cost', '0.123456789012345678'),
        origin: 'manual_invoice',
      });
      r = f.finance.getPilotCostClosure('run_001', time);
      expect(r.recordedDataStatus).toBe('PARTIAL_EVIDENCE');
      expect(r.run.missingEvidence).toContain('cost-event:declared_cost');
      expect(r.run.provenEventTotalsByCurrency).toEqual([
        { currency: 'USD', amount: '0.001' },
      ]);
    } finally {
      f.cleanup();
    }
  });
  it('shows UNKNOWN as unavailable and keeps uncertain liability across periods', () => {
    const f = fixture();
    try {
      tts(f, null);
      const r = f.finance.getPilotCostClosure(
        'run_001',
        '2026-11-01T03:00:00Z',
      );
      expect(r.recordedDataStatus).toBe('UNKNOWN');
      expect(r.run.unknownCosts).toEqual(['TTS:tts_001']);
      expect(r.run.operations[0].actualCostUsd).toBeNull();
      expect(r.budget.daily).toMatchObject({
        committedUsd: '0.1',
        reservedLiabilityUsd: '0.1',
      });
      expect(r.budget.monthly.committedUsd).toBe('0.1');
      expect(r.blockers).toContainEqual({
        source: 'GLOBAL',
        code: 'UNKNOWN_OPERATIONS',
      });
    } finally {
      f.cleanup();
    }
  });
  it('retains active reservations without creating a settlement', () => {
    const f = fixture();
    try {
      f.finance.reserveGlobal(
        {
          operationId: 'global_001',
          requestHash: 'a'.repeat(64),
          provider: 'openai',
          kind: 'ENFORCED_MAXIMUM',
          includesAllCharges: true,
          currency: 'USD',
          maximumAmount: '0.1',
          evidenceReference: 'fixture:ceiling',
          expiresAt: '2099-01-01T00:00:00Z',
          pipelineRunId: 'run_001',
        },
        time,
      );
      const r = f.finance.getPilotCostClosure('run_001', time);
      expect(r.budget.daily.reservedLiabilityUsd).toBe('0.1');
      expect(r.blockers).toContainEqual({
        source: 'GLOBAL',
        code: 'ACTIVE_RESERVATIONS',
      });
      expect(f.finance.getGlobalOperation('global_001')).toMatchObject({
        state: 'RESERVED',
        actual_usd: null,
      });
      expect(r.run.ledger.events).toEqual([]);
      f.finance.dispatchGlobal('global_001', time);
      f.finance.settleGlobal('global_001', {
        actualCostUsd: '0.01',
        evidenceReference: 'fixture:bill',
      });
      const settled = f.finance.getPilotCostClosure('run_001', time);
      expect(settled.budget.daily).toMatchObject({
        committedUsd: '0.1',
        recordedCostUsd: '0.01',
        reservedLiabilityUsd: '0.09',
      });
      expect(settled.run.operations[0].actualCostUsd).toBe('0.01');
    } finally {
      f.cleanup();
    }
  });
  it.each([
    ['2026-10-14T02:59:59.999Z', '2026-10-14T03:00:00Z', '0.1'],
    ['2026-11-01T02:59:59.999Z', '2026-11-01T03:00:00Z', '0'],
  ])(
    'preserves the policy day/month boundary after %s',
    (before, after, monthly) => {
      const f = fixture();
      try {
        f.finance.register({
          ...cost(),
          occurredAt: before,
          recordedAt: before,
        });
        const a = f.finance.getPilotCostClosure('run_001', before);
        const b = f.finance.getPilotCostClosure('run_001', after);
        expect(a.budget.timeZone).toBe('America/Sao_Paulo');
        expect(a.budget.daily.committedUsd).toBe('0.1');
        expect(b.budget.daily.committedUsd).toBe('0');
        expect(b.budget.monthly.committedUsd).toBe(monthly);
        expect(b.run).toEqual(a.run);
      } finally {
        f.cleanup();
      }
    },
  );
  it('reports an evidenced zero operation without manufacturing a cost event', () => {
    const f = fixture();
    try {
      tts(f, '0');
      f.finance.recordTtsResult('tts_001', { audio: audio() });
      f.finance.reconcileTts('tts_001', 'fixture:zero');
      const r = f.finance.getPilotCostClosure('run_001', time);
      expect(r.recordedDataStatus).toBe('RECORDED_DATA_RECONCILED');
      expect(r.run.ledger.events).toEqual([]);
      expect(r.run.operations[0].actualCostUsd).toBe('0');
      expect(r.totalRunCost).toBeNull();
    } finally {
      f.cleanup();
    }
  });
  it('rejects mixed snapshots if another connection commits between the reads', () => {
    const f = fixture(),
      session = new FinanceSession(f.database);
    try {
      const original = session.getRunReadiness.bind(session);
      vi.spyOn(session, 'getRunReadiness').mockImplementation((id) => {
        const run = original(id);
        f.finance.register(cost());
        return run;
      });
      expect(() => session.getPilotCostClosure('run_001', time)).toThrow(
        'FINANCE_CLOSURE_SNAPSHOT_CONFLICT',
      );
      expect(session.db.isTransaction).toBe(false);
    } finally {
      session.close();
      f.cleanup();
    }
  });
  it('propagates invalid time, missing run and missing policy without writing', () => {
    const f = fixture(),
      session = new FinanceSession(f.database);
    try {
      session.db.exec('PRAGMA query_only=ON');
      expect(() => session.getPilotCostClosure('run_001', 'invalid')).toThrow(
        'GLOBAL_TIME_INVALID',
      );
      expect(() => session.getPilotCostClosure('run_missing', time)).toThrow(
        'PIPELINE_RUN_NOT_FOUND',
      );
      expect(session.db.isTransaction).toBe(false);
      session.db.exec('PRAGMA query_only=OFF');
      session.db.exec('DELETE FROM global_finance_policy');
      session.db.exec('PRAGMA query_only=ON');
      expect(() => session.getPilotCostClosure('run_001', time)).toThrow(
        'FINANCE_POLICY_REQUIRED',
      );
      expect(
        session.db.prepare('SELECT count(*) n FROM global_finance_policy').get()
          .n,
      ).toBe(0);
    } finally {
      session.close();
      f.cleanup();
    }
  });
  it('keeps both readiness HTTP contracts unchanged', async () => {
    const f = fixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(time));
    const mod = await Test.createTestingModule({ imports: [FinanceModule] })
      .overrideProvider(FINANCE_DATABASE)
      .useValue(f.database)
      .compile();
    const app = mod.createNestApplication();
    try {
      await app.init();
      const closure = f.finance.getPilotCostClosure('run_001');
      expect(
        (
          await request(app.getHttpServer())
            .get('/finance/readiness')
            .expect(200)
        ).body,
      ).toEqual(closure.budget);
      expect(
        (
          await request(app.getHttpServer())
            .get('/finance/runs/run_001/readiness')
            .expect(200)
        ).body,
      ).toEqual(closure.run);
      await request(app.getHttpServer())
        .post('/finance/runs/run_001/closure')
        .send({})
        .expect(404);
    } finally {
      await app.close();
      f.cleanup();
      vi.useRealTimers();
    }
  });
});
