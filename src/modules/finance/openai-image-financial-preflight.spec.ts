import { describe, it, expect, vi } from 'vitest';
import { imageFinancialRequestHash } from './domain/openai-image-financial-contracts.js';
import { OpenAIImageFinancialPreflight } from './application/openai-image-financial-preflight.js';
import type {
  ImageFinancialReadPort,
  ImageFinancialSnapshot,
} from './application/openai-image-financial-preflight.js';
const at = '2026-11-12T12:00:00Z';
function request(change: (b: any) => void = () => {}) {
  const b: any = {
    schemaVersion: 'openai-image-financial-request/1.0.0',
    operationId: 'image_001',
    projectId: 'project_001',
    projectVersion: 1,
    campaign: null,
    pipelineRunId: null,
    model: 'gpt-image-fixture',
    modelVersion: 'fixture-2026-11',
    quality: 'high',
    resolution: { width: 1024, height: 1024 },
    operationType: 'GENERATE',
    billingMode: 'IMAGES_STANDARD_UNCACHED_NON_STREAMING',
    imageCount: 1,
    referenceHashes: [],
    payloadHash: 'a'.repeat(64),
    tokensPerImage: { textInput: '100', imageInput: '0', imageOutput: '1000' },
    proposedMaximumUsd: '0.1',
    tariff: {
      model: 'gpt-image-fixture',
      modelVersion: 'fixture-2026-11',
      quality: 'high',
      resolution: { width: 1024, height: 1024 },
      operationType: 'GENERATE',
      billingMode: 'IMAGES_STANDARD_UNCACHED_NON_STREAMING',
      reference: 'https://developers.openai.com/api/docs/pricing',
      tariffDate: '2026-11-12T00:00:00Z',
      validUntil: '2026-11-13T00:00:00Z',
      textInputUsdPerMillion: '2',
      imageInputUsdPerMillion: '3',
      imageOutputUsdPerMillion: '10',
    },
  };
  change(b);
  return { ...b, requestHash: imageFinancialRequestHash(b) };
}
function fixture(r = request()) {
  const scope = {
    projectId: r.projectId,
    projectVersion: r.projectVersion,
    campaign: r.campaign,
    pipelineRunId: r.pipelineRunId,
  };
  const period = (period: string, limitUsd: string) => ({
    period,
    limitUsd,
    committedUsd: '0',
    recordedCostUsd: '0',
    reservedLiabilityUsd: '0',
    remainingUsd: limitUsd,
  });
  const snapshot: ImageFinancialSnapshot = {
    scope,
    global: {
      schemaVersion: 'finance-readiness/1.0.0',
      evaluatedAt: at,
      status: 'READY',
      scope: 'TECHNICAL_ONLY',
      operationalAcceptance: 'NOT_ASSESSED',
      spendingAuthorized: false,
      timeZone: 'America/Sao_Paulo',
      usage: {
        dailyUsd: '0',
        monthlyUsd: '0',
        policy: {
          singleton: 1,
          daily_usd: '1',
          monthly_usd: '20',
          time_zone: 'America/Sao_Paulo',
        },
      },
      daily: period('2026-11-12', '1'),
      monthly: period('2026-11', '20'),
      operations: [],
      reasons: [],
    },
    campaign: null,
    operation: null,
  };
  const read = vi.fn(() => snapshot);
  const port: ImageFinancialReadPort = { read };
  return { snapshot, read, service: new OpenAIImageFinancialPreflight(port) };
}
describe('OpenAI Images offline financial preflight', () => {
  it('estimates one image exactly without authorizing or reserving', () => {
    const r = request(),
      f = fixture(r),
      before = JSON.stringify(f.snapshot),
      result = f.service.evaluate(r, at);
    expect(result).toMatchObject({
      schemaVersion: 'openai-image-financial-preflight/1.0.0',
      operationId: 'image_001',
      requestHash: r.requestHash,
      estimateStatus: 'ESTIMATE_DOCUMENTED',
      textInputCostUsd: '0.0002',
      imageInputCostUsd: '0',
      outputImageCostUsd: '0.01',
      totalEstimatedUsd: '0.0102',
      requiredBudgetUsd: '0.1',
      authorizedCeilingUsd: null,
      executionAllowed: false,
    });
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'AUTHORIZATION_REQUIRED',
        'RESERVATION_REQUIRED',
      ]),
    );
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.snapshot)).toBe(before);
  });
  it('scales all per-image quantities for 120 planned images and refuses insufficient global budget', () => {
    const r = request((b) => (b.imageCount = 120)),
      f = fixture(r),
      v = f.service.evaluate(r, at);
    expect(v.totalEstimatedUsd).toBe('1.224');
    expect(v.outputImageCostUsd).toBe('1.2');
    expect(v.requiredBudgetUsd).toBe('1.224');
    expect(v.blockers).toContain('BUDGET_INSUFFICIENT');
    expect(v.blockers).toContain('PROPOSED_CEILING_BELOW_ESTIMATE');
  });
  it('counts image inputs for multiple edit references; their hashes alone are not token counts', () => {
    const r = request((b) => {
      b.operationType = 'EDIT';
      b.tariff.operationType = 'EDIT';
      b.referenceHashes = ['b'.repeat(64), 'c'.repeat(64)];
      b.tokensPerImage.imageInput = '2000';
    });
    expect(fixture(r).service.evaluate(r, at).imageInputCostUsd).toBe('0.006');
    const unknown = request((b) => {
      b.operationType = 'EDIT';
      b.tariff.operationType = 'EDIT';
      b.referenceHashes = ['b'.repeat(64)];
      b.tokensPerImage.imageInput = null;
    });
    const v = fixture(unknown).service.evaluate(unknown, at);
    expect(v.totalEstimatedUsd).toBeNull();
    expect(v.outputImageCostUsd).toBe('0.01');
    expect(v.estimateStatus).toBe('ESTIMATE_PARTIAL');
  });
  it.each([
    'missing',
    'stale',
    'future',
    'wrong_model',
    'wrong_version',
    'wrong_quality',
    'wrong_resolution',
    'wrong_type',
    'missing_rate',
  ])('does not treat %s pricing as a complete estimate', (kind) => {
    const r = request((b) => {
      if (kind === 'missing') b.tariff = null;
      if (kind === 'stale') b.tariff.validUntil = '2026-11-12T01:00:00Z';
      if (kind === 'future') {
        b.tariff.tariffDate = '2026-11-13T00:00:00Z';
        b.tariff.validUntil = '2026-11-14T00:00:00Z';
      }
      if (kind === 'wrong_model') b.tariff.model = 'other';
      if (kind === 'wrong_version') b.tariff.modelVersion = 'other';
      if (kind === 'wrong_quality') b.tariff.quality = 'low';
      if (kind === 'wrong_resolution') b.tariff.resolution.width = 1536;
      if (kind === 'wrong_type') b.tariff.operationType = 'EDIT';
      if (kind === 'missing_rate') b.tariff.textInputUsdPerMillion = null;
    });
    const v = fixture(r).service.evaluate(r, at);
    expect(v.totalEstimatedUsd).toBeNull();
    expect(v.estimateStatus).not.toBe('ESTIMATE_DOCUMENTED');
    expect(v.blockers).toContain('COST_UNKNOWN');
  });
  it('retains unknown counts, including missing output tokens, as unknown rather than zero', () => {
    const r = request((b) => {
        b.tokensPerImage = {
          textInput: null,
          imageInput: null,
          imageOutput: null,
        };
      }),
      v = fixture(r).service.evaluate(r, at);
    expect(v.estimateStatus).toBe('COST_UNKNOWN');
    expect(v.totalEstimatedUsd).toBeNull();
    expect(v.outputImageCostUsd).toBeNull();
  });
  it('represents a fractional attodollar exactly and compares without rounding', () => {
    const r = request((b) => {
        b.tokensPerImage = {
          textInput: '1',
          imageInput: '0',
          imageOutput: '0',
        };
        b.tariff.textInputUsdPerMillion = '0.000000000000000001';
      }),
      v = fixture(r).service.evaluate(r, at);
    expect(v.totalEstimatedUsd).toBe('0.000000000000000000000001');
    expect(v.executionAllowed).toBe(false);
  });
  it.each(['daily', 'monthly', 'campaign'] as const)(
    'checks %s capacity including existing liabilities',
    (kind) => {
      const r = request((b) => {
          if (kind === 'campaign')
            b.campaign = { campaignId: 'camp_001', revision: 1 };
        }),
        f = fixture(r);
      if (kind === 'campaign')
        f.snapshot.campaign = {
          campaignId: 'camp_001',
          totalUsd: '1',
          committedUsd: '0.95',
          reservedSubmissions: 1,
          paidSubmissions: 0,
          hasUnknown: false,
          hasCeilingBreach: false,
        };
      else {
        const p = f.snapshot.global![kind];
        p.committedUsd = kind === 'daily' ? '0.95' : '19.95';
        p.recordedCostUsd = '0';
        p.reservedLiabilityUsd = p.committedUsd;
        p.remainingUsd = '0.05';
        f.snapshot.global!.usage[kind === 'daily' ? 'dailyUsd' : 'monthlyUsd'] =
          p.committedUsd;
      }
      expect(f.service.evaluate(r, at).blockers).toContain(
        'BUDGET_INSUFFICIENT',
      );
    },
  );
  it.each([
    'project',
    'campaign',
    'revision',
    'pipeline',
    'stale',
    'missing',
    'inconsistent',
  ])('fails closed on %s budget context', (kind) => {
    const r = request(
        (b) => (b.campaign = { campaignId: 'camp_001', revision: 1 }),
      ),
      f = fixture(r);
    if (kind === 'project') f.snapshot.scope.projectId = 'other';
    if (kind === 'campaign')
      f.snapshot.scope.campaign = { campaignId: 'other', revision: 1 };
    if (kind === 'revision')
      f.snapshot.scope.campaign = { campaignId: 'camp_001', revision: 2 };
    if (kind === 'pipeline') f.snapshot.scope.pipelineRunId = 'other';
    if (kind === 'stale')
      f.snapshot.global!.evaluatedAt = '2026-11-11T12:00:00Z';
    if (kind === 'missing') f.snapshot.global = null;
    if (kind === 'inconsistent') f.snapshot.global!.daily.remainingUsd = '999';
    const v = f.service.evaluate(r, at);
    expect(v.budgetStatus).toBe('UNVERIFIED');
    expect(v.executionAllowed).toBe(false);
  });
  it('replays stable snapshots without storing or dispatching an intent', () => {
    const r = request(),
      f = fixture(r),
      before = JSON.stringify(f.snapshot),
      a = f.service.evaluate(r, at),
      b = f.service.evaluate(r, at);
    expect(a).toEqual(b);
    expect(f.snapshot.operation).toBeNull();
    expect(JSON.stringify(f.snapshot)).toBe(before);
  });
  it.each([
    'NOT_SENT',
    'RESERVED',
    'SUBMITTING',
    'UNKNOWN',
    'COMPLETED',
    'REJECTED',
  ] as const)(
    'simulates %s recovery without releasing an uncertain operation',
    (state) => {
      const r = request(),
        f = fixture(r);
      f.snapshot.operation = {
        operationId: r.operationId,
        requestHash: r.requestHash,
        scope: f.snapshot.scope,
        state,
        actualCostUsd: null,
        billingEvidence: null,
      };
      const v = f.service.evaluate(r, at);
      expect(v.executionAllowed).toBe(false);
      expect(v.blockers).toContain('OPERATION_ALREADY_EXISTS');
      if (['SUBMITTING', 'UNKNOWN', 'COMPLETED', 'REJECTED'].includes(state))
        expect(v.blockers).toContain('RECONCILIATION_REQUIRED');
      expect(f.snapshot.operation.state).toBe(state);
    },
  );
  it('reports conflicts and changed observed costs without changing the estimate or ledger', () => {
    const r = request(),
      f = fixture(r);
    f.snapshot.operation = {
      operationId: r.operationId,
      requestHash: 'b'.repeat(64),
      scope: f.snapshot.scope,
      state: 'COMPLETED',
      actualCostUsd: '0.2',
      billingEvidence: 'fixture:invoice',
    };
    expect(f.service.evaluate(r, at).blockers).toContain(
      'OPERATION_IDENTITY_CONFLICT',
    );
    f.snapshot.operation.requestHash = r.requestHash;
    const v = f.service.evaluate(r, at);
    expect(v.blockers).toContain('OBSERVED_COST_DIFFERS');
    expect(v.observedCostUsd).toBe('0.2');
    expect(v.totalEstimatedUsd).toBe('0.0102');
  });
  it('requires evidence for an observed zero charge after rejection', () => {
    const r = request(),
      f = fixture(r);
    f.snapshot.operation = {
      operationId: r.operationId,
      requestHash: r.requestHash,
      scope: f.snapshot.scope,
      state: 'REJECTED',
      actualCostUsd: '0',
      billingEvidence: null,
    };
    expect(f.service.evaluate(r, at).blockers).toContain(
      'RECONCILIATION_REQUIRED',
    );
    f.snapshot.operation.billingEvidence = 'fixture:zero';
    expect(f.service.evaluate(r, at).recoveryStatus).toBe('RECONCILED');
  });
  it('propagates read failures and rejects invalid time before reading', () => {
    const r = request(),
      read = vi.fn(() => {
        throw new Error('read failed');
      }),
      s = new OpenAIImageFinancialPreflight({ read });
    expect(() => s.evaluate(r, at)).toThrow('read failed');
    read.mockClear();
    expect(() => s.evaluate(r, 'invalid')).toThrow(/IMAGE_FINANCIAL_/);
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['1000000', '1000001'])(
    'compares exact fractional costs at an attodollar boundary (%s tokens)',
    (quantity) => {
      const r = request((b) => {
        b.proposedMaximumUsd = '0.000000000000000001';
        b.tokensPerImage = {
          textInput: quantity,
          imageInput: '0',
          imageOutput: '0',
        };
        b.tariff.textInputUsdPerMillion = '0.000000000000000001';
      });
      const f = fixture(r),
        p = f.snapshot.global!.daily;
      p.committedUsd = '0.999999999999999999';
      p.reservedLiabilityUsd = p.committedUsd;
      p.remainingUsd = '0.000000000000000001';
      f.snapshot.global!.usage.dailyUsd = p.committedUsd;
      const result = f.service.evaluate(r, at);
      expect(result.blockers.includes('BUDGET_INSUFFICIENT')).toBe(
        quantity === '1000001',
      );
      expect(result.totalEstimatedUsd).toBe(
        quantity === '1000000'
          ? '0.000000000000000001'
          : '0.000000000000000001000001',
      );
    },
  );
  it('retains global uncertainty and refuses contradictory recovery evidence', () => {
    const r = request(),
      f = fixture(r);
    f.snapshot.global!.reasons = ['UNKNOWN_OPERATIONS'];
    f.snapshot.operation = {
      operationId: r.operationId,
      requestHash: r.requestHash,
      scope: f.snapshot.scope,
      state: 'NOT_SENT',
      actualCostUsd: '0.1',
      billingEvidence: 'fixture:unexpected-bill',
    };
    const result = f.service.evaluate(r, at);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'GLOBAL_UNKNOWN_OPERATIONS',
        'OPERATION_STATE_CONFLICT',
        'RECONCILIATION_REQUIRED',
      ]),
    );
    expect(result.recoveryStatus).toBe('UNCERTAIN');
    expect(result.executionAllowed).toBe(false);
  });
});
