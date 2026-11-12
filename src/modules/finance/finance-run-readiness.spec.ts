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

describe('Run financial readiness', () => {
  it('keeps absent events distinct from proven zero and preserves run identity', () => {
    const f = fixture();
    try {
      const r = f.finance.getRunReadiness('run_001');
      expect(r).toMatchObject({
        schemaVersion: 'run-finance-readiness/1.0.0',
        pipelineRunId: 'run_001',
        status: 'PENDING',
        totalRunCost: null,
        ledger: { events: [] },
      });
      expect(r.pendingClosure).toContain('RUN_COST_COVERAGE_UNVERIFIED');
      expect(r.pendingClosure).toContain('NO_RECORDED_COSTS');
      expect(r.runIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      f.cleanup();
    }
  });
  it('retains exact recorded amounts and currencies without inventing evidence', () => {
    const f = fixture();
    try {
      f.finance.register(cost('cost_001', '0.123456789012345678'));
      f.finance.register(cost('cost_002', '0.000000000000000001'));
      f.finance.register(cost('cost_003', '2', 'BRL'));
      const r = f.finance.getRunReadiness('run_001');
      expect(r.recordedTotalsByCurrency).toEqual([
        { currency: 'BRL', amount: '2' },
        { currency: 'USD', amount: '0.123456789012345679' },
      ]);
      expect(r.provenEventTotalsByCurrency).toEqual([]);
      expect(r.missingEvidence).toContain('cost-event:cost_001');
      expect(f.finance.getRunReadiness('run_002').ledger.events).toEqual([]);
    } finally {
      f.cleanup();
    }
  });
  it('shows UNKNOWN TTS even without a cost event', () => {
    const f = fixture();
    try {
      tts(f, null);
      const r = f.finance.getRunReadiness('run_001');
      expect(r.status).toBe('UNKNOWN');
      expect(r.operations[0]).toMatchObject({
        source: 'TTS',
        actualCostUsd: null,
      });
      expect(r.unknownCosts).toEqual(['TTS:tts_001']);
    } finally {
      f.cleanup();
    }
  });
  it.each(['0.001', '0'])(
    'applies TTS adjustment once, preserves history and proves %s',
    (actual) => {
      const f = fixture();
      try {
        tts(f, actual);
        f.finance.register(cost('tts_cost:tts_001', '0.1'));
        f.finance.recordTtsResult('tts_001', { audio: audio() });
        f.finance.reconcileTts('tts_001', 'fixture:reconciled');
        const r = f.finance.getRunReadiness('run_001');
        expect(r.status).toBe('RECONCILED');
        expect(r.ledger.events[0].amount).toBe('0.1');
        expect(r.ledger.adjustments).toHaveLength(1);
        expect(r.ledger.totalsByCurrency).toEqual([
          { currency: 'USD', amount: actual },
        ]);
        expect(r.provenEventTotalsByCurrency).toEqual([
          { currency: 'USD', amount: actual },
        ]);
        expect(r.entries[0].netAmount).toBe(actual);
        expect(r.evidence).toContain('fixture:invoice');
        const reopened = new FinanceSession(f.database);
        try {
          reopened.db.exec('PRAGMA query_only=ON');
          expect(reopened.getRunReadiness('run_001')).toEqual(r);
          expect(reopened.db.isTransaction).toBe(false);
        } finally {
          reopened.close();
        }
        f.finance.reconcileTts('tts_001', 'fixture:reconciled');
        expect(f.finance.getRunReadiness('run_001')).toEqual(r);
      } finally {
        f.cleanup();
      }
    },
  );
  it('reports an evidenced zero without fabricating a ledger event', () => {
    const f = fixture();
    try {
      tts(f, '0');
      f.finance.recordTtsResult('tts_001', { audio: audio() });
      f.finance.reconcileTts('tts_001', 'fixture:zero');
      const r = f.finance.getRunReadiness('run_001');
      expect(r.status).toBe('RECONCILED');
      expect(r.ledger.events).toEqual([]);
      expect(r.operations[0].actualCostUsd).toBe('0');
      expect(r.unknownCosts).toEqual([]);
    } finally {
      f.cleanup();
    }
  });
  it('includes global operations for this run without granting spending', () => {
    const f = fixture();
    try {
      f.finance.configureGlobal({});
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
      f.finance.dispatchGlobal('global_001', time);
      f.finance.unknownGlobal('global_001');
      expect(f.finance.getRunReadiness('run_001').unknownCosts).toEqual([
        'GLOBAL:global_001',
      ]);
      expect(f.finance.getRunReadiness('run_002').operations).toEqual([]);
      f.finance.settleGlobal('global_001', {
        actualCostUsd: '0.1',
        evidenceReference: 'fixture:global-receipt',
      });
      const settled = f.finance.getRunReadiness('run_001');
      expect(settled.unknownCosts).toEqual([]);
      expect(settled.evidence).toContain('fixture:global-receipt');
      expect(settled.pendingClosure).toContain(
        'COST_EVENT_LINK_REQUIRED:GLOBAL:global_001',
      );
    } finally {
      f.cleanup();
    }
  });
  it('exposes HTTP and preserves existing ledgers and error handling', async () => {
    const f = fixture();
    const mod = await Test.createTestingModule({ imports: [FinanceModule] })
      .overrideProvider(FINANCE_DATABASE)
      .useValue(f.database)
      .compile();
    const app = mod.createNestApplication();
    try {
      await app.init();
      const http = app.getHttpServer();
      expect(
        (await request(http).get('/finance/runs/run_001/readiness').expect(200))
          .body,
      ).toEqual(f.finance.getRunReadiness('run_001'));
      await request(http)
        .get('/finance/runs/run_missing/readiness')
        .expect(404);
      await request(http).get('/finance/runs/invalid!/readiness').expect(400);
      await request(http)
        .post('/finance/runs/run_001/readiness')
        .send({})
        .expect(404);
      expect(
        (await request(http).get('/finance/ledger-v2/run_001').expect(200))
          .body,
      ).toEqual(f.finance.getLedgerV2ByPipelineRun('run_001'));
      await request(http).get('/finance/ledger/run_001').expect(200);
    } finally {
      await app.close();
      f.cleanup();
    }
  });
});
