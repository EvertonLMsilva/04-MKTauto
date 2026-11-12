import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FinanceService } from './application/finance.service.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import { FinanceModule, FINANCE_DATABASE } from './finance.module.js';
import { falFixture } from '../../../test/support/fal-fixture.js';
import { SqliteAffiliateRepository } from '../affiliate/infrastructure/sqlite-affiliate.repository.js';
import { AffiliateRunContextService } from '../affiliate/application/affiliate-run-context.service.js';
import { SqliteAffiliateRunContextPersistence } from '../affiliate/infrastructure/sqlite-affiliate-run-context.persistence.js';
import {
  videoRequestHash,
  validateVideoCostAuthorization,
  validateVideoProviderResult,
} from './domain/video-financial-contracts.js';
import {
  ttsHash,
  ttsRequest,
  ttsApproval,
} from './domain/tts-financial-contracts.js';

const fixtures = await import(
  new URL('../../../test/affiliate-fixtures.js', import.meta.url).href
);

const time = '2026-10-13T12:00:00Z';
const proof = (id = 'a', amount = '0.6') => ({
  operationId: id,
  requestHash: id.repeat(64).slice(0, 64),
  provider: 'openai',
  kind: 'ENFORCED_MAXIMUM',
  includesAllCharges: true,
  currency: 'USD',
  maximumAmount: amount,
  evidenceReference: 'mock:enforced',
  expiresAt: '2027-12-31T00:00:00Z',
});

// Current NestJS schema and repositories, confined to a disposable database.
function financeFixture() {
  const f = falFixture();
  let gate: FinanceSession;
  try {
    gate = new FinanceSession(f.database);
    gate.configureGlobal();
  } catch (error) {
    f.cleanup();
    throw error;
  }
  return {
    path: f.database,
    legacy: f.base,
    gate,
    close() {
      gate.close();
      f.cleanup();
    },
  };
}

function campaignFinanceFixture(configureBudgets = true) {
  const f = financeFixture();
  const affiliate = new SqliteAffiliateRepository(f.path);
  try {
    affiliate.registerProduct(fixtures.product(), 'prod_create');
    const bindings = new AffiliateRunContextService(
      new SqliteAffiliateRunContextPersistence(f.path),
    );
    for (let i = 1; i <= 2; i++) {
      const campaignId = `camp_00${i}`;
      affiliate.registerCampaign(
        fixtures.campaign({ campaignId }),
        `camp_create_${i}`,
        true,
      );
      affiliate.createBriefing(
        { briefingId: `brief_00${i}`, campaignId, campaignRevision: 1 },
        `brief_create_${i}`,
        true,
      );
      fixtures.startRun(f.legacy, `run_00${i}`);
      bindings.bindRun(
        { pipelineRunId: `run_00${i}`, briefingId: `brief_00${i}` },
        `bind_run_${i}`,
      );
      if (configureBudgets) f.gate.configureCampaign(campaignId, 1);
    }
    return {
      ...f,
      affiliate,
      close() {
        affiliate.close();
        f.close();
      },
    };
  } catch (error) {
    affiliate.close();
    f.close();
    throw error;
  }
}

function cost(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'cost-event/1.0.0',
    costEventId: 'cost_001',
    category: 'ai_cost',
    pipelineRunId: 'run_001',
    projectId: 'project_001',
    projectVersion: 1,
    contentIdentity: null,
    artifactId: null,
    amount: '0.04',
    currency: 'USD',
    occurredAt: time,
    origin: 'manual_invoice',
    attributionRuleVersion: 'direct-run/1.0.0',
    recordedAt: time,
    ...overrides,
  };
}

function video(
  f: ReturnType<typeof campaignFinanceFixture>,
  i: number,
  state = 'UNKNOWN',
  actual: string | null = null,
) {
  const request = {
    schemaVersion: 'video-generation-request/2.0.0',
    generationRequestId: `video_00${i}`,
    campaignId: `camp_00${i}`,
    pipelineRunId: `run_00${i}`,
    originalSlot: 1,
    provider: 'fake_video',
    purpose: 'ORIGINAL',
    outputAspectRatio: '9:16',
    prompt: 'Local fixture',
    image: { mediaRef: 'authorized-image-001', contentHash: 'a'.repeat(64) },
    endpoint: 'fake/video',
    configuration: {
      resolution: { width: 720, height: 1280 },
      frames: 121,
      fps: 24,
      audio: false,
      multiscale: false,
      parameters: {},
    },
  };
  const hash = videoRequestHash(request);
  const ceiling = validateVideoCostAuthorization(
    {
      kind: 'ENFORCED_MAXIMUM',
      currency: 'USD',
      provider: request.provider,
      requestHash: hash,
      maximumAmount: i === 1 ? '0.15' : '0.2',
      includesAllCharges: true,
      evidenceReference: 'fixture/local',
      expiresAt: '2099-01-01T00:00:00Z',
    },
    request,
    time,
  );
  const result = validateVideoProviderResult(
    {
      generationRequestId: request.generationRequestId,
      requestHash: hash,
      provider: request.provider,
      state,
      providerRequestId: `provider_00${i}`,
      videoReference: state === 'COMPLETED' ? 'object:fixture/video' : null,
      actualCostUsd: actual,
    },
    { request, requestHash: hash },
  );
  f.legacy.db
    .prepare(
      'INSERT INTO video_generation_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      request.generationRequestId,
      request.campaignId,
      request.pipelineRunId,
      request.originalSlot,
      hash,
      JSON.stringify(request),
      JSON.stringify(ceiling),
      state,
      'fixture',
      time,
      JSON.stringify(result),
      `video_cost:${request.generationRequestId}`,
    );
  return request;
}

function tts(
  f: ReturnType<typeof campaignFinanceFixture>,
  i: number,
  state = 'SUBMITTING',
  actual: string | null = null,
) {
  const config = {
    schemaVersion: 'campaign-audio/1.0.0',
    campaignId: `camp_00${i}`,
    revision: 1,
    language: 'pt-BR',
    provider: 'openai',
    voice: 'marin',
    style: 'informative',
    mode: 'REPLACE',
    originalGainDb: 0,
    narrationGainDb: 0,
  };
  const configurationHash = ttsHash(config);
  const operation = {
    sourceId: `source_00${i}`,
    pipelineRunId: `run_00${i}`,
    audioConfigId: `audio_config:${configurationHash}`,
    narration: 'Conheça os detalhes deste produto.',
    maxDurationMilliseconds: 10000,
  };
  const providerConfiguration = {
    model: 'gpt-4o-mini-tts',
    voice: 'marin',
    policyVersion: 'openai-voice-policy/2.0.0',
    audioFormat: 'wav',
  };
  const request = ttsRequest({
    operationId: `tts_00${i}`,
    operation,
    operationHash: ttsHash(operation),
    audioConfiguration: {
      id: operation.audioConfigId,
      config,
      contentHash: configurationHash,
    },
    providerConfiguration,
    providerConfigurationHash: ttsHash({
      provider: 'openai',
      ...providerConfiguration,
    }),
    source: {
      generationRequestId: operation.sourceId,
      requestHash: 'a'.repeat(64),
      sourceContentHash: 'b'.repeat(64),
    },
    estimatedCost: {
      currency: 'USD',
      amount: '0.00306',
      proposedInternalAllowanceUsd: '0.01',
      guaranteedMaximum: false,
    },
  });
  const hash = ttsHash(request);
  const approval = ttsApproval(request, {
    acceptsUnboundedCost: true,
    approvalReference: 'fixture/approval',
    approvedAt: time,
    approvedBy: 'fixture',
    requestHash: hash,
  });
  f.legacy.db
    .prepare('INSERT INTO tts_financial_approvals VALUES(?,?,?,?)')
    .run(
      request.operationId,
      hash,
      JSON.stringify(request),
      JSON.stringify(approval),
    );
  f.legacy.db
    .prepare('INSERT INTO tts_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      request.operationId,
      hash,
      hash,
      request.campaignId,
      JSON.stringify(request),
      state,
      time,
      null,
      actual === null
        ? null
        : JSON.stringify({
            actualCostUsd: actual,
            evidenceReference: 'fixture:bill',
          }),
      null,
      null,
      null,
    );
  return request;
}

function service(path: string) {
  return new FinanceService({ open: () => new FinanceSession(path) });
}

describe('Finance read-only production readiness', () => {
  it('exposes policy, exact usage and technical scope without authorizing spending', () => {
    const f = financeFixture();
    try {
      const finance = service(f.path);
      const result = finance.getGlobalReadiness(time);
      expect(result).toMatchObject({
        schemaVersion: 'finance-readiness/1.0.0',
        evaluatedAt: time,
        status: 'READY',
        scope: 'TECHNICAL_ONLY',
        operationalAcceptance: 'NOT_ASSESSED',
        spendingAuthorized: false,
        timeZone: 'America/Sao_Paulo',
        daily: {
          period: '2026-10-13',
          limitUsd: '1',
          committedUsd: '0',
          recordedCostUsd: '0',
          reservedLiabilityUsd: '0',
          remainingUsd: '1',
        },
        monthly: { period: '2026-10', limitUsd: '20', remainingUsd: '20' },
        operations: [],
        reasons: [],
      });
      expect(result.usage).toEqual(finance.getGlobalUsage(time));
    } finally {
      f.close();
    }
  });

  it('retains UNKNOWN liability across restart and periods, and distinguishes evidenced zero', () => {
    const f = financeFixture();
    try {
      const finance = service(f.path);
      finance.reserveGlobal(proof(), time);
      expect(finance.getGlobalReadiness(time)).toMatchObject({
        status: 'NOT_READY',
        daily: { recordedCostUsd: '0', reservedLiabilityUsd: '0.6' },
        operations: [
          {
            source: 'GLOBAL',
            operationId: 'a',
            state: 'RESERVED',
            actualCostUsd: null,
          },
        ],
        reasons: expect.arrayContaining(['ACTIVE_RESERVATIONS']),
      });
      finance.dispatchGlobal('a', time);
      expect(finance.getGlobalReadiness(time).reasons).toContain(
        'OPERATIONS_IN_FLIGHT',
      );
      finance.unknownGlobal('a');
      const reopened = service(f.path);
      const later = reopened.getGlobalReadiness('2026-11-01T12:00:00Z');
      expect(later.daily.committedUsd).toBe('0.6');
      expect(later.monthly.committedUsd).toBe('0.6');
      expect(later.operations[0].actualCostUsd).toBeNull();
      expect(later.reasons).toEqual(
        expect.arrayContaining([
          'UNKNOWN_OPERATIONS',
          'COST_EVIDENCE_UNAVAILABLE',
        ]),
      );
      expect(() =>
        reopened.settleGlobal('a', {
          actualCostUsd: '0',
          evidenceReference: '',
        }),
      ).toThrow('GLOBAL_BILLING_INVALID');
      reopened.settleGlobal('a', {
        actualCostUsd: '0',
        evidenceReference: 'fixture:zero-receipt',
      });
      expect(reopened.getGlobalReadiness(time)).toMatchObject({
        status: 'READY',
        operations: [
          { actualCostUsd: '0', evidenceReference: 'fixture:zero-receipt' },
        ],
        daily: {
          committedUsd: '0.6',
          recordedCostUsd: '0',
          reservedLiabilityUsd: '0.6',
        },
      });
      expect(
        reopened.getGlobalReadiness('2026-11-01T12:00:00Z').daily.committedUsd,
      ).toBe('0');
    } finally {
      f.close();
    }
  });

  it('does not equate successful transport with financial reconciliation', async () => {
    const f = financeFixture();
    try {
      const finance = service(f.path),
        transport = vi.fn(async () => ({ mock: true }));
      await finance.executePaid(proof(), transport, time);
      await service(f.path).executePaid(proof(), transport, time);
      expect(transport).toHaveBeenCalledTimes(1);
      const result = finance.getGlobalReadiness(time);
      expect(result.status).toBe('NOT_READY');
      expect(result.reasons).toContain('COST_EVIDENCE_UNAVAILABLE');
      expect(result.operations[0].actualCostUsd).toBeNull();
      expect(result.daily.committedUsd).toBe('0.6');
    } finally {
      f.close();
    }
  });

  it.each([
    ['2026-10-14T02:59:59.999Z', '2026-10-14T03:00:00.000Z', '0.6'],
    ['2026-11-01T02:59:59.999Z', '2026-11-01T03:00:00.000Z', '0'],
  ])(
    'uses the policy timezone at %s, with nonzero reconciled costs',
    (before, after, monthly) => {
      const f = financeFixture();
      try {
        const finance = service(f.path);
        finance.reserveGlobal(proof(), before);
        finance.dispatchGlobal('a', before);
        finance.settleGlobal('a', {
          actualCostUsd: '0.2',
          evidenceReference: 'fixture:bill',
        });
        const current = finance.getGlobalReadiness(before),
          next = finance.getGlobalReadiness(after);
        expect(current.daily).toMatchObject({
          committedUsd: '0.6',
          recordedCostUsd: '0.2',
          reservedLiabilityUsd: '0.4',
        });
        expect(next.daily).toMatchObject({
          committedUsd: '0',
          recordedCostUsd: '0',
          remainingUsd: '1',
        });
        expect(next.monthly.committedUsd).toBe(monthly);
        expect(next.usage).toEqual(finance.getGlobalUsage(after));
      } finally {
        f.close();
      }
    },
  );

  it('follows a configured timezone instead of assuming the default', () => {
    const f = financeFixture();
    try {
      const finance = service(f.path);
      finance.configureGlobal({ timeZone: 'UTC' });
      finance.reserveGlobal(proof(), '2026-10-31T23:59:59.999Z');
      finance.dispatchGlobal('a');
      finance.settleGlobal('a', {
        actualCostUsd: '0.1',
        evidenceReference: 'fixture:utc',
      });
      expect(finance.getGlobalReadiness('2026-11-01T00:00:00Z')).toMatchObject({
        timeZone: 'UTC',
        daily: { period: '2026-11-01', committedUsd: '0' },
        monthly: { period: '2026-11', committedUsd: '0' },
      });
    } finally {
      f.close();
    }
  });

  it('shares recorded costs across campaigns and rejects a one-unit decimal overrun', () => {
    const f = campaignFinanceFixture();
    try {
      const finance = service(f.path);
      finance.register(cost({ amount: '0.499999999999999999' }));
      finance.register(
        cost({
          costEventId: 'cost_002',
          pipelineRunId: 'run_002',
          amount: '0.5',
        }),
      );
      expect(finance.getGlobalReadiness(time).daily).toMatchObject({
        recordedCostUsd: '0.999999999999999999',
        remainingUsd: '0.000000000000000001',
      });
      finance.reserveGlobal(proof('a', '0.000000000000000001'), time);
      expect(finance.getGlobalReadiness(time).reasons).toContain(
        'DAILY_BUDGET_EXHAUSTED',
      );
      expect(() =>
        finance.reserveGlobal(proof('b', '0.000000000000000001'), time),
      ).toThrow('GLOBAL_DAILY_BUDGET_EXCEEDED');
      expect(finance.getGlobalReadiness(time).daily.committedUsd).toBe('1');
    } finally {
      f.close();
    }
  });

  it('reports monthly exhaustion and preserves the transactional gate after a ready snapshot', () => {
    const f = financeFixture();
    try {
      const finance = service(f.path);
      for (let day = 1; day <= 20; day++) {
        const at = `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`;
        const p = {
          ...proof('a', '1'),
          operationId: `op_${day}`,
          requestHash: day.toString(16).padStart(64, '0'),
        };
        finance.reserveGlobal(p, at);
        finance.dispatchGlobal(p.operationId, at);
        finance.settleGlobal(p.operationId, {
          actualCostUsd: '1',
          evidenceReference: 'fixture:bill',
        });
      }
      const at = '2026-10-21T12:00:00Z';
      expect(finance.getGlobalReadiness(at)).toMatchObject({
        status: 'NOT_READY',
        daily: { remainingUsd: '1' },
        monthly: {
          committedUsd: '20',
          recordedCostUsd: '20',
          remainingUsd: '0',
        },
        reasons: ['MONTHLY_BUDGET_EXHAUSTED'],
      });
      expect(() =>
        finance.reserveGlobal(proof('b', '0.000000000000000001'), at),
      ).toThrow('GLOBAL_MONTHLY_BUDGET_EXCEEDED');
      const next = '2026-11-01T12:00:00Z';
      expect(finance.getGlobalReadiness(next).status).toBe('READY');
      finance.reserveGlobal(proof('b', '1'), next);
      expect(() => finance.reserveGlobal(proof('c', '0.1'), next)).toThrow(
        'GLOBAL_DAILY_BUDGET_EXCEEDED',
      );
    } finally {
      f.close();
    }
  });

  it('uses the existing aggregation for Video, TTS and overlapping manual reservations', () => {
    const f = campaignFinanceFixture();
    try {
      video(f, 1, 'UNKNOWN', null);
      tts(f, 1, 'SUBMITTING');
      const finance = service(f.path);
      finance.reserveGlobal(
        {
          ...proof('a', '0.01'),
          kind: 'MANUAL_TTS_RESERVATION',
          sourceTtsId: 'tts_001',
        },
        time,
        { authorizationMode: 'MANUAL' },
      );
      const result = finance.getGlobalReadiness(time);
      expect(result.usage).toEqual(finance.getGlobalUsage(time));
      expect(result.daily.committedUsd).toBe('0.16');
      expect(result.operations).toHaveLength(2);
      expect(result.operations.map((op) => op.source).sort()).toEqual([
        'TTS',
        'VIDEO',
      ]);
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          'UNKNOWN_OPERATIONS',
          'OPERATIONS_IN_FLIGHT',
          'COST_EVIDENCE_UNAVAILABLE',
        ]),
      );
    } finally {
      f.close();
    }
  });

  it('reads a single snapshot without initializing an absent policy or changing data', () => {
    const f = financeFixture(),
      session = new FinanceSession(f.path);
    try {
      session.db.exec('PRAGMA query_only=ON');
      expect(session.getGlobalReadiness(time).status).toBe('READY');
      expect(() => session.getGlobalReadiness('invalid')).toThrow(
        'GLOBAL_TIME_INVALID',
      );
      expect(session.db.isTransaction).toBe(false);
      session.db.exec('PRAGMA query_only=OFF');
      session.db.exec('DELETE FROM global_finance_policy');
      session.db.exec('PRAGMA query_only=ON');
      expect(() => session.getGlobalReadiness(time)).toThrow(
        'FINANCE_POLICY_REQUIRED',
      );
      expect(
        session.db.prepare('SELECT count(*) n FROM global_finance_policy').get()
          .n,
      ).toBe(0);
      expect(session.db.isTransaction).toBe(false);
    } finally {
      session.close();
      f.close();
    }
  });

  it('reports a breached ceiling without weakening the reservation gate', () => {
    const f = financeFixture();
    try {
      const finance = service(f.path);
      finance.reserveGlobal(proof(), time);
      finance.dispatchGlobal('a');
      finance.settleGlobal('a', {
        actualCostUsd: '1.1',
        evidenceReference: 'fixture:overrun',
      });
      expect(finance.getGlobalReadiness(time)).toMatchObject({
        status: 'NOT_READY',
        daily: {
          committedUsd: '1.1',
          recordedCostUsd: '1.1',
          reservedLiabilityUsd: '0',
          remainingUsd: '0',
        },
        reasons: expect.arrayContaining([
          'PRICE_CEILING_BREACHED',
          'DAILY_BUDGET_EXHAUSTED',
        ]),
      });
      expect(() => finance.getGlobalUsage(time)).toThrow(
        'GLOBAL_PRICE_CEILING_BREACHED',
      );
      expect(() => finance.reserveGlobal(proof('b', '0.1'), time)).toThrow(
        'GLOBAL_PRICE_CEILING_BREACHED',
      );
    } finally {
      f.close();
    }
  });

  it('keeps a TTS estimate distinct from actual billing until reconciliation adjusts the ledger', () => {
    const f = campaignFinanceFixture();
    try {
      tts(f, 1, 'UNKNOWN', '0.001');
      const finance = service(f.path);
      finance.register(
        cost({
          costEventId: 'tts_cost:tts_001',
          category: 'voice_cost',
          origin: 'openai',
          amount: '0.00306',
        }),
      );
      expect(finance.getGlobalReadiness(time)).toMatchObject({
        status: 'NOT_READY',
        daily: {
          committedUsd: '0.01',
          recordedCostUsd: '0.001',
          reservedLiabilityUsd: '0.009',
        },
        operations: [{ actualCostUsd: '0.001', reconciliationRequired: true }],
      });
      finance.recordTtsResult('tts_001', {
        audio: {
          durationMilliseconds: 9000,
          audioFormat: 'wav',
          contentHash: 'c'.repeat(64),
          storageReference: `object:voice/sha256/${'c'.repeat(64)}`,
          provider: 'openai',
          origin: 'SYNTHETIC_TTS',
          rights: { usageBasis: 'PROVIDER_TERMS', commercialUseAllowed: true },
        },
      });
      finance.reconcileTts('tts_001', 'fixture:reconciliation');
      const reconciled = service(f.path).getGlobalReadiness(time);
      expect(reconciled).toMatchObject({
        status: 'READY',
        daily: {
          committedUsd: '0.001',
          recordedCostUsd: '0.001',
          reservedLiabilityUsd: '0',
        },
        operations: [{ actualCostUsd: '0.001', reconciliationRequired: false }],
      });
      expect(finance.getTtsStatementV2('tts_001').adjustments).toHaveLength(1);
      finance.reconcileTts('tts_001', 'fixture:reconciliation');
      expect(finance.getGlobalReadiness(time)).toEqual(reconciled);
    } finally {
      f.close();
    }
  });

  it('exposes the same read-only contract over HTTP and keeps spending endpoints unavailable', async () => {
    const f = financeFixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(time));
    const module = await Test.createTestingModule({ imports: [FinanceModule] })
      .overrideProvider(FINANCE_DATABASE)
      .useValue(f.path)
      .compile();
    const app = module.createNestApplication();
    try {
      await app.init();
      const finance = app.get(FinanceService);
      finance.reserveGlobal(proof(), time);
      finance.dispatchGlobal('a');
      finance.unknownGlobal('a');
      const response = await request(app.getHttpServer())
        .get('/finance/readiness')
        .expect(200);
      expect(response.body).toEqual(finance.getGlobalReadiness());
      await request(app.getHttpServer())
        .post('/finance/readiness')
        .send({})
        .expect(404);
      await request(app.getHttpServer())
        .post('/finance/reservations')
        .send(proof())
        .expect(404);
      f.legacy.db.exec('DELETE FROM global_finance_policy');
      const missing = await request(app.getHttpServer())
        .get('/finance/readiness')
        .expect(500);
      expect(missing.body.code).toBe('FINANCE_POLICY_REQUIRED');
    } finally {
      await app.close();
      f.close();
      vi.useRealTimers();
    }
  });
});
