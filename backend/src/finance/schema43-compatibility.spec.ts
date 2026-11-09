import { p2EditorialFixture } from '../../test/support/p2-editorial-fixture.js';
import { FinanceSession } from './infrastructure/finance.session.js';
import { provisionSchema } from '../administration/schema-provisioner.js';
import { ttsHash } from './domain/tts-financial-contracts.js';
import { adjustmentHash } from './domain/cost-adjustment-contracts.js';

test('42 to 43 preserves actual adjustment rows, precision and idempotent registration', () => {
  const f = p2EditorialFixture(),
    db = f.base.db,
    time = '2026-11-08T13:00:00.000Z';
  let session: FinanceSession | undefined;
  try {
    provisionSchema(db, 42);
    const request = {
      operationId: 'tts_schema43',
      campaignId: 'camp_001',
      reservationUsd: '0.01',
      operation: { pipelineRunId: 'run_001' },
    };
    const billing = {
      actualCostUsd: '0.003060000000000001',
      evidenceReference: 'fixture/invoice',
    };
    db.prepare(
      'INSERT INTO video_generation_campaign_budgets VALUES(?,?,?,?)',
    ).run('camp_001', 1, 'project_001', '{}');
    db.prepare('INSERT INTO tts_financial_approvals VALUES(?,?,?,?)').run(
      'tts_schema43',
      ttsHash(request),
      JSON.stringify(request),
      '{}',
    );
    db.prepare(
      "INSERT INTO tts_operations VALUES(?,?,?,?,?,'COMPLETED',?,NULL,?,? ,NULL,NULL)",
    ).run(
      'tts_schema43',
      ttsHash(request),
      ttsHash(request),
      'camp_001',
      JSON.stringify(request),
      time,
      JSON.stringify(billing),
      'fixture/reconciliation',
    );
    session = new FinanceSession(f.database);
    session.configureGlobal();
    session.register({
      schemaVersion: 'cost-event/1.0.0',
      costEventId: 'tts_cost:tts_schema43',
      category: 'voice_cost',
      pipelineRunId: 'run_001',
      projectId: 'project_001',
      projectVersion: 1,
      contentIdentity: null,
      artifactId: null,
      amount: '0.00306',
      currency: 'USD',
      occurredAt: time,
      origin: 'openai',
      attributionRuleVersion: 'fixture/1.0.0',
      recordedAt: time,
    });
    const raw = {
      schemaVersion: 'cost-adjustment/2.0.0' as const,
      adjustmentId: 'adjustment_schema43',
      originalCostEventId: 'tts_cost:tts_schema43',
      ttsOperationId: 'tts_schema43',
      deltaUnits: '1',
      currency: 'USD' as const,
      evidenceReference: 'fixture/invoice',
      evidenceHash: ttsHash(billing),
      idempotencyKey: 'schema43_adjustment',
      createdAt: time,
    };
    const adjustment = { ...raw, contentHash: adjustmentHash(raw) };
    session.registerTtsAdjustment(adjustment);
    const statement = session.getTtsStatementV2('tts_schema43'),
      usage = session.getGlobalUsage(time);
    session.close();
    session = undefined;
    const history = db
        .prepare('SELECT * FROM cost_events ORDER BY cost_event_id')
        .all(),
      adjustments = db
        .prepare('SELECT * FROM cost_adjustments ORDER BY adjustment_id')
        .all();
    provisionSchema(db, 43);
    session = new FinanceSession(f.database);
    try {
      expect(session.getTtsStatementV2('tts_schema43')).toEqual(statement);
      expect(
        session.getTtsStatementV2('tts_schema43').adjustments[0].deltaUnits,
      ).toBe('1');
      expect(session.getGlobalUsage(time)).toEqual(usage);
      expect(usage.policy.daily_usd).toBe('1');
      expect(usage.policy.monthly_usd).toBe('20');
      session.registerTtsAdjustment(adjustment);
      expect(
        db.prepare('SELECT * FROM cost_events ORDER BY cost_event_id').all(),
      ).toEqual(history);
      expect(
        db
          .prepare('SELECT * FROM cost_adjustments ORDER BY adjustment_id')
          .all(),
      ).toEqual(adjustments);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      session.close();
      session = undefined;
    }
  } finally {
    session?.close();
    f.cleanup();
  }
});
