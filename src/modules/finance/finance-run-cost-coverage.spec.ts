import { falFixture } from '../../../test/support/fal-fixture.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import { FinanceService } from './application/finance.service.js';

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

import { evaluateRunCostCoverage } from './domain/run-cost-coverage.evaluator.js';
function perimeter(run: ReturnType<FinanceService['getRunReadiness']>) {
  return {
    schemaVersion: 'run-cost-perimeter/1.0.0',
    pipelineRunId: run.pipelineRunId,
    projectId: run.ledger.projectId,
    projectVersion: run.ledger.projectVersion,
    runIdentityHash: run.runIdentityHash,
    complete: true,
    perimeterEvidenceIds: ['scope_doc'],
    evidence: [
      {
        evidenceId: 'scope_doc',
        reference: 'fixture:scope',
        pipelineRunId: run.pipelineRunId,
        projectId: run.ledger.projectId,
        projectVersion: run.ledger.projectVersion,
        stageId: null,
        kind: 'PERIMETER',
        currency: null,
      },
    ],
    stages: [] as any[],
  };
}
function voiceStage(
  d: ReturnType<typeof perimeter>,
  run: ReturnType<FinanceService['getRunReadiness']>,
) {
  d.stages.push({
    stageId: 'narration',
    applicability: 'APPLICABLE',
    costEventIds: run.ledger.events
      .filter((e) => e.costEventId === 'tts_cost:tts_001')
      .map((e) => e.costEventId),
    operations: run.operations
      .filter((o) => o.source === 'TTS')
      .map((o) => ({
        source: o.source,
        operationId: o.operationId,
        requestHash: o.requestHash,
      })),
    evidenceIds: ['voice_bill'],
  });
  d.evidence.push({
    evidenceId: 'voice_bill',
    reference: 'fixture:invoice',
    pipelineRunId: run.pipelineRunId,
    projectId: run.ledger.projectId,
    projectVersion: run.ledger.projectVersion,
    stageId: 'narration' as any,
    kind: 'BILLING',
    currency: 'USD' as any,
  });
}
function reconciled(f: ReturnType<typeof fixture>, actual = '0.001') {
  tts(f, actual);
  f.finance.register(cost('tts_cost:tts_001', '0.1'));
  f.finance.recordTtsResult('tts_001', { audio: audio() });
  f.finance.reconcileTts('tts_001', 'fixture:reconciled');
  return f.finance.getRunReadiness('run_001');
}
describe('Run stage cost coverage', () => {
  it('does not infer stages or zero from an empty run or declaration', () => {
    const f = fixture();
    try {
      const run = f.finance.getRunReadiness('run_001');
      const a = evaluateRunCostCoverage('run_001', run);
      expect(a.coverageStatus).toBe('COVERAGE_UNVERIFIED');
      expect(a.stages).toEqual([]);
      expect(a.totalRunCost).toBeNull();
      const d = perimeter(run);
      const b = evaluateRunCostCoverage('run_001', run, d);
      expect(b.coverageStatus).toBe('COVERAGE_UNVERIFIED');
      expect(b.blockers).toContain('EMPTY_PERIMETER');
    } finally {
      f.cleanup();
    }
  });
  it('covers one documented reconciled stage using the canonical adjusted ledger only', () => {
    const f = fixture();
    try {
      const run = reconciled(f, '0.000000000000000001'),
        d = perimeter(run);
      voiceStage(d, run);
      const r = evaluateRunCostCoverage('run_001', run, d);
      expect(r.coverageStatus).toBe('DOCUMENTED_PERIMETER_COVERED');
      expect(r.stages[0].status).toBe('RECONCILED');
      expect(r.totalRunCost).toBe(run.ledger.totalsByCurrency);
      expect(r.totalRunCost).toEqual([
        { currency: 'USD', amount: '0.000000000000000001' },
      ]);
      expect(r.knownFinancialTotals).toBe(run.ledger.totalsByCurrency);
      expect(run.ledger.events[0].amount).toBe('0.1');
      expect(run.ledger.adjustments).toHaveLength(1);
      expect(r.financiallyClosed).toBe(false);
      expect(r.spendingAuthorized).toBe(false);
      expect(evaluateRunCostCoverage('run_001', run, d)).toEqual(r);
    } finally {
      f.cleanup();
    }
  });
  it('distinguishes recorded costs, absent stages and partial evidence in multiple stages', () => {
    const f = fixture();
    try {
      f.finance.register(cost());
      const run = f.finance.getRunReadiness('run_001'),
        d = perimeter(run);
      d.stages.push(
        {
          stageId: 'script',
          applicability: 'APPLICABLE',
          costEventIds: ['cost_001'],
          operations: [],
          evidenceIds: [],
        },
        {
          stageId: 'video',
          applicability: 'APPLICABLE',
          costEventIds: [],
          operations: [],
          evidenceIds: [],
        },
      );
      const r = evaluateRunCostCoverage('run_001', run, d);
      expect(r.stages.map((s) => s.status)).toEqual([
        'RECORDED',
        'NOT_OBSERVED',
      ]);
      expect(r.totalRunCost).toBeNull();
      expect(r.notCoveredStages).toEqual(['script', 'video']);
      d.evidence.push({
        evidenceId: 'unproven',
        reference: 'fixture:declared',
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        stageId: 'script' as any,
        kind: 'BILLING',
        currency: 'USD' as any,
      });
      d.stages[0].evidenceIds = ['unproven'];
      expect(evaluateRunCostCoverage('run_001', run, d).stages[0].status).toBe(
        'PARTIAL_EVIDENCE',
      );
    } finally {
      f.cleanup();
    }
  });
  it('keeps UNKNOWN despite a declared invoice', () => {
    const f = fixture();
    try {
      tts(f, null);
      const run = f.finance.getRunReadiness('run_001'),
        d = perimeter(run);
      voiceStage(d, run);
      const r = evaluateRunCostCoverage('run_001', run, d);
      expect(r.stages[0].status).toBe('UNKNOWN');
      expect(r.coverageStatus).toBe('UNKNOWN');
      expect(r.totalRunCost).toBeNull();
    } finally {
      f.cleanup();
    }
  });
  it('documents non-applicability without turning it into a zero cost', () => {
    const f = fixture();
    try {
      const run = f.finance.getRunReadiness('run_001'),
        d = perimeter(run);
      d.stages.push({
        stageId: 'music',
        applicability: 'NOT_APPLICABLE',
        justification: 'No music was part of this run.',
        costEventIds: [],
        operations: [],
        evidenceIds: [],
      });
      expect(evaluateRunCostCoverage('run_001', run, d).stages[0].status).toBe(
        'PARTIAL_EVIDENCE',
      );
      d.evidence.push({
        evidenceId: 'no_music',
        reference: 'fixture:no-music',
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        stageId: 'music' as any,
        kind: 'NOT_APPLICABLE',
        currency: null,
      });
      d.stages[0].evidenceIds = ['no_music'];
      const r = evaluateRunCostCoverage('run_001', run, d);
      expect(r.stages[0].status).toBe('NOT_APPLICABLE_DOCUMENTED');
      expect(r.totalRunCost).toBeNull();
    } finally {
      f.cleanup();
    }
  });
  it.each([
    'run',
    'project',
    'hash',
    'stage',
    'currency',
    'duplicate',
    'missing_event',
    'operation_hash',
    'not_applicable',
  ])('rejects inconsistent %s declarations', (kind) => {
    const f = fixture();
    try {
      const run = reconciled(f),
        d = perimeter(run);
      voiceStage(d, run);
      if (kind === 'run') d.pipelineRunId = 'run_002';
      if (kind === 'project') d.projectId = 'other_project';
      if (kind === 'hash') d.runIdentityHash = 'b'.repeat(64);
      if (kind === 'stage') d.evidence[1].stageId = 'wrong' as any;
      if (kind === 'currency') d.evidence[1].currency = 'BRL' as any;
      if (kind === 'duplicate')
        d.stages.push({ ...d.stages[0], stageId: 'again', evidenceIds: [] });
      if (kind === 'missing_event') d.stages[0].costEventIds = ['missing'];
      if (kind === 'operation_hash')
        d.stages[0].operations[0].requestHash = 'f'.repeat(64);
      if (kind === 'not_applicable')
        d.stages[0].applicability = 'NOT_APPLICABLE';
      expect(() => evaluateRunCostCoverage('run_001', run, d)).toThrow(
        /COVERAGE_/,
      );
    } finally {
      f.cleanup();
    }
  });
  it('does not cover unassigned costs or operations and preserves distinct currencies', () => {
    const f = fixture();
    try {
      const run = reconciled(f),
        d = perimeter(run);
      voiceStage(d, run);
      f.finance.register(cost('brl_cost', '2', 'BRL'));
      const updated = f.finance.getRunReadiness('run_001'),
        r = evaluateRunCostCoverage('run_001', updated, d);
      expect(r.coverageStatus).toBe('PARTIAL_COVERAGE');
      expect(r.unassignedCostEventIds).toEqual(['brl_cost']);
      expect(r.totalRunCost).toBeNull();
      expect(r.knownFinancialTotals).toEqual([
        { currency: 'BRL', amount: '2' },
        { currency: 'USD', amount: '0.001' },
      ]);
      d.stages[0].operations = [];
      expect(
        evaluateRunCostCoverage('run_001', run, d).unassignedOperations,
      ).toEqual(['TTS:tts_001']);
    } finally {
      f.cleanup();
    }
  });
  it('requires a documented complete perimeter, even when recorded costs reconcile', () => {
    const f = fixture();
    try {
      const run = reconciled(f),
        d = perimeter(run);
      voiceStage(d, run);
      d.complete = false;
      expect(
        evaluateRunCostCoverage('run_001', run, d).totalRunCost,
      ).toBeNull();
      d.complete = true;
      d.perimeterEvidenceIds = [];
      expect(evaluateRunCostCoverage('run_001', run, d).coverageStatus).toBe(
        'COVERAGE_UNVERIFIED',
      );
    } finally {
      f.cleanup();
    }
  });
  it('requires the billing reference for this operation and does not infer zero from missing proof', () => {
    const f = fixture();
    try {
      const run = reconciled(f, '0'),
        d = perimeter(run);
      voiceStage(d, run);
      d.evidence[1].reference = 'fixture:wrong-bill';
      const r = evaluateRunCostCoverage('run_001', run, d);
      expect(r.stages[0].status).toBe('PARTIAL_EVIDENCE');
      expect(r.totalRunCost).toBeNull();
      d.evidence[1].reference = 'fixture:invoice';
      expect(evaluateRunCostCoverage('run_001', run, d).totalRunCost).toEqual([
        { currency: 'USD', amount: '0' },
      ]);
    } finally {
      f.cleanup();
    }
  });
  it('exposes coverage read-only through FinanceService and preserves closure and budgets', () => {
    const f = fixture();
    try {
      const run = reconciled(f),
        d = perimeter(run);
      voiceStage(d, run);
      const before = f.finance.getPilotCostClosure('run_001', time);
      const result = f.finance.getRunCostCoverage('run_001', d, time);
      expect(result.financial).toEqual(before);
      expect(result.coverage.coverageStatus).toBe(
        'DOCUMENTED_PERIMETER_COVERED',
      );
      expect(result.financial.totalRunCost).toBeNull();
      expect(result.financial.financiallyClosed).toBe(false);
      expect(result.financial.budget.daily.limitUsd).toBe('1');
      expect(result.financial.budget.monthly.limitUsd).toBe('20');
      expect(f.finance.getRunCostCoverage('run_001', d, time)).toEqual(result);
      expect(f.finance.getPilotCostClosure('run_001', time)).toEqual(before);
      const reader = new FinanceService({
        open: () => {
          const session = new FinanceSession(f.database);
          session.db.exec('PRAGMA query_only=ON');
          return session;
        },
      });
      expect(reader.getRunCostCoverage('run_001', d, time)).toEqual(result);
    } finally {
      f.cleanup();
    }
  });
  it('covers multiple documented stages without adding non-applicability to the ledger', () => {
    const f = fixture();
    try {
      const run = reconciled(f),
        d = perimeter(run);
      voiceStage(d, run);
      d.stages.push({
        stageId: 'music',
        applicability: 'NOT_APPLICABLE',
        justification: 'The approved run contains no music.',
        costEventIds: [],
        operations: [],
        evidenceIds: ['music_doc'],
      });
      d.evidence.push({
        evidenceId: 'music_doc',
        reference: 'fixture:no-music',
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        stageId: 'music' as any,
        kind: 'NOT_APPLICABLE',
        currency: null,
      });
      const r = evaluateRunCostCoverage('run_001', run, d);
      expect(r.coveredStages).toEqual(['narration', 'music']);
      expect(r.coverageStatus).toBe('DOCUMENTED_PERIMETER_COVERED');
      expect(r.totalRunCost).toBe(run.ledger.totalsByCurrency);
      delete d.stages[1].justification;
      expect(
        evaluateRunCostCoverage('run_001', run, d).totalRunCost,
      ).toBeNull();
    } finally {
      f.cleanup();
    }
  });
  it('keeps positive billed operations pending until their costs are in the ledger', () => {
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
      f.finance.dispatchGlobal('global_001', time);
      f.finance.settleGlobal('global_001', {
        actualCostUsd: '0.01',
        evidenceReference: 'fixture:receipt',
      });
      const run = f.finance.getRunReadiness('run_001'),
        d = perimeter(run),
        op = run.operations[0];
      d.stages.push({
        stageId: 'script',
        applicability: 'APPLICABLE',
        costEventIds: [],
        operations: [
          {
            source: op.source,
            operationId: op.operationId,
            requestHash: op.requestHash,
          },
        ],
        evidenceIds: ['bill'],
      });
      d.evidence.push({
        evidenceId: 'bill',
        reference: 'fixture:receipt',
        pipelineRunId: 'run_001',
        projectId: 'project_001',
        projectVersion: 1,
        stageId: 'script' as any,
        kind: 'BILLING',
        currency: 'USD' as any,
      });
      const r = evaluateRunCostCoverage('run_001', run, d);
      expect(r.stages[0].status).toBe('PARTIAL_EVIDENCE');
      expect(r.totalRunCost).toBeNull();
      expect(r.stages[0].blockers).toContain(
        'OPERATION_COST_NOT_IN_LEDGER:GLOBAL:global_001',
      );
    } finally {
      f.cleanup();
    }
  });
  it('rejects altered financial project identity and extra declared amounts', () => {
    const f = fixture();
    try {
      const run = reconciled(f),
        d = perimeter(run);
      voiceStage(d, run);
      const altered = {
        ...run,
        ledger: {
          ...run.ledger,
          events: run.ledger.events.map((e) => ({
            ...e,
            projectId: 'other_project',
          })),
        },
      };
      expect(() => evaluateRunCostCoverage('run_001', altered, d)).toThrow(
        'COVERAGE_PROJECT_MISMATCH',
      );
      expect(() =>
        evaluateRunCostCoverage('run_001', run, { ...d, amount: '0' }),
      ).toThrow('COVERAGE_DECLARATION_INVALID');
    } finally {
      f.cleanup();
    }
  });
});
