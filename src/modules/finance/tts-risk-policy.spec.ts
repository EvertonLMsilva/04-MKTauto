import {
  ttsRiskFixture,
  TTS_RISK_TIME as now,
} from '../../../test/support/tts-risk-fixture.js';
import { ttsHash, ttsRequest } from './domain/tts-financial-contracts.js';
import { raceFinance } from '../../../test/support/finance-concurrency.js';
import { createHash } from 'node:crypto';
import { SqliteTtsFinancialSourcesReader } from './infrastructure/financial-readers.sqlite.js';

describe('individual TTS financial risk policy v2', () => {
  let f: ReturnType<typeof ttsRiskFixture>;
  beforeEach(() => {
    f = ttsRiskFixture();
  });
  afterEach(() => f?.close());
  const reserve = () => {
    f.service().approveTts(f.plan, f.approval);
    return f.service().beginTts(f.plan, now);
  };
  it('accepts the real Content revision identifier without changing the historical script', () => {
    const plan = structuredClone(f.plan);
    plan.financialPolicy.scriptId = 'p77_test00_live_script:audio_final_v2';
    expect(ttsRequest(plan).financialPolicy.scriptId).toBe(
      plan.financialPolicy.scriptId,
    );
  });
  it('reads a verified fal source without copying operations or financial entries', () => {
    const basis = {
      pipelineRunId: 'run_001',
      scriptId: 'script:original',
      endpoint: 'fixture/fake',
    };
    const key = ttsHash(basis),
      output = {
        mediaReference: 'media:sha256_' + 'e'.repeat(64),
        contentHash: 'e'.repeat(64),
        assetType: 'VIDEO',
        technicalProperties: {
          format: 'mp4',
          widthPixels: 64,
          heightPixels: 64,
          durationMilliseconds: 2000,
        },
        origin: 'PROVIDER_GENERATED',
        provider: 'fal',
        rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
      };
    f.db
      .prepare(
        "INSERT INTO fal_generations VALUES(?,?,?,'COMPLETED',?,NULL,NULL,'0','USD','fixture',?,?,?,?)",
      )
      .run(
        key,
        'run_001',
        JSON.stringify(basis),
        'req_fake',
        JSON.stringify(output),
        createHash('sha256').update(JSON.stringify(output)).digest('hex'),
        now,
        now,
      );
    const before = f.db.prepare('SELECT * FROM cost_events').all();
    const source = new SqliteTtsFinancialSourcesReader(f.db).videoSource(key);
    expect(source).toMatchObject({
      state: 'COMPLETED',
      requestHash: key,
      request: { pipelineRunId: 'run_001' },
      result: {
        contentHash: output.contentHash,
        videoReference: output.mediaReference,
      },
    });
    expect(f.db.prepare('SELECT * FROM cost_events').all()).toEqual(before);
    expect(
      f.db.prepare('SELECT count(*) n FROM video_generation_operations').get()
        ?.n,
    ).toBe(1);
  });
  it('rejects a fal output whose persisted hash does not match its bytes', () => {
    const basis = { pipelineRunId: 'run_001' },
      key = ttsHash(basis),
      output = { contentHash: 'e'.repeat(64) };
    f.db
      .prepare(
        "INSERT INTO fal_generations VALUES(?,?,?,'COMPLETED',?,NULL,NULL,'0','USD','fixture',?,?,?,?)",
      )
      .run(
        key,
        'run_001',
        JSON.stringify(basis),
        'req_tampered',
        JSON.stringify(output),
        'f'.repeat(64),
        now,
        now,
      );
    expect(() =>
      new SqliteTtsFinancialSourcesReader(f.db).videoSource(key),
    ).toThrow(
      expect.objectContaining({ code: 'TTS_SOURCE_INTEGRITY_INVALID' }),
    );
  });
  it('binds policy, model, script, narration, estimate and reservation to immutable approval', () => {
    const request = ttsRequest(f.plan);
    expect(request.financialPolicy).toEqual(f.plan.financialPolicy);
    reserve();
    expect(f.service().getTts(f.plan.operationId)?.requestHash).toBe(
      f.approval.requestHash,
    );
    const changed = structuredClone(f.plan);
    changed.financialPolicy.scriptContentHash = 'e'.repeat(64);
    expect(() => f.service().beginTts(changed, now)).toThrow();
    expect(f.service().getGlobalUsage(now).dailyUsd).toBe('0.011');
  });
  it('requires explicit overrun acceptance and a valid expiry', () => {
    for (const mutation of [
      { acceptsUnboundedCost: false },
      { expiresAt: now },
      { policyVersion: 'legacy' },
    ])
      expect(() =>
        f.service().approveTts(f.plan, { ...f.approval, ...mutation }),
      ).toThrow();
    expect(() => f.service().beginTts(f.plan, now)).toThrow(
      expect.objectContaining({ code: 'TTS_APPROVAL_REQUIRED' }),
    );
  });
  it('replays the same individual authorization without replacing the original audit time', () => {
    const first = f.service().approveTts(f.plan, f.approval);
    expect(
      f.service().approveTts(f.plan, {
        ...f.approval,
        approvedAt: '2026-10-14T12:01:00Z',
      }),
    ).toEqual(first);
    expect(() =>
      f
        .service()
        .approveTts(f.plan, { ...f.approval, approvedBy: 'other_operator' }),
    ).toThrow();
    expect(() =>
      f.service().approveTts(f.plan, {
        ...f.approval,
        expiresAt: '2026-10-15T00:00:00Z',
      }),
    ).toThrow();
  });
  it.each(['operation', 'script', 'text', 'model', 'estimate'])(
    'rejects a changed %s after approval',
    (field) => {
      f.service().approveTts(f.plan, f.approval);
      const changed = structuredClone(f.plan);
      if (field === 'operation') changed.operationId = 'tts_different';
      if (field === 'script')
        changed.financialPolicy.scriptId = 'script_different';
      if (field === 'text') {
        changed.operation.narration += ' Mais.';
        changed.operationHash = ttsHash(changed.operation);
      }
      if (field === 'model')
        changed.providerConfiguration.model = 'other-model';
      if (field === 'estimate') changed.estimatedCost.amount = 0.005;
      expect(() => f.service().beginTts(changed, now)).toThrow();
      expect(f.service().getTts(changed.operationId)).toBeNull();
    },
  );
  it('rechecks the global budget immediately before dispatch and preserves the audit grant', () => {
    f.service().configureGlobal({ dailyUsd: '0.015', monthlyUsd: '20' });
    reserve();
    f.service().register({
      schemaVersion: 'cost-event/1.0.0',
      costEventId: 'concurrent_cost',
      category: 'voice_cost',
      pipelineRunId: 'run_001',
      projectId: 'project_001',
      projectVersion: 1,
      contentIdentity: null,
      artifactId: null,
      amount: '0.005',
      currency: 'USD',
      occurredAt: now,
      recordedAt: now,
      origin: 'openai',
      attributionRuleVersion: 'fixture/1.0.0',
    });
    expect(() => f.service().dispatchTts(f.plan.operationId, now)).toThrow(
      expect.objectContaining({ code: 'GLOBAL_DAILY_BUDGET_EXCEEDED' }),
    );
    expect(
      f.db.prepare('SELECT count(*) AS n FROM tts_risk_dispatches_v2').get()?.n,
    ).toBe(0);
  });
  it('reserves once under concurrent begin requests', async () => {
    f.service().approveTts(f.plan, f.approval);
    const results = await raceFinance(
      f.database,
      [0, 1].map(() => ({ method: 'beginTts', args: [f.plan, now] })),
    );
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(f.service().getGlobalUsage(now).dailyUsd).toBe('0.011');
  }, 15000);
  it('checks expiry again at dispatch without consuming the grant', () => {
    reserve();
    expect(() =>
      f.service().dispatchTts(f.plan.operationId, f.approval.expiresAt),
    ).toThrow(expect.objectContaining({ code: 'TTS_APPROVAL_EXPIRED' }));
    expect(() =>
      f.service().dispatchTts(f.plan.operationId, now),
    ).not.toThrow();
  });
  it('allows one dispatch across independent SQLite connections and restart', async () => {
    reserve();
    const results = await raceFinance(
      f.database,
      [0, 1].map(() => ({
        method: 'dispatchTts',
        args: [f.plan.operationId, now],
      })),
    );
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(() => f.service().dispatchTts(f.plan.operationId, now)).toThrow(
      expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }),
    );
  }, 15000);
  it.each(['daily', 'monthly'])(
    'preserves the %s budget and creates no claim when exhausted',
    (period) => {
      f.service().configureGlobal({
        dailyUsd: period === 'daily' ? '0.005' : '1',
        monthlyUsd: period === 'monthly' ? '0.005' : '20',
      });
      f.service().approveTts(f.plan, f.approval);
      expect(() => f.service().beginTts(f.plan, now)).toThrow();
      expect(f.service().getTts(f.plan.operationId)).toBeNull();
    },
  );
  it('retains uncertainty across restart and blocks renamed operations', () => {
    reserve();
    f.service().dispatchTts(f.plan.operationId, now);
    f.service().markTtsUnknown(f.plan.operationId, 'TTS_TIMEOUT');
    expect(() => f.service().beginTts(f.plan, now)).toThrow();
    const renamed = { ...f.plan, operationId: 'tts_risk_002' };
    f.service().approveTts(renamed, {
      ...f.approval,
      requestHash: ttsHash(ttsRequest(renamed)),
    });
    expect(() => f.service().beginTts(renamed, now)).toThrow(
      expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }),
    );
    expect(f.service().getLedgerByPipelineRun('run_001').events).toHaveLength(
      0,
    );
  });
  it('does not account estimates; reconciles evidenced overrun exactly once', () => {
    reserve();
    f.service().dispatchTts(f.plan.operationId, now);
    f.service().markTtsUnknown(
      f.plan.operationId,
      'TTS_BILLING_EVIDENCE_REQUIRED',
    );
    expect(() => f.service().accountTts(f.plan.operationId)).toThrow(
      expect.objectContaining({ code: 'TTS_BILLING_EVIDENCE_REQUIRED' }),
    );
    f.service().recordTtsResult(f.plan.operationId, {
      audio: f.audio,
      billing: { actualCostUsd: '0.012', evidenceReference: 'fixture/invoice' },
    });
    const result = f
      .service()
      .reconcileTts(f.plan.operationId, 'fixture/reconcile');
    expect(result.state).toBe('COMPLETED');
    expect(
      f.service().reconcileTts(f.plan.operationId, 'fixture/reconcile'),
    ).toEqual(result);
    expect(f.service().getLedgerByPipelineRun('run_001').events).toHaveLength(
      1,
    );
    expect(f.service().getGlobalUsage(now).dailyUsd).toBe('0.013');
    expect(f.service().getUsage('camp_001').hasCeilingBreach).toBe(false);
  });
});
