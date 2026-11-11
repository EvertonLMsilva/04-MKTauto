import { readFileSync } from 'node:fs';
import { FinanceService } from '../finance/application/finance.service.js';
import { migrateFinance40 } from '../finance/infrastructure/finance-schema-migration.js';
import { FinanceSession } from '../finance/infrastructure/finance.session.js';
import { ttsFinanceFixture } from '../../../test/support/tts-finance-fixture.js';
import { time } from '../../../test/support/finance-fixture.js';
import { ttsHash } from '../finance/domain/tts-financial-contracts.js';
import { NarrationService } from './application/narration.service.js';

describe('non-executing Media narration', () => {
  let f: ReturnType<typeof ttsFinanceFixture>;
  let finance: FinanceService;
  let media: NarrationService;
  beforeEach(() => {
    f = ttsFinanceFixture();
    migrateFinance40(
      f.legacy.db,
      readFileSync(
        new URL(
          '../../infrastructure/database/migrations/040_financial_adjustments.sql',
          import.meta.url,
        ),
        'utf8',
      ),
      time,
    );
    finance = new FinanceService({ open: () => new FinanceSession(f.path) });
    // The application receives only the authorized public Finance methods.
    media = new NarrationService({
      approveTts: finance.approveTts.bind(finance),
      getTts: finance.getTts.bind(finance),
      reconcileTts: finance.reconcileTts.bind(finance),
    });
  });
  afterEach(() => f.close());
  const historical = () => {
    finance.approveTts(f.plan, f.approval);
    finance.beginTts(f.plan, time);
    finance.markTtsUnknown('tts_001', 'TTS_TIMEOUT');
  };
  const evidence = (durationMilliseconds = 9000) => {
    finance.recordTtsResult('tts_001', {
      audio: { ...f.audio, durationMilliseconds },
      providerRequestId: 'historical_request',
      billing: { actualCostUsd: '0.004', evidenceReference: 'fixture/invoice' },
    });
  };

  it('prepares unchanged request hashes and approves idempotently without an operation', () => {
    expect(media.prepare(f.plan)).toEqual({
      request: f.request,
      requestHash: ttsHash(f.request),
    });
    expect(media.approve({ plan: f.plan, approval: f.approval })).toEqual(
      f.approval,
    );
    expect(media.approve({ plan: f.plan, approval: f.approval })).toEqual(
      f.approval,
    );
    expect(media.get('tts_001')).toBeNull();
    expect(f.legacy.db.prepare('PRAGMA user_version').get().user_version).toBe(
      40,
    );
    expect(
      f.legacy.db.prepare('SELECT COUNT(*) AS n FROM tts_operations').get().n,
    ).toBe(0);
    expect(
      f.legacy.db
        .prepare('SELECT COUNT(*) AS n FROM tts_financial_approvals')
        .get().n,
    ).toBe(1);
  });

  it('rejects changed approval identity without overwriting history', () => {
    media.approve({ plan: f.plan, approval: f.approval });
    expect(() =>
      media.approve({
        plan: f.plan,
        approval: {
          ...f.approval,
          approvalReference: 'fixture/other',
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'TTS_IDENTITY_CONFLICT' }));
    expect(media.approve({ plan: f.plan, approval: f.approval })).toEqual(
      f.approval,
    );
  });

  it('reads UNKNOWN without accounting or redispatch and rejects missing historical evidence', () => {
    historical();
    const before = finance.getTts('tts_001');
    expect(media.get('tts_001')).toEqual(before);
    expect(() =>
      media.reconcile('tts_001', { evidenceReference: 'fixture/reconcile' }),
    ).toThrow(expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }));
    expect(media.get('tts_001')).toEqual(before);
    expect(finance.getLedgerByPipelineRun('run_001').events).toHaveLength(0);
  });

  it.each([
    [9000, 'COMPLETED'],
    [11000, 'REVIEW_REQUIRED'],
  ])(
    'reads existing artifacts and reconciles %s ms as %s with exact replay',
    (duration, state) => {
      historical();
      evidence(Number(duration));
      const before = media.get('tts_001')!;
      expect(before.audio).toEqual({
        ...f.audio,
        durationMilliseconds: duration,
      });
      expect(before.billing!.actualCostUsd).toBe('0.004');
      const body = { evidenceReference: 'fixture/reconcile' };
      const result = media.reconcile('tts_001', body);
      expect(result.state).toBe(state);
      expect(result.requestHash).toBe(before.requestHash);
      expect(result.audio).toEqual(before.audio);
      expect(result.providerRequestId).toBe('historical_request');
      expect(media.reconcile('tts_001', body)).toEqual(result);
      expect(finance.getLedgerByPipelineRun('run_001').events).toHaveLength(1);
      expect(() =>
        media.reconcile('tts_001', { evidenceReference: 'fixture/other' }),
      ).toThrow(expect.objectContaining({ code: 'TTS_IDENTITY_CONFLICT' }));
    },
  );

  it('retains UNKNOWN and artifacts when reconciliation accounting rolls back', () => {
    historical();
    evidence();
    const before = media.get('tts_001');
    f.legacy.db.exec(
      "CREATE TRIGGER fail_narration_cost BEFORE INSERT ON cost_events BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    expect(() =>
      media.reconcile('tts_001', { evidenceReference: 'fixture/reconcile' }),
    ).toThrow();
    expect(media.get('tts_001')).toEqual(before);
    expect(finance.getLedgerByPipelineRun('run_001').events).toHaveLength(0);
  });

  it('preserves the original financial event when reconciling historical estimates', () => {
    historical();
    finance.accountTts('tts_001');
    const original = finance.getLedgerByPipelineRun('run_001');
    evidence();
    media.reconcile('tts_001', { evidenceReference: 'fixture/reconcile' });
    expect(finance.getLedgerByPipelineRun('run_001')).toEqual(original);
    expect(finance.getTtsStatementV2('tts_001').netCostUsd).toBe('0.004');
  });

  it('rejects malformed envelopes and evidence before calling Finance', () => {
    expect(() =>
      media.approve({ plan: f.plan, approval: f.approval, dispatch: true }),
    ).toThrow(expect.objectContaining({ code: 'TTS_PREPARATION_INVALID' }));
    expect(() =>
      media.reconcile('tts_001', { evidenceReference: ' ' }),
    ).toThrow(expect.objectContaining({ code: 'TTS_RECONCILIATION_REQUIRED' }));
    expect(() =>
      media.reconcile('tts_001', {
        evidenceReference: 'fixture/ref',
        audio: f.audio,
      }),
    ).toThrow(expect.objectContaining({ code: 'TTS_PREPARATION_INVALID' }));
    expect(() =>
      media.prepare({ ...f.plan, operationHash: 'a'.repeat(64) }),
    ).toThrow(expect.objectContaining({ code: 'TTS_INVALID_PLAN' }));
  });
});
